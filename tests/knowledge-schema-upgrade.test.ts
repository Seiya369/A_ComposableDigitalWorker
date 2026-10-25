import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBlankModules } from '../src/domain/seed.js';
import { WorkforceStore } from '../src/domain/store.js';
import { KnowledgeEngine } from '../src/knowledge/engine.js';
import { KnowledgeRepository } from '../src/knowledge/repository.js';
import { knowledgeNavigation } from '../src/knowledge/navigation.js';
import type { KnowledgeCompilation, KnowledgeCompileRequest, KnowledgeCompiler } from '../src/knowledge/types.js';

function compiled(request: KnowledgeCompileRequest, graph = false): KnowledgeCompilation {
  const citations = request.sources.map(source => ({ sourceId: source.id, sourceVersion: source.version, startLine: 1, endLine: 1 }));
  const evidence = { entryIds: ['article'], citations };
  return {
    entries: [{ id: 'article', title: 'Architecture guide', content: 'Use responsibility boundaries.', citations }],
    overview: [{ id: 'old-map', title: 'Legacy topic', summary: 'Read the guide.', entryIds: ['article'] }],
    ...(graph ? { conceptGraph: { schemaVersion: 1 as const, concepts: [
      { id: 'decomposition', name: '模块划分', aliases: ['Decomposition'], summary: '将职责划分为独立模块。', ...evidence },
      { id: 'boundary', name: '职责边界', summary: '模块的职责范围。', ...evidence },
    ], relations: [{ id: 'based-on', sourceId: 'decomposition', targetId: 'boundary', predicate: '依据', basis: 'explicit' as const, ...evidence }] } } : {}),
  };
}

async function fixture(t: { after: (callback: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'workforce-semantic-migration-'));
  const store = await WorkforceStore.open(join(root, 'state.json'));
  const modules = createBlankModules();
  modules.model = { mode: 'override', provider: 'fixture', model: 'offline' };
  modules.knowledge.sources = [{ id: 'method', title: 'Method', kind: 'text', value: 'Module split (Decomposition) follows responsibility boundaries. RAW_PRIVATE_MARKER' }];
  const template = await store.saveTemplate({ name: 'Architect', status: 'draft', modules });
  const project = await store.saveProject({ name: 'Migration', rootPath: root });
  const employee = await store.createEmployee({ projectId: project.id, templateId: template.id });
  const repository = new KnowledgeRepository(join(root, 'knowledge'));
  const engines: KnowledgeEngine[] = [];
  const errors: unknown[] = [];
  const open = async (compiler: KnowledgeCompiler) => {
    const engine = new KnowledgeEngine(store, repository, compiler, error => errors.push(error));
    engines.push(engine); await engine.start(); return engine;
  };
  t.after(async () => { for (const engine of engines) await engine.dispose(); await rm(root, { recursive: true, force: true }); });
  const legacy = await open(async request => compiled(request));
  await legacy.prepareFor(employee);
  const space = legacy.spacesForEmployee(employee).find(space => space.memberId === employee.id)!;
  const previous = (await repository.snapshot(space))!;
  const sources = await repository.sources(space);
  await legacy.dispose();
  return { store, repository, employee, space, previous, sources, open, errors,
    target: { scope: 'project' as const, projectId: project.id, employeeId: employee.id, library: 'employee' as const } };
}

test('task preparation upgrades legacy knowledge with unchanged evidence and exposes real concepts to agent navigation', async t => {
  const f = await fixture(t); let calls = 0;
  const engine = await f.open(Object.assign(async (request: KnowledgeCompileRequest) => { calls++; return compiled(request, true); }, { conceptGraphVersion: 1 as const }));
  assert.equal(calls, 0, 'startup and inspection do not trigger paid compilation');
  assert.equal((await engine.library(f.target)).status.state, 'pending');
  assert.equal(calls, 0);
  await engine.prepareFor(f.employee);
  const current = (await f.repository.snapshot(f.space))!;
  assert.equal(current.version, f.previous.version + 1);
  assert.equal(current.sourceFingerprint, f.previous.sourceFingerprint);
  assert.deepEqual(await f.repository.sources(f.space), f.sources, 'schema upgrade preserves original A versions');
  assert.equal(current.conceptGraph?.concepts.length, 2);
  const navigation = await engine.overviewDocumentsFor(f.employee);
  assert.deepEqual(navigation.map(item => item.title), ['模块划分', '职责边界']);
  assert.match(JSON.stringify(navigation), /模块划分 —依据→ 职责边界/);
  assert.doesNotMatch(JSON.stringify(navigation), /RAW_PRIVATE_MARKER/);
  assert.ok(navigation.every(item => item.entryIds?.includes('article') && item.version === current.version));
  assert.ok((await engine.searchFor(f.employee, 'Decomposition', 'B')).some(item => item.id === 'article'), 'concept aliases route to the associated article');
  await engine.prepareFor(f.employee);
  assert.equal(calls, 1, 'a current conceptual snapshot is reused');
  assert.deepEqual(await engine.readFor(f.employee, 'B', 'article', f.previous.version, 'employee'), { ...f.previous.entries[0], version: f.previous.version, library: 'employee' });
  assert.deepEqual(f.errors, []);
});

test('explicit rebuild regenerates conceptual knowledge without rewriting original evidence', async t => {
  const f = await fixture(t); let calls = 0;
  const engine = await f.open(Object.assign(async (request: KnowledgeCompileRequest) => { calls++; return compiled(request, true); }, { conceptGraphVersion: 1 as const }));
  await engine.upload({ target: f.target, files: [], retry: true }); await engine.flush();
  const first = (await f.repository.snapshot(f.space))!;
  await engine.upload({ target: f.target, files: [], retry: true }); await engine.flush();
  assert.equal(calls, 2);
  assert.equal((await f.repository.snapshot(f.space))?.version, first.version + 1);
  assert.deepEqual(await f.repository.sources(f.space), f.sources);
});

test('failed concept migration preserves legacy articles and can be retried successfully', async t => {
  const f = await fixture(t); let failing = true;
  const engine = await f.open(Object.assign(async (request: KnowledgeCompileRequest) => {
    if (failing) throw new Error('Model unavailable');
    return compiled(request, true);
  }, { conceptGraphVersion: 1 as const }));
  await engine.prepareFor(f.employee);
  assert.equal((await engine.library(f.target)).status.state, 'failed');
  assert.deepEqual(await f.repository.snapshot(f.space), f.previous);
  assert.equal((await engine.readFor(f.employee, 'B', 'article', undefined, 'employee') as { content: string }).content, f.previous.entries[0]!.content);
  failing = false;
  await engine.upload({ target: f.target, files: [], retry: true }); await engine.flush();
  assert.equal((await engine.library(f.target)).status.state, 'ready');
  assert.equal((await f.repository.snapshot(f.space))?.conceptGraph?.schemaVersion, 1);
});

test('concept navigation marks inferred relationships and preserves the stored publication', () => {
  const request = { sources: [{ id: 'source', version: 1 }] } as KnowledgeCompileRequest;
  const snapshot = { ...compiled(request, true), version: 1, sourceFingerprint: 'hash', createdAt: '2026-10-24', status: 'candidate' as const };
  snapshot.conceptGraph!.relations[0]!.basis = 'inferred';
  const before = structuredClone(snapshot);
  assert.match(knowledgeNavigation(snapshot)[0]!.summary, /待验证推断/);
  assert.deepEqual(snapshot, before);
});
