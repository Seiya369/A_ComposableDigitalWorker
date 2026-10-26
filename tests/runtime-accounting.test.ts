import assert from 'node:assert/strict';
import test from 'node:test';
import { createAssistantMessage, type TokenUsage } from '@deepseek-ai/dsh-llm';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { DEFAULT_RUNTIME_CONFIG, foldRunEvents } from '../src/harness/runtime.js';

const message = (seq: number, usage?: TokenUsage): SessionEvent => ({
  type: 'assistant/message', seq, time: Date.now(), surfaceOp: 'append',
  data: { turn: 1, step: seq + 1, message: createAssistantMessage({ source: { kind: 'model', provider: 'fixture', model: 'fixture' }, content: [{ type: 'text', text: 'Actual answer' }] }), stream: [], ...(usage ? { usage } : {}) },
} as SessionEvent);

test('ordinary conversations have no extra default cumulative token cutoff', () => {
  assert.equal(DEFAULT_RUNTIME_CONFIG.maxTreeTokens, 0);
  assert.equal(DEFAULT_RUNTIME_CONFIG.maxSteps, 24);
  assert.equal(DEFAULT_RUNTIME_CONFIG.maxRunMs, 600_000);
});

test('business accounting preserves disjoint cache fields and authoritative provider totals', () => {
  const result = foldRunEvents([message(0, { inputTokens: 194, cacheReadTokens: 140160, cacheWriteTokens: 0, outputTokens: 1330, reasoningTokens: 524, totalTokens: 141684 })]);
  assert.deepEqual(result.usage, { inputTokens: 194, outputTokens: 1330, cacheReadTokens: 140160, cacheWriteTokens: 0, reasoningTokens: 524, totalTokens: 141684, modelCalls: 1, reportedCalls: 1 });
});

test('missing usage remains identifiable instead of becoming a reported free call', () => {
  const result = foldRunEvents([message(0, { inputTokens: 10, outputTokens: 2, totalTokens: 12 }), message(1)]);
  assert.equal(result.usage.modelCalls, 2);
  assert.equal(result.usage.reportedCalls, 1);
  assert.equal(result.usage.totalTokens, undefined);
  assert.equal(result.usage.inputTokens, 10);
});

test('a partially reported cache breakdown is unknown rather than an exact aggregate', () => {
  const result = foldRunEvents([message(0, { inputTokens: 2, outputTokens: 3, cacheReadTokens: 10, totalTokens: 15 }), message(1, { inputTokens: 4, outputTokens: 5, totalTokens: 19 })]);
  assert.equal(result.usage.cacheReadTokens, undefined);
  assert.equal(result.usage.totalTokens, 34, 'authoritative aggregate totals remain usable even if the cache split is unknown');
});

test('failed native attempts retain reported token use but never fabricate answer text', () => {
  const stream = [{ type: 'chunk' as const, time: Date.now(), chunk: { type: 'usage' as const, usage: { inputTokens: 120, cacheReadTokens: 400, outputTokens: 9, totalTokens: 529 } } }];
  const result = foldRunEvents([{ type: 'assistant/attempt', seq: 0, time: Date.now(), data: { turn: 1, step: 1, stream } } as SessionEvent]);
  assert.equal(result.output, '');
  assert.equal(result.usage.modelCalls, 1);
  assert.equal(result.usage.reportedCalls, 1);
  assert.equal(result.usage.cacheReadTokens, 400);
  assert.equal(result.usage.totalTokens, 529);
});
