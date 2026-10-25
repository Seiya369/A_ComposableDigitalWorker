/** Offline large-task adapter. CLI output contains tasks and visible source evidence, never gold. */
import { pathToFileURL } from 'node:url';
import { createContextPacket, countContextTokens, type ContextDocument, type ContextPacket, type ContextCursor } from '../src/knowledge/context.js';
import { createKnowledgeBudgetController, BUDGET_PRESETS } from './knowledge-budget-policy.js';
import { referenceTokenCounter, REFERENCE_TOKEN_COUNT_MODE, TOKEN_COUNTER_METADATA } from './knowledge-token-counter.js';
import { largeKnowledgeTasks, largeTaskDocumentKey, type LargeKnowledgeTask } from '../tests/fixtures/knowledge-context-large-tasks.js';

export type LargeBudgetName = 'tight' | 'target' | 'roomy';
export type LargeBudgetSnapshot = ReturnType<ReturnType<typeof createKnowledgeBudgetController>['snapshot']>;
export interface LargeTaskTrace {
  phase: string; packet: ContextPacket; maxTokens: number; packetTokens: number;
  activeTokens: number; accepted: boolean; neededNow: boolean; status: string; repeat: boolean;
}
export interface LargeTaskRun {
  taskId: string; budget: LargeBudgetName; countMode: string; trace: LargeTaskTrace[];
  snapshot: LargeBudgetSnapshot; errors: string[]; phasesCompleted: number;
  unresolvedContinuations: number; rereadDocumentKeys: string[];
  phaseSnapshots: Array<{ phase: string; snapshot: LargeBudgetSnapshot }>;
  recoveryReferences: unknown[];
}
const budgetNames: readonly LargeBudgetName[] = ['tight', 'target', 'roomy'];
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
const findDocument = (task: LargeKnowledgeTask, id: string, version: number, layer?: string) => task.documents.find(doc => doc.id === id && doc.version === version && (!layer || doc.layer === layer));

export function runLargeContextTask(task: LargeKnowledgeTask, budget: LargeBudgetName, untilPhase = task.phases.length): LargeTaskRun {
  const controller = createKnowledgeBudgetController({ preset: budget, counter: referenceTokenCounter, countMode: REFERENCE_TOKEN_COUNT_MODE, exactCounter: true,
    // Explicit test envelope, not a claim about the current answering model's context window.
    modelContextTokens: 1000000, reservedOutputTokens: 16000, otherInputTokens: 0 });
  const trace: LargeTaskTrace[] = []; const errors: string[] = []; const rereadDocumentKeys: string[] = [];
  const phaseSnapshots: LargeTaskRun['phaseSnapshots'] = [];
  let snapshot = controller.snapshot(); let unresolvedContinuations = 0; let phasesCompleted = 0;
  const visited = new Set<string>();
  const activate = (packet: ContextPacket, maxTokens: number, phase: string, neededNow: boolean, repeat = false) => {
    snapshot = controller.activate(packet, { neededNow });
    trace.push({ phase, packet, maxTokens, packetTokens: countContextTokens(packet, referenceTokenCounter),
      activeTokens: snapshot.tokenCount, accepted: snapshot.accepted, neededNow, status: snapshot.status, repeat });
    return snapshot.accepted;
  };
  const routing = task.documents.filter(doc => doc.layer === 'C');
  try { activate(createContextPacket(routing, { maxTokens: 1600, counter: referenceTokenCounter, countMode: REFERENCE_TOKEN_COUNT_MODE }), 1600, 'routing', true); }
  catch (error) { errors.push(`routing: ${errorMessage(error)}`); }
  // Read the compiled B directory once, then let its optional body yield to necessary source rows.
  const compiledRoute = task.documents.find(doc => doc.layer === 'B' && doc.id === 'route-index');
  if (compiledRoute) {
    const maxTokens = BUDGET_PRESETS[budget].bRead;
    try { activate(createContextPacket([compiledRoute], { maxTokens, counter: referenceTokenCounter, countMode: REFERENCE_TOKEN_COUNT_MODE }), maxTokens, 'routing', false); }
    catch (error) { errors.push(`compiled-routing: ${errorMessage(error)}`); }
  }
  for (const phase of task.phases.slice(0, untilPhase)) {
    snapshot = controller.beginPhase(phase.id);
    const required = new Set(phase.requiredDocs); let stopped = false;
    for (const read of phase.reads) {
      const doc = findDocument(task, read.id, read.version, read.layer);
      if (!doc) { errors.push(`missing authored route ${read.layer}:${read.id}@${read.version}`); continue; }
      const key = largeTaskDocumentKey(doc); const repeat = visited.has(key); visited.add(key);
      if (repeat) rereadDocumentKeys.push(key);
      const maxTokens = doc.layer === 'A' ? BUDGET_PRESETS[budget].aRead : BUDGET_PRESETS[budget].bRead;
      const options = { maxTokens, counter: referenceTokenCounter, countMode: REFERENCE_TOKEN_COUNT_MODE,
        ...(doc.layer === 'A' ? { reason: 'verify' as const } : {}) };
      try {
        const first = createContextPacket([doc], options);
        if (!activate(first, maxTokens, phase.id, required.has(key), repeat)) { stopped = true; break; }
        const queue: ContextCursor[] = [...(first.continuation ?? [])]; const seen = new Set<string>();
        let hops = 0;
        while (queue.length && hops++ < 256) {
          const cursor = queue.shift()!; const cursorKey = JSON.stringify(cursor);
          if (seen.has(cursorKey)) { errors.push(`repeated continuation ${key}`); break; }
          seen.add(cursorKey);
          const packet = createContextPacket([doc], { ...options, cursor });
          if (!activate(packet, maxTokens, phase.id, required.has(key), repeat)) { stopped = true; break; }
          queue.push(...(packet.continuation ?? []));
        }
        unresolvedContinuations += queue.length;
        if (stopped) break;
      } catch (error) { errors.push(`${phase.id}:${key}: ${errorMessage(error)}`); }
    }
    phaseSnapshots.push({ phase: phase.id, snapshot });
    if (!stopped) phasesCompleted++;
    // A blocked earlier phase cannot be reported as an independently completed end-to-end task.
    if (stopped) break;
  }
  const recoveryReferences: unknown[] = [];
  for (let offset = 0; offset < 10000;) {
    const page = controller.referencePage(offset, 32);
    recoveryReferences.push(...page.entries);
    if (page.nextOffset === undefined) break;
    if (page.nextOffset <= offset) throw new Error('Non-progressing recovery page');
    offset = page.nextOffset;
  }
  return { taskId: task.id, budget, countMode: REFERENCE_TOKEN_COUNT_MODE, trace, snapshot, errors,
    phasesCompleted, unresolvedContinuations, rereadDocumentKeys, phaseSnapshots, recoveryReferences };
}
function pagination(values: unknown[], page: number, pageSize: number) {
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 4) throw new Error('page>=1; 1<=page-size<=4');
  return { page, pageSize, totalItems: values.length, totalPages: Math.ceil(values.length / pageSize), items: values.slice((page - 1) * pageSize, page * pageSize) };
}
function publicTask(task: LargeKnowledgeTask) {
  return { taskId: task.id, label: task.label, task: task.question, routeLabel: task.routeLabel,
    instruction: '仅根据可见来源回答，精确保留数值、代码、否定和适用范围。使用 [id@version:Lstart-Lend] 标注来源；目录与候选不是已核验事实。必须区分已读取、当前活跃及需要重新读取的证据；缺少当前必需页时不得声称完整通过。',
    phases: task.phases, counter: TOKEN_COUNTER_METADATA, syntheticOnly: true };
}

/** CLI `read` is a source reread; it does not assert that its body has been pinned in the baseline run. */
export function largeTaskCLI(args: string[]): unknown {
  const [command = 'list', taskId = '', candidate = 'target'] = args;
  if (command === 'list') return largeKnowledgeTasks.map(task => ({ taskId: task.id, label: task.label, phases: task.phases.length, routeLabel: task.routeLabel }));
  const task = largeKnowledgeTasks.find(task => task.id === taskId);
  if (!task) throw new Error(`Unknown task: ${taskId}`);
  const flag = (name: string, fallback = '') => { const index = args.indexOf(`--${name}`); return index < 0 ? fallback : args[index + 1] ?? fallback; };
  const page = Number(flag('page', '1')); const pageSize = Number(flag('page-size', '1'));
  if (command === 'question') return publicTask(task);
  if (command === 'manifest') return { taskId, documents: pagination(task.documents.map(doc => ({ id: doc.id, version: doc.version, layer: doc.layer, title: doc.title,
    verified: doc.verified, lines: doc.content.split('\n').length, referenceContentTokens: referenceTokenCounter(doc.content), provenance: doc.provenance })), page, pageSize) };
  if (!budgetNames.includes(candidate as LargeBudgetName)) throw new Error('Budget must be tight|target|roomy');
  const budget = candidate as LargeBudgetName;
  if (command === 'read') {
    const id = flag('doc'); const version = Number(flag('version', '1'));
    const doc = findDocument(task, id, version); if (!doc) throw new Error(`Unknown document ${id}@${version}`);
    const startLine = Number(flag('start-line', '1')); const endLine = Number(flag('end-line', String(doc.content.split('\n').length)));
    const startColumn = Number(flag('start-column', '1'));
    return { taskId, budget, sourceRereadOnly: true, packet: createContextPacket([doc], { startLine, endLine, startColumn,
      maxTokens: Math.min(8192, Number(flag('max-tokens', String(doc.layer === 'A' ? BUDGET_PRESETS[budget].aRead : BUDGET_PRESETS[budget].bRead)))),
      counter: referenceTokenCounter, countMode: REFERENCE_TOKEN_COUNT_MODE, ...(doc.layer === 'A' ? { reason: 'verify' as const } : {}) }) };
  }
  if (command === 'search') {
    const query = flag('query'); if (!query) throw new Error('search requires --query');
    const hits = task.documents.flatMap(doc => doc.content.split('\n').flatMap((text, index) => text.toLowerCase().includes(query.toLowerCase()) ? [{ id: doc.id, version: doc.version, layer: doc.layer, line: index + 1, text }] : []));
    return { taskId, query, hits: pagination(hits, page, pageSize) };
  }
  if (command !== 'show') throw new Error('Usage: knowledge-context-large-task.ts <list|question|manifest|show|read|search> <task-id> [tight|target|roomy] [--page N --page-size 1]');
  const run = runLargeContextTask(task, budget, Number(flag('phase', String(task.phases.length))));
  return { ...publicTask(task), budget, status: run.snapshot.status, activeTokens: run.snapshot.tokenCount, envelope: run.snapshot.budget,
    handoff: run.snapshot.handoff, phasesCompleted: run.phasesCompleted, activeContext: pagination(run.snapshot.packets, page, pageSize),
    recovery: run.snapshot.recovery, errors: run.errors };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.stdout.write(`${JSON.stringify(largeTaskCLI(process.argv.slice(2)), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${errorMessage(error)}\n`); process.exitCode = 1; }
}
