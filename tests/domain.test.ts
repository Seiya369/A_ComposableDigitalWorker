import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkforceStore } from '../src/domain/store.js';
import { ARCHITECT_TEMPLATE_ID, createBlankModules, SOFTWARE_TEAM_ID } from '../src/domain/seed.js';
import { buildEmployeePrompt } from '../src/domain/prompt.js';

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'workforce-domain-')); t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'workforce.json'); const store = await WorkforceStore.open(file); const project = await store.saveProject({ name: '项目 A', rootPath: root });
  const employee = await store.createEmployee({ projectId: project.id, templateId: ARCHITECT_TEMPLATE_ID });
  return { root, file, store, project, employee };
}

test('template edits, returned values and reload preserve detached employee snapshots and stable IDs', async t => {
  const { store, file, project, employee } = await fixture(t); const template = store.snapshot().templates[0]!;
  template.modules.responsibilities.mission = '修订后的架构使命'; await store.saveTemplate(template, { expectedVersion: 1 });
  assert.equal(store.snapshot().employees[0]!.templateVersion, 1); assert.notEqual(store.snapshot().employees[0]!.modules.responsibilities.mission, template.modules.responsibilities.mission);
  employee.name = '外部意外修改'; const detached = store.snapshot(); detached.employees[0]!.name = '修改副本';
  assert.notEqual(store.snapshot().employees[0]!.name, '修改副本');
  const reopened = await WorkforceStore.open(file); assert.equal(reopened.snapshot().employees[0]!.id, employee.id);
  await store.saveProject({ id: project.id, name: '项目重命名', rootPath: project.rootPath }); assert.equal(store.snapshot().projects[0]!.id, project.id);
});

test('mutations serialize, stale versions and competing store revisions fail without data loss', async t => {
  const { store, file, employee } = await fixture(t); const stale = await WorkforceStore.open(file);
  await Promise.all([store.updateEmployee(employee.id, { name: '架构甲' }), store.updateEmployee(employee.id, { name: '架构乙' })]);
  assert.equal(store.snapshot().employees[0]!.version, 3);
  await assert.rejects(store.updateEmployee(employee.id, { name: '过期编辑' }, { expectedVersion: 1 }), { code: 'CONFLICT' });
  await assert.rejects(stale.updateEmployee(employee.id, { name: '另一进程旧状态' }), { code: 'CONFLICT' });
  await stale.reload(); assert.equal(stale.snapshot().employees[0]!.name, '架构乙');
  await store.updateEmployee(employee.id, { name: '冲突后继续' }); assert.equal(store.snapshot().employees[0]!.name, '冲突后继续');
  assert.equal(JSON.parse(await readFile(file, 'utf8')).revision, store.snapshot().revision);
});

test('blank drafts instantiate paused; invalid ready configuration and hierarchy cycles roll back', async t => {
  const { store, project, employee } = await fixture(t); const draft = await store.saveTemplate({ name: '空白员工', modules: createBlankModules(), status: 'draft' });
  const blank = await store.createEmployee({ projectId: project.id, templateId: draft.id }); assert.equal(blank.status, 'paused');
  await assert.rejects(store.updateEmployee(blank.id, { status: 'active' }), { code: 'VALIDATION' });
  const before = store.snapshot().revision;
  await assert.rejects(store.saveTeam({ name: '错误团队', members: [{ memberId: 'a', templateId: ARCHITECT_TEMPLATE_ID, reportsTo: 'b' }, { memberId: 'b', templateId: ARCHITECT_TEMPLATE_ID, reportsTo: 'a' }] }), /循环/);
  assert.equal(store.snapshot().revision, before);
  await store.updateEmployee(blank.id, { managerId: employee.id });
  await assert.rejects(store.updateEmployee(employee.id, { managerId: blank.id }), /循环/);
  const group = await store.instantiateTeam(project.id, SOFTWARE_TEAM_ID); assert.equal(group.length, store.snapshot().teams.find(team => team.id === SOFTWARE_TEAM_ID)!.members.length); assert.notEqual(group[0]!.id, employee.id);
});

test('memory CRUD isolates projects and employees, verifies sources, rejects symlink escape', async t => {
  const { store, project, employee, root } = await fixture(t); const otherRoot = await mkdtemp(join(tmpdir(), 'workforce-other-')); t.after(() => rm(otherRoot, { recursive: true, force: true }));
  const otherProject = await store.saveProject({ name: '项目 B', rootPath: otherRoot }); const other = await store.createEmployee({ projectId: otherProject.id, templateId: ARCHITECT_TEMPLATE_ID });
  const shared = await store.saveMemory({ projectId: project.id, scope: 'project', title: '已确认决定', content: '使用模块化单体', source: { kind: 'user-confirmed', reference: '用户在配置面板明确确认' } });
  await store.saveMemory({ projectId: project.id, employeeId: employee.id, scope: 'employee', title: '个人工作经验', content: '接口变更需记录决策', source: { kind: 'user-confirmed', reference: '用户确认' } });
  assert.equal(store.listMemories(project.id).length, 1); assert.equal(store.listMemories(project.id, employee.id).length, 2); assert.equal(store.listMemories(otherProject.id, other.id).length, 0);
  assert.throws(() => store.listMemories(project.id, other.id), /其他项目/);
  await assert.rejects(store.saveMemory({ projectId: project.id, employeeId: other.id, scope: 'employee', title: '错误归属', content: '错误', source: { kind: 'user-confirmed', reference: '确认' } }), /跨项目/);
  await writeFile(join(root, 'decision.md'), '来源');
  await store.saveMemory({ projectId: project.id, scope: 'project', title: '文件证据', content: '事实', source: { kind: 'project-file', path: 'decision.md' } });
  await writeFile(join(otherRoot, 'secret.md'), '其他项目资料'); await symlink(join(otherRoot, 'secret.md'), join(root, 'escape.md'));
  await assert.rejects(store.saveMemory({ projectId: project.id, scope: 'project', title: '越界文件', content: '错误', source: { kind: 'project-file', path: 'escape.md' } }), /本项目/);
  const changed = await store.saveMemory({ ...shared, content: '采用有明确模块边界的单体' }, { expectedVersion: 1 }); assert.equal(changed.version, 2);
  await store.deleteMemory(shared.id, { expectedVersion: 2 }); assert.ok(!store.listMemories(project.id).some(m => m.id === shared.id));
});

test('run lifecycle requires review; memory cannot promote unaccepted or cross-project artifacts', async t => {
  const { store, project, employee } = await fixture(t); const run = await store.createRun({ projectId: project.id, employeeId: employee.id, request: '设计架构' });
  await store.updateEmployee(employee.id, { name: '新名称' }); assert.equal(store.snapshot().runs[0]!.employeeSnapshot.name, employee.name);
  await assert.rejects(store.reviewRun(run.id, { decision: 'accepted', reviewer: 'user' }), /待验收/);
  await store.updateRun(run.id, { status: 'running' }); await store.updateRun(run.id, { status: 'awaiting-review', artifacts: [{ id: 'architecture', title: '架构方案', content: '方案正文与验收条件' }] });
  const memory = { projectId: project.id, scope: 'project' as const, title: '最终方案', content: '采用模块化架构', source: { kind: 'accepted-artifact' as const, runId: run.id, artifactId: 'architecture' } };
  await assert.rejects(store.saveMemory(memory), /已验收/);
  const accepted = await store.reviewRun(run.id, { decision: 'accepted', reviewer: 'user', note: '已审阅方案与边界' }); assert.equal(accepted.status, 'succeeded');
  await store.saveMemory(memory); await assert.rejects(store.updateRun(run.id, { status: 'running' }), /已结束/);
});

test('prompt filters memory scopes even when caller provides an unfiltered snapshot', async t => {
  const { store, project, employee } = await fixture(t); const other = await store.createEmployee({ projectId: project.id, templateId: ARCHITECT_TEMPLATE_ID });
  await store.saveMemory({ projectId: project.id, scope: 'employee', employeeId: other.id, title: '他人私有', content: 'OTHER_PRIVATE_SENTINEL', source: { kind: 'user-confirmed', reference: '确认' } });
  const prompt = buildEmployeePrompt(employee, store.snapshot().memories); assert.ok(!prompt.includes('OTHER_PRIVATE_SENTINEL')); assert.ok(prompt.includes('不得把临时聊天')); assert.ok(prompt.includes('DSH 原生策略')); assert.ok(!prompt.includes('可调用工具：'));
});

test('invalid persisted data is rejected rather than silently replaced with seeds', async t => {
  const { file, store } = await fixture(t); const invalid = store.snapshot() as unknown as Record<string, unknown>; invalid.schemaVersion = 999; await writeFile(file, JSON.stringify(invalid));
  await assert.rejects(WorkforceStore.open(file), /不支持/); assert.equal(JSON.parse(await readFile(file, 'utf8')).schemaVersion, 999);
});

test('host workspace IDs persist on first registration and across path changes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'workforce-workspace-')); t.after(() => rm(root, { recursive: true, force: true }));
  const movedRoot = await mkdtemp(join(tmpdir(), 'workforce-moved-')); t.after(() => rm(movedRoot, { recursive: true, force: true }));
  const store = await WorkforceStore.open(join(root, 'store.json'));
  const project = await store.saveProject({ id: 'host-workspace-stable-id', name: '宿主项目', rootPath: root });
  const employee = await store.createEmployee({ projectId: project.id, templateId: ARCHITECT_TEMPLATE_ID });
  await store.saveProject({ id: project.id, name: '移动后的项目', rootPath: movedRoot });
  assert.equal(store.snapshot().projects[0]!.id, 'host-workspace-stable-id');
  assert.equal(store.snapshot().employees[0]!.projectId, employee.projectId);
});

test('accepted artifacts still cannot be promoted into another project memory', async t => {
  const { store, project, employee } = await fixture(t);
  const otherRoot = await mkdtemp(join(tmpdir(), 'workforce-foreign-artifact-')); t.after(() => rm(otherRoot, { recursive: true, force: true }));
  const otherProject = await store.saveProject({ name: '另一个项目', rootPath: otherRoot });
  const run = await store.createRun({ projectId: project.id, employeeId: employee.id, request: '交付方案' });
  await store.updateRun(run.id, { status: 'running' });
  await store.updateRun(run.id, { status: 'awaiting-review', artifacts: [{ id: 'a', title: '本项目方案', content: '方案正文' }] });
  await store.reviewRun(run.id, { decision: 'accepted', reviewer: 'user' });
  await assert.rejects(store.saveMemory({ projectId: otherProject.id, scope: 'project', title: '不允许跨项目', content: '方案事实', source: { kind: 'accepted-artifact', runId: run.id, artifactId: 'a' } }), /本项目已验收/);
});


test('project-only reads stay detached and never clone employee, memory or run bodies', async t => {
  const { store, project } = await fixture(t);
  const before = store.snapshot();
  const projects = store.listProjects();
  assert.deepEqual(projects, before.projects);
  projects[0]!.name = 'uncommitted external edit'; projects.length = 0;
  assert.equal(store.listProjects()[0]!.name, project.name);
  assert.deepEqual(store.snapshot(), before);
});
