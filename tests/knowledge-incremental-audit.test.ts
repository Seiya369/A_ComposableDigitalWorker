import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { KnowledgeRepository } from '../src/knowledge/repository.js';
import { mergeIncrementalKnowledge, planIncrementalKnowledge } from '../src/knowledge/incremental.js';
import type { KnowledgeCitation, KnowledgeCompilation, KnowledgeSpace } from '../src/knowledge/types.js';

const space: KnowledgeSpace = { kind: 'template', teamId: 'incremental-audit' };
const citation = (id: string): KnowledgeCitation => ({ sourceId: id, sourceVersion: 1, startLine: 1, endLine: 1 });
const entry = (id: string, sourceId: string) => ({ id, title: `Article ${id}`, content: `Knowledge ${id}`, citations: [citation(sourceId)] });
const overview = (id: string, entryIds: string[]) => ({ id, title: `Topic ${id}`, summary: `Summary ${id}`, entryIds });

test('deletion may publish zero remaining knowledge while an already processed source has no derived claims', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'workforce-incremental-empty-audit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repo = new KnowledgeRepository(join(directory, 'knowledge'));
  await repo.ingest(space, { id: 'relevant', title: 'Relevant', content: 'One valid claim.', provenance: 'audit', verified: false });
  await repo.ingest(space, { id: 'administrative', title: 'Administrative note', content: 'No reusable claims extracted from this source.', provenance: 'audit', verified: false });
  const before = await repo.publish(space, { entries: [entry('claim', 'relevant')], overview: [overview('claims', ['claim'])], conceptGraph: { schemaVersion: 1, concepts: [], relations: [] } }, await repo.fingerprint(space));
  await repo.retire(space, 'relevant');
  const plan = planIncrementalKnowledge(await repo.sources(space), before);
  assert.equal(plan.needsModel, false);
  assert.deepEqual(plan.removedSourceIds, ['relevant']);
  const result = mergeIncrementalKnowledge(plan, { entries: [], overview: [] });
  assert.deepEqual(result.entries, []);
  const published = await repo.publish(space, result, plan.sourceFingerprint, undefined, before.version);
  assert.deepEqual(published.entries, []);
  assert.deepEqual(published.sourceManifest!.map(item => item.id), ['administrative']);
});

test('an incremental overview cannot target an unrelated retained B ID omitted from its frontier', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'workforce-incremental-id-audit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repo = new KnowledgeRepository(join(directory, 'knowledge'));
  await repo.ingest(space, { id: 'private-old-source', title: 'Unrelated', content: 'Unrelated old source.', provenance: 'audit', verified: false });
  const before = await repo.publish(space, { entries: [entry('old-entry', 'private-old-source')], overview: [overview('old-topic', ['old-entry'])], conceptGraph: { schemaVersion: 1, concepts: [], relations: [] } }, await repo.fingerprint(space));
  await repo.ingest(space, { id: 'new', title: 'New', content: 'Entirely new evidence with no matching names.', provenance: 'audit', verified: false });
  const plan = planIncrementalKnowledge(await repo.sources(space), before);
  assert.deepEqual(plan.relatedEntries, []);
  const delta: KnowledgeCompilation = { entries: [entry('new-entry', 'new')], overview: [overview('new-topic', ['new-entry', 'old-entry'])], conceptGraph: { schemaVersion: 1, concepts: [], relations: [] } };
  assert.throws(() => mergeIncrementalKnowledge(plan, delta), /frontier|provided|unrelated|allowed/i);
});

test('an incremental relation cannot target retained concept IDs omitted from its supplied anchors', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'workforce-incremental-endpoint-audit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repo = new KnowledgeRepository(join(directory, 'knowledge'));
  await repo.ingest(space, { id: 'old', title: 'Old source', content: 'Old subjects have exact identities.', provenance: 'audit', verified: false });
  const before = await repo.publish(space, {
    entries: [entry('old-entry', 'old')], overview: [overview('old-topic', ['old-entry'])],
    conceptGraph: { schemaVersion: 1, concepts: ['HiddenSubjectOne', 'HiddenSubjectTwo'].map((name, index) => ({ id: `hidden-${index}`, name, summary: name, entryIds: ['old-entry'], citations: [citation('old')] })), relations: [] },
  }, await repo.fingerprint(space));
  await repo.ingest(space, { id: 'new', title: 'New', content: 'New evidence describes no existing named subject.', provenance: 'audit', verified: false });
  const plan = planIncrementalKnowledge(await repo.sources(space), before);
  assert.deepEqual(plan.anchors, []);
  const delta: KnowledgeCompilation = {
    entries: [entry('new-entry', 'new')], overview: [overview('new-topic', ['new-entry'])],
    conceptGraph: { schemaVersion: 1, concepts: [], relations: [{ id: 'guessed-relation', sourceId: 'hidden-0', targetId: 'hidden-1', predicate: 'depends on', basis: 'explicit', entryIds: ['new-entry'], citations: [citation('new')] }] },
  };
  assert.throws(() => mergeIncrementalKnowledge(plan, delta), /frontier|provided|unrelated|allowed/i);
});
