import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createKnowledgeCompiler } from '../src/harness/knowledge-compiler.js';
import { KnowledgeRepository } from '../src/knowledge/repository.js';
import type { KnowledgeCompilation, KnowledgeSource } from '../src/knowledge/types.js';

const space = { kind: 'template' as const, teamId: 'incremental' };
const model = { mode: 'override' as const, provider: 'fixture', model: 'fixture-model', reasoningEffort: 'high' };
const cite = (source: KnowledgeSource, line = 1) => ({ sourceId: source.id, sourceVersion: source.version, startLine: line, endLine: line });
const graph = () => ({ schemaVersion: 1 as const, concepts: [], relations: [] });
const from = (sources: KnowledgeSource[]): KnowledgeCompilation => ({ entries: sources.map(source => ({ id: `entry-${source.id}`, title: source.title, content: source.text, citations: [cite(source)] })), overview: sources.map(source => ({ id: `topic-${source.id}`, title: source.title, summary: `Summary ${source.title}`, entryIds: [`entry-${source.id}`] })), conceptGraph: graph() });
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'workforce-incremental-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = new KnowledgeRepository(join(root, 'knowledge'));
  const ingest = (id: string, content: string) => repo.ingest(space, { id, title: id, content, provenance: 'fixture', verified: false });
  return { root, repo, ingest };
}

test('native two-stage compilation sends only changed evidence, persists its baseline, and reuses unrelated knowledge after restart', async t => {
  const f = await fixture(t);
  await f.ingest('alpha', 'ALPHA_V1');
  await f.ingest('unrelated', 'UNRELATED_PRIVATE_BODY_MUST_NEVER_BE_RESENT');
  const calls: any[] = [];
  const ctx = { llm: { async *stream(options: any) {
    const data = JSON.parse(options.messages[0].content[0].text); calls.push(data);
    const output = data.stage === 'wiki-analysis' ? '候选来源分析' : JSON.stringify(from(data.sources));
    yield { type: 'text-delta', index: 0, text: output };
    yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 20, totalTokens: 130 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } } };
  const compiler = createKnowledgeCompiler(ctx as never, {}, { async analysisPrompt() { return 'Native shared Wiki analysis'; } });
  const run = async (repo: KnowledgeRepository) => {
    const sources = await repo.sources(space); const previous = await repo.snapshot(space);
    const compiled = await compiler({ space, sources, previous, model, signal: new AbortController().signal });
    return repo.publish(space, compiled, await repo.fingerprint(space), undefined, previous?.version ?? null);
  };
  const first = await run(f.repo);
  assert.equal(calls.length, 2);
  assert.equal(first.sourceManifest!.length, 2);
  assert.deepEqual(first.compilationTrace?.usage, { reportedCalls: 2, inputTokens: 200, outputTokens: 20, totalTokens: 260, cacheReadTokens: 40 });
  const restarted = new KnowledgeRepository(f.repo.rootPath);
  assert.deepEqual((await restarted.snapshot(space))!.sourceManifest, first.sourceManifest);
  const a2 = await f.ingest('alpha', 'ALPHA_V2');
  const second = await run(restarted);
  assert.equal(calls.length, 4);
  for (const call of calls.slice(2)) {
    assert.deepEqual(call.sources.map((source: any) => source.id), ['alpha']);
    assert.equal(call.sources[0].version, 2);
    assert.equal(call.previous, undefined);
    assert.deepEqual(call.dependencySources, []);
    assert.doesNotMatch(JSON.stringify(call), /UNRELATED_PRIVATE_BODY_MUST_NEVER_BE_RESENT/);
  }
  assert.deepEqual(second.entries.find(item => item.id === 'entry-unrelated'), first.entries.find(item => item.id === 'entry-unrelated'));
  assert.deepEqual(second.overview.find(item => item.id === 'topic-unrelated'), first.overview.find(item => item.id === 'topic-unrelated'));
  assert.ok(second.entries.some(item => item.content === 'ALPHA_V2'));
  assert.equal(second.compilationTrace?.modelCalls, 2);
  const noop = await compiler({ space, sources: await restarted.sources(space), previous: second, model, signal: new AbortController().signal });
  assert.equal(calls.length, 4);
  assert.deepEqual(noop.entries, second.entries);
  await f.repo.retire(space, a2.id, undefined, a2.version);
  const third = await run(restarted);
  assert.equal(calls.length, 4, 'a source-only withdrawal is a local patch');
  assert.deepEqual(third.entries, first.entries.filter(item => item.id === 'entry-unrelated'));
  assert.equal(third.compilationTrace?.modelCalls, 0);
  assert.ok((await readFile(join(f.repo.rootPath, 'templates/incremental/team/A-sources/alpha/v1.json'), 'utf8')).includes('ALPHA_V1'));
});

test('a changed cross-source synthesis gets only surviving cited lines, with original line numbers', async t => {
  const f = await fixture(t);
  const a = await f.ingest('a', 'Old alpha');
  const b = await f.ingest('b', 'UNRELATED_HEADER\nB exact supporting fact\nUNRELATED_FOOTER');
  const mixed: KnowledgeCompilation = { entries: [{ id: 'mixed', title: 'Joint conclusion', content: 'Old alpha with B fact', citations: [cite(a), cite(b, 2)] }], overview: [{ id: 'mixed-topic', title: 'Joint topic', summary: 'Old joint summary', entryIds: ['mixed'] }], conceptGraph: graph() };
  const previous = await f.repo.publish(space, mixed, await f.repo.fingerprint(space));
  const a2 = await f.ingest('a', 'New alpha'); const payloads: any[] = [];
  const ctx = { llm: { async *stream(options: any) {
    const data = JSON.parse(options.messages[0].content[0].text); payloads.push(data);
    const replacement = { ...mixed, entries: [{ ...mixed.entries[0]!, content: 'Rechecked alpha with B fact', citations: [cite(a2), cite(b, 2)] }] };
    yield { type: 'text-delta', index: 0, text: data.stage === 'wiki-analysis' ? '只核对变更及第2行' : JSON.stringify(replacement) };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } } };
  const compiler = createKnowledgeCompiler(ctx as never, {}, { async analysisPrompt() { return 'Wiki analysis'; } });
  const compilation = await compiler({ space, sources: await f.repo.sources(space), previous, model, signal: new AbortController().signal });
  const next = await f.repo.publish(space, compilation, await f.repo.fingerprint(space), undefined, previous.version);
  assert.equal(next.entries[0]!.content, 'Rechecked alpha with B fact');
  for (const data of payloads) {
    assert.deepEqual(data.sources.map((item: any) => item.id), ['a']);
    assert.deepEqual(data.dependencySources[0].excerpts, [{ startLine: 2, endLine: 2, text: 'B exact supporting fact' }]);
    assert.doesNotMatch(JSON.stringify(data), /UNRELATED_HEADER|UNRELATED_FOOTER/);
    assert.equal(data.previous, undefined);
  }
});

test('source equality cannot let a late delta overwrite a newer knowledge snapshot', async t => {
  const f = await fixture(t); const source = await f.ingest('a', 'A fact');
  const fingerprint = await f.repo.fingerprint(space);
  const first = await f.repo.publish(space, from([source]), fingerprint, undefined, null);
  const next = await f.repo.publish(space, from([source]), fingerprint, undefined, first.version);
  await assert.rejects(f.repo.publish(space, from([source]), fingerprint, undefined, first.version), /snapshot changed/);
  assert.deepEqual(await f.repo.snapshot(space), next);
});
