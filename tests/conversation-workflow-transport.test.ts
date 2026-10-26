import assert from 'node:assert/strict';
import test from 'node:test';
import { createConversationWorkflowTransport } from '../src/client/conversation-workflow-transport.js';

const native = (patch: Record<string, unknown> = {}) => ({ projectId: 'project', sessionId: 'session', revision: 8, selection: 'inherit', instanceId: 'instance', instanceVersion: 2, workflowTemplateId: 'software', name: '软件工程', currentStepId: 'build', activeEmployeeIds: [], relatedOwnerIds: [], steps: [{ id: 'build', name: '开发', status: 'current', employeeId: 'worker', instruction: '完成开发', employeeName: '开发人员' }], choices: [{ id: 'software', name: '软件工程', version: 3, installed: false, available: true, templateVersions: { worker: 7, lead: 4 } }], ...patch });

test('selection sends the exact workflow and roster versions loaded for the preview', async () => {
  const posts: unknown[] = [];
  const { transport, dispose } = createConversationWorkflowTransport(async <T>(_path: string, body?: unknown) => { if (body) posts.push(body); return native() as T; });
  const snapshot = await transport.load('session');
  assert.equal(snapshot.workflowName, '软件工程'); assert.equal(snapshot.steps[0]?.employeeName, '开发人员');
  await transport.selectWorkflow('session', 'software', snapshot);
  assert.deepEqual(posts, [{ action: 'conversation.workflow.select', payload: { projectId: 'project', sessionId: 'session', workflowTemplateId: 'software', workflowTemplateVersion: 3, templateVersions: { worker: 7, lead: 4 } }, options: { expectedRevision: 8 } }]);
  await transport.selectWorkflow('session', null, snapshot);
  assert.deepEqual(posts[1], { action: 'conversation.workflow.select', payload: { projectId: 'project', sessionId: 'session', workflowTemplateId: null }, options: { expectedRevision: 8 } });
  dispose();
});

test('step selection uses instance and global revisions without hiding the unavailable reason', async () => {
  const posts: unknown[] = [];
  const { transport, dispose } = createConversationWorkflowTransport(async <T>(_path: string, body?: unknown) => { if (body) posts.push(body); return native({ unavailableReason: '当前步骤负责人已暂停' }) as T; });
  const snapshot = await transport.load('session');
  assert.equal(snapshot.unavailableReason, '当前步骤负责人已暂停');
  await transport.selectStep('session', 'review', snapshot);
  assert.deepEqual(posts[0], { action: 'conversation.workflow.step', payload: { projectId: 'project', sessionId: 'session', stepId: 'review', instanceVersion: 2 }, options: { expectedRevision: 8 } });
  dispose();
});

test('the header projection retains only the declared rejection destination without exposing instructions', async () => {
  const { transport, dispose } = createConversationWorkflowTransport(async <T>() => native({ steps: [
    { id: 'build', name: '开发', status: 'pending', employeeId: 'worker', instruction: 'private instruction' },
    { id: 'review', name: '验收', status: 'current', employeeId: 'reviewer', onRejectStepId: 'build', instruction: 'private acceptance' },
  ] }) as T);
  const snapshot = await transport.load('session');
  assert.equal(snapshot.steps[1]?.onRejectStepId, 'build');
  assert.equal(snapshot.steps[0]?.onRejectStepId, undefined);
  assert.equal(JSON.stringify(snapshot.steps).includes('private'), false);
  dispose();
});

test('the header projection keeps local conversation activity separate from shared progress activity', async () => {
  const { transport, dispose } = createConversationWorkflowTransport(async <T>() => native({ busy: false, progressBusy: true }) as T);
  const snapshot = await transport.load('idle-chat');
  assert.equal(snapshot.busy, false);
  assert.equal(snapshot.progressBusy, true);
  dispose();
});

test('the header projection retains owned activity stage feedback without exposing run configuration', async () => {
  const activity = { stage: 'knowledge', label: '正在准备知识入口', since: '2026-10-26T08:00:00.000Z' };
  const { transport, dispose } = createConversationWorkflowTransport(async <T>() => native({ busy: true, activity }) as T);
  const snapshot = await transport.load('active-chat');
  assert.deepEqual(snapshot.activity, activity);
  dispose();
});

test('a superseded preview and unavailable choices cannot submit a mutation', async () => {
  let revision = 8;
  let posts = 0;
  const { transport, dispose } = createConversationWorkflowTransport(async <T>(_path: string, body?: unknown) => { if (body) posts++; return native({ revision, choices: [{ id: 'software', name: '软件工程', version: 3, available: false, unavailableReason: '请先引入团队', templateVersions: {} }] }) as T; });
  const first = await transport.load('session');
  assert.equal(first.choices[0]?.disabled, true); assert.equal(first.choices[0]?.disabledReason, '请先引入团队');
  await assert.rejects(() => transport.selectWorkflow('session', 'software', first), /请先引入团队/);
  revision++; await transport.load('session');
  await assert.rejects(() => transport.selectWorkflow('session', null, first), /配置已更新/);
  assert.equal(posts, 0); dispose();
});

test('non-project and disposed projections cannot admit workflow selection', async () => {
  const { transport, dispose } = createConversationWorkflowTransport(async <T>() => native({ projectId: null, instanceId: null, steps: [], choices: [] }) as T);
  const snapshot = await transport.load('session');
  assert.equal(snapshot.projectId, undefined); assert.deepEqual(snapshot.choices, []);
  await assert.rejects(() => transport.selectWorkflow('session', null, snapshot), /配置已更新/);
  dispose(); await assert.rejects(() => transport.selectStep('session', 'build', snapshot), /请先选择工作流/);
});

test('only an explicit host sessionReopened result reopens a selected native session', async () => {
  const callbacks: string[] = [];
  let reopened = false;
  const { transport, dispose } = createConversationWorkflowTransport(async <T>(_path: string, body?: unknown) => (body ? { result: { sessionReopened: reopened } } : native()) as T,
    { beforeSelection: id => callbacks.push('before:' + id), onSessionReopened: id => callbacks.push('reopen:' + id) });
  const snapshot = await transport.load('session');
  await transport.selectWorkflow('session', 'software', snapshot);
  assert.deepEqual(callbacks, ['before:session']);
  reopened = true; await transport.selectWorkflow('session', 'software', snapshot);
  assert.deepEqual(callbacks, ['before:session', 'before:session', 'reopen:session']);
  dispose();
});

test('a retained default-inheriting session handoff is deduplicated and never changes its selection', async () => {
  let releases!: () => void;
  const barrier = new Promise<void>(done => { releases = done; });
  let required = true;
  const posts: unknown[] = [], callbacks: string[] = [];
  const { transport, dispose } = createConversationWorkflowTransport(async <T>(_path: string, body?: unknown, signal?: AbortSignal) => {
    if (!body) return native({ sessionHandoffRequired: required }) as T;
    assert.equal(signal, undefined, 'The host handoff is not cancelled when the old slot retires');
    posts.push(body); await barrier; required = false; return { result: { sessionReopened: true } } as T;
  }, { beforeSelection: id => callbacks.push('before:' + id), onSessionReopened: id => callbacks.push('reopen:' + id) });
  const first = transport.load('session'), second = transport.load('session');
  await new Promise(done => setImmediate(done));
  assert.equal(posts.length, 1); releases();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.selection, 'inherit'); assert.equal(b.selection, 'inherit');
  assert.deepEqual(posts, [{ action: 'conversation.workflow.resume', payload: { projectId: 'project', sessionId: 'session' } }]);
  assert.deepEqual(callbacks, ['before:session', 'before:session', 'reopen:session']);
  await transport.load('session'); assert.equal(posts.length, 1); dispose();
});

test('busy retained sessions defer handoff and disposed UI cannot reopen after an in-flight handoff', async () => {
  let busy = true; let release!: () => void; let posts = 0; let callbacks = 0;
  const barrier = new Promise<void>(done => { release = done; });
  const { transport, dispose } = createConversationWorkflowTransport(async <T>(_path: string, body?: unknown) => {
    if (!body) return native({ sessionHandoffRequired: true, busy }) as T;
    posts++; await barrier; return { result: { sessionReopened: true } } as T;
  }, { onSessionReopened: () => callbacks++ });
  await transport.load('session'); assert.equal(posts, 0);
  busy = false; const pending = transport.load('session'); await new Promise(done => setImmediate(done));
  dispose(); release(); await pending;
  assert.equal(posts, 1); assert.equal(callbacks, 0);
});
