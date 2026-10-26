import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createKnowledgeCompiler } from '../src/harness/knowledge-compiler.js';
import { KnowledgeRepository } from '../src/knowledge/repository.js';
import type { KnowledgeCompilation, KnowledgeCompileRequest } from '../src/knowledge/types.js';

const request = () => ({ space: { kind: 'template' as const, teamId: 'team' }, sources: [{ id: 'source', title: 'Evidence', content: '原件', text: '原件', provenance: 'fixture', verified: false, version: 1, hash: 'hash', createdAt: new Date().toISOString(), processing: [] }], model: { mode: 'override' as const, provider: 'leader-provider', model: 'leader-model', reasoningEffort: 'high' }, signal: new AbortController().signal });
const result = { entries: [{ id: 'entry', title: '知识', content: '原件摘要', citations: [{ sourceId: 'source', sourceVersion: 1, startLine: 1, endLine: 1 }] }], overview: [{ id: 'map', title: '概览', summary: '知识入口', entryIds: ['entry'] }], conceptGraph: { schemaVersion: 1, concepts: [{ id: 'concept-original', name: '原件', summary: '保留的资料', entryIds: ['entry'], citations: [{ sourceId: 'source', sourceVersion: 1, startLine: 1, endLine: 1 }] }], relations: [] } };

test('shared Wiki analysis precedes generation using the same official model and exact source input', async () => {
  const calls: any[] = [];
  let analysisInput: any;
  const ctx = { llm: { async *stream(input: any) {
    calls.push(input);
    yield { type: 'text-delta', index: 0, text: calls.length === 1 ? '候选分析：原件应原样保留，其余原因未知。' : JSON.stringify(result) };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } } };
  const compiler = createKnowledgeCompiler(ctx as never, {}, { async analysisPrompt(input) { analysisInput = input; return 'You are an expert research analyst. Shared upstream Wiki rules.'; } });
  const { compilationTrace, ...compiled } = await compiler(request());
  assert.deepEqual(compiled, result);
  assert.equal(compilationTrace?.modelCalls, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].maxTokens, 24_000);
  assert.equal(calls[1].maxTokens, 64_000);
  assert.match(calls[0].system, /expert research analyst/);
  assert.equal(JSON.parse(calls[0].messages[0].content[0].text).stage, 'wiki-analysis');
  const generation = JSON.parse(calls[1].messages[0].content[0].text);
  assert.match(generation.wikiAnalysis, /候选分析/);
  assert.equal(generation.sources[0].version, 1);
  assert.equal(generation.sources[0].text, '原件');
  assert.equal(analysisInput.sourceContent, '原件');
  for (const call of calls) {
    assert.equal(call.provider, 'leader-provider'); assert.equal(call.model, 'leader-model');
    assert.equal(call.reasoningEffort, 'high'); assert.equal(call.sessionId, undefined); assert.equal(call.tools, undefined);
  }
});

test('failed or oversized Wiki analysis never reaches the generation/publication stage', async () => {
  for (const output of ['', 'x'.repeat(16_001)]) {
    let calls = 0;
    const ctx = { llm: { async *stream() { calls++; yield { type: 'text-delta', index: 0, text: output }; yield { type: 'finish', reason: { kind: 'stop' } }; } } };
    const compiler = createKnowledgeCompiler(ctx as never, {}, { async analysisPrompt() { return 'Upstream analysis'; } });
    await assert.rejects(compiler(request()), /Wiki 分析/);
    assert.equal(calls, 1);
  }
});

test('compiler reports incurred usage even when generation fails after a successful analysis', async () => {
  let calls = 0;
  const traces: NonNullable<KnowledgeCompilation['compilationTrace']>[] = [];
  const ctx = { llm: { async *stream() {
    calls++;
    if (calls === 2) throw new Error('Provider failed before reporting usage');
    yield { type: 'text-delta', index: 0, text: 'Candidate analysis' };
    yield { type: 'usage', usage: { inputTokens: 25, outputTokens: 10, cacheReadTokens: 100, totalTokens: 135 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } } };
  const compiler = createKnowledgeCompiler(ctx as never, {}, { async analysisPrompt() { return 'Analysis method'; } });
  await assert.rejects(compiler({ ...request(), onTrace: trace => { traces.push(structuredClone(trace)); } }), /Provider failed/);
  const last = traces.at(-1)!;
  assert.equal(last.modelCalls, 2);
  assert.deepEqual(last.usage, { reportedCalls: 1, inputTokens: 25, outputTokens: 10, cacheReadTokens: 100, totalTokens: 135 });
  assert.equal(traces[0]!.usage, undefined, 'an unreported model call is unknown, not zero-cost');
});

test('reported usage survives a provider finish error and repeated usage snapshots are not double counted', async () => {
  const traces: NonNullable<KnowledgeCompilation['compilationTrace']>[] = [];
  const ctx = { llm: { async *stream() {
    yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 2 } };
    yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 8 } };
    yield { type: 'finish', reason: { kind: 'max-tokens' } };
  } } };
  await assert.rejects(createKnowledgeCompiler(ctx as never)({ ...request(), onTrace: trace => { traces.push(trace); } }), /未完整结束/);
  assert.deepEqual(traces.at(-1)!.usage, { reportedCalls: 1, inputTokens: 5, outputTokens: 8 });
});

test('Wiki analysis and generation share the total timeout and caller cancellation', async () => {
  for (const cancel of [false, true]) {
    let calls = 0;
    const caller = new AbortController();
    const signals: AbortSignal[] = [];
    const ctx = { llm: { async *stream(input: { signal: AbortSignal }) {
      signals.push(input.signal); calls++;
      if (calls === 2 && cancel) caller.abort(new Error('caller cancelled'));
      await delay(calls === 1 ? 30 : 80, undefined, { signal: input.signal });
      yield { type: 'text-delta', index: 0, text: calls === 1 ? '候选分析' : JSON.stringify(result) };
      yield { type: 'finish', reason: { kind: 'stop' } };
    } } };
    const compiler = createKnowledgeCompiler(ctx as never, { timeoutMs: 90 }, { async analysisPrompt() { return 'Upstream analysis'; } });
    await assert.rejects(compiler({ ...request(), signal: caller.signal }));
    assert.equal(calls, 2);
    assert.equal(signals[0], signals[1], 'both stages use the same total-budget signal');
    assert.equal(signals[1]!.aborted, true);
    assert.match(String(signals[1]!.reason), cancel ? /caller cancelled/ : /编纂超时/);
  }
});

test('hidden librarian uses the leader model through public LLM service without a session', async () => {
  let options: any;
  const ctx = { llm: { async *stream(input: unknown) { options = input; yield { type: 'text-delta', index: 0, text: JSON.stringify(result) }; yield { type: 'finish', reason: { kind: 'stop' } }; } } };
  const { compilationTrace, ...compiled } = await createKnowledgeCompiler(ctx as never)(request());
  assert.deepEqual(compiled, result);
  assert.equal(compilationTrace?.modelCalls, 1);
  assert.equal(options.provider, 'leader-provider');
  assert.equal(options.model, 'leader-model');
  assert.equal(options.reasoningEffort, 'high');
  assert.equal(options.sessionId, undefined);
  assert.equal(options.tools, undefined);
  assert.equal(options.maxTokens, 64_000);
  assert.match(options.system, /候选|candidate/);
  assert.match(options.system, /conceptGraph/);
  assert.match(options.system, /归并同义词/);
  assert.match(options.system, /basis=inferred/);
  assert.match(options.system, /没有具体证据/);
  assert.match(options.system, /不得把同篇出现/);
  assert.match(JSON.stringify(options.messages), /source/);
});

test('model output normalizes only aliases equivalent within one concept while cross-concept conflicts and evidence errors still block publication', async t => {
  const root = await mkdtemp(join(tmpdir(), 'workforce-model-aliases-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = new KnowledgeRepository(join(root, 'knowledge'));
  const source = await repo.ingest(request().space, { id: 'source', title: '接口定义', content: 'API 是应用接口，SDK 是开发包。', provenance: 'fixture', verified: false });
  const input: KnowledgeCompileRequest = { ...request(), sources: [source] };
  const raw = structuredClone(result) as KnowledgeCompilation;
  raw.conceptGraph!.concepts[0]!.name = 'API';
  raw.conceptGraph!.concepts[0]!.aliases = [' API ', 'ＡＰＩ', 'api', '接口', ' 接口 ', 'Api', 'SDK', 'ＳＤＫ', ' sdk '];
  const compile = async (output: KnowledgeCompilation) => {
    const ctx = { llm: { async *stream() {
      yield { type: 'text-delta', index: 0, text: JSON.stringify(output) };
      yield { type: 'finish', reason: { kind: 'stop' } };
    } } };
    return createKnowledgeCompiler(ctx as never)(input);
  };
  const compiled = await compile(raw);
  assert.deepEqual(compiled.conceptGraph!.concepts[0]!.aliases, ['接口', 'SDK']);
  assert.deepEqual(raw.conceptGraph!.concepts[0]!.aliases, [' API ', 'ＡＰＩ', 'api', '接口', ' 接口 ', 'Api', 'SDK', 'ＳＤＫ', ' sdk '], 'the model fixture remains unchanged');
  const fingerprint = await repo.fingerprint(input.space);
  const published = await repo.publish(input.space, compiled, fingerprint);
  assert.deepEqual((await repo.snapshot(input.space))!.conceptGraph, compiled.conceptGraph);

  for (const [modify, expected] of [
    [(output: KnowledgeCompilation) => { output.conceptGraph!.concepts.push({ ...structuredClone(output.conceptGraph!.concepts[0]!), id: 'other', name: 'Another concept', aliases: [' 接口 '] }); }, /Duplicate concept name or alias|ambiguous new concept names/],
    [(output: KnowledgeCompilation) => { output.conceptGraph!.concepts.push({ ...structuredClone(output.conceptGraph!.concepts[0]!), id: 'other', name: 'ＳＤＫ', aliases: [] }); }, /Duplicate concept name or alias|ambiguous new concept names/],
    [(output: KnowledgeCompilation) => { output.conceptGraph!.concepts[0]!.aliases = ['   ']; }, /alias is required/],
    [(output: KnowledgeCompilation) => { output.conceptGraph!.concepts[0]!.aliases = Array.from({ length: 21 }, (_, index) => `Distinct alias ${index}`); }, /too large/],
    [(output: KnowledgeCompilation) => { output.conceptGraph!.concepts[0]!.citations[0]!.endLine = 99; }, /line range|evidence range|outside its supplied/],
  ] as const) {
    const invalid = structuredClone(raw); modify(invalid);
    await assert.rejects(async () => repo.publish(input.space, await compile(invalid), fingerprint), expected);
    assert.deepEqual(await repo.snapshot(input.space), published);
  }
});

test('production compilation advertises graph version and rejects missing or malformed graphs', async () => {
  for (const conceptGraph of [undefined, { schemaVersion: 2, concepts: [], relations: [] }, { schemaVersion: 1, concepts: [], relations: null }]) {
    const ctx = { llm: { async *stream() {
      yield { type: 'text-delta', index: 0, text: JSON.stringify({ ...result, conceptGraph }) };
      yield { type: 'finish', reason: { kind: 'stop' } };
    } } };
    const compiler = createKnowledgeCompiler(ctx as never);
    assert.equal(compiler.conceptGraphVersion, 1);
    await assert.rejects(compiler(request()), /概念图谱/);
  }
});

test('librarian rejects incomplete model output and preserves the old publication on failure', async () => {
  const ctx = { llm: { async *stream() { yield { type: 'text-delta', index: 0, text: JSON.stringify(result) }; yield { type: 'finish', reason: { kind: 'length' } }; } } };
  await assert.rejects(createKnowledgeCompiler(ctx as never)(request()), /完整|结束/);
});

test('incomplete compilation identifies its stage and safe counts without exposing source or generated text', async () => {
  for (const failedCall of [1, 2]) {
    let calls = 0;
    const ctx = { llm: { async *stream() {
      calls++;
      yield { type: 'text-delta', index: 0, text: 'private candidate' };
      yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 24000 } };
      yield { type: 'finish', reason: { kind: calls === failedCall ? 'max-tokens' : 'stop' } };
    } } };
    const compiler = createKnowledgeCompiler(ctx as never, {}, { async analysisPrompt() { return 'Wiki analysis'; } });
    await assert.rejects(compiler(request()), error => {
      const message = String(error);
      assert.match(message, failedCall === 1 ? /Wiki 分析/ : /知识生成/);
      assert.match(message, /正文 17 字，输出 24000 tokens/);
      assert.doesNotMatch(message, /private candidate|原件/);
      return true;
    });
    assert.equal(calls, failedCall);
  }
});

test('librarian bounds input and never falls back to a different model', async () => {
  let calls = 0;
  const ctx = { llm: { async *stream() { calls++; } } };
  const input = request(); input.sources[0]!.text = 'x'.repeat(200);
  await assert.rejects(createKnowledgeCompiler(ctx as never, { maxInputBytes: 100 })(input), /大小|上限/);
  input.model = { mode: 'inherit' } as never;
  await assert.rejects(createKnowledgeCompiler(ctx as never)(input), /负责人|模型/);
  assert.equal(calls, 0);
});

test('a leader following the DSH default uses exactly the same current default route', async () => {
  let selected: any;
  const ctx = {
    sessionController: { modelCatalog: async () => ({ default: { provider: 'account', model: 'current-default', reasoningEffort: 'high' }, groups: [] }) },
    llm: { async *stream(options: unknown) { selected = options; yield { type: 'text-delta', index: 0, text: JSON.stringify(result) }; yield { type: 'finish', reason: { kind: 'stop' } }; } },
  };
  const input = request(); input.model = { mode: 'inherit' } as never;
  await createKnowledgeCompiler(ctx as never)(input);
  assert.equal(selected.provider, 'account');
  assert.equal(selected.model, 'current-default');
  assert.equal(selected.reasoningEffort, 'high');
  assert.equal(selected.sessionId, undefined);
});

test('private compilation has a dedicated shadow prompt and never impersonates the business employee', async () => {
  const systems: string[] = [];
  const ctx = { llm: { async *stream(input: { system: string; sessionId?: string; tools?: unknown }) {
    systems.push(input.system); assert.equal(input.sessionId, undefined); assert.equal(input.tools, undefined);
    yield { type: 'text-delta', index: 0, text: JSON.stringify(result) }; yield { type: 'finish', reason: { kind: 'stop' } };
  } } };
  const compiler = createKnowledgeCompiler(ctx as never);
  await compiler(request());
  const privateRequest = { ...request(), space: { kind: 'template' as const, teamId: 'team', memberId: 'private-employee' } };
  await compiler(privateRequest);
  assert.match(systems[0]!, /team-librarian/);
  assert.match(systems[1]!, /employee-shadow/);
  assert.match(systems[1]!, /不是该业务员工本人/);
  assert.match(systems[1]!, /可以根据失败证据整理反思提案/);
  assert.match(systems[1]!, /失败现象、已有证据、已知原因与待验证假设、改进建议、验证步骤/);
  assert.match(systems[1]!, /不得冒充业务员工自述/);
  assert.match(systems[1]!, /不自动修改 Skill 或执行改进/);
  assert.notEqual(systems[0], systems[1]);
});

async function confirmedBoundaryFixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'workforce-conflict-boundary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = new KnowledgeRepository(join(root, 'knowledge'));
  const space = request().space;
  const input = {
    id: 'memory:boundary', title: '权限边界',
    content: 'OLD_A_HEADER_DO_NOT_SEND\n生产环境的权限边界：仅允许读取；写入必须由用户另行批准。\nOLD_A_FOOTER_DO_NOT_SEND',
    category: 'environment/constraint' as const, verified: true,
    provenance: JSON.stringify({ kind: 'confirmed-memory', id: 'boundary', version: 1, source: { kind: 'user-confirmed', reference: '生产环境权限决定' } }),
  };
  const source = await repository.ingest(space, input);
  const citation = { sourceId: source.id, sourceVersion: source.version, startLine: 2, endLine: 2 };
  const initial: KnowledgeCompilation = {
    entries: [{ id: 'boundary-rule', title: '权限边界', content: '已确认约束：生产环境只读，写入须另行批准。', citations: [citation] }],
    overview: [{ id: 'boundary-topic', title: '权限约束', summary: '生产环境权限边界', entryIds: ['boundary-rule'] }],
    conceptGraph: { schemaVersion: 1, concepts: [{ id: 'boundary', name: '权限边界', kind: 'concept', summary: '生产环境只读，写入须另行批准。', entryIds: ['boundary-rule'], citations: [citation] }], relations: [] },
  };
  const previous = await repository.publish(space, initial, await repository.fingerprint(space));
  const path = join(repository.rootPath, 'templates/team/team');
  return { repository, space, input, source, citation, initial, previous, path };
}

test('a conflicting proposal can add a dual-evidence review article but cannot overwrite an unchanged confirmed constraint', async t => {
  const f = await confirmedBoundaryFixture(t);
  const oldKnowledgeBytes = await readFile(join(f.path, 'B-knowledge/v1.json'));
  const oldSourceBytes = await readFile(join(f.path, 'A-sources', encodeURIComponent(f.source.id), 'v1.json'));
  const proposal = await f.repository.ingest(f.space, { id: 'run:proposal', title: '复盘提案', content: '建议放宽权限边界，允许直接写入生产数据；这是未经确认的模型提案。', category: 'incident/reflection-proposal', provenance: 'run:proposal@1', verified: false });
  const proposedCitation = { sourceId: proposal.id, sourceVersion: proposal.version, startLine: 1, endLine: 1 };
  const delta: KnowledgeCompilation = {
    entries: [{ id: 'boundary-rule', title: '冲突待确认：权限边界', content: '冲突待确认。旧约束要求生产环境只读，写入须另行批准；新复盘提案建议直接写入。二者适用范围相同，但提案未获授权，原约束仍保留，需用户确认是否修改。', citations: [f.citation, proposedCitation] }],
    overview: [{ id: 'boundary-topic', title: '权限边界冲突', summary: '原约束与模型提案并列，待确认。', entryIds: ['boundary-rule'] }],
    conceptGraph: { schemaVersion: 1, concepts: [{ id: 'new-model-id', name: '权限边界', kind: 'concept', summary: '模型试图把权限边界改为可以直接写入。', entryIds: ['boundary-rule'], citations: [proposedCitation] }], relations: [] },
  };
  const calls: Array<{ system: string; messages: Array<{ content: Array<{ text: string }> }> }> = [];
  const ctx = { llm: { async *stream(options: typeof calls[number]) {
    calls.push(options);
    yield { type: 'text-delta', index: 0, text: calls.length === 1 ? '旧权限约束与复盘提案冲突，待用户确认。' : JSON.stringify(delta) };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } } };
  const compiled = await createKnowledgeCompiler(ctx as never, {}, { async analysisPrompt() { return 'Shared upstream Wiki analysis'; } })({ ...request(), sources: await f.repository.sources(f.space), previous: f.previous });
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.match(call.system, /冲突待确认/);
    assert.match(call.system, /并列双方主张.*精确 A 行引用/);
    assert.match(call.system, /已确认约束与用户明确决定不能被模型推断/);
    assert.match(call.system, /来源 verified 仅是来源状态/);
    const payload = JSON.parse(call.messages[0]!.content[0]!.text);
    assert.deepEqual(payload.sources.map((source: { id: string }) => source.id), [proposal.id]);
    assert.equal(payload.sources[0].verified, false);
    assert.equal(payload.sources[0].category, 'incident/reflection-proposal');
    assert.equal(payload.dependencySources[0].category, 'environment/constraint');
    assert.equal(payload.dependencySources[0].verified, true);
    assert.equal(payload.dependencySources[0].provenance, f.source.provenance);
    assert.deepEqual(payload.dependencySources[0].excerpts, [{ startLine: 2, endLine: 2, text: f.source.text.split('\n')[1] }]);
    assert.doesNotMatch(JSON.stringify(payload), /OLD_A_HEADER_DO_NOT_SEND|OLD_A_FOOTER_DO_NOT_SEND/);
  }
  const oldConcept = f.previous.conceptGraph!.concepts[0]!;
  const kept = compiled.conceptGraph!.concepts.find(concept => concept.id === 'boundary')!;
  assert.equal(kept.summary, oldConcept.summary, 'the model cannot replace a retained definition with its proposal');
  assert.deepEqual(kept.citations, oldConcept.citations, 'proposal evidence cannot replace the original definition evidence');
  assert.deepEqual(compiled.entries.find(entry => entry.id === 'boundary-rule'), f.previous.entries[0], 'a reused delta ID cannot overwrite retained B prose');
  const conflict = compiled.entries.find(entry => entry.title === '冲突待确认：权限边界')!;
  assert.notEqual(conflict.id, 'boundary-rule');
  assert.deepEqual(conflict.citations, [f.citation, proposedCitation]);
  assert.ok(kept.entryIds.includes(conflict.id), 'the conflict remains discoverable from its existing concept');
  const published = await f.repository.publish(f.space, compiled, await f.repository.fingerprint(f.space), undefined, f.previous.version);
  assert.equal(published.entries.length, 2);
  assert.deepEqual(await readFile(join(f.path, 'B-knowledge/v1.json')), oldKnowledgeBytes);
  assert.deepEqual(await readFile(join(f.path, 'A-sources', encodeURIComponent(f.source.id), 'v1.json')), oldSourceBytes);
});

test('an updated source version withdraws its old derived claims from the new snapshot while preserving A and B history', async t => {
  const f = await confirmedBoundaryFixture(t);
  const oldAPath = join(f.path, 'A-sources', encodeURIComponent(f.source.id), 'v1.json');
  const oldBPath = join(f.path, 'B-knowledge/v1.json');
  const oldABytes = await readFile(oldAPath); const oldBBytes = await readFile(oldBPath);
  const updated = await f.repository.ingest(f.space, { ...f.input, content: 'NEW_A_HEADER\n权限边界的已确认适用范围仅限生产环境；测试沙箱按单独授权执行。\nNEW_A_FOOTER' });
  const citation = { sourceId: updated.id, sourceVersion: updated.version, startLine: 2, endLine: 2 };
  const delta: KnowledgeCompilation = {
    entries: [{ id: 'boundary-rule', title: '权限边界', content: '新版明确区分生产环境与单独授权的测试沙箱；不从新日期推断其他授权。', citations: [citation] }],
    overview: [{ id: 'boundary-topic', title: '权限约束', summary: '区分生产与测试适用条件', entryIds: ['boundary-rule'] }],
    conceptGraph: { schemaVersion: 1, concepts: [{ id: 'boundary', name: '权限边界', kind: 'concept', summary: '生产和测试环境分别适用各自已确认授权。', entryIds: ['boundary-rule'], citations: [citation] }], relations: [] },
  };
  let payload: any;
  const ctx = { llm: { async *stream(options: any) {
    payload = JSON.parse(options.messages[0].content[0].text);
    assert.match(options.system, /同一来源 ID 的版本更新使其旧派生条目退出当前快照/);
    yield { type: 'text-delta', index: 0, text: JSON.stringify(delta) };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } } };
  const compiled = await createKnowledgeCompiler(ctx as never)({ ...request(), sources: [updated], previous: f.previous });
  assert.deepEqual(payload.sources.map((source: { version: number }) => source.version), [2]);
  assert.deepEqual(payload.dependencySources, [], 'obsolete A v1 is not supplied as current evidence');
  assert.equal(payload.affected.entries[0].id, 'boundary-rule');
  assert.deepEqual(compiled.entries, delta.entries, 'old dependent B prose is fully withdrawn rather than merely removing its citation');
  assert.deepEqual(compiled.conceptGraph!.concepts[0]!.citations, [citation]);
  await f.repository.publish(f.space, compiled, await f.repository.fingerprint(f.space), undefined, f.previous.version);
  assert.deepEqual(await readFile(oldAPath), oldABytes);
  assert.deepEqual(await readFile(oldBPath), oldBBytes);
  assert.deepEqual(f.previous.entries, f.initial.entries, 'the previous in-memory publication also remains immutable');
});
