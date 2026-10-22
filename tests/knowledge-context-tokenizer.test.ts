import assert from 'node:assert/strict';
import test from 'node:test';
import { createContextPacket, countContextTokens } from '../src/knowledge/context.js';
import { referenceTokenCounter, REFERENCE_TOKEN_COUNT_MODE } from '../scripts/knowledge-token-counter.js';
import { largeKnowledgeTasks } from './fixtures/knowledge-context-large-tasks.js';

test('real BPE counting budgets the final content hash before choosing a continuation span', () => {
  const source = largeKnowledgeTasks.find(task => task.id === 'large-version-conflict')!.documents
    .find(doc => doc.id === 'service-policy-1' && doc.version === 2)!;
  const options = { maxTokens: 2000, reason: 'verify' as const, counter: referenceTokenCounter,
    countMode: REFERENCE_TOKEN_COUNT_MODE,
    cursor: { layer: 'A' as const, id: source.id, library: source.library, version: 2,
      startLine: 15, startColumn: 1, endLine: 49, endColumn: 545 } };
  const packet = createContextPacket([source], options);
  assert.ok(packet.pieces.length > 0);
  assert.ok(countContextTokens(packet, referenceTokenCounter) <= 2000);
  assert.deepEqual(createContextPacket([source], options), packet);
  for (const span of packet.pieces) {
    const lines = source.content.split('\n');
    const text = lines.slice(span.startLine - 1, span.endLine).join('\n');
    assert.equal(span.text, span.startColumn === undefined ? text : text.slice(span.startColumn - 1,
      span.startLine === span.endLine && span.endColumn !== undefined ? span.endColumn - 1 : undefined));
  }
  assert.ok(packet.truncated && packet.continuation?.length);
});
