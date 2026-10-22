/** Blind fixed-snapshot answering inputs; never exports fixture gold or expected answers. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { runLargeContextTask, type LargeBudgetName } from './knowledge-context-large-task.js';
import { largeKnowledgeTasks } from '../tests/fixtures/knowledge-context-large-tasks.js';
import { TOKEN_COUNTER_METADATA } from './knowledge-token-counter.js';

const output = resolve('artifacts/knowledge-budget-large-2026-10-22/answer-trial');
const selected = new Set(['large-reflection-boundary', 'large-cross-page-table', 'large-required-over32', 'large-hard64-handoff']);
const files = ['src/knowledge/context.ts', 'scripts/knowledge-budget-policy.ts', 'scripts/knowledge-token-counter.ts', 'scripts/knowledge-context-large-task.ts', 'tests/fixtures/knowledge-context-large-tasks.ts', 'scripts/prepare-large-answer-trial.ts'];
const sources = await Promise.all(files.map(async file => ({ file, sha256: createHash('sha256').update(await readFile(file)).digest('hex') })));
const manifest: unknown[] = [];
for (const budget of ['tight', 'target', 'roomy'] as LargeBudgetName[]) {
  const folder = join(output, 'inputs', budget); await mkdir(folder, { recursive: true });
  for (const task of largeKnowledgeTasks.filter(task => selected.has(task.id))) {
    const run = runLargeContextTask(task, budget);
    const value = { taskId: task.id, budget, question: task.question,
      protocol: 'You only see the final active snapshot. Earlier phase counters are implementation metadata, not evidence you personally examined. No raw source reread or gold is available in this trial. Answer exact visible facts with source/version/line citations. Distinguish unknown facts, missing pages, unverified proposals, and whole-task completeness. Do not infer all business rows from a repeated pattern or from a C/B directory.',
      counter: TOKEN_COUNTER_METADATA, snapshot: run.snapshot,
      implementationMetadata: { phasesCompleted: run.phasesCompleted, totalPhases: task.phases.length, errors: run.errors } };
    const body = `${JSON.stringify(value, null, 2)}\n`;
    const file = join(folder, `${task.id}.json`); await writeFile(file, body);
    manifest.push({ taskId: task.id, budget, file, sha256: createHash('sha256').update(body).digest('hex'),
      activeTokens: run.snapshot.tokenCount, packets: run.snapshot.packets.length, status: run.snapshot.status });
  }
}
await writeFile(join(output, 'input-manifest.json'), `${JSON.stringify({ createdAt: new Date().toISOString(), protocol: 'Blind final-snapshot probe; not autonomous retrieval, full multi-phase task execution, or the target DSH model.', counter: TOKEN_COUNTER_METADATA, sources, inputs: manifest }, null, 2)}\n`);
console.log(JSON.stringify(manifest));
