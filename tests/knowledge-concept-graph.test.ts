import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { KnowledgeRepository } from '../src/knowledge/repository.js';
import type { KnowledgeCitation, KnowledgeCompilation, KnowledgeConceptGraph, KnowledgeSpace } from '../src/knowledge/types.js';

const space: KnowledgeSpace = { kind: 'template', teamId: 'architecture', memberId: 'architect' };
const citation = (startLine = 1, endLine = 2): KnowledgeCitation => ({ sourceId: 'architecture-source', sourceVersion: 1, startLine, endLine });
const compilation = (): KnowledgeCompilation & { conceptGraph: KnowledgeConceptGraph } => ({
  entries: [{ id: 'module-design', title: '模块划分方法', content: '模块划分依据职责边界；职责边界影响模块耦合。', citations: [citation()] }],
  overview: [{ id: 'architecture-map', title: '架构设计', summary: '模块设计方法', entryIds: ['module-design'] }],
  conceptGraph: {
    schemaVersion: 1,
    concepts: [
      { id: 'module-boundary', name: '模块划分', aliases: ['模块拆分'], summary: '按职责组织模块。', entryIds: ['module-design'], citations: [citation(1, 1)] },
      { id: 'responsibility', name: '职责边界', summary: '界定模块所承担的责任。', entryIds: ['module-design'], citations: [citation()] },
      { id: 'coupling', name: '模块耦合', summary: '模块之间的联系程度。', entryIds: ['module-design'], citations: [citation(2, 2)] },
    ],
    relations: [
      { id: 'boundary-basis', sourceId: 'module-boundary', targetId: 'responsibility', predicate: '依据', basis: 'explicit', summary: '资料直接说明模块划分的依据。', entryIds: ['module-design'], citations: [citation(1, 1)] },
      { id: 'responsibility-effect', sourceId: 'responsibility', targetId: 'coupling', predicate: '影响', basis: 'inferred', summary: '需结合具体架构验证影响程度。', entryIds: ['module-design'], citations: [citation(2, 2)] },
    ],
  },
});

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'workforce-concept-graph-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = new KnowledgeRepository(join(root, 'knowledge'));
  await repo.ingest(space, { id: 'architecture-source', title: '架构原始资料', content: '模块划分依据职责边界。\n职责边界影响模块耦合。\n\n候选结论待验证。', provenance: 'fixture', verified: false });
  return { repo, fingerprint: await repo.fingerprint(space), directory: join(repo.rootPath, 'templates/architecture/employees/architect') };
}

test('concept graph round-trips in the versioned C layer and preserves legacy snapshots and immutable graph history', async t => {
  const { repo, fingerprint, directory } = await fixture(t);
  const legacy: KnowledgeCompilation = compilation(); delete legacy.conceptGraph;
  const original = await repo.publish(space, legacy, fingerprint);
  const legacyPath = join(directory, 'C-overview/v1.json');
  const legacyBytes = await readFile(legacyPath, 'utf8');
  assert.ok(Array.isArray(JSON.parse(legacyBytes)));
  assert.deepEqual(await new KnowledgeRepository(repo.rootPath).snapshot(space), original);
  assert.equal((await repo.snapshot(space))!.conceptGraph, undefined, 'legacy articles never become invented concepts');

  const graph = compilation();
  const firstGraph = await repo.publish(space, graph, fingerprint);
  const firstGraphPath = join(directory, 'C-overview/v2.json');
  const firstGraphBytes = await readFile(firstGraphPath, 'utf8');
  assert.deepEqual(JSON.parse(firstGraphBytes), { schemaVersion: 1, overview: graph.overview, conceptGraph: graph.conceptGraph });
  assert.deepEqual(await new KnowledgeRepository(repo.rootPath).snapshot(space), firstGraph);
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'B-knowledge/v2.json'), 'utf8')), graph.entries);
  assert.deepEqual(await repo.read(space, 'B', 'module-design', 1), legacy.entries[0]);

  graph.conceptGraph.relations[1]!.summary = '第二次编纂的推断。';
  await repo.publish(space, graph, fingerprint);
  assert.equal(await readFile(legacyPath, 'utf8'), legacyBytes);
  assert.equal(await readFile(firstGraphPath, 'utf8'), firstGraphBytes);
  assert.equal((await repo.snapshot(space))!.conceptGraph!.relations[1]!.summary, '第二次编纂的推断。');
});

test('publication rejects graph identifiers, synonyms, endpoints, duplicate semantics and missing evidence without replacing the last valid graph', async t => {
  const { repo, fingerprint } = await fixture(t);
  const initial = await repo.publish(space, compilation(), fingerprint);
  const invalid: Array<[string, (value: ReturnType<typeof compilation>) => void, RegExp]> = [
    ['duplicate concept id', value => { value.conceptGraph.concepts[1]!.id = 'module-boundary'; }, /Duplicate graph ID/],
    ['duplicate cross-type id', value => { value.conceptGraph.relations[0]!.id = 'coupling'; }, /Duplicate graph ID/],
    ['duplicate normalized name', value => { value.conceptGraph.concepts[1]!.name = ' 模块划分 '; }, /Duplicate concept name/],
    ['duplicate alias', value => { value.conceptGraph.concepts[1]!.aliases = ['模块拆分']; }, /Duplicate concept name/],
    ['dangling endpoint', value => { value.conceptGraph.relations[0]!.targetId = 'unknown'; }, /dangling concept/],
    ['self reference', value => { value.conceptGraph.relations[0]!.targetId = 'module-boundary'; }, /self-referential/],
    ['duplicate relation', value => { value.conceptGraph.relations.push({ ...value.conceptGraph.relations[0]!, id: 'duplicate', predicate: ' 依据 ' }); }, /Duplicate concept relation/],
    ['unsupported basis', value => { value.conceptGraph.relations[0]!.basis = 'confirmed' as never; }, /basis/],
    ['no specific evidence', value => { value.conceptGraph.relations[0]!.citations = []; }, /source references/],
    ['nonexistent article', value => { value.conceptGraph.concepts[0]!.entryIds = ['missing']; }, /dangling knowledge/],
    ['duplicate article', value => { value.conceptGraph.relations[0]!.entryIds.push('module-design'); }, /Duplicate graph knowledge/],
    ['retired source version', value => { value.conceptGraph.relations[0]!.citations[0]!.sourceVersion = 2; }, /outdated source/],
    ['invalid line range', value => { value.conceptGraph.relations[0]!.citations[0]!.endLine = 20; }, /line range/],
    ['empty evidence line', value => { value.conceptGraph.relations[0]!.citations = [citation(3, 3)]; }, /no evidence/],
    ['evidence outside article', value => { value.conceptGraph.relations[0]!.citations = [citation(4, 4)]; }, /not supported/],
    ['missing concept summary', value => { value.conceptGraph.concepts[0]!.summary = ''; }, /summary is required/],
    ['schema mismatch', value => { value.conceptGraph.schemaVersion = 2 as never; }, /graph is incomplete/],
  ];
  for (const [description, mutate, expected] of invalid) {
    const next = compilation(); mutate(next);
    await assert.rejects(repo.publish(space, next, fingerprint), expected, description);
    assert.deepEqual(await repo.snapshot(space), initial, description);
  }
});

test('graph limits fail explicitly instead of silently truncating concepts, aliases, predicates or relations', async t => {
  const { repo, fingerprint } = await fixture(t);
  const invalid: Array<(value: ReturnType<typeof compilation>) => void> = [
    value => { value.conceptGraph.concepts = Array.from({ length: 501 }, () => value.conceptGraph.concepts[0]!); },
    value => { value.conceptGraph.relations = Array.from({ length: 1501 }, () => value.conceptGraph.relations[0]!); },
    value => { value.conceptGraph.concepts[0]!.aliases = Array.from({ length: 21 }, (_, index) => `alias-${index}`); },
    value => { value.conceptGraph.relations[0]!.predicate = 'x'.repeat(161); },
    value => { value.conceptGraph.concepts[0]!.summary = 'x'.repeat(8001); },
  ];
  for (const mutate of invalid) {
    const next = compilation(); mutate(next);
    await assert.rejects(repo.publish(space, next, fingerprint), /too large/);
    assert.equal(await repo.snapshot(space), undefined);
  }
});

test('a concept graph may honestly have no semantic relations and unknown concepts are never synthesized by storage', async t => {
  const { repo, fingerprint } = await fixture(t);
  const next = compilation(); next.conceptGraph.relations = [];
  assert.deepEqual((await repo.publish(space, next, fingerprint)).conceptGraph!.relations, []);
  next.conceptGraph.concepts = [];
  assert.deepEqual((await repo.publish(space, next, fingerprint)).conceptGraph, { schemaVersion: 1, concepts: [], relations: [] });
});
