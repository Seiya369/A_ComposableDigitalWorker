/** Reproducible, isolated measurements; synthetic loads are never model-quality evidence. */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { cpus, tmpdir } from 'node:os';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { createSeedState } from '../src/domain/seed.js';
import { WorkforceStore } from '../src/domain/store.js';
import { validateState } from '../src/domain/validation.js';
import { createContextPacket, type ContextDocument } from '../src/knowledge/context.js';
import { groupedSemanticLayout } from '../third_party/llm-wiki/web/graph-layout.js';
import type { WikiView } from '../third_party/llm-wiki/web/protocol.js';

const sources = ['src/domain/seed.ts', 'src/domain/software-defaults.ts', 'skills/software-development-presets.json', 'src/domain/store.ts', 'src/domain/validation.ts', 'src/knowledge/context.ts', 'third_party/llm-wiki/web/graph-layout.ts', 'scripts/performance-audit.ts'];
const hashes = () => Promise.all(sources.map(async file => ({ file, sha256: createHash('sha256').update(await readFile(file)).digest('hex') })));
const before = await hashes();
const report: Record<string, unknown> = { generatedAt: new Date().toISOString(), version: JSON.parse(await readFile('package.json', 'utf8')).version,
  scope: 'Synthetic local state, durable writes, bounded knowledge retrieval and active semantic layout. No LLM calls, model-quality claims, browser frame-rate or production capacity claim.',
  environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, logicalCpus: cpus().length }, sourceHashes: before };
const temp = await mkdtemp(join(tmpdir(), 'workforce-performance-'));
const summary = (samples: number[]) => { const sorted = [...samples].sort((a, b) => a - b); return { samples: sorted.length,
  p50Ms: sorted[Math.ceil(sorted.length * .5) - 1], p95Ms: sorted[Math.ceil(sorted.length * .95) - 1], maxMs: sorted.at(-1)! }; };
async function measure(count: number, run: () => unknown | Promise<unknown>) {
  for (let i = 0; i < 3; i++) await run();
  const samples = []; for (let i = 0; i < count; i++) { const began = performance.now(); await run(); samples.push(performance.now() - began); }
  return summary(samples);
}
try {
  const states = [];
  for (const count of [10, 100, 1000]) {
    const state = createSeedState('2026-10-25T00:00:00.000Z');
    state.projects.push({ id: 'perf-project', name: 'performance project', rootPath: temp, createdAt: state.templates[0]!.createdAt, updatedAt: state.templates[0]!.updatedAt });
    for (let index = 0; index < count; index++) state.employees.push({ id: `perf-employee-${index}`, projectId: 'perf-project', name: `employee ${index}`,
      templateId: state.templates[0]!.id, templateName: state.templates[0]!.name, templateVersion: 1, modules: structuredClone(state.templates[0]!.modules),
      version: 1, status: 'active', createdAt: state.templates[0]!.createdAt, updatedAt: state.templates[0]!.updatedAt });
    validateState(state);
    const file = join(temp, `state-${count}.json`); await writeFile(file, JSON.stringify(state));
    const store = await WorkforceStore.open(file);
    const projectOnlyReads = await measure(30, () => { assert.equal(store.listProjects().length, 1); });
    const snapshots = await measure(30, () => { assert.equal(store.snapshot().employees.length, count); });
    const writes = await measure(12, () => store.saveProject({ id: 'perf-project', name: 'measurement update', rootPath: temp }));
    const bytes = (await readFile(file)).byteLength;
    states.push({ employees: count, stateBytes: bytes, snapshot: snapshots, projectOnlyRead: projectOnlyReads, durableMutation: writes });
  }
  report.state = states;
  const retrieval = [];
  for (const count of [10, 100, 1000]) {
    const documents: ContextDocument[] = Array.from({ length: count }, (_, index) => ({ id: `evidence-${index}`, version: 1, library: 'team', layer: 'B', title: `Contract ${index}`,
      content: `Contract ${index} uses a bounded queue.\n${'Evidence remains attributed; unverified synthesis is a candidate.\n'.repeat(12)}` }));
    const timing = await measure(20, () => { const packet = createContextPacket(documents, { query: 'bounded queue', maxTokens: 3000 }); assert.ok(packet.tokenEstimate <= 3000); });
    retrieval.push({ documents: count, inputBytes: Buffer.byteLength(JSON.stringify(documents)), ...timing });
  }
  report.knowledge = retrieval;
  const graphs = [];
  for (const count of [100, 1000, 5000]) {
    const graph: WikiView['graph'] = { kind: 'semantic', nodes: Array.from({ length: count }, (_, index) => ({ id: `node-${index}`, label: `concept ${index}`, type: 'concept', path: `concept/${index}`, community: 0, linkCount: 4 })),
      edges: Array.from({ length: count * 2 }, (_, index) => ({ id: `edge-${index}`, source: `node-${index % count}`, target: `node-${(index + 1 + Math.floor(index / count)) % count}`, weight: 1, relations: [] })), communities: [] };
    const timing = await measure(20, () => { assert.equal(groupedSemanticLayout(graph, 'performance').positions.size, count); });
    graphs.push({ nodes: count, edges: graph.edges.length, ...timing });
  }
  report.semanticLayout = graphs;
  report.peakRssMiB = process.resourceUsage().maxRSS / 1024;
  assert.deepEqual(await hashes(), before, 'measured sources changed during the run');
  report.sourcesStableDuringRun = true;
  const output = resolve(process.env.WORKFORCE_PERFORMANCE_REPORT_DIR || 'artifacts/performance'); await mkdir(output, { recursive: true });
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await rm(temp, { recursive: true, force: true }); }
