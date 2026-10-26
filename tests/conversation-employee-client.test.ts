import assert from 'node:assert/strict';
import test from 'node:test';
import { createConversationEmployeeController, type ConversationEmployeeSnapshot, type ConversationEmployeeTransport } from '../src/client/conversation-employee.js';
import { createConversationEmployeeTransport } from '../src/client/conversation-employee-transport.js';

const card = { name: '产品负责人', mission: '明确可验收的需求', duties: ['澄清需求'], boundaries: ['不代替用户发布'], capabilities: { skills: [], tools: [], plugins: [], mcps: [] } };
const view = (sessionId = 'chat', extra: Partial<ConversationEmployeeSnapshot> = {}): ConversationEmployeeSnapshot => ({ enabled: true, busy: false, revision: 4, sessionId, projectId: 'project', conversationEmployee: null, choices: [{ kind: 'template', id: 'product', name: card.name, description: card.mission, card }], ...extra });
const tick = () => new Promise(resolve => setImmediate(resolve));
const binding = { sessionId: 'chat', projectId: 'project', employeeId: 'employee', mode: 'consult' as const, version: 2, createdAt: 'now', updatedAt: 'now' };

test('resident client selects explicitly with exact revision/version and never writes from load', async () => {
  const calls: Array<{ path: string; body?: any }> = [];
  const requester = async <T,>(path: string, body?: unknown): Promise<T> => { calls.push({ path, body }); return view() as T; };
  const transport = createConversationEmployeeTransport(requester);
  const snapshot = await transport.load('chat');
  assert.deepEqual(calls, [{ path: '/conversation-employee?sessionId=chat', body: undefined }]);
  await transport.select('chat', snapshot.choices[0]!, 'consult', snapshot);
  assert.deepEqual(calls[1]!.body, { action: 'conversation.employee.select', payload: { sessionId: 'chat', projectId: 'project', templateId: 'product', mode: 'consult' }, options: { expectedRevision: 4, expectedVersion: 0 } });
  await transport.clear('chat', view('chat', { conversationEmployee: binding }));
  assert.deepEqual(calls[2]!.body, { action: 'conversation.employee.clear', payload: { sessionId: 'chat', projectId: 'project' }, options: { expectedRevision: 4, expectedVersion: 2 } });
});

test('resident pending mutation blocks only its own conversation', async () => {
  let release: (() => void) | undefined;
  const selected: string[] = [];
  const transport: ConversationEmployeeTransport = { load: async id => view(id), select: async id => { selected.push(id); if (id === 'one') await new Promise<void>(resolve => { release = resolve; }); }, clear: async () => {} };
  const controller = createConversationEmployeeController(transport, { pollMs: 60_000 });
  const a = controller.subscribe('one', () => {}), b = controller.subscribe('two', () => {});
  await tick();
  const first = controller.select('one', view().choices[0]!, 'consult');
  await tick();
  assert.equal(controller.read('one').pending, true);
  assert.equal(controller.read('two').pending, false);
  assert.equal(await controller.select('two', view().choices[0]!, 'execute'), true);
  assert.deepEqual(selected, ['one', 'two']);
  release!(); await first; a(); b(); controller.dispose();
});

test('unavailable resident remains visible and can clear, while disabled workspaces cannot select', async () => {
  const cleared: string[] = [], selected: string[] = [];
  const transport: ConversationEmployeeTransport = { load: async id => view(id, { conversationEmployee: binding, unavailableReason: '员工已暂停', ...(id === 'project-chat' ? { enabled: false } : {}) }), select: async id => { selected.push(id); }, clear: async id => { cleared.push(id); } };
  const controller = createConversationEmployeeController(transport, { pollMs: 60_000 });
  await controller.refresh('chat'); await controller.refresh('project-chat');
  assert.equal(await controller.clear('chat'), true);
  assert.equal(await controller.select('project-chat', view().choices[0]!, 'consult'), false);
  assert.deepEqual(cleared, ['chat']); assert.deepEqual(selected, []); controller.dispose();
});

test('stale read cannot overwrite resident mutation and conflicts refresh without replaying selection', async () => {
  let fail = true, writes = 0, revision = 4;
  const controller = createConversationEmployeeController({ load: async id => view(id, { revision }), select: async () => { writes++; revision++; if (fail) throw new Error('配置已更新'); }, clear: async () => {} }, { pollMs: 60_000 });
  await controller.refresh('chat');
  assert.equal(await controller.select('chat', view().choices[0]!, 'consult'), false);
  assert.equal(controller.read('chat').snapshot?.revision, 5); assert.equal(controller.read('chat').error, '配置已更新'); assert.equal(writes, 1);
  fail = false; assert.equal(await controller.select('chat', view().choices[0]!, 'consult'), true); assert.equal(writes, 2); controller.dispose();
});

test('a transport ignoring abort cannot publish an older read over explicit selection', async () => {
  let loads = 0, release: ((snapshot: ConversationEmployeeSnapshot) => void) | undefined;
  const controller = createConversationEmployeeController({ load: async id => {
    loads++;
    if (loads === 2) return new Promise(resolve => { release = resolve; });
    return view(id, { revision: loads === 1 ? 4 : 5 });
  }, select: async () => {}, clear: async () => {} });
  await controller.refresh('chat'); const stale = controller.refresh('chat'); await tick();
  assert.equal(await controller.select('chat', view().choices[0]!, 'consult'), true);
  release!(view('chat', { revision: 4 })); await stale;
  assert.equal(controller.read('chat').snapshot?.revision, 5); controller.dispose();
});

test('unmount and disposal abort read work and release subscriptions', async () => {
  let signal: AbortSignal | undefined, release: ((snapshot: ConversationEmployeeSnapshot) => void) | undefined, notifications = 0;
  const controller = createConversationEmployeeController({ load: async (_id, input) => { signal = input; return new Promise(resolve => { release = resolve; }); }, select: async () => {}, clear: async () => {} });
  const unsubscribe = controller.subscribe('chat', () => { notifications++; }); await tick();
  unsubscribe(); assert.equal(signal?.aborted, true); controller.dispose();
  release!(view()); await tick(); assert.equal(notifications, 0);
});
