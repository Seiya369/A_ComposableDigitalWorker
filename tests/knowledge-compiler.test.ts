import assert from 'node:assert/strict';
import test from 'node:test';
import { createKnowledgeCompiler } from '../src/harness/knowledge-compiler.js';

const request = () => ({ space: { kind: 'template' as const, teamId: 'team' }, sources: [{ id: 'source', title: 'Evidence', content: '原件', text: '原件', provenance: 'fixture', verified: false, version: 1, hash: 'hash', createdAt: new Date().toISOString(), processing: [] }], model: { mode: 'override' as const, provider: 'leader-provider', model: 'leader-model', reasoningEffort: 'high' }, signal: new AbortController().signal });
const result = { entries: [{ id: 'entry', title: '知识', content: '原件摘要', citations: [{ sourceId: 'source', sourceVersion: 1, startLine: 1, endLine: 1 }] }], overview: [{ id: 'map', title: '概览', summary: '知识入口', entryIds: ['entry'] }] };

test('hidden librarian uses the leader model through public LLM service without a session', async () => {
  let options: any;
  const ctx = { llm: { async *stream(input: unknown) { options = input; yield { type: 'text-delta', index: 0, text: JSON.stringify(result) }; yield { type: 'finish', reason: { kind: 'stop' } }; } } };
  assert.deepEqual(await createKnowledgeCompiler(ctx as never)(request()), result);
  assert.equal(options.provider, 'leader-provider');
  assert.equal(options.model, 'leader-model');
  assert.equal(options.reasoningEffort, 'high');
  assert.equal(options.sessionId, undefined);
  assert.equal(options.tools, undefined);
  assert.match(options.system, /候选|candidate/);
  assert.match(JSON.stringify(options.messages), /source/);
});

test('librarian rejects incomplete model output and preserves the old publication on failure', async () => {
  const ctx = { llm: { async *stream() { yield { type: 'text-delta', index: 0, text: JSON.stringify(result) }; yield { type: 'finish', reason: { kind: 'length' } }; } } };
  await assert.rejects(createKnowledgeCompiler(ctx as never)(request()), /完整|结束/);
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
