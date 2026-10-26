import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmployeeMentionSource, employeeMentionMarkerDisplayRule } from '../src/client/mentions.js';
import type { WorkforceState } from '../src/domain/types.js';

const snapshot = () => ({ employees: [], templates: [{ id: 'role-a', version: 1, name: '产品负责人', status: 'ready', modules: { responsibilities: { mission: '明确需求', duties: [], boundaries: [] }, capabilities: { skills: [], tools: [] } } }] } as unknown as WorkforceState);
const query = { query: '', position: 'leading' as const, signal: new AbortController().signal };
const marker = '<graph-horses-employee:0123456789abcdef0123456789abcdef>';
const source = (issueMentionTicket: any) => createEmployeeMentionSource({ snapshot: async () => snapshot(), projectForSession: async () => ({ projectId: 'chat', standaloneOnly: true }), issueMentionTicket,
  run: async () => { throw Error('Chat must use the native send sink'); }, onStarted: () => { assert.fail('Chat must never navigate to a work order'); } });

test('Chat @ inserts a native reference without allocating work or claiming attachment submission', async () => {
  let calls = 0; const employeeSource = source(async () => { calls++; return { marker }; });
  const candidates = await employeeSource.candidates({ sessionId: 'chat-a' as never }, query);
  assert.equal(candidates[0]!.hint, '仅本轮');
  const picked = employeeSource.onPick({ session: { sessionId: 'chat-a' as never }, position: 'leading', candidate: candidates[0] } as never);
  assert.ok(picked && typeof picked === 'object' && 'insert' in picked);
  assert.equal(picked.insert.label, '产品负责人'); assert.equal(picked.insert.clipboardText, '@产品负责人'); assert.equal(calls, 0);
  assert.equal(employeeSource.codec!.clipboardText(picked.insert.ref), '@产品负责人');
  assert.ok(!('claim' in picked), 'native references leave attachments and delivery mode to DSH');
  const signal = new AbortController().signal;
  assert.equal(await employeeSource.codec!.serialize(picked.insert.ref, signal), marker + ' @产品负责人'); assert.equal(calls, 1);
});

test('Chat reference serialization captures exact session/target and propagates the native abort signal', async () => {
  const issued: unknown[] = []; const employeeSource = source(async (input: unknown, signal: unknown) => { issued.push({ input, signal }); return { marker }; });
  const [candidate] = await employeeSource.candidates({ sessionId: 'chat-a' as never }, query);
  const picked = employeeSource.onPick({ session: { sessionId: 'chat-a' as never }, position: 'leading', candidate } as never);
  assert.ok(picked && typeof picked === 'object' && 'insert' in picked);
  const controller = new AbortController(); await employeeSource.codec!.serialize(picked.insert.ref, controller.signal);
  assert.deepEqual(issued, [{ input: { sessionId: 'chat-a', templateId: 'role-a' }, signal: controller.signal }]);
  controller.abort(); await assert.rejects(employeeSource.codec!.serialize(picked.insert.ref, controller.signal)); assert.equal(issued.length, 1);
  await assert.rejects(employeeSource.codec!.serialize('untrusted-reference', new AbortController().signal), /引用/);
});

test('typed/pasted Chat @ returns unchanged to the same native sink with attachments', async () => {
  const issued: unknown[] = []; const employeeSource = source(async (input: unknown) => { issued.push(input); return { marker }; });
  const signal = new AbortController().signal;
  assert.equal(await employeeSource.matchEnter!({ sessionId: 'chat-a' as never }, '@产品负责人 原文\n含换行', signal, { attachments: 2 }), undefined);
  assert.deepEqual(issued, []);
  const picked = employeeSource.matchSpace!({ sessionId: 'chat-a' as never }, '@产品负责人'); assert.ok(picked && typeof picked === 'object' && 'insert' in picked);
  assert.equal(issued.length, 0, 'space-time decoration is read-only');
});

test('ticket failure rejects reference serialization without consuming draft text or attachments', async () => {
  const employeeSource = source(async () => { throw Error('员工已暂停'); });
  const [candidate] = await employeeSource.candidates({ sessionId: 'chat-a' as never }, query);
  const picked = employeeSource.onPick({ session: { sessionId: 'chat-a' as never }, position: 'leading', candidate } as never);
  assert.ok(picked && typeof picked === 'object' && 'insert' in picked);
  await assert.rejects(employeeSource.codec!.serialize(picked.insert.ref, new AbortController().signal), /暂停/);
});

test('public user-text rule masks only the transport marker and preserves the visible @ name', () => {
  const text = marker + ' @产品负责人 原文';
  const node = employeeMentionMarkerDisplayRule.match(text, 0, {} as never);
  assert.ok(node && node.id === 'text'); assert.equal(node.data.display, '');
  assert.equal(text.slice(node.end), '@产品负责人 原文');
  assert.equal(employeeMentionMarkerDisplayRule.match('普通文本<graph-horses-employee:bad>', 0, {} as never), undefined);
});
