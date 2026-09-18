import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkforceStore } from '../src/domain/store.js';
import { createBlankModules } from '../src/domain/seed.js';
import { validateState } from '../src/domain/validation.js';
import { WorkflowRepository } from '../src/workflow/repository.js';
import { activeProjectTeams, projectEmployees } from '../src/domain/project-roster.js';

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'workforce-team-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'state.json');
  const store = await WorkforceStore.open(file);
  await mkdir(join(root, 'other'));
  const project = await store.saveProject({ name: '项目甲', rootPath: root });
  const other = await store.saveProject({ name: '项目乙', rootPath: join(root, 'other') });
  const architect = store.snapshot().templates[0]!;
  const designer = await store.saveTemplate({ name: '设计师', status: 'draft', modules: createBlankModules() });
  const team = await store.saveTeam({ name: '应用团队', members: [
    { memberId: 'design', templateId: designer.id, reportsTo: 'architect' },
    { memberId: 'architect', templateId: architect.id },
  ], workflows: [{ id: 'app-flow', name: '应用交付', steps: [
    { id: 'plan', name: '设计方案', memberId: 'architect', instruction: '完成架构方案并交付文档' },
    { id: 'ux', name: '交互设计', memberId: 'design', instruction: '依据方案完成界面设计' },
  ] }] });
  const input = { projectId: project.id, teamId: team.id, teamVersion: team.version, templateVersions: { [architect.id]: architect.version, [designer.id]: designer.version } };
  return { root, file, store, project, other, architect, designer, team, input };
}

test('one team transaction creates all members, forward reports and project workflow assignments', async t => {
  const { store, file, project, input, team, architect, designer } = await fixture(t);
  const before = store.snapshot();
  const installed = await store.configureProjectTeam(input);
  const state = store.snapshot();
  assert.equal(state.revision, before.revision + 1);
  assert.equal(installed.members.length, 2);
  const employees = installed.members.map(member => state.employees.find(employee => employee.id === member.employeeId)!);
  assert.deepEqual(employees.map(employee => employee.templateId), [designer.id, architect.id]);
  assert.equal(employees[0]!.managerId, employees[1]!.id);
  assert.deepEqual(employees.map(employee => employee.status), ['paused', 'active']);
  assert.ok(employees.every(employee => employee.projectId === project.id && employee.teamInstanceId === installed.id));
  assert.deepEqual(employees[1]!.modules, architect.modules);
  assert.deepEqual(installed.workflows[0]!.steps.map(step => step.employeeId), [employees[1]!.id, employees[0]!.id]);
  assert.notEqual(installed.workflows[0]!.id, team.workflows[0]!.id);
  assert.equal(installed.workflows[0]!.templateWorkflowId, team.workflows[0]!.id);
  assert.deepEqual(state.teams, before.teams);
  assert.deepEqual(state.templates, before.templates);
  assert.deepEqual(state.memories, before.memories);
  installed.workflows[0]!.steps[0]!.instruction = 'must not leak into store';
  const reopened = await WorkforceStore.open(file);
  assert.deepEqual(reopened.snapshot(), state);
});

test('legacy employee adoption preserves identity, project overrides and private memory without duplicates', async t => {
  const { store, project, architect, input } = await fixture(t);
  const existing = await store.createEmployee({ projectId: project.id, templateId: architect.id, name: '我的架构师' });
  const modules = structuredClone(existing.modules);
  modules.permissions.writePaths = ['docs/local/**'];
  await store.updateEmployee(existing.id, { modules });
  const memory = await store.saveMemory({ projectId: project.id, scope: 'employee', employeeId: existing.id, title: '已确认决定', content: '项目专属事实', source: { kind: 'user-confirmed', reference: '用户确认' } });
  const installed = await store.configureProjectTeam(input);
  const adopted = store.snapshot().employees.find(employee => employee.id === existing.id)!;
  assert.equal(installed.members.find(member => member.memberId === 'architect')!.employeeId, existing.id);
  assert.equal(adopted.name, existing.name);
  assert.deepEqual(adopted.modules, modules);
  assert.deepEqual(store.listMemories(project.id, existing.id), [memory]);
  assert.equal(store.snapshot().employees.length, 2);
});

test('repeated or lost-response installation survives restart and template edits without duplicating or overwriting', async t => {
  const { store, file, input, team, architect } = await fixture(t);
  const installed = await store.configureProjectTeam(input);
  const modules = structuredClone(architect.modules); modules.responsibilities.mission = 'later template change';
  await store.saveTemplate({ ...architect, modules }, { expectedVersion: architect.version });
  await store.saveTeam({ ...team, name: 'later name', workflows: [] }, { expectedVersion: team.version });
  const reopened = await WorkforceStore.open(file);
  assert.deepEqual(await reopened.configureProjectTeam(input), installed);
  assert.deepEqual(await reopened.configureProjectTeam(input), installed);
  assert.equal(reopened.snapshot().employees.length, 2);
  assert.equal(reopened.snapshot().projectTeams?.length, 1);
  assert.equal(reopened.snapshot().projectTeams?.[0]?.workflows.length, 1);
  assert.equal(reopened.snapshot().employees.find(employee => employee.templateId === architect.id)!.modules.responsibilities.mission, architect.modules.responsibilities.mission);
});

test('each project gets independent employees and workflows and cannot receive foreign memory or assignees', async t => {
  const { store, project, other, input } = await fixture(t);
  const a = await store.configureProjectTeam(input);
  const b = await store.configureProjectTeam({ ...input, projectId: other.id });
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.workflows[0]!.id, b.workflows[0]!.id);
  assert.ok(a.members.every(member => !b.members.some(other => member.employeeId === other.employeeId)));
  await store.saveMemory({ projectId: project.id, scope: 'employee', employeeId: a.members[0]!.employeeId, title: '私有', content: '不共享', source: { kind: 'user-confirmed', reference: '用户确认' } });
  assert.deepEqual(store.listMemories(other.id, b.members[0]!.employeeId), []);
  const broken = store.snapshot();
  broken.projectTeams![0]!.workflows[0]!.steps[0]!.employeeId = b.members[0]!.employeeId;
  assert.throws(() => validateState(broken), /负责员工不在团队中/);
});

test('stale team/member previews and unavailable teams leave the entire installation unchanged', async t => {
  const { store, file, input, team, designer } = await fixture(t);
  for (const stale of [{ ...input, teamVersion: 0 }, { ...input, templateVersions: {} }]) {
    const before = await readFile(file, 'utf8');
    await assert.rejects(store.configureProjectTeam(stale), { code: 'CONFLICT' });
    assert.equal(await readFile(file, 'utf8'), before);
  }
  await store.archiveTemplate(designer.id);
  const before = await readFile(file, 'utf8');
  await assert.rejects(store.configureProjectTeam(input), /已归档/);
  assert.equal(await readFile(file, 'utf8'), before);
  const empty = await store.saveTeam({ name: '空团队', members: [] });
  await assert.rejects(store.configureProjectTeam({ ...input, teamId: empty.id, teamVersion: empty.version }), /1–50/);
  assert.equal(store.snapshot().employees.length, 0);
  assert.equal(store.snapshot().projectTeams?.length ?? 0, 0);
  const invalid = { ...team, workflows: [{ id: 'invalid', name: '无效流程', steps: [{ id: 's', name: '任务', instruction: '执行', memberId: 'absent' }] }] };
  await assert.rejects(store.saveTeam(invalid), /负责员工不在团队中/);
});

test('workflow snapshots remain after platform removal; existing saves preserve flows and bound employees cannot be deleted', async t => {
  const { store, input, team } = await fixture(t);
  const revised = await store.saveTeam({ id: team.id, name: team.name, members: team.members }, { expectedVersion: team.version });
  assert.deepEqual(revised.workflows, team.workflows);
  const installed = await store.configureProjectTeam({ ...input, teamVersion: revised.version });
  await store.deleteTeam(team.id);
  assert.deepEqual(store.snapshot().projectTeams?.[0], installed);
  await assert.rejects(store.deleteEmployee(installed.members[0]!.employeeId), /属于项目团队/);
});

test('ambiguous repeated roles get fresh instances; configuring an in-flight legacy employee rolls back', async t => {
  const { store, input, project, architect, team } = await fixture(t);
  const existing = await store.createEmployee({ projectId: project.id, templateId: architect.id });
  const run = await store.createRun({ projectId: project.id, employeeId: existing.id, request: '正在工作' });
  const before = store.snapshot();
  await assert.rejects(store.configureProjectTeam(input), /正在执行任务/);
  assert.deepEqual(store.snapshot(), before);
  await store.updateRun(run.id, { status: 'cancelled' });
  const revised = await store.saveTeam({ ...team, members: [...team.members, { memberId: 'reviewer', templateId: architect.id }] });
  const installed = await store.configureProjectTeam({ ...input, teamVersion: revised.version });
  assert.equal(installed.members.length, 3);
  assert.ok(installed.members.every(member => member.employeeId !== existing.id));
});

test('team cancellation preserves history and memory, and explicit restoration reuses project instances', async t => {
  const f = await fixture(t); const team = await f.store.configureProjectTeam(f.input);
  const employees = f.store.snapshot().employees;
  const architect = employees.find(employee => employee.templateId === f.architect.id)!;
  await f.store.saveMemory({ projectId: f.project.id, employeeId: architect.id, scope: 'employee', title: '项目决定', content: '恢复时保留', source: { kind: 'user-confirmed', reference: '用户确认' } });
  const task = await f.store.createRun({ projectId: f.project.id, employeeId: architect.id, request: '待执行工作' });
  const before = f.store.snapshot();
  const input = { projectId: f.project.id, teams: [{ id: team.id, version: team.version! }] };
  const result = await f.store.cancelProjectTeams(input);
  assert.deepEqual(result.runIds, [task.id]);
  assert.equal(activeProjectTeams(f.store.snapshot(), f.project.id).length, 0);
  assert.equal(projectEmployees(f.store.snapshot(), f.project.id).length, 0);
  assert(f.store.snapshot().employees.every(employee => employee.status === 'paused'));
  assert.equal(f.store.snapshot().runs[0]!.status, 'cancelled');
  assert.deepEqual(f.store.snapshot().memories, before.memories);
  assert.deepEqual(f.store.snapshot().teams, before.teams);
  await f.store.cancelProjectTeams(input);
  await assert.rejects(f.store.configureProjectTeam(f.input), /已取消/);
  await assert.rejects(f.store.updateEmployee(architect.id, { status: 'active' }), /先恢复团队/);
  const reopened = await WorkforceStore.open(f.file);
  const restored = await reopened.configureProjectTeam({ ...f.input, restoreVersion: 2 });
  assert.equal(restored.id, team.id); assert.deepEqual(restored.members, team.members); assert.deepEqual(restored.workflows, team.workflows);
  assert.deepEqual(reopened.snapshot().employees.map(employee => employee.status), employees.map(employee => employee.status));
  assert.deepEqual(reopened.snapshot().employees.map(employee => employee.modules), employees.map(employee => employee.modules));
  assert.deepEqual(reopened.snapshot().memories, before.memories);
  assert.equal(reopened.snapshot().runs.length, 1);
  await assert.rejects(reopened.cancelProjectTeams(input), { code: 'CONFLICT' });
});

test('cancelling a team closes its workflow reservation without affecting another project', async t => {
  const f = await fixture(t); const team = await f.store.configureProjectTeam(f.input);
  const other = await f.store.configureProjectTeam({ ...f.input, projectId: f.other.id });
  const repository = new WorkflowRepository(f.store);
  const workflow = await repository.saveDefinition({ projectId: f.project.id, projectTeamId: team.id, expectedVersion: 1, workflow: { ...team.workflows[0]!, steps: team.workflows[0]!.steps.slice(0, 1) } });
  const input = { projectId: f.project.id, projectTeamId: team.id, workflowId: workflow.id, workflowVersion: workflow.version!, requestId: 'start', request: '测试流程取消' };
  const flow = await repository.start(input); await repository.advance(flow.id);
  const unrelated = f.store.snapshot().employees.filter(employee => employee.projectId === f.other.id);
  await f.store.cancelProjectTeams({ projectId: f.project.id, teams: [{ id: team.id, version: team.version! }] });
  assert.equal(f.store.snapshot().workflowRuns![0]!.status, 'cancelled');
  assert.equal(f.store.snapshot().runs[0]!.status, 'cancelled');
  assert.deepEqual(repository.actions(), []);
  assert.deepEqual(f.store.snapshot().employees.filter(employee => employee.projectId === f.other.id), unrelated);
  assert.deepEqual(activeProjectTeams(f.store.snapshot(), f.other.id), [other]);
  await assert.rejects(repository.start({ ...input, requestId: 'new' }), /已取消/);
  await assert.rejects(repository.saveDefinition({ projectId: f.project.id, projectTeamId: team.id, expectedVersion: 2, workflow }), /已取消/);
});

test('stale or cross-project cancellation rolls back the whole batch', async t => {
  const f = await fixture(t); const a = await f.store.configureProjectTeam(f.input);
  const b = await f.store.configureProjectTeam({ ...f.input, projectId: f.other.id });
  const before = await readFile(f.file, 'utf8');
  await assert.rejects(f.store.cancelProjectTeams({ projectId: f.project.id, teams: [{ id: a.id, version: 1 }, { id: b.id, version: 1 }] }), /不属于/);
  await assert.rejects(f.store.cancelProjectTeams({ projectId: f.project.id, teams: [{ id: a.id, version: 0 }] }), { code: 'CONFLICT' });
  assert.equal(await readFile(f.file, 'utf8'), before);
});

test('late employee completion preserves output without reviving a cancelled team task', async t => {
  const f = await fixture(t); const team = await f.store.configureProjectTeam(f.input);
  const employeeId = team.members.find(member => member.memberId === 'architect')!.employeeId;
  const task = await f.store.createRun({ projectId: f.project.id, employeeId, request: '正在执行的任务' });
  await f.store.updateRun(task.id, { status: 'running' });
  await f.store.cancelProjectTeams({ projectId: f.project.id, teams: [{ id: team.id, version: 1 }] });
  await assert.rejects(f.store.configureProjectTeam({ ...f.input, restoreVersion: 2 }), /正在停止/);
  const completed = await f.store.updateRun(task.id, { status: 'awaiting-review', output: '取消时到达的结果' });
  assert.equal(completed.status, 'cancelled');
  assert.equal(completed.output, '取消时到达的结果');
  assert.ok(completed.finishedAt);
  await f.store.configureProjectTeam({ ...f.input, restoreVersion: 2 });
  assert.equal(f.store.snapshot().runs.find(run => run.id === task.id)!.status, 'cancelled');
});
