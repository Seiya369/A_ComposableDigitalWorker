import assert from 'node:assert/strict';
import test from 'node:test';
import { CONFIRMED_ITEMS_LIMITS, CONFIRMED_ITEMS_MEDIA_TYPE, parseConfirmedItemDeclarations } from '../src/domain/confirmed-items.js';

const item = { id: 'scope', title: '交付范围', content: '本轮仅交付已列出的模块。' };
const document = (value: unknown, mediaType = CONFIRMED_ITEMS_MEDIA_TYPE) => ({ mediaType, content: JSON.stringify(value) });

test('structured declarations preserve original text and accept bounded lists without granting confirmation authority', () => {
  assert.deepEqual(parseConfirmedItemDeclarations(document({ schemaVersion: 1, items: [item] })), [item]);
  const fifty = Array.from({ length: 50 }, (_, index) => ({ ...item, id: `scope-${index}` }));
  assert.deepEqual(parseConfirmedItemDeclarations(document({ schemaVersion: 1, items: fifty })), fifty);
  assert.deepEqual(parseConfirmedItemDeclarations(document({ schemaVersion: 1, items: [{ ...item, title: '标'.repeat(240), content: '内'.repeat(20_000) }] }))?.[0]?.title, '标'.repeat(240));
});

test('untyped prose, malformed data, duplicates and invented confirmation metadata never become structured items', () => {
  assert.equal(parseConfirmedItemDeclarations({ content: '用户已确认：交付范围', mediaType: 'text/markdown' }), undefined);
  assert.equal(parseConfirmedItemDeclarations(document({ schemaVersion: 1, items: [item] }, 'application/json')), undefined);
  for (const value of [null, [], { schemaVersion: 2, items: [item] }, { schemaVersion: 1, items: 'wrong' },
    { schemaVersion: 1, items: [item, item] }, { schemaVersion: 1, items: [{ ...item, id: ' scope' }] },
    { schemaVersion: 1, items: [{ ...item, id: 'line\nbreak' }] }, { schemaVersion: 1, items: [{ ...item, title: ' ' }] },
    { schemaVersion: 1, items: [{ ...item, confirmedBy: '用户' }] }, { schemaVersion: 1, items: [item], userConfirmed: true }]) {
    assert.equal(parseConfirmedItemDeclarations(document(value)), undefined);
  }
  assert.equal(parseConfirmedItemDeclarations({ mediaType: CONFIRMED_ITEMS_MEDIA_TYPE, content: '{bad json' }), undefined);
});

test('oversized documents, entries and item counts are rejected as a whole rather than silently shortened', () => {
  for (const patch of [{ id: 'x'.repeat(121) }, { title: 'x'.repeat(241) }, { content: 'x'.repeat(20_001) }]) {
    assert.equal(parseConfirmedItemDeclarations(document({ schemaVersion: 1, items: [{ ...item, ...patch }] })), undefined);
  }
  assert.equal(parseConfirmedItemDeclarations(document({ schemaVersion: 1, items: Array.from({ length: 51 }, (_, index) => ({ ...item, id: String(index) })) })), undefined);
  const content = JSON.stringify({ schemaVersion: 1, items: [item] }).padEnd(CONFIRMED_ITEMS_LIMITS.documentCharacters + 1, ' ');
  assert.equal(parseConfirmedItemDeclarations({ mediaType: CONFIRMED_ITEMS_MEDIA_TYPE, content }), undefined);
});
