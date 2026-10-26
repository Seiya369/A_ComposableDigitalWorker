import test from 'node:test';
import assert from 'node:assert/strict';
import { createTemporaryEmployeeMentionTickets } from '../src/harness/host.js';
import { hasTemporaryEmployeeMentionMarker, parseTemporaryEmployeeMentionMarker, stripTemporaryEmployeeMentionMarker } from '../src/domain/conversation-employee.js';

const target = { projectId: 'project-a', sessionId: 'chat-a', templateId: 'role-a', expectedTargetVersion: 3 };

test('temporary marker grants one native conversation turn and permits only that turns idempotent preparation', () => {
  const tickets = createTemporaryEmployeeMentionTickets();
  const { marker } = tickets.issue(target);
  assert.equal(tickets.has('chat-a', `${marker} @员工 问题`), true);
  assert.throws(() => tickets.claim('chat-b', 'chat-b:2', `${marker} @员工 问题`), /当前对话/);
  const claimed = tickets.claim('chat-a', 'chat-a:2', `${marker} @员工 问题`)!;
  assert.deepEqual(claimed.input, { ...target, turnKey: 'chat-a:2' });
  assert.equal(claimed.requestText, '@员工 问题');
  assert.deepEqual(tickets.claim('chat-a', 'chat-a:2', `${marker} @员工 问题`), claimed);
  assert.throws(() => tickets.claim('chat-a', 'chat-a:3', `${marker} @员工 问题`), /另一轮/);
  tickets.dispose(); assert.throws(() => tickets.claim('chat-a', 'chat-a:2', `${marker} @员工 问题`), /失效/);
});

test('temporary ticket lifetime and capacity bound unused or cancelled selections without timers', () => {
  let clock = 1; let sequence = 0;
  const tickets = createTemporaryEmployeeMentionTickets({ now: () => clock, ttlMs: 50, capacity: 2, token: () => (++sequence).toString(16).padStart(32, '0') });
  const first = tickets.issue(target); tickets.issue(target);
  assert.throws(() => tickets.issue(target), /过多/);
  clock = 51;
  assert.throws(() => tickets.claim('chat-a', 'chat-a:2', `${first.marker} hello`), /失效/);
  assert.doesNotThrow(() => tickets.issue(target));
});

test('ordinary typed text does not acquire or consume a reference ticket', () => {
  const tickets = createTemporaryEmployeeMentionTickets();
  assert.equal(tickets.has('chat-a', '@员工 问题'), false);
  tickets.issue(target);
  assert.equal(tickets.has('chat-a', '  @员工 问题\n'), false);
  assert.equal(tickets.has('chat-b', '@员工 问题'), false);
  assert.equal(tickets.claim('chat-a', 'chat-a:2', '@员工 问题'), undefined);
});

test('only one leading well-formed employee marker is accepted and stripping preserves surrounding user text', () => {
  const a = `<graph-horses-employee:${'a'.repeat(32)}>`;
  const b = `<graph-horses-employee:${'b'.repeat(32)}>`;
  assert.equal(parseTemporaryEmployeeMentionMarker('@普通文件 请阅读'), undefined);
  assert.equal(hasTemporaryEmployeeMentionMarker('<graph-horses-employee:bad>'), true);
  assert.throws(() => parseTemporaryEmployeeMentionMarker(`<graph-horses-employee:bad> 问题`), /无效/);
  assert.throws(() => parseTemporaryEmployeeMentionMarker(`问题 ${a}`), /无效/);
  assert.throws(() => parseTemporaryEmployeeMentionMarker(`${a} ${b} 问题`), /一位员工/);
  assert.equal(stripTemporaryEmployeeMentionMarker(`${a} @员工\n原生资料`), ' @员工\n原生资料');
});
