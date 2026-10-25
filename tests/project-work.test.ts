import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { WorkforceStore } from '../src/domain/store.js';
import { ARCHITECT_TEMPLATE_ID } from '../src/domain/seed.js';
import { WorkService } from '../src/work/service.js';
import { WorkEngine } from '../src/work/engine.js';
import type { ProjectBrief, WorkCommandOptions, WorkDeliverable, WorkTask } from '../src/work/types.js';

async function fixture(t: TestContext, budget = 4) {
  const root = await mkdtemp(resolve(tmpdir(), 'workforce-project-work-')); t.after(() => rm(root, { recursive: true, force: true })); await mkdir(resolve(root, 'project'));
  const store = await WorkforceStore.open(resolve(root, 'state.json')); const project = await store.saveProject({ name: 'Project', rootPath: resolve(root, 'project') });
  const employees = [];
  for (let i = 0; i < 3; i++) { const employee = await store.createEmployee({ projectId: project.id, templateId: ARCHITECT_TEMPLATE_ID, name: `Worker ${i}` }); employee.modules.model = { mode: 'override', provider: 'fixture', model: 'fixture-model' }; employees.push(await store.updateEmployee(employee.id, { modules: employee.modules, status: 'active' })); }
  const service = new WorkService(store, { maxConcurrent: budget }); const starts: string[] = []; const errors: unknown[] = [];
  const executor = { startReserved: async (id: string) => { const run = store.snapshot().runs.find(run => run.id === id)!; const task = store.snapshot().workState!.tasks.find(task => task.id === run.workTaskId)!; assert.equal(task.attemptRunIds.at(-1), id, 'attempt must be atomically registered before execution'); if (run.status === 'queued') { starts.push(id); return store.updateRun(id, { status: 'running' }); } return run; }, cancel: async (id: string) => { const run = store.snapshot().runs.find(run => run.id === id)!; if (['queued', 'running', 'blocked'].includes(run.status)) await store.updateRun(id, { status: 'cancelled' }); } };
  const engine = new WorkEngine(service, executor, error => errors.push(error)); t.after(() => engine.dispose());
  const command = (action: string, input: object, options: WorkCommandOptions = {}) => service.command(`work.${action}`, { projectId: project.id, ...input }, { requestId: randomUUID(), ...options });
  const task = (id: string) => service.snapshot().tasks.find(task => task.id === id)!;
  const create = (title: string, deps: string[] = [], index = 0) => command('saveTask', { title, goal: `Complete ${title}`, employeeId: employees[index]!.id, acceptanceCriteria: [`Verify ${title}`], dependencyTaskIds: deps }) as Promise<WorkTask>;
  const brief = () => service.snapshot().briefs[0]!;
  const setupBrief = () => command('saveBrief', { goal: 'Deliver verified project', scope: 'Fixture', completionCriteria: ['Everything reviewed'], maxConcurrent: 3 }) as Promise<ProjectBrief>;
  const run = (id: string) => store.snapshot().runs.find(run => run.id === task(id).attemptRunIds.at(-1))!;
  const complete = async (id: string, output: string = `${task(id).title} output`) => { await store.updateRun(run(id).id, { status: 'awaiting-review', output }); await engine.idle(); };
  const accept = async (id: string) => { await command('reviewTask', { id, decision: 'accepted', runId: run(id)?.id }); await engine.idle(); };
  return { root, store, project, employees, service, starts, errors, executor, engine, command, task, create, brief, setupBrief, run, complete, accept };
}

test('old state remains optional and engine startup never creates project work or model calls', async t => {
  const f = await fixture(t); const before = await readFile(f.store.filePath, 'utf8'); await f.engine.start(); await f.engine.idle(); assert.equal(f.store.snapshot().workState, undefined); assert.deepEqual(f.starts, []); assert.equal(await readFile(f.store.filePath, 'utf8'), before);
});

test('task commands are atomic, idempotent before stale revision checks, and reject cyclic/cross-project dependencies', async t => {
  const f = await fixture(t); const revision = f.store.snapshot().revision; const requestId = randomUUID(); const input = { title: 'A', goal: 'Do A', employeeId: f.employees[0]!.id, acceptanceCriteria: ['Pass'] };
  const a = await f.command('saveTask', input, { requestId, expectedRevision: revision }) as WorkTask;
  const afterFirst = await readFile(f.store.filePath, 'utf8');
  assert.equal((await f.command('saveTask', input, { requestId, expectedRevision: revision })).id, a.id); assert.equal(f.service.snapshot().tasks.length, 1); assert.equal(await readFile(f.store.filePath, 'utf8'), afterFirst, 'retry must not write or bump revision');
  await assert.rejects(f.command('saveTask', { ...input, title: 'Changed' }, { requestId, expectedRevision: revision }), /不同/);
  const b = await f.create('B', [a.id]); const before = await readFile(f.store.filePath, 'utf8');
  await assert.rejects(f.command('saveTask', { ...a, dependencyTaskIds: [b.id] }), /循环/); assert.equal(await readFile(f.store.filePath, 'utf8'), before);
  await mkdir(resolve(f.root, 'foreign')); const foreign = await f.store.saveProject({ name: 'Foreign', rootPath: resolve(f.root, 'foreign') }); const foreignEmployee = await f.store.createEmployee({ projectId: foreign.id, templateId: ARCHITECT_TEMPLATE_ID });
  await assert.rejects(f.command('saveTask', { ...input, employeeId: foreignEmployee.id }), /本项目/);
  await assert.rejects(f.command('saveTask', { ...input, dependencyTaskIds: ['missing'] }), /不存在/);
  assert.equal(f.service.snapshot().tasks.length, 2); assert.equal(f.store.snapshot().runs.length, 0);
});

test('independent tasks dispatch in parallel, join waits for all accepted outputs, and retry is localized', async t => {
  const f = await fixture(t); await f.engine.start(); await f.setupBrief(); const a = await f.create('A'); const b = await f.create('B', [], 1); const join = await f.create('Join', [a.id, b.id], 2);
  await f.command('startProject', {}); await f.engine.idle(); assert.equal(f.starts.length, 2); assert.equal(f.task(join.id).attemptRunIds.length, 0);
  await f.complete(a.id, 'A accepted evidence'); await f.accept(a.id); assert.equal(f.starts.length, 2);
  const failedId = f.run(b.id).id; await f.store.updateRun(failedId, { status: 'failed', error: 'Transient failure' }); await f.engine.idle(); assert.equal(f.task(b.id).status, 'blocked'); assert.equal(f.task(join.id).attemptRunIds.length, 0);
  await f.command('retryTask', { id: b.id, note: 'Check previous artifacts' }); await f.engine.idle(); assert.equal(f.starts.length, 3); assert.equal(f.task(a.id).attemptRunIds.length, 1); assert.equal(f.task(b.id).attemptRunIds.length, 2); assert.equal(f.store.snapshot().runs.find(run => run.id === failedId)!.status, 'failed');
  await f.complete(b.id, 'B accepted evidence'); await f.accept(b.id); assert.equal(f.starts.length, 4); assert.equal(f.task(join.id).id, join.id); assert.match(f.run(join.id).request, /A accepted evidence/); assert.match(f.run(join.id).request, /B accepted evidence/); assert.equal(f.task(join.id).inputVersions.length, 2);
  await f.complete(join.id); await f.accept(join.id); assert.equal(f.task(join.id).status, 'accepted'); assert.deepEqual(f.errors, []);
});

test('upstream revisions invalidate only affected descendants and never silently rerun accepted work', async t => {
  const f = await fixture(t); await f.engine.start(); const a = await f.create('A'); const b = await f.create('B', [a.id], 1); const unrelated = await f.create('Unrelated', [], 2);
  for (const id of [a.id, b.id, unrelated.id]) { await f.command('startTask', { id }); await f.engine.idle(); await f.complete(id); await f.accept(id); }
  const starts = f.starts.length; const aOutput = f.service.snapshot().deliverables.find(d => d.id === f.task(a.id).requiredDeliverableIds[0])!;
  await f.command('saveDeliverable', { id: aOutput.id, taskId: a.id, title: aOutput.title, content: 'A version two' }); await f.engine.idle();
  assert.equal(f.task(a.id).status, 'awaiting-review'); assert.equal(f.task(b.id).status, 'needs-revalidation'); assert.equal(f.task(unrelated.id).status, 'accepted'); assert.equal(f.starts.length, starts);
  const historical = f.service.snapshot().deliverables.find(d => d.id === aOutput.id)!.revisions[0]!;
  assert.equal(historical.review?.decision, 'accepted'); assert.equal(historical.reviews.length, 1); assert.equal(historical.invalidatedAt, undefined, 'previous source version retains its original historical approval');
  const downstream = f.service.snapshot().deliverables.find(d => d.id === f.task(b.id).requiredDeliverableIds[0])!.revisions[0]!;
  assert.equal(downstream.review?.decision, 'accepted'); assert.equal(downstream.reviews.length, 1); assert(downstream.invalidatedAt, 'downstream retains approval history but current validity is revoked');
  await assert.rejects(f.command('reviewTask', { id: b.id, decision: 'accepted' }), /前置|版本/); await f.accept(a.id);
  await assert.rejects(f.command('reviewTask', { id: b.id, decision: 'accepted' }), /版本/);
  await f.command('retryTask', { id: b.id }); await f.engine.idle(); assert.equal(f.task(b.id).attemptRunIds.length, 2); assert.equal(f.task(b.id).inputVersions[0]!.version, 2); await f.complete(b.id); await f.accept(b.id); assert.equal(f.task(b.id).status, 'accepted');
});

test('project pause holds downstream dispatch without cancelling current execution and runtime budget limits parallel reservations', async t => {
  const f = await fixture(t, 1); await f.engine.start(); await f.setupBrief(); const a = await f.create('A'); const b = await f.create('B', [], 1); await f.command('startProject', {}); await f.engine.idle(); assert.equal(f.starts.length, 1);
  await f.command('pauseProject', {}); assert.equal(f.run(a.id).status, 'running'); await f.complete(a.id); await f.accept(a.id); assert.equal(f.starts.length, 1); assert.equal(f.task(b.id).status, 'ready');
  await f.command('startProject', {}); await f.engine.idle(); assert.equal(f.starts.length, 2);
});

test('project completion requires current accepted required deliverables and revisions reopen completion', async t => {
  const f = await fixture(t); await f.engine.start(); await f.setupBrief(); const a = await f.create('A');
  await assert.rejects(f.command('completeProject', {}), /必交成果/); await f.command('saveBrief', { ...f.brief(), requiredDeliverableIds: a.requiredDeliverableIds });
  await assert.rejects(f.command('completeProject', {}), /未验收/); await f.command('startTask', { id: a.id }); await f.engine.idle(); await f.complete(a.id); await assert.rejects(f.command('completeProject', {}), /未验收/); await f.accept(a.id); await f.command('completeProject', {}); assert.equal(f.brief().status, 'completed');
  const d = f.service.snapshot().deliverables[0]!; await f.command('saveDeliverable', { id: d.id, taskId: a.id, title: d.title, content: 'Changed after completion' }); assert.equal(f.brief().status, 'paused'); assert.equal(f.brief().autoDispatch, false); await assert.rejects(f.command('completeProject', {}), /未验收/);
});

test('restart preserves attempt history and accepted results, pauses automation, and requires an explicit retry', async t => {
  const f = await fixture(t); await f.engine.start(); await f.setupBrief(); const a = await f.create('A'); const b = await f.create('B', [], 1); await f.command('startTask', { id: a.id }); await f.engine.idle(); await f.complete(a.id); await f.accept(a.id); await f.command('startProject', {}); await f.engine.idle(); const interrupted = f.run(b.id).id; await f.engine.dispose();
  const reopened = await WorkforceStore.open(f.store.filePath); const service = new WorkService(reopened); const calls: string[] = []; const engine = new WorkEngine(service, { startReserved: async id => { calls.push(id); return reopened.snapshot().runs.find(run => run.id === id)!; }, cancel: async () => undefined }); t.after(() => engine.dispose());
  await engine.start(); await engine.idle(); assert.deepEqual(calls, []); assert.equal(service.snapshot().briefs[0]!.status, 'paused'); assert.equal(service.snapshot().tasks.find(task => task.id === a.id)!.status, 'accepted'); assert.equal(service.snapshot().tasks.find(task => task.id === b.id)!.status, 'blocked'); assert.equal(reopened.snapshot().runs.find(run => run.id === interrupted)!.status, 'failed');
});

test('cancel aborts a registered attempt and malformed graph/state writes roll back', async t => {
  const f = await fixture(t); await f.engine.start(); const a = await f.create('A'); await f.command('startTask', { id: a.id }); await f.engine.idle(); await f.command('cancelTask', { id: a.id }); await f.engine.idle(); assert.equal(f.run(a.id).status, 'cancelled'); assert.equal(f.task(a.id).status, 'cancelled'); const before = await readFile(f.store.filePath, 'utf8');
  await assert.rejects(f.store.transaction(state => { state.workState!.tasks[0]!.status = 'unknown' as WorkTask['status']; }), /状态/);
  await assert.rejects(f.store.transaction(state => { state.runs[0]!.workTaskId = 'missing'; }), /链接|登记/); assert.equal(await readFile(f.store.filePath, 'utf8'), before);
});

test('manual reservations obey the same project budget and queued cancellation releases the slot', async t => {
  const f = await fixture(t, 4); await f.setupBrief(); await f.command('saveBrief', { ...f.brief(), maxConcurrent: 1 });
  const a = await f.create('Reserved A'); const b = await f.create('Reserved B', [], 1);
  // No engine is running, so reservations cannot yet be present in a runtime live map.
  await f.command('startTask', { id: a.id });
  assert.equal(f.run(a.id).status, 'queued');
  await assert.rejects(f.command('startTask', { id: b.id }), /并发上限/);
  assert.equal(f.task(b.id).attemptRunIds.length, 0);
  await f.command('cancelTask', { id: a.id });
  assert.equal(f.run(a.id).status, 'cancelled');
  assert.deepEqual(f.service.actions(), []);
  await f.command('retryTask', { id: a.id });
  assert.equal(f.task(a.id).attemptRunIds.length, 2);
  assert.equal(f.run(a.id).status, 'queued');
});

test('a cancelling live attempt cannot be orphaned by task edits or a second reservation', async t => {
  const f = await fixture(t); const a = await f.create('Active task');
  await f.command('startTask', { id: a.id }); await f.store.updateRun(f.run(a.id).id, { status: 'running' });
  await f.command('cancelTask', { id: a.id });
  await assert.rejects(f.command('saveTask', { ...f.task(a.id), goal: 'Changed before cancellation finished' }), /尚未停止/);
  await assert.rejects(f.command('retryTask', { id: a.id }), /正在执行/);
  assert.equal(f.task(a.id).attemptRunIds.length, 1);
  await f.store.updateRun(f.run(a.id).id, { status: 'cancelled' });
  await f.command('saveTask', { ...f.task(a.id), goal: 'Changed after cancellation' });
  assert.equal(f.task(a.id).status, 'ready');
});

test('out-of-order returned artifacts keep their named deliverable identity', async t => {
  const f = await fixture(t); await f.engine.start();
  const a = await f.command('saveTask', { title: 'Design and verify', goal: 'Produce two distinct deliverables', employeeId: f.employees[0]!.id, acceptanceCriteria: ['Both outputs correspond'], deliverableTitles: ['接口约定', '测试报告'] }) as WorkTask;
  await f.command('startTask', { id: a.id }); await f.engine.idle();
  await f.store.updateRun(f.run(a.id).id, { status: 'awaiting-review', artifacts: [{ id: 'test', title: '测试报告', content: 'TEST_REPORT_CONTENT' }, { id: 'api', title: '接口约定', content: 'API_SPEC_CONTENT' }] });
  await f.engine.idle();
  const outputs = f.service.snapshot().deliverables.filter(d => d.taskId === a.id);
  assert.equal(outputs.find(d => d.title === '接口约定')!.revisions.at(-1)!.content, 'API_SPEC_CONTENT');
  assert.equal(outputs.find(d => d.title === '测试报告')!.revisions.at(-1)!.content, 'TEST_REPORT_CONTENT');
  await f.accept(a.id); assert.equal(f.task(a.id).status, 'accepted');
});

test('workflow materialization creates editable detached task plan without starting legacy workflow', async t => {
  const f = await fixture(t); const template = f.store.snapshot().templates.find(template => template.id === ARCHITECT_TEMPLATE_ID)!;
  const team = await f.store.saveTeam({ name: 'Blueprint', members: [{ memberId: 'lead', templateId: template.id }], workflows: [{ id: 'flow', name: 'Flow', steps: [{ id: 'one', name: 'One', memberId: 'lead', instruction: 'First', outputs: ['One output'] }, { id: 'two', name: 'Two', memberId: 'lead', instruction: 'Second' }] }] });
  const installed = await f.store.configureProjectTeam({ projectId: f.project.id, teamId: team.id, teamVersion: team.version, templateVersions: { [template.id]: template.version } }); const before = structuredClone(installed);
  const tasks = await f.command('materializeWorkflow', { projectTeamId: installed.id, workflowId: installed.workflows[0]!.id, workflowVersion: 1 }) as WorkTask[]; assert.equal(tasks.length, 2); assert.deepEqual(tasks[1]!.dependencyTaskIds, [tasks[0]!.id]); assert.equal(f.store.snapshot().runs.length, 0); assert.equal(f.store.snapshot().workflowRuns?.length ?? 0, 0); assert.deepEqual(f.store.snapshot().projectTeams![0], before);
  await f.command('saveTask', { ...tasks[1], dependencyTaskIds: [], goal: 'Independent new plan' }); assert.equal(f.task(tasks[1]!.id).dependencyTaskIds.length, 0); assert.deepEqual(f.store.snapshot().projectTeams![0], before);
});

test('default model mode permits reservation and leaves model resolution to the executor', async t => {
  const f = await fixture(t);
  const a = await f.create('A');
  const employee = f.employees[0]!;
  const modules = structuredClone(employee.modules);
  modules.model = { mode: 'inherit' };
  await f.store.updateEmployee(employee.id, { modules });
  await f.command('startTask', { id: a.id });
  assert.equal(f.store.snapshot().runs.length, 1);
  assert.equal(f.run(a.id).status, 'queued');
  assert.deepEqual(f.run(a.id).employeeSnapshot.modules.model, { mode: 'inherit' });
  assert.deepEqual(f.starts, [], 'reservation leaves default resolution to the executor');
});

test('default model executor failures become reviewable blocked attempts', async t => {
  const f = await fixture(t);
  const employee = f.employees[0]!;
  const modules = structuredClone(employee.modules);
  modules.model = { mode: 'inherit' };
  await f.store.updateEmployee(employee.id, { modules });
  let starts = 0;
  const engine = new WorkEngine(f.service, { startReserved: async () => { starts++; throw new Error('Provider temporarily unavailable'); }, cancel: async () => undefined });
  t.after(() => engine.dispose());
  // Start recovery before reserving this attempt so it is dispatched as new work.
  await engine.start();
  const a = await f.create('A');
  await f.command('startTask', { id: a.id });
  await engine.idle();
  assert.equal(starts, 1);
  assert.equal(f.task(a.id).status, 'blocked');
  assert.equal(f.run(a.id).status, 'failed');
  assert.equal(f.run(a.id).error, 'Provider temporarily unavailable');
  assert.deepEqual(f.run(a.id).employeeSnapshot.modules.model, { mode: 'inherit' });
});

test('incomplete explicit employee models still prevent work reservation', async t => {
  const f = await fixture(t);
  const a = await f.create('A');
  for (const key of ['provider', 'model'] as const) {
    const state = f.store.snapshot();
    delete state.employees.find(employee => employee.id === f.employees[0]!.id)!.modules.model[key];
    const service = new WorkService({
      snapshot: () => structuredClone(state),
      transaction: async operation => operation(structuredClone(state)),
    });
    await assert.rejects(service.command('work.startTask', { projectId: f.project.id, id: a.id }, { requestId: randomUUID() }), /模型 provider|模型名称/);
    assert.equal(service.snapshot().tasks.find(task => task.id === a.id)!.attemptRunIds.length, 0);
    assert.equal(f.store.snapshot().runs.length, 0);
  }
});

test('hand-off includes only accepted inputs and authorized file references, never private employee memory', async t => {
  const f = await fixture(t); await f.engine.start(); const a = await f.create('A'); const b = await f.create('B', [a.id], 1); const employee = f.employees[1]!; const modules = structuredClone(employee.modules); modules.permissions.readPaths = ['docs/public/**']; await f.store.updateEmployee(employee.id, { modules });
  await f.store.saveMemory({ projectId: f.project.id, employeeId: f.employees[0]!.id, scope: 'employee', title: 'Private', content: 'PRIVATE_SENTINEL', source: { kind: 'user-confirmed', reference: 'Fixture' } });
  await f.command('startTask', { id: a.id }); await f.engine.idle(); await f.store.updateRun(f.run(a.id).id, { status: 'awaiting-review', artifacts: [{ id: 'secret', title: 'Secret', path: 'private/SECRET_PATH_SENTINEL.txt' }] }); await f.engine.idle(); await f.accept(a.id); await f.command('startTask', { id: b.id }); await f.engine.idle(); assert.match(f.run(b.id).request, /SECRET_PATH_SENTINEL/); assert.doesNotMatch(f.run(b.id).request, /PRIVATE_SENTINEL/);
});
