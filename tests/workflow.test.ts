import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkforceStore } from '../src/domain/store.js';
import { ARCHITECT_TEMPLATE_ID } from '../src/domain/seed.js';
import { WorkflowRepository } from '../src/workflow/repository.js';
import { WorkflowEngine } from '../src/workflow/engine.js';
import type { WorkflowCommandInput } from '../src/workflow/types.js';

async function fixture(t: TestContext) {
  const root = await mkdtemp(resolve(tmpdir(), 'workforce-flow-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(resolve(root, 'project'));
  const store = await WorkforceStore.open(resolve(root, 'state.json'));
  const project = await store.saveProject({ name: 'Project', rootPath: resolve(root, 'project') });
  const template = store.snapshot().templates.find(item => item.id === ARCHITECT_TEMPLATE_ID)!;
  const team = await store.saveTeam({ name: 'Team', members: [{ memberId: 'lead', templateId: template.id }, { memberId: 'reviewer', templateId: template.id, reportsTo: 'lead' }], workflows: [{ id: 'delivery', name: '交付流程', maxAttempts: 2, steps: [{ id: 'plan', name: '方案', memberId: 'lead', instruction: '完成方案', outputs: ['方案摘要'], acceptanceCriteria: ['说明边界'] }, { id: 'review', name: '评审', memberId: 'reviewer', instruction: '评审已验收的方案' }] }] });
  const installed = await store.configureProjectTeam({ projectId: project.id, teamId: team.id, teamVersion: team.version, templateVersions: { [template.id]: template.version } });
  const repository = new WorkflowRepository(store);
  const input = { projectId: project.id, projectTeamId: installed.id, workflowId: installed.workflows[0]!.id, workflowVersion: 1, request: '交付一个清晰的方案', requestId: randomUUID() };
  const starts: string[] = [];
  const errors: unknown[] = [];
  const executor = {
    startReserved: async (id: string) => {
      const task = store.snapshot().runs.find(task => task.id === id)!;
      assert(store.snapshot().workflowRuns?.some(flow => flow.steps.some(step => step.attempts.some(attempt => attempt.runId === id))), 'reservation must precede execution');
      if (task.status === 'queued') { starts.push(id); return store.updateRun(id, { status: 'running' }); }
      return task;
    },
    cancel: async (id: string) => { const task = store.snapshot().runs.find(task => task.id === id)!; if (['queued', 'running', 'blocked'].includes(task.status)) await store.updateRun(id, { status: 'cancelled' }); },
  };
  const engine = new WorkflowEngine(repository, executor, error => errors.push(error));
  t.after(() => engine.dispose());
  const get = () => store.snapshot().workflowRuns![0]!;
  const control = (action: WorkflowCommandInput['action'], extra: Partial<WorkflowCommandInput> = {}) => repository.control({ projectId: project.id, id: get().id, commandId: randomUUID(), expectedVersion: get().version, action, ...extra });
  const complete = async (output = '已验收交接内容') => { await store.updateRun(starts.at(-1)!, { status: 'awaiting-review', output }); await engine.idle(); };
  return { root, store, repository, engine, executor, input, get, control, starts, errors, complete, installed };
}

test('workflow start is idempotent, snapshots definitions, and rejects foreign/stale requests', async t => {
  const f = await fixture(t);
  const started = await f.repository.start(f.input);
  assert.equal((await f.repository.start(f.input)).id, started.id);
  await assert.rejects(f.repository.start({ ...f.input, request: 'different' }), /已用于/);
  await assert.rejects(f.repository.start({ ...f.input, requestId: randomUUID(), projectId: 'foreign' }), /不属于/);
  await assert.rejects(f.repository.start({ ...f.input, requestId: randomUUID(), workflowVersion: 99 }), /更新/);
  await f.repository.saveDefinition({ projectId: f.input.projectId, projectTeamId: f.input.projectTeamId, expectedVersion: 1, workflow: { ...f.installed.workflows[0]!, name: '新的项目流程' } });
  assert.equal(f.get().definition.name, '交付流程');
  assert.equal((await f.repository.start(f.input)).id, started.id, 'lost response remains retryable after definition changes');
  assert.equal(f.store.snapshot().runs.length, 0);
});

test('sequential dispatch waits for review, then hands off accepted results and completes', async t => {
  const f = await fixture(t); await f.engine.start(); await f.repository.start(f.input); await f.engine.idle();
  assert.equal(f.starts.length, 1);
  const firstId = f.starts[0]!;
  await f.complete(); assert.equal(f.get().status, 'awaiting-review'); assert.equal(f.starts.length, 1);
  await assert.rejects(f.store.reviewRun(firstId, { decision: 'accepted', reviewer: 'bypass' }), /工作流验收入口/);
  await f.control('review', { runId: firstId, decision: 'accepted' }); await f.engine.idle();
  assert.equal(f.starts.length, 2); assert.notEqual(f.starts[1], firstId);
  assert.match(f.store.snapshot().runs.at(-1)!.request, /已验收交接内容/);
  assert.equal(f.get().steps[0]!.status, 'accepted');
  await f.complete('评审完成'); await f.control('review', { runId: f.starts[1], decision: 'accepted' }); await f.engine.idle();
  assert.equal(f.get().status, 'succeeded'); assert(f.get().finishedAt); assert.deepEqual(f.errors, []);
  await assert.rejects(f.control('retry'), /已结束/);
});

test('pause stops subsequent dispatch and replayed control requests do not toggle state', async t => {
  const f = await fixture(t); await f.engine.start(); await f.repository.start(f.input); await f.engine.idle();
  const pause: WorkflowCommandInput = { projectId: f.input.projectId, id: f.get().id, commandId: randomUUID(), expectedVersion: f.get().version, action: 'pause' };
  await f.repository.control(pause); await f.repository.control(pause);
  await f.complete(); await f.control('review', { runId: f.starts[0], decision: 'accepted' }); await f.engine.idle();
  assert.equal(f.get().status, 'paused'); assert.equal(f.starts.length, 1);
  await assert.rejects(f.repository.control({ ...pause, action: 'resume' }), /不同操作/);
  await f.control('resume'); await f.engine.idle(); assert.equal(f.starts.length, 2); assert.deepEqual(f.errors, []);
});

test('rejection, stale reviews and bounded retries preserve every attempt and feedback', async t => {
  const f = await fixture(t); await f.engine.start(); await f.repository.start(f.input); await f.engine.idle();
  await f.complete();
  await assert.rejects(f.control('review', { runId: f.starts[0], decision: 'rejected' }), /退回意见/);
  await f.control('review', { runId: f.starts[0], decision: 'rejected', note: '补充风险说明' });
  assert.equal(f.get().status, 'blocked');
  await f.control('retry', { runId: f.starts[0] }); await f.engine.idle();
  assert.equal(f.starts.length, 2); assert.equal(f.get().steps[0]!.attempts.length, 2);
  assert.match(f.store.snapshot().runs.at(-1)!.request, /补充风险说明/);
  await f.complete(); await assert.rejects(f.control('review', { runId: f.starts[0], decision: 'accepted' }), /已改变/);
  await f.control('review', { runId: f.starts[1], decision: 'rejected', note: '仍需补充' });
  await assert.rejects(f.control('retry', { runId: f.starts[1] }), /上限/);
  assert.equal(f.get().steps[1]!.attempts.length, 0); assert.deepEqual(f.errors, []);
});

test('cancelled reservation never starts; repeated scheduler notifications reuse one task', async t => {
  const f = await fixture(t); await f.repository.start(f.input); await f.repository.advance(f.get().id);
  assert.equal(f.store.snapshot().runs[0]!.status, 'queued');
  await f.control('cancel'); await f.engine.start(); await f.engine.idle();
  assert.equal(f.starts.length, 0); assert.equal(f.get().status, 'cancelled');
  assert.equal(f.store.snapshot().runs[0]!.status, 'cancelled');
});

test('restart resumes durable queued work once and blocks an interrupted running attempt', async t => {
  const f = await fixture(t); await f.repository.start(f.input); await f.repository.advance(f.get().id);
  const reserved = f.store.snapshot().runs[0]!.id;
  await f.engine.start(); await f.engine.idle(); assert.deepEqual(f.starts, [reserved]);
  await f.engine.dispose();
  const reopened = await WorkforceStore.open(f.store.filePath);
  const repository = new WorkflowRepository(reopened);
  const calls: string[] = [];
  const engine = new WorkflowEngine(repository, { startReserved: async id => { calls.push(id); return reopened.snapshot().runs.find(run => run.id === id)!; }, cancel: async () => undefined }, error => { throw error; });
  t.after(() => engine.dispose()); await engine.start(); await engine.idle();
  assert.equal(reopened.snapshot().workflowRuns![0]!.status, 'blocked'); assert.equal(calls.length, 0);
  assert.match(reopened.snapshot().runs[0]!.error!, /中断/);
  assert.equal((await repository.start(f.input)).id, f.get().id);
});

test('handoff filters unreadable file references and never copies private employee memory', async t => {
  const f = await fixture(t); await f.engine.start(); await f.repository.start(f.input); await f.engine.idle();
  const employee = f.store.snapshot().employees.find(employee => employee.id === f.get().definition.steps[1]!.employeeId)!;
  const modules = structuredClone(employee.modules); modules.permissions.readPaths = ['docs/public/**'];
  await f.store.updateEmployee(employee.id, { modules });
  await f.store.saveMemory({ projectId: f.input.projectId, employeeId: f.get().definition.steps[0]!.employeeId, scope: 'employee', title: 'private', content: 'PRIVATE_MEMORY_SENTINEL', source: { kind: 'user-confirmed', reference: 'fixture' } });
  await f.store.updateRun(f.starts[0]!, { artifacts: [{ id: 'visible', title: '共享结果', path: 'docs/public/result.md' }, { id: 'secret', title: 'SECRET_ARTIFACT_SENTINEL', path: 'private/secret.md' }] });
  await f.complete(); await f.control('review', { runId: f.starts[0], decision: 'accepted' }); await f.engine.idle();
  const request = f.store.snapshot().runs.at(-1)!.request;
  assert.match(request, /docs\/public\/result.md/); assert.doesNotMatch(request, /SECRET_ARTIFACT_SENTINEL|PRIVATE_MEMORY_SENTINEL/);
  await assert.rejects(f.repository.control({ projectId: 'foreign', id: f.get().id, commandId: randomUUID(), expectedVersion: f.get().version, action: 'cancel' }), /当前项目/);
});

test('invalid configuration and tampered task links roll back memory and disk together', async t => {
  const f = await fixture(t); await f.repository.start(f.input); await f.repository.advance(f.get().id);
  const before = f.store.snapshot(); const disk = await readFile(f.store.filePath, 'utf8');
  const definition = structuredClone(f.installed.workflows[0]!);
  definition.steps[0]!.timeoutMs = 0;
  await assert.rejects(f.repository.saveDefinition({ projectId: f.input.projectId, projectTeamId: f.input.projectTeamId, workflow: definition, expectedVersion: 1 }), /超时/);
  await assert.rejects(f.store.transaction(state => { state.runs[0]!.workflow!.attempt = 5; }), /链接/);
  await assert.rejects(f.store.transaction(state => { state.runs[0]!.workflow!.timeoutMs = 3600000; }), /快照/);
  await assert.rejects(f.store.transaction(state => { state.workflowRuns![0]!.steps[1]!.status = 'running'; }), /前序/);
  assert.deepEqual(f.store.snapshot(), before);
  assert.equal(await readFile(f.store.filePath, 'utf8'), disk);
});

test('employee deactivation blocks only the next step and paused retry waits for resume', async t => {
  const f = await fixture(t); await f.engine.start(); await f.repository.start(f.input); await f.engine.idle();
  const nextEmployee = f.get().definition.steps[1]!.employeeId;
  await f.store.updateEmployee(nextEmployee, { status: 'paused' });
  await f.complete(); await f.control('review', { runId: f.starts[0], decision: 'accepted' }); await f.engine.idle();
  assert.equal(f.get().status, 'blocked'); assert.equal(f.starts.length, 1);
  await assert.rejects(f.control('retry'), /启用/);
  await f.store.updateEmployee(nextEmployee, { status: 'active' });
  await f.control('pause'); await f.control('retry'); await f.engine.idle();
  assert.equal(f.get().status, 'paused'); assert.equal(f.starts.length, 1);
  await f.control('resume'); await f.engine.idle(); assert.equal(f.starts.length, 2);
  assert.equal(f.get().steps[0]!.attempts.length, 1);
});

test('restart preserves accepted steps, and stale controls cannot review a newer state', async t => {
  const f = await fixture(t); await f.engine.start(); await f.repository.start(f.input); await f.engine.idle();
  await f.complete(); const staleVersion = f.get().version;
  await f.control('pause');
  await assert.rejects(f.control('review', { runId: f.starts[0], decision: 'accepted', expectedVersion: staleVersion }), /更新/);
  await f.control('review', { runId: f.starts[0], decision: 'accepted' });
  await f.control('resume'); await f.engine.idle(); await f.engine.dispose();
  const reopened = await WorkforceStore.open(f.store.filePath);
  const repository = new WorkflowRepository(reopened);
  await repository.recover(); await repository.advance(f.get().id);
  const recovered = reopened.snapshot().workflowRuns![0]!;
  assert.equal(recovered.steps[0]!.status, 'accepted');
  assert.equal(recovered.steps[1]!.status, 'blocked');
  assert.equal(recovered.steps[0]!.attempts.length, 1);
  assert.equal(reopened.snapshot().runs.length, 2);
});

test('cancellation closes pending reviews and reconciles a completion racing with cancel', async t => {
  const f = await fixture(t); await f.engine.start(); await f.repository.start(f.input); await f.engine.idle();
  await f.complete(); await f.control('cancel'); await f.engine.idle();
  assert.equal(f.store.snapshot().runs[0]!.status, 'cancelled');
  assert.equal(f.get().status, 'cancelled');

  await f.engine.dispose();
  const second = await f.repository.start({ ...f.input, requestId: randomUUID() });
  await f.repository.advance(second.id);
  const task = f.store.snapshot().runs.at(-1)!;
  await f.executor.startReserved(task.id);
  await f.repository.control({ projectId: second.projectId, id: second.id, commandId: randomUUID(), expectedVersion: f.store.snapshot().workflowRuns!.at(-1)!.version, action: 'cancel' });
  await f.store.updateRun(task.id, { status: 'awaiting-review', output: 'arrived while abort was pending' });
  await f.engine.start(); await f.engine.idle();
  assert.equal(f.store.snapshot().runs.at(-1)!.status, 'cancelled');
  assert.equal(f.store.snapshot().runs.at(-1)!.output, 'arrived while abort was pending');
  assert.equal(f.store.snapshot().workflowRuns!.at(-1)!.steps[1]!.attempts.length, 0);
});
