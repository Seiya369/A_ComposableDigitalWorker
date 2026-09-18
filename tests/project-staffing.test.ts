import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkforceStore } from '../src/domain/store.js';
import { ARCHITECT_TEMPLATE_ID, createBlankModules } from '../src/domain/seed.js';

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'workforce-staffing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'state.json');
  const store = await WorkforceStore.open(file);
  await Promise.all(['a', 'b'].map(name => mkdir(join(root, name))));
  const projectA = await store.saveProject({ name: '项目 A', rootPath: join(root, 'a') });
  const projectB = await store.saveProject({ name: '项目 B', rootPath: join(root, 'b') });
  const template = store.snapshot().templates.find(t => t.id === ARCHITECT_TEMPLATE_ID)!;
  return { root, file, store, projectA, projectB, template };
}

test('project staffing creates detached project overrides without changing the platform template', async t => {
  const { file, store, projectA, projectB, template } = await fixture(t);
  const modulesA = structuredClone(template.modules);
  modulesA.responsibilities.mission = '负责项目 A 的支付模块架构';
  modulesA.permissions.readPaths = ['src/payments/**'];
  modulesA.permissions.writePaths = ['docs/payments/**'];
  modulesA.knowledge.projectMemory = true;
  modulesA.knowledge.employeeMemory = false;
  const modulesB = structuredClone(template.modules);
  modulesB.responsibilities.mission = '负责项目 B 的视频任务';
  modulesB.permissions.readPaths = ['assets/**'];
  modulesB.permissions.writePaths = [];
  modulesB.knowledge.projectMemory = false;
  modulesB.knowledge.employeeMemory = true;

  const [employeeA] = await store.createProjectEmployees({ projectId: projectA.id, employees: [{ key: 'architect', templateId: template.id, templateVersion: template.version, name: '支付架构师', modules: modulesA }] });
  const [employeeB] = await store.createProjectEmployees({ projectId: projectB.id, employees: [{ key: 'architect', templateId: template.id, templateVersion: template.version, name: '视频架构师', modules: modulesB, status: 'paused' }] });
  assert.ok(employeeA && employeeB);
  assert.notEqual(employeeA.id, employeeB.id);
  assert.equal(employeeA.status, 'active');
  assert.equal(employeeB.status, 'paused');
  assert.equal(employeeA.projectId, projectA.id);
  assert.equal(employeeB.projectId, projectB.id);
  assert.deepEqual(employeeA.modules, modulesA);
  assert.deepEqual(employeeB.modules, modulesB);
  assert.equal(employeeA.templateVersion, template.version);
  assert.deepEqual(store.snapshot().templates.find(t => t.id === template.id), template);

  // Neither the submitted form nor the returned result may retain live store references.
  modulesA.permissions.readPaths.push('UNEXPECTED/**');
  employeeA.modules.knowledge.projectMemory = false;
  const reloaded = await WorkforceStore.open(file);
  const persistedA = reloaded.snapshot().employees.find(e => e.id === employeeA.id)!;
  assert.deepEqual(persistedA.modules.permissions.readPaths, ['src/payments/**']);
  assert.equal(persistedA.modules.knowledge.projectMemory, true);
  assert.deepEqual(reloaded.snapshot().templates.find(t => t.id === template.id), template);
});

test('batch staffing resolves forward manager keys and existing same-project managers in one revision', async t => {
  const { store, projectA, template } = await fixture(t);
  const existing = await store.createEmployee({ projectId: projectA.id, templateId: template.id, name: '项目负责人' });
  const before = store.snapshot().revision;
  const created = await store.createProjectEmployees({ projectId: projectA.id, employees: [
    { key: 'engineer', templateId: template.id, templateVersion: template.version, name: '工程师', managerKey: 'architect' },
    { key: 'architect', templateId: template.id, templateVersion: template.version, name: '架构师', managerId: existing.id },
  ] });
  const engineer = created.find(e => e.name === '工程师')!;
  const architect = created.find(e => e.name === '架构师')!;
  assert.equal(engineer.managerId, architect.id);
  assert.equal(architect.managerId, existing.id);
  assert.equal(store.snapshot().revision, before + 1);
  assert.equal(store.snapshot().employees.filter(e => e.projectId === projectA.id).length, 3);
});

test('staffing creates no memory records and never copies another instance private memory', async t => {
  const { store, projectA, projectB, template } = await fixture(t);
  const previous = await store.createEmployee({ projectId: projectA.id, templateId: template.id });
  const shared = await store.saveMemory({ projectId: projectA.id, scope: 'project', title: '项目 A 已确认事实', content: 'PROJECT_A_ONLY', source: { kind: 'user-confirmed', reference: '本项目用户明确确认' } });
  await store.saveMemory({ projectId: projectA.id, scope: 'employee', employeeId: previous.id, title: '既有员工经验', content: 'PREVIOUS_EMPLOYEE_PRIVATE', source: { kind: 'user-confirmed', reference: '用户确认' } });
  const memoriesBefore = store.snapshot().memories;
  const [freshA] = await store.createProjectEmployees({ projectId: projectA.id, employees: [{ key: 'a', templateId: template.id, templateVersion: template.version }] });
  const [freshB] = await store.createProjectEmployees({ projectId: projectB.id, employees: [{ key: 'b', templateId: template.id, templateVersion: template.version }] });
  assert.ok(freshA && freshB);
  assert.deepEqual(store.snapshot().memories, memoriesBefore);
  assert.deepEqual(store.listMemories(projectA.id, freshA.id).map(m => m.id), [shared.id]);
  assert.deepEqual(store.listMemories(projectB.id, freshB.id), []);
  assert.throws(() => store.listMemories(projectA.id, freshB.id), { code: 'VALIDATION' });
});

test('a stale template fails the entire staffing batch and leaves disk unchanged', async t => {
  const { store, file, projectA, template } = await fixture(t);
  const revised = await store.saveTemplate({ ...template, description: '模板已由另一位用户修订' }, { expectedVersion: template.version });
  const before = store.snapshot();
  const diskBefore = await readFile(file, 'utf8');
  await assert.rejects(store.createProjectEmployees({ projectId: projectA.id, employees: [
    { key: 'current', templateId: template.id, templateVersion: revised.version },
    { key: 'stale', templateId: template.id, templateVersion: template.version },
  ] }), { code: 'CONFLICT' });
  assert.deepEqual(store.snapshot(), before);
  assert.equal(await readFile(file, 'utf8'), diskBefore);
});

test('foreign, missing, duplicate and cyclic manager references roll back the entire batch', async t => {
  const { store, file, projectA, projectB, template } = await fixture(t);
  const foreign = await store.createEmployee({ projectId: projectB.id, templateId: template.id });
  const base = { templateId: template.id, templateVersion: template.version };
  const invalid = [
    [{ ...base, key: 'first' }, { ...base, key: 'foreign', managerId: foreign.id }],
    [{ ...base, key: 'first' }, { ...base, key: 'missing', managerKey: 'not-selected' }],
    [{ ...base, key: 'duplicate' }, { ...base, key: 'duplicate' }],
    [{ ...base, key: 'a', managerKey: 'b' }, { ...base, key: 'b', managerKey: 'a' }],
    [{ ...base, key: 'self', managerKey: 'self' }],
  ];
  for (const employees of invalid) {
    const before = store.snapshot();
    const diskBefore = await readFile(file, 'utf8');
    await assert.rejects(store.createProjectEmployees({ projectId: projectA.id, employees }), { code: 'VALIDATION' });
    assert.deepEqual(store.snapshot(), before);
    assert.equal(await readFile(file, 'utf8'), diskBefore);
  }
});

test('only published templates can be selected for project staffing', async t => {
  const { store, projectA, template } = await fixture(t);
  const draft = await store.saveTemplate({ name: '尚未配置的员工', modules: createBlankModules(), status: 'draft' });
  const archived = await store.archiveTemplate(template.id);
  for (const unavailable of [draft, archived]) {
    const before = store.snapshot();
    await assert.rejects(store.createProjectEmployees({ projectId: projectA.id, employees: [{ key: 'unavailable', templateId: unavailable.id, templateVersion: unavailable.version, status: 'paused' }] }), { code: 'VALIDATION' });
    assert.deepEqual(store.snapshot(), before);
  }
});

test('a lost staffing response can be retried after restart without creating duplicate instances', async t => {
  const { store, file, projectA, template } = await fixture(t);
  const input = { requestId: 'staffing-response-lost', projectId: projectA.id, employees: [
    { key: 'lead', templateId: template.id, templateVersion: template.version, name: '项目技术负责人' },
    { key: 'reviewer', templateId: template.id, templateVersion: template.version, name: '项目评审员', managerKey: 'lead' },
  ] };
  const committed = await store.createProjectEmployees(input);
  // The host committed, but the client never received those IDs. A process restart
  // must preserve enough of the receipt to make the identical retry safe.
  const reopened = await WorkforceStore.open(file);
  const retried = await reopened.createProjectEmployees(structuredClone(input));
  assert.deepEqual(retried.map(employee => employee.id), committed.map(employee => employee.id));
  assert.equal(retried.find(employee => employee.name === '项目评审员')?.managerId, committed.find(employee => employee.name === '项目技术负责人')?.id);
  assert.equal(reopened.snapshot().employees.filter(employee => employee.projectId === projectA.id).length, 2);
  assert.deepEqual(reopened.snapshot().templates.find(item => item.id === template.id), template);
});

test('a staffing request ID cannot change payload or recreate an employee removed after the original commit', async t => {
  const { store, file, projectA, template } = await fixture(t);
  const input = { requestId: 'staffing-fixed-request', projectId: projectA.id, employees: [
    { key: 'lead', templateId: template.id, templateVersion: template.version, name: '负责人' },
    { key: 'reviewer', templateId: template.id, templateVersion: template.version, name: '评审员', managerKey: 'lead' },
  ] };
  const created = await store.createProjectEmployees(input);
  const beforeChangedRetry = store.snapshot();
  const diskBeforeChangedRetry = await readFile(file, 'utf8');
  const changed = structuredClone(input);
  changed.employees[0]!.name = '改变后的岗位';
  await assert.rejects(store.createProjectEmployees(changed), { code: 'CONFLICT' });
  assert.deepEqual(store.snapshot(), beforeChangedRetry);
  assert.equal(await readFile(file, 'utf8'), diskBeforeChangedRetry);

  const reviewer = created.find(employee => employee.name === '评审员')!;
  await store.deleteEmployee(reviewer.id);
  const reopened = await WorkforceStore.open(file);
  const afterDeletion = reopened.snapshot();
  const diskAfterDeletion = await readFile(file, 'utf8');
  await assert.rejects(reopened.createProjectEmployees(input), { code: 'CONFLICT' });
  assert.deepEqual(reopened.snapshot(), afterDeletion);
  assert.equal(await readFile(file, 'utf8'), diskAfterDeletion);
  assert.equal(reopened.snapshot().employees.filter(employee => employee.projectId === projectA.id).length, 1);
});
