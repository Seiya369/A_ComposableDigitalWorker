import assert from 'node:assert/strict';
import test from 'node:test';
import { countContextTokens } from '../src/knowledge/context.js';
import { referenceTokenCounter, REFERENCE_TOKEN_COUNT_MODE, TOKEN_COUNTER_METADATA } from '../scripts/knowledge-token-counter.js';

test('large-budget trials count reference BPE tokens rather than bytes', () => {
  assert.equal(referenceTokenCounter('hello world'), 2);
  assert.equal(referenceTokenCounter('2+2=4'), 5);
  assert.equal(referenceTokenCounter(''), 0);
  const chinese = '审计记录必须保留版本、否定条件和例外。'.repeat(80);
  assert.ok(referenceTokenCounter(chinese) < Buffer.byteLength(chinese, 'utf8'));
  assert.equal(referenceTokenCounter(chinese), referenceTokenCounter(chinese));
});

test('untrusted source strings resembling tokenizer control tokens remain literal data', () => {
  for (const source of ['<|endoftext|>', '<|fim_prefix|>正文😀<|fim_suffix|>', '👩🏽‍💻\n结论：待验证']) {
    assert.ok(referenceTokenCounter(source) > 0);
  }
});

test('the reference counter counts the complete JSON envelope and discloses model compatibility', () => {
  const body = 'threshold=0.875; do not delete pending transactions';
  const envelope = { content: body, source: 'policy', library: 'employee', version: 3, startLine: 2, endLine: 4 };
  assert.ok(countContextTokens(envelope, referenceTokenCounter) > referenceTokenCounter(body));
  assert.equal(REFERENCE_TOKEN_COUNT_MODE, 'tiktoken:o200k_base:reference');
  assert.equal(TOKEN_COUNTER_METADATA.modelCompatibility, 'reference-only');
  assert.equal(TOKEN_COUNTER_METADATA.encoding, 'o200k_base');
});
