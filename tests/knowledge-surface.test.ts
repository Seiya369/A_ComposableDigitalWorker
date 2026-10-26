import assert from 'node:assert/strict';
import test from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { ToolCallId, createSystemMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm';
import SessionStore, { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session';
import { compactKnowledgeSurface, KnowledgeContextBudgetError } from '../src/harness/knowledge-surface.js';
import { createContextPacket, countContextTokens, type ContextLimits, type ContextPacket } from '../src/knowledge/context.js';

const limits: ContextLimits = { cTarget: 1200, cMax: 1600, bRead: 1800, bActive: 3500, aRead: 1800, aActive: 2200, total: 6500 };
const packet = (id: string, layer: 'A' | 'B' | 'C' = 'B', body = '知识 evidence '.repeat(60)): ContextPacket => createContextPacket([
  { layer, id, library: 'team', version: 1, title: id, content: body },
], { maxTokens: layer === 'C' ? 1200 : 1800, ...(layer === 'A' ? { reason: 'verify' as const } : {}) });

async function fixture() {
  const ctx = new Context(); const scope = ctx.plugin(SessionStore); await scope;
  const events: SessionEvent[] = [];
  ctx.on('session/event', (_session, event) => { events.push(event); });
  const session = ctx.sessions.create(SessionId('knowledge-surface-fixture'));
  let call = 0;
  const result = (value: unknown, name = 'worker_memory_search', extra?: Record<string, unknown>) => {
    const callId = ToolCallId(`knowledge-${++call}`);
    session.append('tool/call', { turn: 1, step: call, callId, name, arguments: JSON.stringify({ query: '知识' }) });
    return session.append('tool/result', {
      turn: 1, step: call, message: createToolResultMessage({ callId, isError: false,
        content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] }),
      meta: { fixture: true, ...extra },
    }, { surfaceOp: 'append' });
  };
  return { ctx, session, events, result, dispose: () => scope.dispose() };
}

test('knowledge surface bounds multi-step ABC pools through official replayable replacements', async () => {
  const f = await fixture();
  try {
    const c = packet('overview', 'C', '团队原则：核对引用版本。');
    const prompt = `员工职责\n${JSON.stringify(c)}`;
    f.session.append('system/message', { turn: 1, step: 1, message: createSystemMessage(prompt) }, { surfaceOp: 'append' });
    const first = f.result(packet('detail-1'));
    f.result(packet('detail-2')); f.result(packet('detail-3')); f.result(packet('source', 'A', '原始证据必须准确引用。'.repeat(35)));
    const original = JSON.stringify(first);
    const before = f.events.length;
    const usage = compactKnowledgeSurface(f.session, c, limits, { events: f.events, systemText: prompt, tools: [] });
    assert.ok(usage.replaced > 0); assert.ok(usage.bTokens <= limits.bActive);
    assert.ok(usage.aTokens <= limits.aActive); assert.ok(usage.totalTokens <= limits.total);
    assert.equal(usage.contextWindowKnown, false); assert.equal(usage.countMode, 'utf8-byte-upper-bound');
    assert.equal(JSON.stringify(first), original, 'archive event is immutable');
    const changes = f.events.slice(before);
    for (let index = 0; index < changes.length; index += 2) {
      assert.equal(changes[index]?.type, 'compaction/prune');
      assert.equal(changes[index + 1]?.type, 'tool/result');
      assert.notEqual(changes[index + 1]?.surfaceOp, 'append');
    }
    const replay = Session.create(SessionId('surface-replay'), f.events);
    assert.deepEqual(replay.deriveMessages(), f.session.deriveMessages(), 'original events and replacements replay without plugin interpreters');
    const next = compactKnowledgeSurface(f.session, c, limits, { events: f.events, systemText: prompt });
    assert.equal(next.replaced, 0, 'unchanged step does not append recurring summaries');
  } finally { await f.dispose(); }
});

test('duplicate reads retain one body and count old references in the active budget', async () => {
  const f = await fixture();
  try {
    const value = packet('same-detail'); const first = f.result(value); const last = f.result(value);
    const usage = compactKnowledgeSurface(f.session, undefined, limits, { events: f.events });
    assert.equal(usage.replaced, 1);
    const texts = f.session.deriveMessages().flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : []));
    assert.equal(texts.filter(text => text.includes('"pieces":[{')).length, 1);
    assert.match(texts[0]!, /workforce-knowledge-reference/);
    assert.deepEqual(JSON.parse(texts[0]!).directory, [{ layer: 'B', id: 'same-detail', library: 'team', version: 1 }]);
    assert.ok(usage.bTokens > countContextTokens(value), 'reference metadata also consumes B');
    const replacement = f.events.at(-1)!;
    assert.equal(replacement.type, 'tool/result');
    if (replacement.type !== 'tool/result') throw new Error('missing replacement');
    assert.deepEqual({ ...replacement.data.message, content: first.data.message.content }, first.data.message);
    assert.deepEqual(replacement.data.meta, first.data.meta);
    assert.deepEqual(replacement.sourceEventSeqs, [first.seq]);
    assert.ok(f.session.surface.nodes.includes(last.seq));
  } finally { await f.dispose(); }
});

test('other tools, nested source marker text and malformed producer envelopes remain unchanged', async () => {
  const f = await fixture();
  try {
    const fake = packet('fake');
    const other = f.result(fake, 'read_file');
    const nested = f.result(`原文提及 ${JSON.stringify(fake)}，其后仍有原文。`);
    const invalid = f.result({ kind: 'workforce-knowledge-context', layer: 'B', pieces: [], directory: [] });
    const valid = f.result(packet('valid', 'B', JSON.stringify(fake)));
    const before = f.events.length;
    const usage = compactKnowledgeSurface(f.session, undefined, limits, { events: f.events });
    assert.equal(usage.replaced, 0); assert.equal(f.events.length, before);
    assert.ok([other, nested, invalid, valid].every(event => f.session.surface.nodes.includes(event.seq)));
  } finally { await f.dispose(); }
});

test('pending first-step task and tool schemas are budgeted without double-counting C', async () => {
  const f = await fixture();
  try {
    const c = packet('overview', 'C', '当前团队规则'); const prompt = JSON.stringify(c);
    f.session.append('system/message', { turn: 1, step: 1, message: createSystemMessage(prompt) }, { surfaceOp: 'append' });
    const ordinary = compactKnowledgeSurface(f.session, c, limits, { events: f.events, systemText: prompt, contextWindow: 10_000, outputReserve: 1_000, headroom: 100 });
    const pending = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'PENDING_TASK '.repeat(25) }] });
    const withPending = compactKnowledgeSurface(f.session, c, limits, { events: f.events, systemText: prompt, pendingMessages: [pending],
      tools: [{ name: 'fixture_tool', description: 'scoped wire tool', parameters: { type: 'object' } }], contextWindow: 10_000, outputReserve: 1_000, headroom: 100 });
    assert.ok(withPending.requestTokens > ordinary.requestTokens + 200);
    assert.equal(ordinary.cTokens, countContextTokens(c));
    assert.equal(ordinary.knowledgeLimit, 2250, 'window policy caps ABC at one quarter of context after output reserve');
    assert.ok(ordinary.requestTokens < countContextTokens(c) * 2, 'C only appears once in the complete request measurement');
  } finally { await f.dispose(); }
});

test('non-knowledge overflow is explicit and leaves original history untouched', async () => {
  const f = await fixture();
  try {
    f.result(packet('detail'));
    const before = [...f.session.surface.nodes]; const logBefore = f.events.length;
    assert.throws(() => compactKnowledgeSurface(f.session, undefined, limits, { events: f.events,
      contextWindow: 2000, outputReserve: 500, headroom: 100, pendingText: '用户任务原文'.repeat(200),
    }), KnowledgeContextBudgetError);
    assert.deepEqual(f.session.surface.nodes, before); assert.equal(f.events.length, logBefore);
  } finally { await f.dispose(); }
});

test('native context management defers long native history pressure while still enforcing plugin ABC limits', async () => {
  const f = await fixture();
  try {
    const original = f.session.append('user/message', createUserMessage({ source: { kind: 'user' },
      content: [{ type: 'text', text: 'LONG_NATIVE_HISTORY '.repeat(5000) }] }), { surfaceOp: 'append' });
    const immutable = JSON.stringify(original);
    const c = packet('current-overview', 'C', '当前候选知识入口。');
    f.result(packet('bounded-detail'));
    const usage = compactKnowledgeSurface(f.session, c, limits, { events: f.events,
      contextWindow: 64_000, outputReserve: 8000, nativeContextManagement: true });
    assert.equal(usage.requestBudgetOwner, 'native');
    assert.ok(usage.requestTokens > 64_000, 'the byte estimate is diagnostic, not an extra native turn limit');
    assert.ok(usage.totalTokens <= limits.total); assert.ok(usage.bTokens <= limits.bActive);
    assert.ok(f.session.surface.nodes.includes(original.seq)); assert.equal(JSON.stringify(original), immutable);
    const before = f.events.length;
    assert.throws(() => compactKnowledgeSurface(f.session, c, { ...limits, cMax: 1 }, { events: f.events,
      contextWindow: 64_000, outputReserve: 8000, nativeContextManagement: true }), /pinned C overview/);
    assert.equal(f.events.length, before, 'owned knowledge overflow fails before any mutation');
  } finally { await f.dispose(); }
});

test('surface helper supports a pluggable counter and refuses absent event provenance', async () => {
  const f = await fixture();
  try {
    const counter = (serialized: string) => Buffer.byteLength(serialized, 'utf8');
    const value = createContextPacket([{ layer: 'B', id: 'counter', library: 'employee', version: 2, title: 'counter', content: 'precise evidence' }], { counter, maxTokens: 1800 });
    f.result(value);
    assert.throws(() => compactKnowledgeSurface(f.session, undefined, limits), /session\/event/);
    const usage = compactKnowledgeSurface(f.session, undefined, limits, { events: f.events, counter });
    assert.equal(usage.countMode, 'custom-token-counter'); assert.equal(usage.bTokens, countContextTokens(value, counter));
  } finally { await f.dispose(); }
});

test('each successive read is charged with prior evidence and pinned C stays intact', async () => {
  const f = await fixture();
  try {
    const c = packet('always-pinned', 'C', '不可删除的团队约束。');
    const prompt = JSON.stringify(c);
    f.session.append('system/message', { turn: 1, step: 1, message: createSystemMessage(prompt) }, { surfaceOp: 'append' });
    const body = 'VERSION=7.2; timeout=1600; 除非管理员批准，否则禁止重试。'.repeat(14);
    let compacted = 0;
    for (let index = 0; index < 5; index++) {
      f.result(packet(`successive-${index}`, index % 2 ? 'A' : 'B', body));
      const usage = compactKnowledgeSurface(f.session, c, limits, { events: f.events, systemText: prompt });
      compacted += usage.replaced;
      assert.ok(usage.totalTokens <= limits.total); assert.ok(usage.bTokens <= limits.bActive); assert.ok(usage.aTokens <= limits.aActive);
      assert.equal(usage.cTokens, countContextTokens(c));
      assert.equal(f.session.deriveMessages()[0]?.content[0]?.type, 'text');
      const system = f.session.deriveMessages()[0]!;
      if (system.content[0]?.type === 'text') assert.equal(system.content[0].text, prompt);
    }
    assert.ok(compacted > 0, 'accumulated bodies are actually collected over multiple pre-step calls');
    const lastBody = f.session.deriveMessages().at(-1)!.content[0];
    assert.ok(lastBody?.type === 'text' && lastBody.text.includes('timeout=1600'), 'latest exact values and conditions are retained');
  } finally { await f.dispose(); }
});

test('different citation pages retain precise reread coordinates when an old body is collected', async () => {
  const f = await fixture();
  try {
    const content = '共享正文及适用条件。'.repeat(25);
    const citationPage = (offset: number) => createContextPacket([{
      layer: 'B', id: 'citation-paged-detail', library: 'employee', version: 7, title: 'same body, separate evidence pages', content,
      citations: [{ sourceId: `source-${offset + 1}`, sourceVersion: 2, startLine: 10, endLine: 12 }],
      provenance: `A 引用共 8 条，当前 ${offset + 1}–${offset + 4}；其余可用 citationOffset=${offset + 4} 继续读取同一 B。`,
    }], { maxTokens: 1800 });
    const first = citationPage(0); const second = citationPage(4);
    assert.notEqual(first.packetId, second.packetId);
    f.result(first); f.result(second);
    const usage = compactKnowledgeSurface(f.session, undefined, { ...limits, bActive: 2000 }, { events: f.events });
    assert.ok(usage.replaced > 0); assert.ok(usage.bTokens <= 2000);
    const values = f.session.deriveMessages().map(message => {
      assert.equal(message.content[0]?.type, 'text');
      return JSON.parse((message.content[0] as { text: string }).text);
    });
    assert.equal(values[0].kind, 'workforce-knowledge-reference');
    assert.deepEqual(values[0].directory[0], { layer: 'B', id: 'citation-paged-detail', library: 'employee', version: 7,
      provenance: first.directory[0]!.provenance, citationOffset: 0 });
    assert.equal(values[1].kind, 'workforce-knowledge-context');
    assert.equal(values[1].directory[0].citations[0].sourceId, 'source-5');
    const stable = compactKnowledgeSurface(f.session, undefined, { ...limits, bActive: 2000 }, { events: f.events });
    assert.equal(stable.replaced, 0); assert.equal(stable.bTokens, usage.bTokens);
  } finally { await f.dispose(); }
});

test('an older hash-only reference recovers versioned reread identity from its logged source', async () => {
  const f = await fixture();
  try {
    const value = packet('recoverable-reference'); const origin = f.result(value);
    f.session.append('tool/result', { ...origin.data, message: { ...origin.data.message, content: [{ type: 'text', text: JSON.stringify({
      kind: 'workforce-knowledge-reference', layer: value.layer, packetId: value.packetId, contentOmitted: true,
    }) }] } }, { surfaceOp: { op: 'replace', startSeq: origin.seq, endSeq: origin.seq }, sourceEventSeqs: [origin.seq] });
    const usage = compactKnowledgeSurface(f.session, undefined, limits, { events: f.events });
    assert.equal(usage.replaced, 1);
    const content = f.session.deriveMessages()[0]!.content[0];
    assert.ok(content?.type === 'text');
    assert.equal(JSON.parse(content.text).directory[0].id, 'recoverable-reference');
  } finally { await f.dispose(); }
});
