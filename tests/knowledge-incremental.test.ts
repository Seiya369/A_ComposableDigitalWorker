import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { mergeIncrementalKnowledge, planIncrementalKnowledge } from '../src/knowledge/incremental.js';
import { KnowledgeRepository } from '../src/knowledge/repository.js';
import type { KnowledgeCitation, KnowledgeCompilation, KnowledgeConcept, KnowledgeSnapshot, KnowledgeSource } from '../src/knowledge/types.js';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const source = (id: string, text: string, version = 1): KnowledgeSource => ({ id, title: `Document ${id}`, content: text, text, version, hash: sha(text), verified: false, provenance: 'fixture', createdAt: '2026-10-24T00:00:00.000Z', processing: [] });
const citation = (sourceId: string, startLine = 1, endLine = startLine, sourceVersion = 1): KnowledgeCitation => ({ sourceId, sourceVersion, startLine, endLine });
const entry = (id: string, citations: KnowledgeCitation[], content = `Unchanged body ${id}`) => ({ id, title: `Article ${id}`, content, citations });
const overview = (id: string, entryIds: string[]) => ({ id, title: `Topic ${id}`, summary: `Summary ${id}`, entryIds });
const concept = (id: string, name: string, entryIds: string[], citations: KnowledgeCitation[], aliases?: string[]): KnowledgeConcept => ({ id, name, summary: `Original definition of ${name}`, kind: 'concept', entryIds, citations, ...(aliases ? { aliases } : {}) });
const empty = (): KnowledgeCompilation => ({ entries: [], overview: [], conceptGraph: { schemaVersion: 1, concepts: [], relations: [] } });
function snapshot(sources: KnowledgeSource[], value: KnowledgeCompilation, manifest = true): KnowledgeSnapshot {
  return { ...value, version: 7, sourceFingerprint: sha(JSON.stringify([...sources].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(item => [item.id, item.version, item.hash, item.verified]))), createdAt: '2026-10-24T00:00:00.000Z', status: 'candidate', ...(manifest ? { sourceManifest: sources.map(({ id, version, hash, verified }) => ({ id, version, hash, verified })) } : {}) };
}
function fixture() {
  const a = source('a', 'Alpha is a method.\nAlpha depends on Beta.\nA unrelated context.');
  const b = source('b', 'DO NOT SEND B HEADER.\nBeta is a constraint.\nBeta constrains Alpha.\nDO NOT SEND B FOOTER.');
  const unrelated = source('unrelated', 'Unrelated secret should never enter the update.');
  const compilation: KnowledgeCompilation = {
    entries: [entry('a-entry', [citation('a')]), entry('b-entry', [citation('b', 2)]), entry('mixed-entry', [citation('a', 2), citation('b', 3)]), entry('unrelated-entry', [citation('unrelated')])],
    overview: [overview('a-topic', ['a-entry']), overview('b-topic', ['b-entry']), overview('mixed-topic', ['mixed-entry', 'b-entry']), overview('unrelated-topic', ['unrelated-entry'])],
    conceptGraph: {
      schemaVersion: 1,
      concepts: [concept('alpha', 'Alpha', ['a-entry'], [citation('a')]), concept('beta', 'Beta', ['b-entry'], [citation('b', 2)], ['B constraint']), concept('unrelated-concept', 'Unrelated concept', ['unrelated-entry'], [citation('unrelated')])],
      relations: [{ id: 'alpha-beta', sourceId: 'alpha', targetId: 'beta', predicate: 'depends on', summary: 'Original relation summary', basis: 'explicit', entryIds: ['mixed-entry'], citations: [citation('a', 2)] }],
    },
  };
  const sources = [a, b, unrelated];
  return { a, b, unrelated, sources, compilation, previous: snapshot(sources, compilation) };
}

test('one changed source invalidates whole dependent objects and carries only exact surviving evidence', () => {
  const f = fixture(); const changedA = source('a', 'Alpha has a revised definition.\nAlpha no longer depends on Beta.\nNew A context.', 2);
  const plan = planIncrementalKnowledge([changedA, f.b, f.unrelated], f.previous);
  assert.deepEqual(plan.changedSources, [changedA]);
  assert.deepEqual(plan.removedSourceIds, []);
  assert.equal(plan.baseVersion, 7);
  assert.equal(plan.needsModel, true);
  assert.deepEqual(plan.affected.entries.map(item => item.id), ['a-entry', 'mixed-entry']);
  assert.deepEqual(plan.affected.overview.map(item => item.id), ['a-topic', 'mixed-topic']);
  assert.deepEqual(plan.affected.conceptGraph!.concepts.map(item => item.id), ['alpha']);
  assert.deepEqual(plan.affected.conceptGraph!.relations.map(item => item.id), ['alpha-beta']);
  assert.equal(plan.affected.entries[1], f.compilation.entries[2], 'withdraw the whole mixed article, including its old claim');
  assert.equal(plan.affected.entries[1]!.citations.length, 2, 'never clip old citations while retaining old prose');
  assert.equal(plan.retained.entries[0], f.compilation.entries[1]);
  assert.deepEqual(plan.dependencySources, [{ id: 'b', version: 1, title: 'Document b', category: 'reference', provenance: 'fixture', verified: false, lineCount: 4, excerpts: [{ startLine: 2, endLine: 3, text: 'Beta is a constraint.\nBeta constrains Alpha.' }] }]);
  assert.deepEqual(plan.anchors, [{ id: 'beta', name: 'Beta', kind: 'concept', aliases: ['B constraint'] }]);
  const payload = JSON.stringify({ changedSources: plan.changedSources, affected: plan.affected, dependencySources: plan.dependencySources, anchors: plan.anchors, relatedEntries: plan.relatedEntries });
  assert.doesNotMatch(payload, /DO NOT SEND|Unrelated secret|Unchanged body unrelated-entry|unrelated-concept/);
});

test('an addition discovers matching concepts locally without sending the full previous library', () => {
  const f = fixture(); const addition = source('new', 'New operational guidance for the B constraint.');
  const plan = planIncrementalKnowledge([...f.sources, addition], f.previous);
  assert.deepEqual(plan.changedSources, [addition]);
  assert.deepEqual(plan.affected.entries, []);
  assert.deepEqual(plan.anchors.map(item => item.id), ['beta']);
  assert.deepEqual(plan.relatedEntries.map(item => item.id), ['b-entry']);
  assert.deepEqual(plan.dependencySources.map(item => item.id), ['b']);
  assert.equal(plan.dependencySources[0]!.excerpts[0]!.text, 'Beta is a constraint.');
  assert.equal(JSON.stringify(plan.anchors).includes('Original definition'), false);
  assert.equal(JSON.stringify(plan.relatedEntries).includes('Unchanged body'), false);
});

test('ASCII name retrieval respects word boundaries while CJK names work without spaces', () => {
  const s = source('old', 'API 是接口。\n架构约束应记录。');
  const old = snapshot([s], { entries: [entry('api-article', [citation('old')]), entry('arch-article', [citation('old', 2)])], overview: [overview('topics', ['api-article', 'arch-article'])], conceptGraph: { schemaVersion: 1, concepts: [concept('api', 'API', ['api-article'], [citation('old')]), concept('arch', '架构约束', ['arch-article'], [citation('old', 2)])], relations: [] } });
  const plan = planIncrementalKnowledge([s, source('new', 'rapid improvement；遵守架构约束。')], old);
  assert.deepEqual(plan.anchors.map(item => item.id), ['arch']);
});

test('unchanged snapshots including legacy snapshots require no model and preserve every object', () => {
  const f = fixture();
  for (const previous of [f.previous, { ...f.previous, sourceManifest: undefined }]) {
    const plan = planIncrementalKnowledge([...f.sources].reverse(), previous);
    assert.equal(plan.needsModel, false);
    assert.deepEqual(plan.changedSources, []);
    assert.deepEqual(plan.dependencySources, []);
    assert.deepEqual(plan.anchors, []);
    assert.equal(plan.sourceFingerprint, previous.sourceFingerprint);
    const merged = mergeIncrementalKnowledge(plan, { entries: [entry('ignored', [])], overview: [] });
    assert.deepEqual(merged, { ...f.compilation, compilationTrace: { revision: 'strict-incremental-v1', changedSourceIds: [], removedSourceIds: [], modelCalls: 0 } });
    assert.equal(mergeIncrementalKnowledge(plan, empty()).entries, previous.entries);
    assert.equal(mergeIncrementalKnowledge(plan, empty()).conceptGraph, previous.conceptGraph);
  }
});

test('legacy migration only treats exact explicitly cited source versions as processed', () => {
  const a = source('a', 'A old'); const b = source('b', 'B was never included');
  const old = snapshot([a], { entries: [entry('a-entry', [citation('a')])], overview: [overview('a-topic', ['a-entry'])] }, false);
  const plan = planIncrementalKnowledge([a, b], old);
  assert.deepEqual(plan.changedSources.map(item => item.id), ['b']);
  assert.equal(plan.retained.entries[0], old.entries[0]);
  assert.equal(plan.needsModel, true);
  const newerA = source('a', 'A updated', 2);
  const update = planIncrementalKnowledge([newerA, b], old);
  assert.deepEqual(update.changedSources.map(item => item.id), ['a', 'b']);
  assert.deepEqual(update.affected.entries.map(item => item.id), ['a-entry']);
});

test('manifest changes to version, hash or verification are genuine source updates', () => {
  const f = fixture();
  for (const a of [{ ...f.a, version: 2 }, { ...f.a, hash: sha('different') }, { ...f.a, verified: true }]) {
    const plan = planIncrementalKnowledge([a, f.b, f.unrelated], f.previous);
    assert.deepEqual(plan.changedSources.map(item => item.id), ['a']);
    assert.deepEqual(plan.affected.entries.map(item => item.id), ['a-entry', 'mixed-entry']);
  }
});

test('deleting mixed evidence forces regeneration from surviving dependencies instead of retaining its stale text', () => {
  const f = fixture(); const plan = planIncrementalKnowledge([f.b, f.unrelated], f.previous);
  assert.deepEqual(plan.changedSources, []);
  assert.deepEqual(plan.removedSourceIds, ['a']);
  assert.equal(plan.needsModel, true);
  assert.ok(plan.affected.entries.some(item => item.id === 'mixed-entry'));
  assert.ok(!plan.retained.entries.some(item => item.id === 'mixed-entry'));
  const merged = mergeIncrementalKnowledge(plan, { entries: [], overview: [overview('mixed-topic', ['b-entry'])], conceptGraph: { schemaVersion: 1, concepts: [], relations: [] } });
  assert.deepEqual(merged.entries.map(item => item.id), ['b-entry', 'unrelated-entry']);
  assert.equal(JSON.stringify(merged).includes('Original relation summary'), false);
});

test('a mixed overview alone pulls surviving article evidence into the rewrite frontier', () => {
  const a = source('a', 'A will be removed.'); const b = source('b', 'Hidden header.\nB survives.\nHidden footer.');
  const old = snapshot([a, b], { entries: [entry('a-entry', [citation('a')]), entry('b-entry', [citation('b', 2)])], overview: [overview('joint-topic', ['a-entry', 'b-entry'])], conceptGraph: { schemaVersion: 1, concepts: [], relations: [] } });
  const plan = planIncrementalKnowledge([b], old);
  assert.equal(plan.needsModel, true, 'the old joint summary must be rewritten even though its remaining B is unchanged');
  assert.deepEqual(plan.relatedEntries.map(item => item.id), ['b-entry']);
  assert.deepEqual(plan.dependencySources[0]!.excerpts, [{ startLine: 2, endLine: 2, text: 'B survives.' }]);
  assert.deepEqual(plan.retained.overview, []);
  assert.equal(plan.affected.overview[0], old.overview[0]);
});

test('deleting the last source publishes an empty local result without a model', () => {
  const a = source('a', 'A original');
  const old = snapshot([a], { entries: [entry('a-entry', [citation('a')])], overview: [overview('a-topic', ['a-entry'])], conceptGraph: { schemaVersion: 1, concepts: [concept('alpha', 'Alpha', ['a-entry'], [citation('a')])], relations: [] } });
  const plan = planIncrementalKnowledge([], old);
  assert.equal(plan.needsModel, false);
  assert.deepEqual(plan.removedSourceIds, ['a']);
  assert.deepEqual(plan.sourceManifest, []);
  assert.deepEqual(mergeIncrementalKnowledge(plan, empty()), { ...empty(), compilationTrace: { revision: 'strict-incremental-v1', changedSourceIds: [], removedSourceIds: ['a'], modelCalls: 0 } });
  assert.deepEqual(mergeIncrementalKnowledge(planIncrementalKnowledge([]), empty()), { ...empty(), compilationTrace: { revision: 'strict-incremental-v1', changedSourceIds: [], removedSourceIds: [], modelCalls: 0 } });
});

test('a complete affected patch leaves unrelated articles, concepts and topics identical', () => {
  const f = fixture(); const a2 = source('a', 'Alpha revised.\nBeta still constrains Alpha.', 2);
  const plan = planIncrementalKnowledge([a2, f.b, f.unrelated], f.previous);
  const updated = entry('a-entry', [citation('a', 1, 1, 2)], 'Revised definition');
  const mixed = entry('mixed-entry', [citation('a', 2, 2, 2), citation('b', 3)], 'Rechecked synthesis');
  const delta: KnowledgeCompilation = { entries: [updated, mixed], overview: [overview('a-topic', ['a-entry']), overview('mixed-topic', ['mixed-entry', 'b-entry'])], conceptGraph: { schemaVersion: 1, concepts: [concept('new-alpha-id', 'Alpha', ['a-entry'], [citation('a', 1, 1, 2)])], relations: [{ id: 'alpha-beta', sourceId: 'new-alpha-id', targetId: 'beta', predicate: 'constrained by', basis: 'explicit', entryIds: ['mixed-entry'], citations: [citation('a', 2, 2, 2)] }] } };
  const before = structuredClone(f.previous);
  const result = mergeIncrementalKnowledge(plan, delta);
  assert.equal(result.entries.find(item => item.id === 'b-entry'), f.compilation.entries[1]);
  assert.equal(result.overview.find(item => item.id === 'b-topic'), f.compilation.overview[1]);
  assert.equal(result.conceptGraph!.concepts.find(item => item.id === 'unrelated-concept'), f.compilation.conceptGraph!.concepts[2]);
  assert.equal(result.conceptGraph!.concepts.find(item => item.name === 'Alpha')!.id, 'alpha');
  assert.equal(result.conceptGraph!.relations[0]!.sourceId, 'alpha');
  assert.deepEqual(f.previous, before, 'planning and merging never mutate the previous publication');
});

test('canonical retained concepts keep their definition, aliases and evidence while linking new articles', () => {
  const f = fixture(); const added = source('new', 'B constraint needs separate operational guidance.');
  const plan = planIncrementalKnowledge([...f.sources, added], f.previous);
  const linked = concept('llm-beta-id', 'B constraint', ['new-entry'], [citation('new')], ['Model invented alias']);
  linked.summary = 'A model must not replace the original definition';
  const result = mergeIncrementalKnowledge(plan, { entries: [entry('new-entry', [citation('new')])], overview: [overview('new-topic', ['new-entry'])], conceptGraph: { schemaVersion: 1, concepts: [linked], relations: [] } });
  const beta = result.conceptGraph!.concepts.find(item => item.id === 'beta')!;
  const newEntryId = result.entries.find(item => item.citations[0]!.sourceId === 'new')!.id;
  assert.match(newEntryId, /^delta-[a-f0-9]{12}-entry-/);
  assert.deepEqual(beta, { ...f.compilation.conceptGraph!.concepts[1], entryIds: ['b-entry', newEntryId] });
  assert.equal(beta.citations, f.compilation.conceptGraph!.concepts[1]!.citations);
  assert.equal(beta.aliases, f.compilation.conceptGraph!.concepts[1]!.aliases);
  assert.equal(result.conceptGraph!.concepts.filter(item => item.id === 'beta').length, 1);
});

test('delta cannot cite hidden evidence outside supplied excerpts', () => {
  const f = fixture(); const added = source('new', 'Beta receives new guidance.');
  const plan = planIncrementalKnowledge([...f.sources, added], f.previous);
  for (const [delta, pattern] of [
    [{ ...empty(), entries: [entry('new-entry', [citation('b', 1)])] }, /outside its supplied/],
    [{ ...empty(), entries: [entry('new-entry', [citation('unrelated')])] }, /outside its supplied/],
    [{ ...empty(), entries: [entry('new-entry', [citation('new', 1, 1, 99)])] }, /outside its supplied/],
  ] as const) assert.throws(() => mergeIncrementalKnowledge(plan, delta as KnowledgeCompilation), pattern);
});

test('new generic IDs receive deterministic local namespaces without rewriting retained objects', () => {
  const f = fixture(); const added = source('new', 'Beta receives new guidance.');
  const plan = planIncrementalKnowledge([...f.sources, added], f.previous);
  const delta: KnowledgeCompilation = { entries: [entry('b-entry', [citation('new')], 'New article body')], overview: [overview('b-topic', ['b-entry'])], conceptGraph: { schemaVersion: 1, concepts: [concept('new-object', 'New object', ['b-entry'], [citation('new')])], relations: [] } };
  const merged = mergeIncrementalKnowledge(plan, delta);
  const newArticle = merged.entries.at(-1)!;
  const newTopic = merged.overview.at(-1)!;
  const newConcept = merged.conceptGraph!.concepts.at(-1)!;
  assert.match(newArticle.id, /^delta-[a-f0-9]{12}-entry-/);
  assert.match(newTopic.id, /^delta-[a-f0-9]{12}-overview-/);
  assert.match(newConcept.id, /^delta-[a-f0-9]{12}-concept-/);
  assert.deepEqual(newTopic.entryIds, [newArticle.id]);
  assert.deepEqual(newConcept.entryIds, [newArticle.id]);
  assert.equal(merged.entries.find(item => item.id === 'b-entry'), f.compilation.entries[1]);
  assert.equal(merged.overview.find(item => item.id === 'b-topic'), f.compilation.overview[1]);
  assert.deepEqual(mergeIncrementalKnowledge(plan, delta), merged, 'retrying the same delta assigns the same IDs');
  assert.deepEqual(mergeIncrementalKnowledge(planIncrementalKnowledge([added, ...f.sources].reverse(), f.previous), delta), merged, 'source input order does not change generated IDs');
  assert.equal(mergeIncrementalKnowledge(planIncrementalKnowledge([added]), delta).entries[0]!.id, 'b-entry', 'first publications retain their existing ID compatibility');
});

test('ambiguous aliases and retained ID redefinitions fail closed', () => {
  const f = fixture(); const added = source('new', 'Beta receives Alpha guidance.');
  const plan = planIncrementalKnowledge([...f.sources, added], f.previous);
  const patch = (item: KnowledgeConcept): KnowledgeCompilation => ({ entries: [entry('new-entry', [citation('new')])], overview: [overview('new-topic', ['new-entry'])], conceptGraph: { schemaVersion: 1, concepts: [item], relations: [] } });
  assert.throws(() => mergeIncrementalKnowledge(plan, patch(concept('new', 'Beta', ['new-entry'], [citation('new')], ['Alpha']))), /ambiguously join/);
  assert.throws(() => mergeIncrementalKnowledge(plan, patch(concept('beta', 'Distinct new object', ['new-entry'], [citation('new')]))), /cannot redefine/);
  assert.throws(() => mergeIncrementalKnowledge(plan, patch({ ...concept('new', 'Beta', ['new-entry'], [citation('new')]), kind: 'entity' })), /conflicts.*kind/);
  assert.throws(() => mergeIncrementalKnowledge(plan, patch(concept('new', 'Beta', ['unrelated-entry'], [citation('new')]))), /provided frontier/);
});

test('all delta article references are restricted to new articles and supplied related entries', () => {
  const f = fixture(); const added = source('new', 'Beta has operational guidance.');
  const plan = planIncrementalKnowledge([...f.sources, added], f.previous);
  assert.deepEqual(plan.relatedEntries.map(item => item.id), ['b-entry']);
  const base: KnowledgeCompilation = { entries: [entry('new-entry', [citation('new')])], overview: [overview('new-topic', ['new-entry'])], conceptGraph: { schemaVersion: 1, concepts: [], relations: [] } };
  for (const modify of [
    (delta: KnowledgeCompilation) => { delta.overview[0]!.entryIds.push('unrelated-entry'); },
    (delta: KnowledgeCompilation) => { delta.conceptGraph!.concepts.push(concept('new-concept', 'Fresh subject', ['new-entry', 'unrelated-entry'], [citation('new')])); },
    (delta: KnowledgeCompilation) => {
      delta.conceptGraph!.concepts.push(concept('new-concept', 'Fresh subject', ['new-entry'], [citation('new')]));
      delta.conceptGraph!.relations.push({ id: 'new-edge', sourceId: 'new-concept', targetId: 'beta', predicate: 'depends on', basis: 'explicit', entryIds: ['new-entry', 'unrelated-entry'], citations: [citation('new')] });
    },
  ]) {
    const delta = structuredClone(base); modify(delta);
    assert.throws(() => mergeIncrementalKnowledge(plan, delta), /knowledge entry outside its provided frontier/);
  }
  const allowed = structuredClone(base); allowed.overview[0]!.entryIds.push('b-entry');
  assert.doesNotThrow(() => mergeIncrementalKnowledge(plan, allowed));
});

test('relation endpoints require supplied anchors or explicitly rebuilt delta concepts', () => {
  const f = fixture(); const added = source('new', 'Brand new evidence without old names.');
  const plan = planIncrementalKnowledge([...f.sources, added], f.previous);
  assert.deepEqual(plan.anchors, []);
  const delta: KnowledgeCompilation = { entries: [entry('new-entry', [citation('new')])], overview: [overview('new-topic', ['new-entry'])], conceptGraph: { schemaVersion: 1, concepts: [], relations: [{ id: 'guessed', sourceId: 'alpha', targetId: 'beta', predicate: 'depends on', basis: 'explicit', entryIds: ['new-entry'], citations: [citation('new')] }] } };
  assert.throws(() => mergeIncrementalKnowledge(plan, delta), /concept endpoint outside its provided frontier/);
  const a2 = source('a', 'Alpha changed and Beta still exists.', 2);
  const changed = planIncrementalKnowledge([a2, f.b, f.unrelated], f.previous);
  const affectedDelta: KnowledgeCompilation = { entries: [entry('a-entry', [citation('a', 1, 1, 2)])], overview: [overview('a-topic', ['a-entry'])], conceptGraph: { schemaVersion: 1, concepts: [], relations: [{ id: 'fresh-relation', sourceId: 'alpha', targetId: 'beta', predicate: 'considers', basis: 'explicit', entryIds: ['a-entry'], citations: [citation('a', 1, 1, 2)] }] } };
  assert.throws(() => mergeIncrementalKnowledge(changed, affectedDelta), /concept endpoint outside its provided frontier/, 'an affected old concept must be rebuilt before it can serve as an endpoint');
});

test('only retained relations between supplied anchors appear as bounded metadata', () => {
  const f = fixture();
  const one = planIncrementalKnowledge([...f.sources, source('new', 'Beta operational guidance.')], f.previous);
  assert.deepEqual(one.relatedRelations, []);
  const both = planIncrementalKnowledge([...f.sources, source('new', 'Alpha and Beta operational guidance.')], f.previous);
  assert.deepEqual(both.relatedRelations, [{ id: 'alpha-beta', sourceId: 'alpha', targetId: 'beta', predicate: 'depends on', basis: 'explicit' }]);
  assert.doesNotMatch(JSON.stringify(both.relatedRelations), /summary|citations|entryIds|Original relation/);
  const crowded = structuredClone(f.previous);
  crowded.conceptGraph!.relations = Array.from({ length: 301 }, (_, index) => ({ ...f.previous.conceptGraph!.relations[0]!, id: `edge-${index}`, predicate: `predicate-${index}` }));
  assert.throws(() => planIncrementalKnowledge([...f.sources, source('new', 'Alpha and Beta operational guidance.')], crowded), /related relation frontier is too large/);
});

test('canonical endpoint remapping cannot turn a relation into a self loop or replace an existing relation', () => {
  const f = fixture(); const added = source('new', 'Alpha and Beta have new operational guidance.');
  const plan = planIncrementalKnowledge([...f.sources, added], f.previous);
  const delta: KnowledgeCompilation = { entries: [entry('new-entry', [citation('new')])], overview: [overview('new-topic', ['new-entry'])], conceptGraph: { schemaVersion: 1, concepts: [concept('new-alpha', 'Alpha', ['new-entry'], [citation('new')]), concept('new-beta', 'Beta', ['new-entry'], [citation('new')])], relations: [{ id: 'new-relation', sourceId: 'new-alpha', targetId: 'new-beta', predicate: 'depends on', basis: 'explicit', entryIds: ['new-entry'], citations: [citation('new')] }] } };
  assert.throws(() => mergeIncrementalKnowledge(plan, delta), /repeats a retained relation/);
  delta.conceptGraph!.relations[0]!.predicate = 'different predicate';
  const merged = mergeIncrementalKnowledge(plan, delta);
  assert.equal(merged.conceptGraph!.relations[1]!.sourceId, 'alpha');
  assert.equal(merged.conceptGraph!.relations[1]!.targetId, 'beta');
  delta.conceptGraph!.relations[0]!.targetId = 'alpha';
  assert.throws(() => mergeIncrementalKnowledge(plan, delta), /self-referential/);
});

test('dependency frontiers are bounded explicitly without silently truncating relevant concepts', () => {
  const s = source('old', 'Original shared evidence.');
  const concepts = Array.from({ length: 101 }, (_, index) => concept(`concept-${index}`, `UniqueTerm${index}`, ['old-entry'], [citation('old')]));
  const old = snapshot([s], { entries: [entry('old-entry', [citation('old')])], overview: [overview('old-topic', ['old-entry'])], conceptGraph: { schemaVersion: 1, concepts, relations: [] } });
  const changed = source('new', concepts.map(item => item.name).join(' '));
  assert.throws(() => planIncrementalKnowledge([s, changed], old), /dependency frontier is too large/);
});

test('malformed provenance manifests and invalid dependency ranges never produce a partial plan', () => {
  const f = fixture();
  assert.throws(() => planIncrementalKnowledge([f.a, f.a], f.previous), /duplicate IDs/);
  assert.throws(() => planIncrementalKnowledge(f.sources, { ...f.previous, sourceManifest: [f.previous.sourceManifest![0]!] }), /disagrees with its source manifest/);
  const invalid = structuredClone(f.previous);
  invalid.entries[1]!.citations[0]!.endLine = 999;
  assert.throws(() => planIncrementalKnowledge([...f.sources, source('new', 'Beta guidance')], invalid), /invalid evidence range/);
});

test('a restarted repository can publish a namespaced local delta with canonical concepts and exact source references', async t => {
  const root = await mkdtemp(join(tmpdir(), 'workforce-incremental-publication-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const space = { kind: 'template' as const, teamId: 'team' };
  const repository = new KnowledgeRepository(join(root, 'knowledge'));
  const f = fixture();
  for (const item of f.sources) await repository.ingest(space, { id: item.id, title: item.title, content: item.content, provenance: item.provenance, verified: item.verified });
  const first = await repository.publish(space, f.compilation, await repository.fingerprint(space));
  const reopened = new KnowledgeRepository(join(root, 'knowledge'));
  const before = (await reopened.snapshot(space))!;
  assert.equal(before.version, first.version);
  assert.equal(before.sourceManifest!.length, 3, 'publication persists a manifest for planning after restart');
  await reopened.ingest(space, { id: 'new', title: 'Operational guidance', content: 'Beta guides Alpha during operations.', provenance: 'fixture', verified: false });
  const plan = planIncrementalKnowledge(await reopened.sources(space), before);
  const delta: KnowledgeCompilation = {
    entries: [entry('b-entry', [citation('new')], 'Additional operational knowledge')],
    overview: [overview('b-topic', ['b-entry'])],
    conceptGraph: { schemaVersion: 1, concepts: [concept('new-beta', 'B constraint', ['b-entry'], [citation('new')])], relations: [{ id: 'alpha-beta', sourceId: 'new-beta', targetId: 'alpha', predicate: 'guides', basis: 'explicit', entryIds: ['b-entry'], citations: [citation('new')] }] },
  };
  const merged = mergeIncrementalKnowledge(plan, delta);
  const published = await reopened.publish(space, merged, plan.sourceFingerprint, undefined, before.version);
  assert.equal(published.entries.length, before.entries.length + 1);
  assert.deepEqual(published.entries.find(item => item.id === 'b-entry'), before.entries.find(item => item.id === 'b-entry'));
  const newArticle = published.entries.find(item => item.content === 'Additional operational knowledge')!;
  const beta = published.conceptGraph!.concepts.find(item => item.id === 'beta')!;
  assert.ok(beta.entryIds.includes(newArticle.id));
  assert.equal(beta.summary, before.conceptGraph!.concepts.find(item => item.id === 'beta')!.summary);
  assert.ok(published.conceptGraph!.relations.some(item => item.sourceId === 'beta' && item.targetId === 'alpha' && item.predicate === 'guides'));
  assert.deepEqual((await reopened.snapshot(space))!.sourceManifest!.map(item => item.id), ['a', 'b', 'new', 'unrelated']);
});
