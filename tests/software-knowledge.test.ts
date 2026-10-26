import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkforceStore } from '../src/domain/store.js';
import { KnowledgeRepository } from '../src/knowledge/repository.js';
import { KnowledgeEngine } from '../src/knowledge/engine.js';
import { bundledSoftwareKnowledge } from '../src/knowledge/software-knowledge.js';

test('bundled professional graphs cite exact A evidence, persist at startup and survive reopening without model calls', async t => {
  const root = await mkdtemp(join(tmpdir(), 'software-knowledge-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = await WorkforceStore.open(join(root, 'state.json'));
  const repository = new KnowledgeRepository(join(root, 'knowledge'));
  let calls = 0;
  const engine = new KnowledgeEngine(store, repository, async () => { calls++; throw Error('No model should run for packaged professional references'); }, error => { throw error; });
  await engine.start();
  const fingerprints = new Map<string, string>();
  for (const template of store.snapshot().templates) {
    const target = { scope: 'template' as const, employeeId: template.id, library: 'employee' as const };
    const library = await engine.library(target);
    assert.equal(library.status.state, 'ready', template.name);
    assert.equal(library.snapshot!.conceptGraph!.concepts.length, 9);
    assert.equal(library.snapshot!.conceptGraph!.relations.length, 10);
    assert.equal(library.snapshot!.compilationTrace!.modelCalls, 0);
    for (const item of [...library.snapshot!.conceptGraph!.concepts, ...library.snapshot!.conceptGraph!.relations]) {
      for (const citation of item.citations) {
        const source = library.sources.find(source => source.id === citation.sourceId)!;
        assert.equal(source.version, citation.sourceVersion);
        assert.ok(source.text.split('\n')[citation.startLine - 1]!.trim());
      }
    }
    fingerprints.set(template.id, JSON.stringify(library.snapshot));
    const changed = structuredClone(library.sources); changed.find(source => source.provenance.includes('software-knowledge-v1-'))!.content += '\nUser edit';
    assert.equal(bundledSoftwareKnowledge(changed), undefined, 'edited bundled definitions cannot receive the packaged graph');
  }
  assert.equal(calls, 0);
  const shared = await engine.library({ scope: 'template', employeeId: 'employee-template-product', library: 'team', teamId: store.snapshot().teams[0]!.id });
  const teamGraph = shared.snapshot!.conceptGraph!;
  const graphNames = new Map(teamGraph.concepts.map(item => [item.id, item.name]));
  const reports = teamGraph.relations.filter(item => item.predicate === '汇报给').map(item => [graphNames.get(item.sourceId), graphNames.get(item.targetId)]);
  assert.deepEqual(reports, [['技术负责人/架构师', '产品负责人'], ['专业负责人', '产品负责人'], ['开发人员', '技术负责人/架构师']]);
  assert.match(teamGraph.concepts.find(item => item.name === '专业负责人')!.summary, /UX\/UI设计师、测试负责人、运维负责人直接向产品负责人汇报/);
  assert.deepEqual(store.snapshot().memories, []);
  assert.deepEqual(store.snapshot().runs, []);
  await engine.dispose();
  const reopened = new KnowledgeEngine(await WorkforceStore.open(store.filePath), repository, async () => { calls++; throw Error('No recompile'); }, error => { throw error; });
  await reopened.start();
  for (const template of store.snapshot().templates) {
    const library = await reopened.library({ scope: 'template', employeeId: template.id, library: 'employee' });
    assert.equal(JSON.stringify(library.snapshot), fingerprints.get(template.id), 'published graph must not be regenerated at restart');
  }
  assert.equal(calls, 0); await reopened.dispose();
});

test('large valid custom references beside bundled knowledge do not fail plugin startup or silently bypass normal compilation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'software-knowledge-large-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = await WorkforceStore.open(join(root, 'state.json'));
  const template = store.snapshot().templates.find(item => item.id === 'employee-template-product')!;
  const modules = structuredClone(template.modules);
  modules.knowledge.sources.push({ id: 'large-user-reference', title: 'Large user source', kind: 'text', value: 'x'.repeat(300_000) });
  await store.saveTemplate({ ...template, modules });
  const repository = new KnowledgeRepository(join(root, 'knowledge'));
  let calls = 0;
  const engine = new KnowledgeEngine(store, repository, async () => { calls++; throw Error('No implicit model call'); }, error => { throw error; });
  await engine.start();
  const library = await engine.library({ scope: 'template', employeeId: template.id, library: 'employee' });
  assert.equal(library.status.state, 'pending'); assert.equal(library.snapshot, undefined);
  assert.ok(library.sources.some(source => source.content.length === 300_000));
  assert.equal(calls, 0); await engine.dispose();
});

test('concurrent profiles keep first publication CAS without failing either startup or duplicating snapshots', async t => {
  const root = await mkdtemp(join(tmpdir(), 'software-knowledge-race-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = await WorkforceStore.open(join(root, 'state.json'));
  const engines = [0, 1].map(() => new KnowledgeEngine(store, new KnowledgeRepository(join(root, 'knowledge')), async () => { throw Error('No implicit model call'); }, error => { throw error; }));
  await Promise.all(engines.map(engine => engine.start()));
  for (const engine of engines) {
    const library = await engine.library({ scope: 'template', employeeId: 'employee-template-product', library: 'employee' });
    assert.equal(library.status.state, 'ready'); assert.equal(library.snapshot!.version, 1);
    assert.equal(library.snapshot!.conceptGraph!.concepts.length, 9);
  }
  await Promise.all(engines.map(engine => engine.dispose()));
});
