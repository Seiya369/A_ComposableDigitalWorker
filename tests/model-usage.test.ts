import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModelUsage } from '../src/ui/ModelUsage.js';

const render = (usage?: Parameters<typeof ModelUsage>[0]['usage']) => renderToStaticMarkup(createElement(ModelUsage, { usage }));

test('usage panel is absent for old records without accounting and keeps legacy unknown values unreported', () => {
  assert.equal(render(), '');
  const html = render({ inputTokens: 12, outputTokens: 3 });
  assert.match(html, /data-usage-field="inputTokens">12</);
  assert.match(html, /data-usage-field="outputTokens">3</);
  for (const field of ['cacheReadTokens', 'cacheWriteTokens', 'totalTokens']) assert.match(html, new RegExp(`data-usage-field="${field}">未报告<`));
});

test('usage panel preserves distinct cache counters and provider total without double-counting reasoning', () => {
  const html = render({ inputTokens: 10, cacheReadTokens: 100, cacheWriteTokens: 2, outputTokens: 5,
    reasoningTokens: 4, totalTokens: 117, modelCalls: 1, reportedCalls: 1 });
  assert.match(html, /data-usage-field="cacheReadTokens">100</);
  assert.match(html, /data-usage-field="cacheWriteTokens">2</);
  assert.match(html, /data-usage-field="outputTokens">5</);
  assert.match(html, /data-usage-field="totalTokens">117</);
  assert.doesNotMatch(html, /data-usage-field="totalTokens">121</);
});

test('partial and entirely unreported calls cannot appear as complete or zero-cost usage', () => {
  const partial = render({ inputTokens: 20, outputTokens: 8, totalTokens: 28, modelCalls: 3, reportedCalls: 1 });
  assert.match(partial, /仅部分调用报告用量，已知数值是下限/);
  assert.match(partial, /data-usage-field="totalTokens">未报告</);
  const missing = render({ inputTokens: 0, outputTokens: 0, modelCalls: 2, reportedCalls: 0 });
  assert.match(missing, /data-usage-field="inputTokens">未报告</);
  assert.match(missing, /data-usage-field="outputTokens">未报告</);
  assert.doesNotMatch(missing, /data-usage-field="(?:inputTokens|outputTokens)">0</);
});
