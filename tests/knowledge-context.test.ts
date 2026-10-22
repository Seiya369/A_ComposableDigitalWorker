import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ContextBudgetError, countContextTokens, createContextPacket, createContextPool,
  DEFAULT_COUNT_MODE, type ContextDocument,
} from '../src/knowledge/context.js';

const doc = (layer: 'A' | 'B' | 'C', content: string, extra: Partial<ContextDocument> = {}): ContextDocument => ({
  layer, id: 'policy', library: 'team', version: 2, title: 'Export policy', content, ...extra,
});

test('A requires an explicit activation reason and returns exact versioned original windows', () => {
  const source = doc('A', '# Export\n经理不得导出原始聊天。\n例外仅授予合规专员。\n授权 24 小时后失效。');
  assert.throws(() => createContextPacket([source], { maxTokens: 1500 }), /reason|激活/);
  const packet = createContextPacket([source], { maxTokens: 1500, reason: 'verify', startLine: 2, endLine: 4 });
  assert.equal(packet.countMode, DEFAULT_COUNT_MODE);
  assert.equal(packet.pieces[0]!.text, source.content.split('\n').slice(1).join('\n'));
  assert.equal(packet.pieces[0]!.startLine, 2);
  assert.equal(packet.pieces[0]!.endLine, 4);
  assert.equal(packet.pieces[0]!.version, 2);
  assert.ok(countContextTokens(packet) <= 1500);
});

test('long single lines locate query evidence in the middle and expose exact columns', () => {
  const exact = 'audit_export_requires_owner_approval=true; retention_days=365; redact_fields=[national_id,bank_account];';
  const source = doc('A', `head\n${'ui=standard;'.repeat(2000)} ${exact} ${'color=neutral;'.repeat(2000)}`);
  const packet = createContextPacket([source], { query: '核验 audit_export_requires_owner_approval retention_days redact_fields 的精确值', maxTokens: 1400,
    reason: 'exact-detail', startLine: 2, endLine: 2 });
  assert.ok(packet.pieces.some(piece => piece.text.includes(exact)));
  for (const piece of packet.pieces) {
    assert.ok(piece.startColumn && piece.endColumn);
    assert.equal(piece.text, source.content.split('\n')[piece.startLine - 1]!.slice(piece.startColumn - 1, piece.endColumn - 1));
  }
  assert.ok(packet.truncated && packet.continuation?.length);
  assert.ok(countContextTokens(packet) <= 1400);
});

test('B finds middle evidence with adjacent negation and exceptions without rewriting', () => {
  const content = ['# 灰度发布', ...Array.from({ length: 180 }, () => '项目周报讨论排期与界面颜色，不规定生产阈值。'),
    '## 灰度回滚条件', '连续 3 个五分钟窗口均超过 0.8% 必须回滚；单个窗口不触发自动回滚。',
    '支付成功率低于 99.5% 时立即暂停新增流量；不回收已完成订单。', ...Array.from({ length: 180 }, () => '其他背景记录。')].join('\n');
  const packet = createContextPacket([doc('B', content)], { query: '灰度回滚错误率几个窗口？支付成功率阈值，单个窗口与已完成订单', maxTokens: 1700 });
  const text = packet.pieces.map(piece => piece.text).join('\n');
  assert.match(text, /0\.8%/); assert.match(text, /单个窗口不触发/); assert.match(text, /99\.5%/); assert.match(text, /不回收已完成订单/);
  for (const piece of packet.pieces) assert.equal(piece.text, content.split('\n').slice(piece.startLine - 1, piece.endLine).join('\n'));
  assert.ok(countContextTokens(packet) <= 1700);
});

test('C routes task topics and keeps versioned B references under its complete serialized budget', () => {
  const documents = Array.from({ length: 28 }, (_, index) => doc('C', '界面排期与人员安排。', { id: `noise-${index}`, title: '办公周报', entryIds: [`office-${index}`] }));
  documents.splice(18, 0, doc('C', '支付回执丢失时需要遵循幂等与退款例外。', { id: 'payment', title: '支付重试与退款', entryIds: ['payment-retry'] }));
  const packet = createContextPacket(documents, { query: '支付回执丢失场景的幂等重试和退款例外', maxTokens: 1600 });
  assert.equal(packet.pieces[0]!.id, 'payment');
  assert.ok(packet.directory.some(item => item.id === 'payment' && item.entryIds?.includes('payment-retry')));
  assert.ok(packet.truncated && packet.continuation?.length);
  assert.ok(countContextTokens(packet) <= 1600);
});

test('oversized optional source metadata cannot consume the content budget or evade counting', () => {
  const packet = createContextPacket([doc('A', 'capacity_alarm=0.875;\nNever terminate in-flight work.', {
    id: 'metadata-'.repeat(21), title: '执行主体与流转说明'.repeat(100), provenance: `fixture://${'tracking=unrelated&'.repeat(400)}`,
  })], { reason: 'verify', startLine: 1, endLine: 2, maxTokens: 1800 });
  assert.match(packet.pieces.map(piece => piece.text).join('\n'), /Never terminate/);
  assert.ok(packet.metadata.omittedMetadata);
  assert.ok(countContextTokens(packet) <= 1800);
  assert.ok(packet.tokenEstimate >= countContextTokens(packet));
  assert.throws(() => createContextPacket([doc('A', 'x', { id: 'x'.repeat(1000) })], { reason: 'verify', maxTokens: 500 }), ContextBudgetError);
});

test('A paginates the requested range without altering source data or skipping the remainder', () => {
  const original = Array.from({ length: 30 }, (_, index) => `channel=${index}; retention_days=${index + 200}; export_role=compliance; legal_hold=preserve;`).join('\n');
  const source = doc('A', original);
  let packet = createContextPacket([source], { reason: 'source-comparison', startLine: 1, endLine: 30, maxTokens: 1000 });
  const seen = new Set<string>();
  for (let hop = 0; hop < 40; hop++) {
    packet.pieces.forEach(piece => seen.add(piece.text));
    const cursor = packet.continuation?.[0];
    if (!cursor) break;
    packet = createContextPacket([source], { cursor, reason: 'source-comparison', maxTokens: 1000 });
    assert.ok(countContextTokens(packet) <= 1000);
  }
  const evidence = [...seen].join('\n');
  for (const line of original.split('\n')) assert.ok(evidence.includes(line), line);
  assert.equal(source.content, original);
});

test('pool deduplicates repeated ranges and compacts old evidence to recoverable versioned directories', () => {
  const pool = createContextPool({ cMax: 1200, bActive: 2200, aActive: 1600, total: 3400 });
  const first = createContextPacket([doc('B', 'Preparation requires backup checksum and 45 seconds stopped writes. '.repeat(6))], { maxTokens: 1300 });
  const once = pool.activate(first);
  const twice = pool.activate(first);
  assert.equal(twice.tokenEstimate, once.tokenEstimate);
  for (let index = 0; index < 4; index++) pool.activate(createContextPacket([doc('B', `phase ${index}: ${'specific procedure; '.repeat(20)}`, { id: `phase-${index}` })], { maxTokens: 1200 }));
  const state = pool.snapshot();
  assert.ok(state.compactedCount > 0);
  assert.ok(state.packets.some(packet => packet.directory.some(item => item.id === 'policy' && item.version === 2 && item.contentOmitted)));
  assert.ok(countContextTokens(state) <= 3400);
  assert.ok(countContextTokens(state.packets.filter(packet => packet.layer === 'B')) <= 2200);
});

test('pool refuses a request when even recoverable minimal indexes cannot fit, without mutating its prior state', () => {
  const pool = createContextPool({ total: 1700, bActive: 1700 });
  let rejected = false;
  for (let index = 0; index < 40; index++) {
    const before = pool.snapshot();
    try { pool.activate(createContextPacket([doc('B', 'policy', { id: `long-document-${index}-${'x'.repeat(80)}` })], { maxTokens: 1000 })); }
    catch (error) { assert.ok(error instanceof ContextBudgetError); assert.deepEqual(pool.snapshot(), before); rejected = true; break; }
  }
  assert.ok(rejected);
});

test('pool pins system C and uses the complete serialized envelope with a supplied tokenizer', () => {
  const counter = (text: string) => Math.ceil(Buffer.byteLength(text, 'utf8') / 2);
  const pool = createContextPool({ total: 1700, cMax: 1000, bActive: 1400 }, { counter, countMode: 'test-byte-halves' });
  const overview = createContextPacket([doc('C', 'Team principles must remain visible. '.repeat(12), { entryIds: ['policy'] })], { maxTokens: 850, counter, countMode: 'test-byte-halves' });
  pool.activate(overview);
  for (let index = 0; index < 4; index++) pool.activate(createContextPacket([doc('B', 'Specific background procedure. '.repeat(15), { id: `phase-${index}` })], { maxTokens: 700, counter, countMode: 'test-byte-halves' }));
  const state = pool.snapshot();
  assert.deepEqual(state.packets.find(packet => packet.packetId === overview.packetId), overview);
  assert.ok(state.tokenEstimate >= countContextTokens(state, counter));
  assert.ok(state.tokenEstimate <= 1700);
});

test('read budgets preserve code spelling, candidate status and Unicode character boundaries', () => {
  const content = `说明😀\nexport const policy = { retentionDays: 365, allowManager: false };\n${'审计😀'.repeat(1000)}`;
  const packet = createContextPacket([doc('A', content, { verified: false, provenance: 'fixture://source/v2' })], {
    reason: 'exact-detail', startLine: 1, endLine: 3, maxTokens: 1000,
  });
  assert.equal(packet.directory[0]!.verified, false);
  assert.equal(packet.directory[0]!.provenance, 'fixture://source/v2');
  assert.ok(packet.pieces.some(piece => piece.text.includes('allowManager: false')));
  for (const piece of packet.pieces) assert.doesNotMatch(piece.text, /[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/);
  assert.throws(() => createContextPacket([doc('A', 'raw')], { reason: 'unknown' as never }), /valid source activation/);
});

test('A without a supplied source range finds query evidence instead of truncating the document head', () => {
  const source = doc('A', [...Array.from({ length: 70 }, () => 'Unrelated presentation layout notes.'),
    'Migration schema 42 requires SELECT pg_advisory_lock(7421); before any write.', 'If checksum mismatches, abort; never bypass verification.',
    ...Array.from({ length: 70 }, () => 'Unrelated scheduling notes.')].join('\n'));
  const packet = createContextPacket([source], { reason: 'no-wiki', query: 'schema 42 pg_advisory_lock checksum verification', maxTokens: 1500 });
  assert.match(packet.pieces.map(piece => piece.text).join('\n'), /pg_advisory_lock\(7421\)/);
  assert.match(packet.pieces.map(piece => piece.text).join('\n'), /never bypass verification/);
  assert.ok(countContextTokens(packet) <= 1500);
});

test('packet identity and active deduplication preserve distinct citation and provenance pages', () => {
  const first = createContextPacket([doc('B', 'Identical B body.', { citations: [{ sourceId: 'source-0', sourceVersion: 1, startLine: 1, endLine: 2 }], provenance: 'fixture://reference-page/0' })]);
  const second = createContextPacket([doc('B', 'Identical B body.', { citations: [{ sourceId: 'source-4', sourceVersion: 2, startLine: 3, endLine: 4 }], provenance: 'fixture://reference-page/4' })]);
  assert.notEqual(first.packetId, second.packetId, 'the visible reference page is part of packet identity');
  const pool = createContextPool();
  pool.activate(first); pool.activate(second);
  const packets = pool.snapshot().packets;
  assert.equal(packets.length, 2, 'different reference pages cannot deduplicate only by body/range');
  assert.deepEqual(packets.map(packet => packet.directory[0]!.citations![0]!.sourceId), ['source-0', 'source-4']);
  assert.deepEqual(packets.map(packet => packet.directory[0]!.provenance), ['fixture://reference-page/0', 'fixture://reference-page/4']);
  assert.equal(createContextPacket([doc('B', 'Identical B body.', { citations: [{ sourceId: 'source-0', sourceVersion: 1, startLine: 1, endLine: 2 }], provenance: 'fixture://reference-page/0' })]).packetId, first.packetId);
});

test('navigation-only search packets omit synthetic read cursors while retaining task routing and budget accounting', () => {
  const documents = Array.from({ length: 14 }, (_, index) => doc('B', `Search result ${index}: ${'background office notes '.repeat(40)}`, { id: `search:B:noise-${index}` }));
  documents.splice(9, 0, doc('B', 'Payment retry policy entry payment-retry; source payment-slo.', { id: 'search:B:payment', title: 'Payment retry' }));
  const packet = createContextPacket(documents, { query: 'Payment retry policy', maxTokens: 1300, navigationOnly: true });
  assert.equal(packet.pieces[0]!.id, 'search:B:payment');
  assert.equal(packet.metadata.navigationOnly, true);
  assert.equal(packet.continuation, undefined, 'a search hit ID is not a repository-readable document ID');
  assert.ok(packet.truncated && packet.metadata.omittedDocumentCount > 0);
  assert.ok(countContextTokens(packet) <= 1300);
});
