import assert from 'node:assert/strict';
import test from 'node:test';
import { createConversationWorkflowController, type ConversationWorkflowSnapshot, type ConversationWorkflowTransport } from '../src/client/conversation-workflow.js';

function view(sessionId: string, patch: Partial<ConversationWorkflowSnapshot> = {}): ConversationWorkflowSnapshot {
  return { sessionId, projectId: 'project', revision: 1, selection: 'inherit', choices: [{ id: 'software', name: '软件工程', version: 1 }], steps: [], ...patch };
}
const flush = () => new Promise<void>(done => setImmediate(done));

test('workflow selection refreshes mounted project conversations while None is a session override', async t => {
  let selected: string | undefined;
  const overrides = new Map<string, string | null>();
  const calls: Array<[string, string | null, number]> = [];
  const controller = createConversationWorkflowController({
    async load(sessionId) {
      const workflow = overrides.has(sessionId) ? overrides.get(sessionId) : selected;
      return view(sessionId, { revision: calls.length + 1, selection: overrides.has(sessionId) ? 'override' : 'inherit', workflowTemplateId: workflow ?? undefined, ...(workflow ? { workflowName: '软件工程' } : {}) });
    },
    async selectWorkflow(sessionId, id, snapshot) { calls.push([sessionId, id, snapshot.revision]); if (!selected && id) selected = id; else overrides.set(sessionId, id); },
    async selectStep() {},
  }, { pollMs: 100000 });
  t.after(() => controller.dispose());
  const stopA = controller.subscribe('a', () => {});
  const stopB = controller.subscribe('b', () => {});
  t.after(stopA); t.after(stopB);
  await flush();
  assert.equal(await controller.selectWorkflow('a', 'software'), true);
  assert.equal(controller.read('a').snapshot?.workflowTemplateId, 'software');
  assert.equal(controller.read('b').snapshot?.workflowTemplateId, 'software');
  assert.equal(await controller.selectWorkflow('b', null), true);
  assert.equal(controller.read('b').snapshot?.selection, 'override');
  assert.equal(controller.read('b').snapshot?.workflowTemplateId, undefined);
  assert.equal(controller.read('a').snapshot?.workflowTemplateId, 'software');
  assert.deepEqual(calls, [['a', 'software', 1], ['b', null, 2]]);
});

test('step selection waits for the host and never fabricates completion for preceding steps', async t => {
  let current = 'build';
  let release!: () => void;
  let writes = 0;
  const barrier = new Promise<void>(done => { release = done; });
  const controller = createConversationWorkflowController({
    async load(sessionId) { return view(sessionId, { workflowTemplateId: 'software', currentStepId: current, steps: ['plan', 'build', 'test'].map(id => ({ id, name: id, status: id === current ? 'current' : 'pending' })) }); },
    async selectWorkflow() {},
    async selectStep(_sessionId, stepId) { writes++; await barrier; current = stepId; },
  }, { pollMs: 100000 });
  t.after(() => controller.dispose());
  const stop = controller.subscribe('a', () => {}); t.after(stop); await flush();
  const selection = controller.selectStep('a', 'test');
  assert.equal(controller.read('a').pending, true);
  assert.equal(controller.read('a').snapshot?.currentStepId, 'build');
  assert.equal(await controller.selectStep('a', 'plan'), false);
  release(); assert.equal(await selection, true);
  assert.equal(writes, 1);
  assert.deepEqual(controller.read('a').snapshot?.steps.map(step => step.status), ['pending', 'pending', 'current']);
  assert.equal(controller.read('a').pending, false);
});

test('CAS rejection refreshes the effective selection, surfaces error and does not retry a write', async t => {
  let revision = 3;
  let writes = 0;
  const controller = createConversationWorkflowController({
    async load(sessionId) { return view(sessionId, { revision, workflowTemplateId: revision > 3 ? 'newer' : undefined }); },
    async selectWorkflow() { writes++; revision = 4; throw new Error('配置已更新，请重试'); },
    async selectStep() {},
  }, { pollMs: 100000 });
  t.after(() => controller.dispose());
  const stop = controller.subscribe('a', () => {}); t.after(stop); await flush();
  assert.equal(await controller.selectWorkflow('a', 'software'), false);
  assert.equal(writes, 1);
  assert.equal(controller.read('a').snapshot?.revision, 4);
  assert.equal(controller.read('a').snapshot?.workflowTemplateId, 'newer');
  assert.equal(controller.read('a').error, '配置已更新，请重试');
  assert.equal(controller.read('a').pending, false);
});

test('unmounted or disposed slots stop polling and ignore late host responses', async () => {
  let reads = 0;
  let late!: (snapshot: ConversationWorkflowSnapshot) => void;
  let signal: AbortSignal | undefined;
  const transport: ConversationWorkflowTransport = {
    load(sessionId, inputSignal) { reads++; signal = inputSignal; return reads === 1 ? Promise.resolve(view(sessionId)) : new Promise(done => { late = done; }); },
    async selectWorkflow() {}, async selectStep() {},
  };
  const controller = createConversationWorkflowController(transport, { pollMs: 10 });
  let notifications = 0;
  const stop = controller.subscribe('a', () => { notifications++; }); await flush();
  const pending = controller.refresh('a');
  stop(); assert.equal(signal?.aborted, true);
  const before = notifications;
  late(view('a', { revision: 100 })); await pending;
  await new Promise(done => setTimeout(done, 30));
  assert.equal(reads, 2); assert.equal(notifications, before);
  assert.equal(controller.read('a').snapshot?.revision, 1);
  controller.dispose();
  assert.equal(await controller.selectWorkflow('a', 'software'), false);
});

test('failed loads remain retryable and a host-busy workflow refuses a selection', async t => {
  let failing = true;
  let writes = 0;
  const controller = createConversationWorkflowController({
    async load(sessionId) { if (failing) throw new Error('网络暂不可用'); return view(sessionId, { busy: true }); },
    async selectWorkflow() { writes++; }, async selectStep() { writes++; },
  }, { pollMs: 100000 });
  t.after(() => controller.dispose());
  const stop = controller.subscribe('a', () => {}); t.after(stop); await flush();
  assert.equal(controller.read('a').error, '网络暂不可用');
  assert.equal(controller.read('a').loading, false);
  failing = false; await controller.refresh('a');
  assert.equal(controller.read('a').error, undefined);
  assert.equal(await controller.selectWorkflow('a', 'software'), false);
  assert.equal(await controller.selectStep('a', 'build'), false);
  assert.equal(writes, 0);
});

test('shared progress activity blocks step changes while an idle conversation can still choose a workflow', async t => {
  const calls: string[] = [];
  const controller = createConversationWorkflowController({
    async load(sessionId) { return view(sessionId, { busy: false, progressBusy: true }); },
    async selectWorkflow() { calls.push('workflow'); },
    async selectStep() { calls.push('step'); },
  }, { pollMs: 100000 });
  t.after(() => controller.dispose());
  const stop = controller.subscribe('idle-chat', () => {}); t.after(stop); await flush();
  assert.equal(await controller.selectStep('idle-chat', 'build'), false, 'a shared step cannot change while another owner is executing');
  assert.equal(await controller.selectWorkflow('idle-chat', null), true);
  assert.deepEqual(calls, ['workflow']);
});
