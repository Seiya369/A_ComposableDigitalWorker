import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createKnowledgeCompiler } from '../src/harness/knowledge-compiler.js';
import { KnowledgeRepository } from '../src/knowledge/repository.js';
import { graphEvidenceAlignmentIssues, assertEvidenceAlignmentRepairScope } from '../src/knowledge/evidence-alignment.js';
import type { KnowledgeCompilation, KnowledgeSource } from '../src/knowledge/types.js';

const source: KnowledgeSource = { id: 'new-source', title: '焦点与交互', text: '焦点表示当前操作位置。\n可见性帮助识别焦点。\n焦点依赖可见性。', content: '', version: 1, hash: 'new-hash', provenance: 'fixture', verified: false, createdAt: new Date().toISOString(), processing: [] };
const cite = (startLine: number, endLine = startLine) => ({ sourceId: source.id, sourceVersion: 1, startLine, endLine });
const empty: KnowledgeCompilation = { entries: [], overview: [], conceptGraph: { schemaVersion: 1, concepts: [], relations: [] } };
function misaligned(): KnowledgeCompilation {
  return {
    entries: [{ id: 'entry', title: '焦点可见性', content: '焦点表示操作位置，可见性帮助识别焦点，焦点依赖可见性。', citations: [cite(1)] }],
    overview: [{ id: 'topic', title: '交互', summary: '焦点可见性', entryIds: ['entry'] }],
    conceptGraph: { schemaVersion: 1, concepts: [
      { id: 'focus', name: '焦点', summary: '当前操作位置', entryIds: ['entry'], citations: [cite(1)] },
      { id: 'visibility', name: '可见性', summary: '帮助识别焦点', entryIds: ['entry'], citations: [cite(2)] },
    ], relations: [{ id: 'focus-needs-visibility', sourceId: 'focus', targetId: 'visibility', predicate: '依赖', basis: 'explicit', entryIds: ['entry'], citations: [cite(3)] }] },
  };
}
function aligned(): KnowledgeCompilation { const value = misaligned(); value.entries[0]!.citations = [cite(1, 3)]; return value; }

test('alignment preflight reports exact graph item IDs and A/B ranges without changing evidence', () => {
  const value = misaligned(); const before = structuredClone(value);
  const issues = graphEvidenceAlignmentIssues(value, [source], empty);
  assert.deepEqual(issues.map(({ itemType, itemId, citation }) => ({ itemType, itemId, citation })), [
    { itemType: 'concept', itemId: 'visibility', citation: cite(2) },
    { itemType: 'relation', itemId: 'focus-needs-visibility', citation: cite(3) },
  ]);
  assert.deepEqual(issues[0]!.knowledgeReferences, [{ entryId: 'entry', citations: [cite(1)] }]);
  assert.deepEqual(value, before);
  assert.deepEqual(graphEvidenceAlignmentIssues(aligned(), [source], empty), []);
  assert.throws(() => graphEvidenceAlignmentIssues(value, [source], value), /原有知识/);
});

test('alignment correction cannot turn invalid A evidence into a repair request or erase graph knowledge', () => {
  const invalid = misaligned(); invalid.conceptGraph!.concepts[0]!.citations = [cite(99)];
  assert.throws(() => graphEvidenceAlignmentIssues(invalid, [source], empty), /line range/);
  assert.doesNotThrow(() => assertEvidenceAlignmentRepairScope(misaligned(), aligned()));
  const erased = aligned(); erased.conceptGraph!.relations = [];
  assert.throws(() => assertEvidenceAlignmentRepairScope(misaligned(), erased), /超出引用范围|删改/);
  const rewritten = aligned(); rewritten.entries[0]!.content = '改写未授权结论';
  assert.throws(() => assertEvidenceAlignmentRepairScope(misaligned(), rewritten), /超出引用范围|删改/);
});

async function storedFixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'workforce-evidence-alignment-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = new KnowledgeRepository(join(root, 'knowledge'));
  const space = { kind: 'template' as const, teamId: 'team', memberId: 'employee' };
  const oldSource = await repo.ingest(space, { id: 'old-source', title: '旧知识', content: 'UNRELATED_OLD_SOURCE_NOT_FOR_MODEL\n保留定义。', provenance: 'fixture', verified: false });
  const oldCitation = { sourceId: oldSource.id, sourceVersion: 1, startLine: 2, endLine: 2 };
  const previous = await repo.publish(space, {
    entries: [{ id: 'old-entry', title: '旧文章', content: '不可由新资料改写的旧正文。', citations: [oldCitation] }],
    overview: [{ id: 'old-topic', title: '旧主题', summary: '保留', entryIds: ['old-entry'] }],
    conceptGraph: { schemaVersion: 1, concepts: [{ id: 'old-concept', name: '旧概念', summary: '原定义。', entryIds: ['old-entry'], citations: [oldCitation] }], relations: [] },
  }, await repo.fingerprint(space));
  const current = await repo.ingest(space, { id: source.id, title: source.title, content: source.text, provenance: 'fixture', verified: false });
  const input = { space, previous, sources: [oldSource, current], model: { mode: 'override' as const, provider: 'employee-provider', model: 'employee-model', reasoningEffort: 'high' }, signal: new AbortController().signal };
  return { repo, space, previous, input };
}

test('one evidence alignment correction reuses analysis, exact route and total signal, reports all usage and protects retained knowledge', async t => {
  const f = await storedFixture(t);
  const calls: any[] = []; let analysisCalls = 0;
  const ctx = { llm: { async *stream(input: any) {
    calls.push(input);
    const output = calls.length === 1 ? '焦点、可见性及依赖关系。' : JSON.stringify(calls.length === 2 ? misaligned() : aligned());
    yield { type: 'text-delta', index: 0, text: output };
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } } };
  const compiled = await createKnowledgeCompiler(ctx as never, {}, { async analysisPrompt() { analysisCalls++; return 'Wiki analysis'; } })(f.input);
  assert.equal(analysisCalls, 1);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(call => call.maxTokens), [24_000, 64_000, 64_000]);
  for (const call of calls) {
    assert.equal(call.provider, f.input.model.provider); assert.equal(call.model, f.input.model.model); assert.equal(call.reasoningEffort, 'high');
    assert.equal(call.signal, calls[0].signal); assert.equal(call.sessionId, undefined); assert.equal(call.tools, undefined);
    assert.doesNotMatch(call.messages[0].content[0].text, /UNRELATED_OLD_SOURCE_NOT_FOR_MODEL/);
  }
  const generation = JSON.parse(calls[1].messages[0].content[0].text);
  const repair = JSON.parse(calls[2].messages[0].content[0].text);
  assert.equal(repair.stage, 'evidence-alignment-repair');
  assert.equal(repair.wikiAnalysis, generation.wikiAnalysis);
  assert.deepEqual(repair.sources, generation.sources); assert.deepEqual(repair.dependencySources, generation.dependencySources);
  assert.deepEqual(repair.previousDelta, misaligned());
  assert.deepEqual(repair.alignmentIssues.map((issue: any) => issue.citation), [cite(2), cite(3)]);
  assert.ok(repair.alignmentIssues.every((issue: any) => typeof issue.itemId === 'string' && issue.itemId.length));
  assert.deepEqual(compiled.entries.find(entry => entry.id === 'old-entry'), f.previous.entries[0]);
  assert.deepEqual(compiled.conceptGraph!.concepts.find(concept => concept.id === 'old-concept'), f.previous.conceptGraph!.concepts[0]);
  assert.equal(compiled.compilationTrace!.modelCalls, 3);
  assert.deepEqual(compiled.compilationTrace!.usage, { reportedCalls: 3, inputTokens: 30, outputTokens: 15, totalTokens: 45 });
  const published = await f.repo.publish(f.space, compiled, await f.repo.fingerprint(f.space));
  assert.equal(published.version, f.previous.version + 1);
  assert.equal(published.conceptGraph!.relations.length, 1);
  assert.equal(published.conceptGraph!.concepts.length, 3);
});

test('a second alignment failure stops after one correction and preserves the old publication', async t => {
  const f = await storedFixture(t); let calls = 0;
  const ctx = { llm: { async *stream() {
    calls++;
    yield { type: 'text-delta', index: 0, text: calls === 1 ? '候选分析' : JSON.stringify(misaligned()) };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } } };
  const compiler = createKnowledgeCompiler(ctx as never, {}, { async analysisPrompt() { return 'Wiki analysis'; } });
  await assert.rejects(compiler(f.input), /图谱引用范围仍未被关联知识覆盖/);
  assert.equal(calls, 3);
  assert.deepEqual(await f.repo.snapshot(f.space), f.previous);
});

test('illegal A ranges and ambiguous concept names never trigger an alignment correction', async t => {
  const f = await storedFixture(t);
  for (const [modify, expected] of [
    [(value: KnowledgeCompilation) => { value.conceptGraph!.concepts[0]!.citations = [cite(99)]; }, /outside its supplied|line range/],
    [(value: KnowledgeCompilation) => { value.conceptGraph!.concepts[0]!.aliases = ['可见性']; }, /ambiguous new concept names/],
  ] as const) {
    let calls = 0; const invalid = misaligned(); modify(invalid);
    const ctx = { llm: { async *stream() {
      calls++; yield { type: 'text-delta', index: 0, text: JSON.stringify(invalid) }; yield { type: 'finish', reason: { kind: 'stop' } };
    } } };
    await assert.rejects(createKnowledgeCompiler(ctx as never)(f.input), expected);
    assert.equal(calls, 1);
    assert.deepEqual(await f.repo.snapshot(f.space), f.previous);
  }
});

test('correction cannot drop an unsupported edge or replace it with illegal A evidence', async t => {
  const f = await storedFixture(t);
  for (const [modify, expected] of [
    [(value: KnowledgeCompilation) => { value.conceptGraph!.relations = []; }, /超出引用范围|删改/],
    [(value: KnowledgeCompilation) => { value.conceptGraph!.relations[0]!.citations = [cite(99)]; }, /outside its supplied|line range/],
    [(value: KnowledgeCompilation) => { value.conceptGraph!.relations[0]!.citations = [{ sourceId: 'old-source', sourceVersion: 1, startLine: 2, endLine: 2 }]; }, /outside its supplied/],
  ] as const) {
    let calls = 0; const invalid = aligned(); modify(invalid);
    const ctx = { llm: { async *stream() {
      calls++; yield { type: 'text-delta', index: 0, text: JSON.stringify(calls === 1 ? misaligned() : invalid) }; yield { type: 'finish', reason: { kind: 'stop' } };
    } } };
    await assert.rejects(createKnowledgeCompiler(ctx as never)(f.input), expected);
    assert.equal(calls, 2);
    assert.deepEqual(await f.repo.snapshot(f.space), f.previous);
  }
});

test('evidence correction keeps the original total deadline and bounded input allowance', async () => {
  const calls: any[] = [];
  const ctx = { llm: { async *stream(input: any) {
    calls.push(input);
    await delay(calls.length === 3 ? 150 : 20, undefined, { signal: input.signal });
    yield { type: 'text-delta', index: 0, text: calls.length === 1 ? '候选分析' : JSON.stringify(misaligned()) };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } } };
  const input = { space: { kind: 'template' as const, teamId: 'team' }, sources: [source], model: { mode: 'override' as const, provider: 'provider', model: 'model', reasoningEffort: 'high' }, signal: new AbortController().signal };
  await assert.rejects(createKnowledgeCompiler(ctx as never, { timeoutMs: 100 }, { async analysisPrompt() { return 'Wiki analysis'; } })(input));
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.signal === calls[0].signal));
  assert.equal(calls[2].signal.aborted, true);
  assert.match(String(calls[2].signal.reason), /编纂超时/);
  let boundedCalls = 0;
  const boundedCtx = { llm: { async *stream() { boundedCalls++; yield { type: 'text-delta', index: 0, text: JSON.stringify(misaligned()) }; yield { type: 'finish', reason: { kind: 'stop' } }; } } };
  await assert.rejects(createKnowledgeCompiler(boundedCtx as never, { maxInputBytes: 1_500 })(input), /证据对齐修正输入超过大小上限/);
  assert.equal(boundedCalls, 1);
});
