import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { access, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { apply } from '../src/harness/host.js';
import { WorkforceStore } from '../src/domain/store.js';
import { captureWorkflowTeam } from '../src/domain/workflow-team.js';
import type { ConversationWorkflowView } from '../src/domain/conversation-workflow.js';
import type { WorkforceRun, WorkforceState } from '../src/domain/types.js';
import { WorkflowRepository } from '../src/workflow/repository.js';
import { WorkService } from '../src/work/service.js';
import { KnowledgeEngine } from '../src/knowledge/engine.js';
import { WorkforceRuntime, type RunRequest } from '../src/harness/runtime.js';
import type { WorkTask } from '../src/work/types.js';
import type { ConversationWorkflowDetails, ConversationWorkflowReviewInput } from '../src/domain/conversation-workflow-details.js';

/** The real authenticated route is exercised with official services represented by fixtures. */
async function fixture(t: { after(fn: () => Promise<void>): void }, options: { legacyHistory?: boolean; modernHistory?: boolean; activeModernHistory?: boolean; blockedHistory?: boolean; failRuntimeCleanup?: boolean; chatWorkspace?: boolean; projectTitle?: string; pausedLegacyFlow?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'conversation-workflow-http-')); const file = join(root, 'state.json');
  let hostCleanupRegistered = false;
  t.after(() => hostCleanupRegistered ? Promise.resolve() : rm(root, { recursive: true, force: true }));
  const projectPath = options.chatWorkspace ? join(root, 'Chat') : root;
  if (options.chatWorkspace) await mkdir(projectPath);
  const store = await WorkforceStore.open(file); const project = await store.saveProject({ id: 'project-a', name: options.projectTitle ?? '项目甲', rootPath: projectPath });
  await mkdir(join(root, 'other')); const other = await store.saveProject({ id: 'project-b', name: '项目乙', rootPath: join(root, 'other') });
  const architect = store.snapshot().templates[0]!;
  const developer = await store.saveTemplate({ name: '开发人员', modules: architect.modules, status: 'ready' });
  const team = await store.saveTeam({ name: '开发组', members: [{ memberId: 'architect', templateId: architect.id }, { memberId: 'developer', templateId: developer.id, reportsTo: 'architect' }] });
  const workflow = await store.saveWorkflowTemplate({ name: '软件工程', team: captureWorkflowTeam(team, store.snapshot().templates),
    roles: team.members.map(member => ({ id: member.memberId, name: member.memberId, memberId: member.memberId })),
    steps: [{ id: 'plan', name: '方案', roleId: 'architect', instruction: '设计方案', outputs: ['设计文档'], acceptanceCriteria: ['覆盖要求'] },
      { id: 'build', name: '实现', roleId: 'developer', instruction: '完成实现', outputs: ['代码'], acceptanceCriteria: ['测试通过'] }] });
  const templateVersions = Object.fromEntries(store.snapshot().templates.map(template => [template.id, template.version]));
  const history: WorkforceRun[] = [];
  if (options.legacyHistory) {
    const original = await store.createEmployee({ projectId: project.id, templateId: architect.id });
    const subordinate = await store.createEmployee({ projectId: project.id, templateId: developer.id, managerId: original.id });
    const oldRun = async (sessionId: string, status: 'awaiting-review' | 'succeeded' | 'failed' | 'cancelled', parentRunId?: string) => {
      let run = await store.createRun({ projectId: project.id, employeeId: parentRunId ? subordinate.id : original.id, request: `保留历史：${sessionId}`, ...(parentRunId ? { parentRunId } : {}) });
      run = await store.updateRun(run.id, { sessionId, status: 'running' });
      if (status === 'awaiting-review' || status === 'succeeded') {
        run = await store.updateRun(run.id, { status: 'awaiting-review', output: `历史交付：${sessionId}`, artifacts: [{ id: 'original-artifact', title: '历史资料', content: '保留原交付与验收状态' }] });
        if (status === 'succeeded') run = await store.reviewRun(run.id, { decision: 'accepted', reviewer: '历史验收人', note: '夹具原有验收，不得因切换而更改' });
      } else run = await store.updateRun(run.id, { status, error: status === 'failed' ? '保留历史错误' : undefined });
      history.push(run); return run;
    };
    await oldRun('chat-a', 'awaiting-review');
    for (const status of ['succeeded', 'failed', 'cancelled'] as const) await oldRun(`legacy-${status}`, status);
    const parent = await oldRun('legacy-parent', 'awaiting-review'); await oldRun('legacy-child', 'awaiting-review', parent.id);
    const installed = await store.configureProjectTeam({ projectId: project.id, teamId: team.id, teamVersion: team.version, templateVersions });
    const repository = new WorkflowRepository(store);
    const definition = await repository.saveDefinition({ projectId: project.id, projectTeamId: installed.id, expectedVersion: 0,
      workflow: { id: 'legacy-flow', templateWorkflowId: 'legacy-source', name: '历史结构化流程', steps: [{ id: 'legacy-step', name: '历史步骤', employeeId: installed.members[0]!.employeeId, instruction: '保留历史结构化任务' }] } });
    const flow = await repository.start({ projectId: project.id, projectTeamId: installed.id, workflowId: definition.id, workflowVersion: definition.version!, requestId: 'historical-flow-fixture', request: '历史流程' });
    await repository.advance(flow.id);
    const structured = store.snapshot().runs.find(run => run.workflow?.workflowRunId === flow.id)!;
    await store.updateRun(structured.id, { sessionId: 'legacy-structured-workflow' });
    await repository.control({ projectId: project.id, id: flow.id, commandId: 'historical-flow-stop', expectedVersion: store.snapshot().workflowRuns!.find(entry => entry.id === flow.id)!.version, action: 'cancel' });
    history.push(store.snapshot().runs.find(run => run.id === structured.id)!);
    const work = new WorkService(store);
    await work.command('work.saveBrief', { projectId: project.id, goal: '保留历史工作台任务', completionCriteria: ['保留原记录'] });
    const task = await work.command('work.saveTask', { projectId: project.id, employeeId: original.id, title: '历史任务', goal: '历史任务验证', acceptanceCriteria: ['保留任务记录'] }) as WorkTask;
    await work.command('work.startTask', { projectId: project.id, id: task.id });
    const workRun = store.snapshot().runs.find(run => run.workTaskId === task.id)!;
    await store.updateRun(workRun.id, { sessionId: 'legacy-structured-task' });
    await work.command('work.cancelTask', { projectId: project.id, id: task.id });
    history.push(store.snapshot().runs.find(run => run.id === workRun.id)!);
    if (options.blockedHistory) {
      let blocked = await store.createRun({ projectId: project.id, employeeId: original.id, request: '保留尚未结束的原任务' });
      blocked = await store.updateRun(blocked.id, { sessionId: 'legacy-blocked', status: 'running' });
      history.push(await store.updateRun(blocked.id, { status: 'blocked', error: '等待人工解决原有阻塞' }));
    }
  }
  if (options.modernHistory || options.activeModernHistory) {
    const selected = await store.selectConversationWorkflow({ projectId: project.id, sessionId: 'chat-a', workflowTemplateId: workflow.id,
      workflowTemplateVersion: workflow.version, templateVersions }, { expectedRevision: store.snapshot().revision });
    let ownerRun = await store.createRun({ projectId: project.id, employeeId: selected.owner!.id, request: '已有原生工作流负责人交付',
      conversationWorkflow: { instanceId: selected.instanceId!, stepId: selected.currentStepId! } });
    ownerRun = await store.updateRun(ownerRun.id, { sessionId: 'chat-a', status: 'running' });
    history.push(options.activeModernHistory ? await store.updateRun(ownerRun.id, { status: 'blocked', error: '受控验证：当前负责人仍在处理' })
      : await store.updateRun(ownerRun.id, { status: 'awaiting-review', output: '保留原生对话产生的交付，等待人工验收' }));
  }
  if (options.pausedLegacyFlow) {
    const installed = await store.configureProjectTeam({ projectId: project.id, teamId: team.id, teamVersion: team.version, templateVersions });
    const repository = new WorkflowRepository(store);
    const definition = await repository.saveDefinition({ projectId: project.id, projectTeamId: installed.id, expectedVersion: 0,
      workflow: { id: 'paused-chat-flow', templateWorkflowId: 'paused-chat-source', name: '历史暂停流程', steps: [{ id: 'paused-step', name: '历史待执行步骤', employeeId: installed.members[0]!.employeeId, instruction: '不应自动执行' }] } });
    const flow = await repository.start({ projectId: project.id, projectTeamId: installed.id, workflowId: definition.id,
      workflowVersion: definition.version!, requestId: 'paused-chat-flow-fixture', request: '旧流程仅允许取消' });
    await repository.control({ projectId: project.id, id: flow.id, commandId: 'pause-before-fixture-start', expectedVersion: flow.version, action: 'pause' });
  }
  let workspaces = [{ id: project.id, title: project.name, path: project.rootPath, sessionIds: [...new Set(['chat-a', 'chat-b', ...history.map(run => run.sessionId!)])] },
    { id: other.id, title: other.name, path: other.rootPath, sessionIds: ['foreign-chat'] }];
  const runningSessions = new Set<string>();
  const queuedIdleSessions = new Map<string, 'nextTurn' | 'nextStep'>();
  const approvalNotices = new Set<string>();
  const approvalNotice = { id: 'permission-notice', role: 'user', source: { kind: 'user-approval' }, content: [{ type: 'text', text: 'The approval policy changed (changed by the user).' }] };
  let handler: ((req: IncomingMessage, res: ServerResponse) => void | Promise<void>) | undefined;
  const server = createServer((req, res) => { if (!handler) { res.writeHead(503).end(); return; }
    void Promise.resolve(handler(req, res)).catch(error => res.writeHead(500).end(String(error))); });
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const address = server.address(); assert.ok(address && typeof address !== 'string'); const origin = `http://127.0.0.1:${address.port}`;
  const ctx = new Context();
  ctx.provide('webServer', { port: address.port, register(route: { handler: typeof handler }) { handler = route.handler; return () => { handler = undefined; }; } } as never);
  ctx.provide('connection', { admit: () => ({}) } as never);
  ctx.provide('workspaceRegistry', { list: () => workspaces, get: (id: string) => workspaces.find(entry => entry.id === id) } as never);
  ctx.provide('agents', { get: (id: string) => runningSessions.has(id) ? { status: 'running' }
    : queuedIdleSessions.has(id) ? { status: 'idle', inbox: { nextTurn: queuedIdleSessions.get(id) === 'nextTurn' ? ['queued-input'] : [], nextStep: queuedIdleSessions.get(id) === 'nextStep' ? ['queued-input'] : [] } }
      : approvalNotices.has(id) ? { status: 'idle', inbox: { nextTurn: [], nextStep: [approvalNotice] } }
      : undefined, list: () => { if (options.failRuntimeCleanup) throw new Error('fixture runtime cleanup failure'); return []; }, values: () => [] } as never);
  ctx.provide('sessionController', { modelCatalog: async () => ({ groups: [], failures: [] }) } as never);
  ctx.provide('skills', { register: () => () => undefined, list: async () => [] } as never);
  ctx.provide('tools', { schemas: () => [], guard: () => () => undefined } as never);
  ctx.provide('systemPrompt', { context: () => () => undefined } as never);
  t.after(async () => { await ctx.fiber.dispose(); server.closeAllConnections(); await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())); await rm(root, { recursive: true, force: true }); });
  hostCleanupRegistered = true;
  await apply(ctx, { statePath: file, skillsDirectory: resolve('skills') });
  const state = async (): Promise<WorkforceState> => { const response = await fetch(`${origin}/digital-workers/api/state`); assert.equal(response.status, 200); return response.json() as Promise<WorkforceState>; };
  const view = async (sessionId: string) => {
    const response = await fetch(`${origin}/digital-workers/api/conversation-workflow?sessionId=${encodeURIComponent(sessionId)}`);
    return { status: response.status, body: await response.json() as Omit<ConversationWorkflowView, 'projectId'> & { projectId: string | null; revision: number; busy?: boolean; progressBusy?: boolean; workflowEnabled?: boolean; sessionHandoffRequired?: boolean; employeeSessionOwned?: boolean; error?: string } };
  };
  const command = async (action: string, payload: unknown, options: unknown) => {
    const response = await fetch(`${origin}/digital-workers/api/command`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, payload, options }) });
    return { status: response.status, body: await response.json() as { result: ConversationWorkflowView & { sessionReopened?: boolean }; state: WorkforceState; error?: string; code?: string } };
  };
  const select = async (sessionId = 'chat-a', workflowTemplateId: string | null = workflow.id, projectId = project.id, revision?: number) => command('conversation.workflow.select',
    { projectId, sessionId, workflowTemplateId, workflowTemplateVersion: workflow.version, templateVersions }, { expectedRevision: revision ?? (await state()).revision });
  const details = async (sessionId = 'chat-a', query: Record<string, string> = {}) => {
    const response = await fetch(`${origin}/digital-workers/api/conversation-workflow/details?${new URLSearchParams({ sessionId, ...query })}`);
    return { status: response.status, body: await response.json() as ConversationWorkflowDetails & { error?: string } };
  };
  const review = async (input: ConversationWorkflowReviewInput) => {
    const response = await fetch(`${origin}/digital-workers/api/conversation-workflow/review`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    return { status: response.status, body: await response.json() as ConversationWorkflowDetails & { error?: string; code?: string } };
  };
  const run = async (payload: unknown) => {
    const response = await fetch(`${origin}/digital-workers/api/run`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return { status: response.status, body: await response.json() as { run?: WorkforceRun; error?: string } };
  };
  return { root, file, origin, project, other, architect, workflow, history, state, view, select, command, details, review, run,
    dispose: () => ctx.fiber.dispose(),
    setRunning(sessionId: string, value: boolean) { if (value) runningSessions.add(sessionId); else runningSessions.delete(sessionId); },
    setQueuedIdle(sessionId: string, lane?: 'nextTurn' | 'nextStep') { if (lane) queuedIdleSessions.set(sessionId, lane); else queuedIdleSessions.delete(sessionId); },
    setApprovalNotice(sessionId: string) { approvalNotices.add(sessionId); return approvalNotice; },
    duplicateSession() { workspaces = workspaces.map(entry => entry.id === other.id ? { ...entry, sessionIds: [...entry.sessionIds, 'chat-a'] } : entry); },
    removeWorkspace: () => { workspaces = workspaces.filter(entry => entry.id !== project.id); } };
}

test('plugin disposal awaits archive shutdown even when an earlier runtime cleanup fails', async t => {
  const original = KnowledgeEngine.prototype.dispose;
  let entered = false; let released = false;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(KnowledgeEngine.prototype, 'dispose', async function (this: KnowledgeEngine) {
    entered = true; await gate; released = true; await original.call(this);
  });
  const f = await fixture(t, { failRuntimeCleanup: true });
  assert.equal((await f.select()).status, 200, 'selection admits local employee archives before teardown');
  let settled = false;
  const closing = f.dispose().then(() => { settled = true; });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(entered, true, 'a failing context cleanup must not skip the archive disposer');
    assert.equal(settled, false, 'fiber disposal must wait for all owned archive writes');
  } finally { release(); await closing; }
  assert.equal(released, true);
  await rm(f.root, { recursive: true, force: true });
  await new Promise(resolve => setTimeout(resolve, 30));
  await assert.rejects(access(f.root), { code: 'ENOENT' }, 'no background archive writer may recreate the removed plugin directory');
});

test('production conversation routes derive the native project and preserve default inheritance and explicit none', async t => {
  const f = await fixture(t); const initial = await f.view('chat-a');
  assert.equal(initial.status, 200, initial.body.error); assert.equal(initial.body.projectId, f.project.id); assert.equal(initial.body.instanceId, null);
  assert.ok(initial.body.choices.some(choice => choice.id === f.workflow.id && choice.available));
  const priorNone = await f.select('chat-b', null); assert.equal(priorNone.status, 200); assert.equal(priorNone.body.result.instanceId, null);
  const selected = await f.select(); assert.equal(selected.status, 200, selected.body.error);
  assert.equal(selected.body.result.name, '软件工程'); assert.equal(selected.body.result.owner!.templateId, f.architect.id);
  const inherited = await f.view('chat-b'); assert.equal(inherited.body.instanceId, selected.body.result.instanceId); assert.equal(inherited.body.selection, 'inherit');
  assert.equal((await f.view('foreign-chat')).body.instanceId, null);
  const none = await f.select('chat-b', null); assert.equal(none.status, 200); assert.equal(none.body.result.instanceId, null);
  assert.equal((await f.view('chat-a')).body.instanceId, selected.body.result.instanceId);
  assert.equal((await f.view('chat-b')).body.selection, 'override');
  assert.equal((await f.state()).runs.length, 0, 'selection installs snapshots but never invokes a model');
});

test('Chat directory excludes workflow service even with a retained default while preserving native project scope for mentions', async t => {
  const f = await fixture(t, { chatWorkspace: true, modernHistory: true });
  const before = await readFile(f.file, 'utf8'); const state = await f.state();
  assert.ok(state.conversationWorkflows?.defaults.some(entry => entry.projectId === f.project.id), 'fixture retains a previously installed default');
  const view = await f.view('chat-a');
  assert.equal(view.status, 200, view.body.error);
  assert.equal(view.body.workflowEnabled, false);
  assert.equal(view.body.projectId, f.project.id, 'Chat keeps its native project identity for explicit employee mentions');
  assert.equal(view.body.instanceId, null);
  assert.equal(view.body.owner, undefined);
  assert.deepEqual(view.body.steps, []);
  assert.deepEqual(view.body.choices, []);
  assert.equal(view.body.sessionHandoffRequired, false);
  assert.equal(view.body.employeeSessionOwned, false);
  const inherited = await f.view('chat-b');
  assert.equal(inherited.body.workflowEnabled, false);
  assert.equal(inherited.body.instanceId, null, 'another conversation cannot inherit the retained default');
  const details = await f.details('chat-a');
  assert.equal(details.status, 200, details.body.error);
  assert.equal(details.body.instanceId, null);
  assert.deepEqual(details.body.steps, []);
  assert.deepEqual(details.body.history, []);
  const scope = await fetch(`${f.origin}/digital-workers/api/session-project?sessionId=chat-a`);
  assert.equal(scope.status, 200);
  assert.deepEqual(await scope.json(), { projectId: f.project.id, standaloneOnly: true });
  const foreignScope = await fetch(`${f.origin}/digital-workers/api/session-project?sessionId=foreign-chat`);
  assert.deepEqual(await foreignScope.json(), { projectId: f.other.id }, 'Chat policy cannot leak into another workspace');
  const missingScope = await fetch(`${f.origin}/digital-workers/api/session-project?sessionId=unknown-chat`);
  assert.deepEqual(await missingScope.json(), { projectId: null });
  assert.equal(await readFile(f.file, 'utf8'), before, 'policy projection does not delete old installs, deliveries or selections');
  f.duplicateSession();
  assert.notEqual((await f.view('chat-a')).status, 200, 'ambiguous membership still fails closed instead of being treated as Chat');
  assert.notEqual((await fetch(`${f.origin}/digital-workers/api/session-project?sessionId=chat-a`)).status, 200);
  assert.equal(await readFile(f.file, 'utf8'), before);
});

test('Chat composer ownership includes an unfinished native handoff but excludes unrelated workflow children', async t => {
  t.mock.method(WorkforceRuntime.prototype, 'ownsSession', (sessionId: string) => ['chat-a', 'legacy-child'].includes(sessionId));
  t.mock.method(WorkforceRuntime.prototype, 'needsCompletedSessionHandoff', (sessionId: string) => sessionId === 'legacy-failed');
  const f = await fixture(t, { chatWorkspace: true, legacyHistory: true });
  const before = await readFile(f.file, 'utf8');
  assert.equal((await f.view('chat-a')).body.employeeSessionOwned, true);
  const pending = (await f.view('legacy-failed')).body;
  assert.equal(pending.employeeSessionOwned, true, 'a disposed employee whose native resume failed must keep input blocked until retry succeeds');
  assert.equal(pending.sessionHandoffRequired, true); assert.equal(pending.workflowEnabled, false);
  assert.equal((await f.view('legacy-child')).body.employeeSessionOwned, false);
  assert.equal((await f.view('chat-b')).body.employeeSessionOwned, false);
  assert.equal(await readFile(f.file, 'utf8'), before, 'ownership projection never rewrites history or configuration');
});

test('Chat workflow mutation and review endpoints reject retained configuration without changing user state', async t => {
  const f = await fixture(t, { chatWorkspace: true, modernHistory: true });
  const state = await f.state(); const instance = state.conversationWorkflows!.instances[0]!;
  const run = f.history.find(entry => entry.conversationWorkflow)!;
  const before = await readFile(f.file, 'utf8');
  const team = state.projectTeams![0]!; const definition = team.workflows[0]!;
  for (const result of [
    await f.command('workflow.save', { projectId: f.project.id, projectTeamId: team.id, expectedVersion: definition.version,
      workflow: { ...definition, name: '不得保存到Chat的流程' } }, {}),
    await f.command('workflow.start', { projectId: f.project.id, projectTeamId: team.id, workflowId: definition.id,
      workflowVersion: definition.version, requestId: 'forbidden-chat-start', request: '不得在Chat运行' }, {}),
    await f.select('chat-a'),
    await f.select('chat-a', null),
    await f.command('conversation.workflow.step', { projectId: f.project.id, sessionId: 'chat-a', stepId: 'build', instanceVersion: instance.version }, { expectedRevision: state.revision }),
    await f.command('conversation.workflow.resume', { projectId: f.project.id, sessionId: 'chat-a' }, {}),
    await f.review({ projectId: f.project.id, sessionId: 'chat-a', instanceId: instance.id, instanceVersion: instance.version,
      stepId: instance.currentStepId!, runId: run.id, runVersion: run.version, decision: 'accepted', expectedRevision: state.revision }),
  ]) {
    assert.notEqual(result.status, 200, 'Chat cannot opt back into workflow service through a direct API request');
    assert.match(result.body.error ?? '', /Chat.*工作流|工作流.*Chat/);
  }
  assert.equal(await readFile(f.file, 'utf8'), before);
  assert.deepEqual((await f.state()).runs, state.runs, 'old deliverables remain audit history rather than being accepted or cancelled');
});

test('Chat rejects resuming a legacy structured workflow but permits explicit cancellation without creating work', async t => {
  const f = await fixture(t, { chatWorkspace: true, pausedLegacyFlow: true });
  const initial = await f.state(); const flow = initial.workflowRuns!.find(entry => entry.workflowId === 'paused-chat-flow')!;
  assert.equal(flow.status, 'paused'); assert.equal(initial.runs.length, 0);
  const before = await readFile(f.file, 'utf8');
  const resumed = await f.command('workflow.control', { projectId: f.project.id, id: flow.id,
    commandId: 'forbidden-chat-resume', expectedVersion: flow.version, action: 'resume' }, {});
  assert.notEqual(resumed.status, 200);
  assert.match(resumed.body.error ?? '', /Chat.*工作流|工作流.*Chat/);
  assert.equal(await readFile(f.file, 'utf8'), before);
  const input = { projectId: f.project.id, id: flow.id, commandId: 'cancel-legacy-chat-flow', expectedVersion: flow.version, action: 'cancel' };
  const cancelled = await f.command('workflow.control', input, {});
  assert.equal(cancelled.status, 200, cancelled.body.error);
  const after = await f.state();
  assert.equal(after.workflowRuns!.find(entry => entry.id === flow.id)!.status, 'cancelled');
  assert.equal(after.runs.length, 0, 'cancelling a retained legacy flow must not start an employee or model');
  assert.equal((await f.command('workflow.control', input, {})).status, 200, 'the cancel receipt remains replayable');
  const replayed = await f.state();
  assert.deepEqual(replayed.workflowRuns, after.workflowRuns, 'retry does not duplicate workflow events or change cancellation');
  assert.deepEqual(replayed.runs, after.runs);
});

test('fresh Chat template mentions create one standalone employee only on explicit run admission and reuse it', async t => {
  const admitted: RunRequest[] = [];
  t.mock.method(WorkforceRuntime.prototype, 'start', async (input: RunRequest) => {
    admitted.push(structuredClone(input));
    return { id: `captured-${admitted.length}`, projectId: input.projectId, employeeId: input.employeeId, status: 'queued' } as WorkforceRun;
  });
  const f = await fixture(t, { chatWorkspace: true }); const before = await f.state();
  assert.equal(before.employees.length, 0);
  const input = { projectId: f.project.id, templateId: f.architect.id, sourceSessionId: 'chat-a', request: '显式交给该自由职业人' };
  const first = await f.run(input); assert.equal(first.status, 202, first.body.error);
  const created = await f.state();
  assert.equal(created.employees.length, 1);
  const employee = created.employees[0]!;
  assert.equal(employee.templateId, f.architect.id); assert.equal(employee.projectId, f.project.id);
  assert.equal(employee.teamInstanceId, undefined); assert.equal(employee.managerId, undefined);
  assert.deepEqual(employee.modules, f.architect.modules);
  assert.deepEqual(created.projectTeams, before.projectTeams);
  assert.deepEqual(created.conversationWorkflows, before.conversationWorkflows);
  assert.equal((await f.run({ ...input, request: '再次明确调用相同员工' })).status, 202);
  assert.equal((await f.state()).employees.length, 1);
  assert.equal(admitted.length, 2);
  assert.ok(admitted.every(entry => entry.employeeId === employee.id && entry.sourceSessionId === 'chat-a'));
  assert.ok(admitted.every(entry => !entry.conversationWorkflow && !entry.workflow), 'explicit mentions never acquire workflow ownership');
});

test('Chat template admission avoids old workflow members and preserves standalone employee custom configuration', async t => {
  const admitted: RunRequest[] = [];
  t.mock.method(WorkforceRuntime.prototype, 'start', async (input: RunRequest) => {
    admitted.push(structuredClone(input));
    return { id: `captured-${admitted.length}`, projectId: input.projectId, employeeId: input.employeeId, status: 'queued' } as WorkforceRun;
  });
  const f = await fixture(t, { chatWorkspace: true, modernHistory: true });
  const before = await f.state(); const teamMember = before.employees.find(employee => employee.templateId === f.architect.id && employee.teamInstanceId)!;
  assert.ok(teamMember);
  const beforeRejected = await readFile(f.file, 'utf8');
  assert.notEqual((await f.run({ projectId: f.project.id, employeeId: teamMember.id, sourceSessionId: 'chat-a', request: '不允许自动调用流程成员' })).status, 202);
  assert.equal(await readFile(f.file, 'utf8'), beforeRejected);
  assert.equal(admitted.length, 0);
  const input = { projectId: f.project.id, templateId: f.architect.id, sourceSessionId: 'chat-a', request: '仅调用独立自由职业人' };
  assert.equal((await f.run(input)).status, 202);
  const created = await f.state();
  const standalone = created.employees.find(employee => employee.templateId === f.architect.id && !employee.teamInstanceId && !employee.managerId)!;
  assert.ok(standalone); assert.notEqual(standalone.id, teamMember.id);
  const modules = structuredClone(standalone.modules); modules.responsibilities.mission = '保留这个独立员工的项目专属职责';
  const updated = await f.command('employee.update', { id: standalone.id, input: { name: '自定义独立员工', modules } }, { expectedVersion: standalone.version });
  assert.equal(updated.status, 200, updated.body.error);
  assert.equal((await f.run(input)).status, 202);
  const after = await f.state(); const kept = after.employees.find(employee => employee.id === standalone.id)!;
  assert.equal(after.employees.length, created.employees.length);
  assert.equal(kept.name, '自定义独立员工'); assert.deepEqual(kept.modules, modules);
  assert.ok(admitted.every(entry => entry.employeeId === standalone.id));
  assert.deepEqual(after.projectTeams, before.projectTeams); assert.deepEqual(after.conversationWorkflows, before.conversationWorkflows);
});

test('template mention admission rejects invalid identity, source ownership and unavailable templates before any write', async t => {
  const admitted: RunRequest[] = [];
  t.mock.method(WorkforceRuntime.prototype, 'start', async (input: RunRequest) => {
    admitted.push(structuredClone(input));
    return { id: 'unexpected-run', projectId: input.projectId, employeeId: input.employeeId, status: 'queued' } as WorkforceRun;
  });
  const f = await fixture(t, { chatWorkspace: true });
  for (const [name, status] of [['未启用自由职业人', 'draft'], ['已归档自由职业人', 'archived']] as const) {
    const response = await f.command('template.save', { name, status, modules: f.architect.modules }, {});
    assert.equal(response.status, 200, response.body.error);
  }
  const initial = await f.state(); const before = await readFile(f.file, 'utf8');
  const base = { projectId: f.project.id, templateId: f.architect.id, sourceSessionId: 'chat-a', request: '不得错误产生工作单' };
  const { templateId: _template, ...withoutIdentity } = base;
  for (const payload of [
    { ...base, employeeId: 'another-identity' }, withoutIdentity,
    { ...base, sourceSessionId: 'foreign-chat' }, { ...base, sourceSessionId: 'unknown-chat' },
    { ...base, sourceSessionId: undefined }, { ...base, parentRunId: 'forged-parent' },
    { ...base, projectId: f.other.id, sourceSessionId: 'foreign-chat' },
    ...initial.templates.filter(template => ['draft', 'archived'].includes(template.status)).map(template => ({ ...base, templateId: template.id })),
  ]) {
    const response = await f.run(payload);
    assert.notEqual(response.status, 202, JSON.stringify(payload));
    assert.ok(response.body.error);
    assert.equal(await readFile(f.file, 'utf8'), before, 'invalid mention cannot create an employee, workflow or work order');
  }
  assert.equal(admitted.length, 0);
});

test('display title Chat does not disable workflows for another real project directory', async t => {
  const f = await fixture(t, { projectTitle: 'Chat' });
  const view = await f.view('chat-a');
  assert.equal(view.body.workflowEnabled, true);
  assert.ok(view.body.choices.some(choice => choice.id === f.workflow.id));
  assert.equal((await f.select()).status, 200);
  const scope = await fetch(`${f.origin}/digital-workers/api/session-project?sessionId=chat-a`);
  assert.deepEqual(await scope.json(), { projectId: f.project.id });
});

test('production conversation commands require native session ownership and CAS before any write', async t => {
  const f = await fixture(t); const current = await f.state(); const before = await readFile(f.file, 'utf8');
  const unbound = await f.view('unknown-chat'); assert.equal(unbound.status, 200); assert.equal(unbound.body.projectId, null); assert.deepEqual(unbound.body.choices, []);
  assert.notEqual((await f.select('foreign-chat')).status, 200, 'a native session from another project must not be accepted');
  assert.notEqual((await f.select('unknown-chat')).status, 200);
  const stale = await f.select('chat-a', f.workflow.id, f.project.id, current.revision - 1);
  assert.equal(stale.status, 409); assert.equal(stale.body.code, 'CONFLICT');
  assert.equal(await readFile(f.file, 'utf8'), before);
  const selected = await f.select(); assert.equal(selected.status, 200, selected.body.error);
  const view = (await f.view('chat-a')).body;
  const wrongProject = await f.command('conversation.workflow.step', { projectId: f.other.id, sessionId: 'chat-a', stepId: 'build', instanceVersion: view.instanceVersion }, { expectedRevision: view.revision });
  assert.notEqual(wrongProject.status, 200);
  const selectedBefore = await readFile(f.file, 'utf8'); f.removeWorkspace();
  assert.notEqual((await f.select('chat-a', null)).status, 200);
  assert.equal(await readFile(f.file, 'utf8'), selectedBefore);
});

test('production shared step selection updates every inheriting conversation without fabricating acceptance', async t => {
  const f = await fixture(t); const selected = await f.select(); assert.equal(selected.status, 200, selected.body.error);
  const view = (await f.view('chat-b')).body;
  const next = await f.command('conversation.workflow.step', { projectId: f.project.id, sessionId: 'chat-b', stepId: 'build', instanceVersion: view.instanceVersion }, { expectedRevision: view.revision });
  assert.equal(next.status, 200, next.body.error); assert.equal(next.body.result.owner!.name, '开发人员');
  const first = (await f.view('chat-a')).body; assert.equal(first.currentStepId, 'build'); assert.deepEqual(first.steps.map(step => step.status), ['pending', 'current']);
  const current = await f.state(); assert.deepEqual(current.conversationWorkflows!.instances[0]!.completions, []); assert.equal(current.runs.length, 0);
  const stale = await f.command('conversation.workflow.step', { projectId: f.project.id, sessionId: 'chat-a', stepId: 'plan', instanceVersion: view.instanceVersion }, { expectedRevision: current.revision });
  assert.equal(stale.status, 409);
});

test('native Agent execution locks workflow and step mutation until the official turn is idle', async t => {
  const f = await fixture(t); assert.equal((await f.select()).status, 200);
  const current = (await f.view('chat-a')).body; const before = await readFile(f.file, 'utf8');
  f.setRunning('chat-a', true);
  assert.equal((await f.view('chat-a')).body.busy, true);
  assert.notEqual((await f.select('chat-a', null)).status, 200);
  assert.notEqual((await f.command('conversation.workflow.step', { projectId: f.project.id, sessionId: 'chat-a', stepId: 'build', instanceVersion: current.instanceVersion }, { expectedRevision: current.revision })).status, 200);
  assert.equal(await readFile(f.file, 'utf8'), before);
  f.setRunning('chat-a', false); assert.equal((await f.view('chat-a')).body.busy, false);
  assert.equal((await f.select('chat-a', null)).status, 200);
});

test('another conversation running the shared workflow locks progress but leaves the idle conversation picker available', async t => {
  const f = await fixture(t, { activeModernHistory: true });
  f.setRunning('chat-a', true);
  const active = (await f.view('chat-a')).body;
  const idle = (await f.view('chat-b')).body;
  assert.equal(active.busy, true);
  assert.equal(idle.instanceId, active.instanceId);
  assert.equal(idle.busy, false, 'an unrelated native turn cannot disable this conversation picker');
  assert.equal(active.progressBusy, true);
  assert.equal(idle.progressBusy, true, 'shared progress still cannot change underneath a running owner');
  assert.notEqual((await f.command('conversation.workflow.step', { projectId: f.project.id, sessionId: 'chat-b', stepId: 'build', instanceVersion: idle.instanceVersion }, { expectedRevision: idle.revision })).status, 200);
  assert.notEqual((await f.select('chat-a', null)).status, 200, 'the executing conversation keeps its frozen owner');
  assert.equal((await f.select('chat-b', null)).status, 200);
  const restored = await f.select('chat-b');
  assert.equal(restored.status, 200, restored.body.error);
  assert.equal(restored.body.result.instanceId, active.instanceId);
  assert.equal(restored.body.result.owner?.id, active.owner?.id, 'reselection reuses the installed owner and history');
  const after = await f.state();
  assert.deepEqual(after.runs, f.history, 'picker changes cannot cancel or rewrite another conversation run');
  assert.equal(after.conversationWorkflows?.instances.length, 1);
});

test('an idle native Agent with queued turn or step messages locks selection, resume and shared step changes', async t => {
  const f = await fixture(t); assert.equal((await f.select()).status, 200);
  const current = (await f.view('chat-a')).body; const before = await readFile(f.file, 'utf8');
  for (const lane of ['nextTurn', 'nextStep'] as const) {
    f.setQueuedIdle('chat-a', lane);
    const queued = await f.view('chat-a');
    assert.equal(queued.status, 200, queued.body.error); assert.equal(queued.body.busy, true, lane);
    assert.notEqual((await f.select('chat-a', null)).status, 200, lane);
    assert.notEqual((await f.command('conversation.workflow.resume', { projectId: f.project.id, sessionId: 'chat-a' }, {})).status, 200, lane);
    assert.notEqual((await f.command('conversation.workflow.step', { projectId: f.project.id, sessionId: 'chat-a', stepId: 'build', instanceVersion: current.instanceVersion }, { expectedRevision: current.revision })).status, 200, lane);
    assert.equal(await readFile(f.file, 'utf8'), before, `${lane} cannot change workflow settings, progress or delivery history`);
  }
  f.setQueuedIdle('chat-a');
  assert.equal((await f.view('chat-a')).body.busy, false);
  assert.equal((await f.select('chat-a', null)).status, 200);
});

test('an idle native permission notice does not lock workflow selection or step changes', async t => {
  const f = await fixture(t); assert.equal((await f.select()).status, 200);
  const notice = f.setApprovalNotice('chat-a'); const before = structuredClone(notice);
  const current = (await f.view('chat-a')).body; assert.equal(current.busy, false);
  const changed = await f.command('conversation.workflow.step', { projectId: f.project.id, sessionId: 'chat-a', stepId: 'build', instanceVersion: current.instanceVersion }, { expectedRevision: current.revision });
  assert.equal(changed.status, 200, changed.body.error); assert.equal(changed.body.result.currentStepId, 'build');
  assert.equal((await f.select('chat-a', null)).status, 200);
  assert.deepEqual(notice, before, 'permission context must stay queued for its next real model step');
  assert.equal((await f.state()).runs.length, 0, 'permission changes and workflow selection must not execute a model');
});

test('ambiguous native workspace membership cannot read a different project or mutate a selection', async t => {
  const f = await fixture(t); const before = await readFile(f.file, 'utf8'); f.duplicateSession();
  assert.notEqual((await f.view('chat-a')).status, 200);
  assert.notEqual((await f.select()).status, 200);
  assert.equal(await readFile(f.file, 'utf8'), before);
});

test('restored stopped legacy root conversations expose workflow choices without altering their existing deliveries', async t => {
  const f = await fixture(t, { legacyHistory: true }); const before = await f.state();
  assert.deepEqual(before.runs, f.history, 'startup must preserve historical deliveries and pending reviews');
  for (const sessionId of ['chat-a', 'legacy-succeeded', 'legacy-failed', 'legacy-cancelled', 'legacy-parent']) {
    const initial = await f.view(sessionId);
    assert.equal(initial.status, 200, initial.body.error); assert.equal(initial.body.projectId, f.project.id, sessionId);
    assert.ok(initial.body.choices.some(choice => choice.id === f.workflow.id && choice.available), sessionId);
  }
  const selected = await f.select('chat-a'); assert.equal(selected.status, 200, selected.body.error);
  const shared = (await f.view('chat-b')).body;
  assert.equal(shared.instanceId, selected.body.result.instanceId); assert.equal(shared.selection, 'inherit');
  const after = await f.state();
  assert.deepEqual(after.runs, before.runs, 'adopting the workflow must not accept, cancel, edit or remove any old delivery');
  assert.deepEqual(after.workflowRuns, before.workflowRuns); assert.deepEqual(after.workState, before.workState);
  const none = await f.select('legacy-failed', null); assert.equal(none.status, 200);
  assert.deepEqual((await f.state()).runs, before.runs);
});

test('a legacy root Agent still executing cannot switch workflow even though its history remains intact', async t => {
  const f = await fixture(t, { legacyHistory: true }); const before = await readFile(f.file, 'utf8');
  f.setRunning('chat-a', true);
  assert.notEqual((await f.select('chat-a')).status, 200);
  assert.equal(await readFile(f.file, 'utf8'), before);
  f.setRunning('chat-a', false);
  const resumed = await f.select('chat-a'); assert.equal(resumed.status, 200, resumed.body.error);
  assert.deepEqual((await f.state()).runs, f.history);
});

test('generated children and structured workflow/work-task deliveries remain excluded after they stop', async t => {
  const f = await fixture(t, { legacyHistory: true }); const before = await readFile(f.file, 'utf8');
  for (const sessionId of ['legacy-child', 'legacy-structured-workflow', 'legacy-structured-task']) {
    const excluded = await f.view(sessionId);
    assert.equal(excluded.status, 200, excluded.body.error); assert.equal(excluded.body.projectId, null, sessionId); assert.deepEqual(excluded.body.choices, []);
    assert.notEqual((await f.select(sessionId)).status, 200, sessionId);
  }
  assert.equal(await readFile(f.file, 'utf8'), before, 'excluded generated sessions must not mutate selection, installs or historical records');
});

test('explicit resume of a restored stopped root is a read-only no-op when no owned Agent needs handoff', async t => {
  const f = await fixture(t, { legacyHistory: true });
  const initial = (await f.view('chat-a')).body;
  assert.equal(initial.sessionHandoffRequired, false);
  let before = await readFile(f.file, 'utf8');
  const restored = await f.command('conversation.workflow.resume', { projectId: f.project.id, sessionId: 'chat-a' }, {});
  assert.equal(restored.status, 200, restored.body.error); assert.equal(restored.body.result.sessionReopened, false);
  assert.equal(await readFile(f.file, 'utf8'), before, 'resuming cannot create defaults, overrides, runs or acceptance records');
  assert.equal((await f.select('chat-b')).status, 200);
  assert.equal((await f.select('legacy-failed', null)).status, 200);
  before = await readFile(f.file, 'utf8');
  const selected = await f.command('conversation.workflow.resume', { projectId: f.project.id, sessionId: 'chat-a' }, {});
  assert.equal(selected.status, 200, selected.body.error); assert.equal(selected.body.result.sessionReopened, false);
  assert.equal(await readFile(f.file, 'utf8'), before, 'an existing project default and another chat override remain exactly unchanged');
  assert.deepEqual((await f.state()).runs, f.history);
});

test('resume requires official project ownership and rejects busy or generated sessions without mutating history', async t => {
  const f = await fixture(t, { legacyHistory: true }); const before = await readFile(f.file, 'utf8');
  for (const sessionId of ['unknown-chat', 'foreign-chat', 'legacy-child', 'legacy-structured-workflow', 'legacy-structured-task']) {
    const result = await f.command('conversation.workflow.resume', { projectId: f.project.id, sessionId }, {});
    assert.notEqual(result.status, 200, sessionId);
  }
  f.setRunning('chat-a', true);
  const busy = await f.command('conversation.workflow.resume', { projectId: f.project.id, sessionId: 'chat-a' }, {});
  assert.notEqual(busy.status, 200);
  assert.equal(await readFile(f.file, 'utf8'), before);
  assert.deepEqual((await f.state()).runs, f.history, 'rejected handoffs cannot cancel or accept an existing delivery');
});

test('an unfinished blocked legacy root is still an active delivery rather than a convertible native conversation', async t => {
  const f = await fixture(t, { legacyHistory: true, blockedHistory: true }); const before = await readFile(f.file, 'utf8');
  const blocked = await f.view('legacy-blocked');
  assert.equal(blocked.status, 200, blocked.body.error); assert.equal(blocked.body.projectId, null); assert.deepEqual(blocked.body.choices, []);
  assert.notEqual((await f.select('legacy-blocked')).status, 200);
  assert.notEqual((await f.command('conversation.workflow.resume', { projectId: f.project.id, sessionId: 'legacy-blocked' }, {})).status, 200);
  assert.equal(await readFile(f.file, 'utf8'), before);
  assert.deepEqual((await f.state()).runs, f.history);
});

test('legacy and native workflow root history in the same chat never permanently blocks normal workflow selection', async t => {
  const f = await fixture(t, { legacyHistory: true, modernHistory: true }); const before = await f.state();
  const view = await f.view('chat-a');
  assert.equal(view.status, 200, view.body.error); assert.equal(view.body.projectId, f.project.id);
  assert.equal(view.body.sessionHandoffRequired, false); assert.ok(view.body.instanceId);
  assert.equal(before.runs.filter(run => run.sessionId === 'chat-a').length, 2);
  const none = await f.select('chat-a', null);
  assert.equal(none.status, 200, none.body.error); assert.equal(none.body.result.instanceId, null); assert.equal(none.body.result.sessionReopened, false);
  assert.deepEqual((await f.state()).runs, before.runs);
  const selected = await f.select('chat-a');
  assert.equal(selected.status, 200, selected.body.error); assert.equal(selected.body.result.instanceId, view.body.instanceId);
  const after = await f.state();
  assert.deepEqual(after.runs, before.runs, 'old and current pending human reviews both retain their original output and status');
  assert.deepEqual(after.workflowRuns, before.workflowRuns); assert.deepEqual(after.workState, before.workState);
  assert.deepEqual(after.conversationWorkflows!.instances, before.conversationWorkflows!.instances, 'switching choices cannot invent step completion');
});

test('production detail route exposes only native conversation workflow fields and scoped delivery evidence', async t => {
  const f = await fixture(t, { legacyHistory: true, modernHistory: true }); const before = await readFile(f.file, 'utf8');
  const detail = await f.details(); assert.equal(detail.status, 200, detail.body.error);
  assert.equal(detail.body.projectName, '项目甲');
  assert.equal(detail.body.name, '软件工程'); assert.equal(detail.body.selectedStep!.owner!.name, f.architect.name);
  assert.deepEqual(detail.body.selectedStep!.outputs, ['设计文档']); assert.deepEqual(detail.body.selectedStep!.acceptanceCriteria, ['覆盖要求']);
  assert.deepEqual(detail.body.selectedStep!.roster.map(person => person.name).sort(), [f.architect.name, '开发人员'].sort());
  assert.equal(detail.body.history.length, 2, 'only this chat legacy root and current workflow owner root are visible');
  assert.equal(detail.body.selectedStep!.latestDelivery!.output, '保留原生对话产生的交付，等待人工验收');
  assert.doesNotMatch(JSON.stringify(detail.body), /employeeSnapshot|modules|model|capabilities|workState|usage|rootPath/);
  const projected = (await f.view('chat-a')).body; assert.deepEqual(Object.keys(projected.owner!).sort(), ['id', 'name']);
  const unknown = await f.details('unknown-chat'); assert.equal(unknown.body.projectId, null); assert.deepEqual(unknown.body.history, []);
  const foreign = await f.details('foreign-chat'); assert.equal(foreign.body.projectId, f.other.id); assert.deepEqual(foreign.body.history, []);
  const oldChild = f.history.find(run => run.parentRunId)!;
  assert.notEqual((await f.details('chat-a', { runId: oldChild.id })).status, 200);
  const foreignLegacy = f.history.find(run => run.sessionId === 'legacy-succeeded')!;
  assert.notEqual((await f.details('chat-a', { runId: foreignLegacy.id })).status, 200);
  assert.notEqual((await f.details('chat-a', { stepId: 'foreign-step' })).status, 200);
  assert.equal(await readFile(f.file, 'utf8'), before, 'read-only details and rejected scopes preserve every stored byte');
});

test('production detail snapshots reject stale versions and preserve native scope before returning bodies', async t => {
  const f = await fixture(t, { modernHistory: true }); const detail = (await f.details()).body;
  const run = detail.selectedStep!.latestDelivery!; const before = await readFile(f.file, 'utf8');
  const selected = { stepId: detail.selectedStep!.id, runId: run.id, runVersion: String(run.version) };
  assert.equal((await f.details('chat-a', selected)).body.selectedStep!.latestDelivery!.output, run.output);
  assert.equal((await f.details('chat-a', { ...selected, runVersion: String(run.version - 1) })).status, 409);
  assert.notEqual((await f.details('chat-a', { runVersion: String(run.version) })).status, 200);
  assert.notEqual((await f.details('chat-a', { ...selected, stepId: 'build' })).status, 200);
  assert.notEqual((await f.details('foreign-chat', selected)).status, 200);
  assert.equal(await readFile(f.file, 'utf8'), before, 'snapshot reads and rejected scope/version requests perform no state mutation');
});

test('production scoped review endpoint checks native ownership and CAS then advances through real acceptance', async t => {
  const f = await fixture(t, { modernHistory: true }); const details = (await f.details()).body;
  const run = details.selectedStep!.latestDelivery!; const before = await readFile(f.file, 'utf8');
  const input: ConversationWorkflowReviewInput = { projectId: f.project.id, sessionId: 'chat-a', instanceId: details.instanceId,
    instanceVersion: details.instanceVersion, stepId: details.selectedStep!.id, runId: run.id, runVersion: run.version, expectedRevision: details.revision, decision: 'accepted', note: '人工检查通过' };
  assert.notEqual((await f.review({ ...input, sessionId: 'unknown-chat' })).status, 200);
  assert.notEqual((await f.review({ ...input, projectId: f.other.id })).status, 200);
  assert.equal((await f.review({ ...input, expectedRevision: input.expectedRevision - 1 })).status, 409);
  assert.equal((await f.review({ ...input, runVersion: 1 })).status, 409);
  assert.notEqual((await f.review({ ...input, stepId: 'build' })).status, 200);
  f.setQueuedIdle('chat-a', 'nextTurn'); assert.notEqual((await f.review(input)).status, 200); f.setQueuedIdle('chat-a');
  assert.equal(await readFile(f.file, 'utf8'), before, 'every rejected review is atomic and read-only');
  const accepted = await f.review(input); assert.equal(accepted.status, 200, accepted.body.error);
  assert.equal(accepted.body.currentStepId, 'build'); assert.deepEqual(accepted.body.steps.map(step => step.status), ['completed', 'current']);
  assert.equal(accepted.body.selectedStep!.owner!.name, '开发人员');
  assert.doesNotMatch(JSON.stringify(accepted.body), /employeeSnapshot|modules|workState|rootPath/);
  const state = await f.state(); const reviewed = state.runs.find(entry => entry.id === run.id)!;
  assert.equal(reviewed.acceptance!.reviewer, '用户'); assert.equal(reviewed.acceptance!.note, '人工检查通过'); assert.equal(reviewed.status, 'succeeded');
  assert.equal(state.conversationWorkflows!.instances[0]!.completions[0]!.runId, run.id);
  assert.equal((await f.review(input)).status, 409, 'replayed stale acceptance cannot advance twice');
});

test('legacy delivery review remains available in its own native chat after explicitly choosing none', async t => {
  const f = await fixture(t, { legacyHistory: true }); assert.equal((await f.select('chat-a', null)).status, 200);
  const legacy = f.history.find(run => run.sessionId === 'chat-a')!;
  const details = (await f.details('chat-a', { runId: legacy.id })).body;
  assert.equal(details.instanceId, null); assert.equal(details.legacyDelivery!.id, legacy.id); assert.equal(details.legacyDelivery!.reviewable, true);
  const input: ConversationWorkflowReviewInput = { projectId: f.project.id, sessionId: 'chat-a', instanceId: null,
    runId: legacy.id, runVersion: legacy.version, expectedRevision: details.revision, decision: 'rejected', note: '旧交付不采用' };
  const wrong = await f.review({ ...input, sessionId: 'chat-b' }); assert.notEqual(wrong.status, 200);
  const result = await f.review(input); assert.equal(result.status, 200, result.body.error); assert.equal(result.body.instanceId, null);
  assert.equal((await f.state()).runs.find(run => run.id === legacy.id)!.acceptance!.decision, 'rejected');
});

test('generic run commands cannot bypass native workflow review ownership, inbox or revision admission', async t => {
  const f = await fixture(t, { modernHistory: true }); const modern = f.history.find(run => run.conversationWorkflow)!;
  const before = await readFile(f.file, 'utf8'); f.setQueuedIdle('chat-a', 'nextTurn');
  for (const action of ['run.review', 'run.cancel']) {
    const response = await f.command(action, { id: modern.id, input: { decision: 'accepted', reviewer: '绕过尝试', note: '禁止旧路由验收' } }, { expectedVersion: modern.version });
    assert.notEqual(response.status, 200, action); assert.match(response.body.error!, /原生项目对话的工作流详情/);
  }
  f.setQueuedIdle('chat-a');
  assert.notEqual((await f.command('run.review', { id: modern.id, input: { decision: 'accepted', reviewer: '旧页面' } }, { expectedVersion: modern.version })).status, 200);
  assert.equal(await readFile(f.file, 'utf8'), before);
});

test('own native delivery from an unselected workflow gives precise return guidance without opening another chats delivery', async t => {
  const f = await fixture(t, { modernHistory: true }); const modern = f.history.find(run => run.conversationWorkflow)!;
  assert.equal((await f.select('chat-a', null)).status, 200); const before = await readFile(f.file, 'utf8');
  const own = await f.details('chat-a', { runId: modern.id }); assert.notEqual(own.status, 200);
  assert.match(own.body.error!, /请先在此对话选择“软件工程”工作流，再切换到“方案”步骤/);
  assert.equal((await f.select('chat-b', null)).status, 200);
  const other = await f.details('chat-b', { runId: modern.id }); assert.notEqual(other.status, 200);
  assert.match(other.body.error!, /交付不属于当前对话或工作流/); assert.doesNotMatch(other.body.error!, /软件工程|方案/);
  const after = await f.state(); assert.deepEqual(after.runs, f.history); assert.equal(JSON.parse(before).runs[0].status, modern.status);
});
