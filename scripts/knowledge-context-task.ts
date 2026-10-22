/** Offline task adapter. CLI stdout intentionally excludes authored gold and scoring. */
import { pathToFileURL } from 'node:url';
import {
  createContextPacket, createContextPool, countContextTokens, DEFAULT_COUNT_MODE,
  type ContextDocument, type ContextPacket,
} from '../src/knowledge/context.js';
import {
  knowledgeBudgetCandidates, knowledgeContextTasks, type KnowledgeContextReadStep, type KnowledgeContextTask,
} from '../tests/fixtures/knowledge-context-tasks.js';

export type ContextTaskBudget = (typeof knowledgeBudgetCandidates)[number];
type PacketOptions = NonNullable<Parameters<typeof createContextPacket>[1]>;
type ActivationReason = NonNullable<PacketOptions['reason']>;
type PoolSnapshot = ReturnType<ReturnType<typeof createContextPool>['activate']>;

const reasonFor = (task: KnowledgeContextTask, step: KnowledgeContextReadStep): ActivationReason => {
  if (step.reason.includes('quote')) return 'quote';
  if (step.reason.includes('compare') || task.triggers.includes('compare')) return 'source-comparison';
  if (task.triggers.includes('conflict')) return 'conflict';
  if (task.triggers.includes('missing')) return 'no-wiki';
  if (task.triggers.includes('candidate') || task.triggers.includes('stale')) return 'verify';
  return 'exact-detail';
};

export function taskDocuments(task: KnowledgeContextTask): ContextDocument[] {
  return [
    ...task.compilation.overview.map(item => ({ layer: 'C' as const, id: item.id, library: 'team' as const,
      version: 1, title: item.title, content: `${item.title}\n${item.summary}`, entryIds: item.entryIds })),
    ...task.compilation.entries.map(item => ({ layer: 'B' as const, id: item.id, library: 'team' as const,
      version: 1, title: item.title, content: item.content, citations: item.citations })),
    ...task.sources.map(item => ({ layer: 'A' as const, id: item.id, library: 'team' as const,
      version: item.version, title: item.title, content: item.text, provenance: item.provenance, verified: item.verified })),
  ];
}

export interface ContextTaskTrace {
  packet: ContextPacket;
  maxTokens: number;
  actualTokens: number;
  activeTokens: number;
  activeActualTokens: number;
  repeat: boolean;
  duplicateGrowth: number;
}

export interface ContextTaskRun {
  taskId: string;
  budget: ContextTaskBudget;
  countMode: string;
  snapshot: PoolSnapshot;
  trace: ContextTaskTrace[];
  errors: string[];
  unresolvedContinuations: number;
}

export function runContextTask(task: KnowledgeContextTask, budget: ContextTaskBudget): ContextTaskRun {
  const documents = taskDocuments(task);
  const pool = createContextPool({
    cTarget: budget.cTokens, cMax: budget.cTokens, bRead: budget.bReadTokens, bActive: budget.bActiveTokens,
    aRead: budget.aReadTokens, aActive: budget.aActiveTokens, total: budget.totalTokens,
  });
  const trace: ContextTaskTrace[] = [];
  const errors: string[] = [];
  let snapshot = pool.snapshot();
  const activate = (packet: ContextPacket, maxTokens: number, repeat = false) => {
    const before = countContextTokens(snapshot.packets);
    const existed = snapshot.packets.some(item => JSON.stringify(item) === JSON.stringify(packet));
    snapshot = pool.activate(packet);
    const after = countContextTokens(snapshot.packets);
    trace.push({ packet, maxTokens, actualTokens: countContextTokens(packet), activeTokens: snapshot.tokenEstimate,
      activeActualTokens: after, repeat, duplicateGrowth: repeat && existed ? Math.max(0, after - before) : 0 });
  };
  try {
    const cPacket = createContextPacket(documents.filter(item => item.layer === 'C'), { query: task.query, maxTokens: budget.cTokens });
    activate(cPacket, budget.cTokens);
  } catch (error) { errors.push(`C: ${error instanceof Error ? error.message : String(error)}`); }
  let unresolvedContinuations = 0;
  for (const step of task.reads) {
    const doc = documents.find(item => item.layer === step.layer && item.id === step.id);
    if (!doc) { errors.push(`Unknown document ${step.layer}:${step.id}`); continue; }
    const maxTokens = step.layer === 'A' ? budget.aReadTokens : budget.bReadTokens;
    const options: PacketOptions = { query: task.query, maxTokens,
      ...(step.layer === 'A' ? { reason: reasonFor(task, step) } : {}),
      ...(step.startLine ? { startLine: step.startLine } : {}), ...(step.endLine ? { endLine: step.endLine } : {}),
    };
    try {
      const first = createContextPacket([doc], options);
      activate(first, maxTokens, step.repeat);
      const cursors = [...(first.continuation ?? [])];
      if (!step.completeRange) { unresolvedContinuations += cursors.length; continue; }
      const seen = new Set<string>();
      let hops = 0;
      while (cursors.length && hops++ < 32) {
        const cursor = cursors.shift()!;
        const key = JSON.stringify(cursor);
        if (seen.has(key)) { errors.push(`Repeated continuation for ${doc.id}`); break; }
        seen.add(key);
        const next = createContextPacket([doc], { ...options, cursor });
        activate(next, maxTokens);
        cursors.push(...(next.continuation ?? []));
      }
      unresolvedContinuations += cursors.length;
    } catch (error) { errors.push(`${step.layer}:${step.id}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return { taskId: task.id, budget, countMode: DEFAULT_COUNT_MODE, snapshot, trace, errors, unresolvedContinuations };
}

/** Only selected knowledge is sent to the independent answering agent, never gold. */
export function contextTaskPrompt(taskId: string, budgetName: string) {
  const task = knowledgeContextTasks.find(item => item.id === taskId);
  const budget = knowledgeBudgetCandidates.find(item => item.name === budgetName);
  if (!task || !budget) throw new Error('Usage: knowledge-context-task.ts <task-id> <compact|balanced|expanded>');
  const run = runContextTask(task, budget);
  return {
    taskId, budget: budget.name, countMode: run.countMode,
    instruction: '仅根据以下知识包回答任务。保留数值、否定、例外和精确代码。使用包内来源版本及行号标注依据；若证据不足，明确指出缺失，不要凭常识补全。',
    task: task.query,
    context: run.snapshot.packets,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === 'list') {
      process.stdout.write(`${JSON.stringify(knowledgeContextTasks.map(({ id, label }) => ({ id, label })), null, 2)}\n`);
    } else process.stdout.write(`${JSON.stringify(contextTaskPrompt(process.argv[2] ?? '', process.argv[3] ?? 'balanced'), null, 2)}\n`);
  } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
