import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSeedState } from '../src/domain/seed.js';
import { applySoftwareDefaultsUpgrade, planSoftwareDefaultsUpgrade, type SoftwareDefaultsUpgradePlan } from '../src/domain/software-defaults-upgrade.js';
import { softwareKnowledgeSources } from '../src/knowledge/software-knowledge.js';
import { validateState } from '../src/domain/validation.js';
import { WorkforceStore } from '../src/domain/store.js';
import type { WorkforceState } from '../src/domain/types.js';

// Package-generated defaults from public commit 3d888df; no installed user state.
async function legacy(): Promise<WorkforceState> {
  return JSON.parse(await readFile(new URL('./fixtures/software-defaults-0.28.json', import.meta.url), 'utf8'));
}
function apply(state: WorkforceState, plan: SoftwareDefaultsUpgradePlan): WorkforceState {
  const copy = structuredClone(state);
  for (const update of plan.templateUpdates) copy.templates[copy.templates.findIndex(value => value.id === update.id)] = update;
  if (plan.teamUpdate) copy.teams[copy.teams.findIndex(value => value.id === plan.teamUpdate!.id)] = plan.teamUpdate;
  if (plan.workflowUpdate) copy.workflowTemplates![copy.workflowTemplates!.findIndex(value => value.id === plan.workflowUpdate!.id)] = plan.workflowUpdate;
  copy.workflowTemplates = copy.workflowTemplates?.filter(flow => !plan.removeWorkflowIds.includes(flow.id));
  return copy;
}
const now = '2026-10-26T00:00:00.000Z';

test('explicit default upgrade repairs hierarchy and linked workflow atomically without touching input or old sources', async () => {
  const state = await legacy(); validateState(state);
  const before = structuredClone(state);
  const plan = planSoftwareDefaultsUpgrade(state, now);
  assert.deepEqual(state, before);
  assert.equal(plan.templateUpdates.length, 6);
  assert.deepEqual(plan.skipped, []);
  assert.deepEqual(plan.removeWorkflowIds, ['workflow-template-defect-repair']);
  assert.equal(plan.teamUpdate!.members.find(member => member.memberId === 'product')!.reportsTo, undefined);
  assert.equal(plan.teamUpdate!.members.find(member => member.memberId === 'architect')!.reportsTo, 'product');
  assert.equal(plan.teamUpdate!.members.find(member => member.memberId === 'developer')!.reportsTo, 'architect');
  for (const role of ['designer', 'tester', 'operator']) assert.equal(plan.teamUpdate!.members.find(member => member.memberId === role)!.reportsTo, 'product');
  const oldStepIds = state.workflowTemplates![0]!.steps.map(step => step.id);
  assert.deepEqual(plan.workflowUpdate!.steps.filter(step => oldStepIds.includes(step.id)).map(step => step.id), oldStepIds);
  assert.equal(plan.workflowUpdate!.steps.length, oldStepIds.length + 1);
  assert.equal(plan.workflowUpdate!.steps.find(step => step.id === 'deployment')!.roleId, 'operator');
  assert.equal(plan.workflowUpdate!.team!.sourceTeamVersion, 2);
  assert.equal(plan.workflowUpdate!.team!.members.find(member => member.memberId === 'architect')!.reportsTo, 'product');
  assert.equal(plan.teamUpdate!.workflows!.length, 1);
  assert.equal(plan.teamUpdate!.workflows![0]!.sourceTemplateVersion, 2);
  for (const update of plan.templateUpdates) {
    const previous = state.templates.find(template => template.id === update.id)!;
    assert.deepEqual(update.modules.knowledge.sources.slice(0, previous.modules.knowledge.sources.length), previous.modules.knowledge.sources);
    assert.equal(update.version, previous.version + 1);
    assert.equal(update.updatedAt, now);
  }
  const updated = apply(state, plan); validateState(updated);
  assert.equal(updated.workflowTemplates!.length, 1);
  assert.deepEqual(updated.projects, state.projects);
  assert.deepEqual(updated.employees, state.employees);
  assert.deepEqual(updated.runs, state.runs);
  assert.deepEqual(planSoftwareDefaultsUpgrade(updated, now), { templateUpdates: [], removeWorkflowIds: [], skipped: [] });
});

test('fresh defaults already include one coherent flow and professional source IDs, so migration is a no-op', () => {
  const state = createSeedState(now);
  assert.deepEqual(planSoftwareDefaultsUpgrade(state, now), { templateUpdates: [], removeWorkflowIds: [], skipped: [] });
  for (const role of ['product', 'architect', 'designer', 'developer', 'tester', 'operator']) {
    const template = state.templates.find(template => template.id === `employee-template-${role}`)!;
    for (const source of softwareKnowledgeSources(role)) assert.ok(template.modules.knowledge.sources.some(value => value.id === source.id));
  }
});

test('custom team or software flow is preserved as a linked pair, including its adopted defect definition', async () => {
  for (const kind of ['team', 'flow'] as const) {
    const state = await legacy();
    if (kind === 'team') state.teams[0]!.members[0]!.name = '用户定制负责人';
    else state.workflowTemplates![0]!.steps[0]!.instruction = '用户自定义实施流程';
    const plan = planSoftwareDefaultsUpgrade(state, now);
    assert.equal(plan.teamUpdate, undefined);
    assert.equal(plan.workflowUpdate, undefined);
    assert.deepEqual(plan.removeWorkflowIds, []);
    assert.ok(plan.skipped.length >= 1);
    const updated = apply(state, plan); validateState(updated);
    assert.deepEqual(updated.teams, state.teams);
    assert.deepEqual(updated.workflowTemplates, state.workflowTemplates);
  }
});

test('custom defect flow and custom team adoption retain their definitions and binding history', async () => {
  const modified = await legacy(); modified.workflowTemplates![1]!.name = '用户缺陷处理流程';
  assert.deepEqual(planSoftwareDefaultsUpgrade(modified, now).removeWorkflowIds, []);
  const adopted = await legacy(); adopted.teams.push({ ...structuredClone(adopted.teams[0]!), id: 'user-project-team', name: '用户团队' });
  const plan = planSoftwareDefaultsUpgrade(adopted, now);
  assert.deepEqual(plan.removeWorkflowIds, []);
  assert.ok(plan.teamUpdate && plan.workflowUpdate);
  const updated = apply(adopted, plan); validateState(updated);
  assert.deepEqual(updated.teams.find(team => team.id === 'user-project-team'), adopted.teams[1]);
});

test('professional source additions preserve custom names, all other modules, custom sources and source ID collisions', async () => {
  const state = await legacy();
  const product = state.templates.find(template => template.id === 'employee-template-product')!;
  product.name = '自定义产品岗位'; product.modules.knowledge.sources.push({ id: 'user-source', title: '用户资料', kind: 'text', value: '用户的专业资料' });
  const architect = state.templates.find(template => template.id === 'employee-template-architect')!;
  const source = softwareKnowledgeSources('architect')[0]!;
  architect.modules.knowledge.sources.push({ ...source, value: '用户覆盖的同 ID 资料，必须保留' });
  const developer = state.templates.find(template => template.id === 'employee-template-developer')!;
  developer.modules.capabilities.skills = [];
  const plan = planSoftwareDefaultsUpgrade(state, now);
  const update = plan.templateUpdates.find(template => template.id === product.id)!;
  assert.equal(update.name, product.name);
  assert.deepEqual(update.modules.responsibilities, product.modules.responsibilities);
  assert.deepEqual(update.modules.knowledge.sources.slice(0, product.modules.knowledge.sources.length), product.modules.knowledge.sources);
  const nextArchitect = plan.templateUpdates.find(template => template.id === architect.id) || architect;
  assert.equal(nextArchitect.modules.knowledge.sources.find(value => value.id === source.id)!.value, '用户覆盖的同 ID 资料，必须保留');
  assert.equal(plan.templateUpdates.some(template => template.id === developer.id), false);
});

test('authorized store transaction preserves detached project employees and confirmed memory; ordinary reopen never reseeds', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'software-default-upgrade-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'state.json');
  await writeFile(file, JSON.stringify(await legacy()));
  const store = await WorkforceStore.open(file);
  const project = await store.saveProject({ name: 'User project', rootPath: directory });
  const employee = await store.createEmployee({ projectId: project.id, templateId: 'employee-template-developer' });
  await store.saveMemory({ projectId: project.id, scope: 'employee', employeeId: employee.id, title: 'User fact', content: 'Explicitly confirmed project fact', source: { kind: 'user-confirmed', reference: 'Fixture user' } });
  const before = store.snapshot();
  const bytesBeforeReopen = await readFile(file, 'utf8');
  await WorkforceStore.open(file);
  assert.equal(await readFile(file, 'utf8'), bytesBeforeReopen);
  await store.transaction(candidate => { Object.assign(candidate, apply(candidate, planSoftwareDefaultsUpgrade(candidate, now))); }, { expectedRevision: before.revision });
  const updated = store.snapshot(); validateState(updated);
  assert.equal(updated.revision, before.revision + 1);
  assert.deepEqual(updated.projects, before.projects);
  assert.deepEqual(updated.employees, before.employees);
  assert.deepEqual(updated.memories, before.memories);
  assert.deepEqual(updated.runs, before.runs);
  assert.equal(updated.teams[0]!.members.find(member => member.memberId === 'architect')!.reportsTo, 'product');
  assert.equal(updated.workflowTemplates!.length, 1);
  assert.deepEqual(planSoftwareDefaultsUpgrade(updated, now), { templateUpdates: [], removeWorkflowIds: [], skipped: [] });
  assert.deepEqual((await WorkforceStore.open(file)).snapshot(), updated);
});

async function idleAdoption(t: { after(fn: () => Promise<void>): void }) {
  const directory = await mkdtemp(join(tmpdir(), 'software-idle-adoption-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'state.json'); await writeFile(file, JSON.stringify(await legacy()));
  const store = await WorkforceStore.open(file);
  const project = await store.saveProject({ name: 'Adopted user project', rootPath: directory });
  const workflow = store.snapshot().workflowTemplates![0]!;
  await store.selectConversationWorkflow({ projectId: project.id, sessionId: 'existing-native-session', workflowTemplateId: workflow.id, workflowTemplateVersion: workflow.version,
    templateVersions: Object.fromEntries(store.snapshot().templates.map(template => [template.id, template.version])) }, { expectedRevision: store.revision });
  return { store, project };
}

test('idle untouched adoption follows the corrected hierarchy with identical employees, modules, session selection and history', async t => {
  const { store, project } = await idleAdoption(t);
  const previous = store.snapshot();
  const productId = previous.projectTeams![0]!.members.find(member => member.memberId === 'product')!.employeeId;
  await store.saveMemory({ projectId: project.id, scope: 'employee', employeeId: productId, title: 'Confirmed note', content: 'A user fact survives hierarchy changes', source: { kind: 'user-confirmed', reference: 'Fixture user' } });
  const before = store.snapshot();
  const plan = planSoftwareDefaultsUpgrade(before, now);
  assert.ok(plan.teamUpdate && plan.workflowUpdate);
  assert.deepEqual(plan.skipped, []);
  await store.transaction(state => applySoftwareDefaultsUpgrade(state, plan), { expectedRevision: before.revision });
  const updated = store.snapshot(); validateState(updated);
  assert.deepEqual(updated.projectTeams![0]!.members, before.projectTeams![0]!.members);
  const bindings = new Map(updated.projectTeams![0]!.members.map(member => [member.memberId, member.employeeId]));
  for (const employee of updated.employees) {
    const old = before.employees.find(value => value.id === employee.id)!;
    assert.deepEqual(employee.modules, old.modules);
    assert.equal(employee.templateVersion, old.templateVersion);
    assert.equal(employee.name, old.name);
  }
  assert.equal(updated.employees.find(employee => employee.id === bindings.get('product'))!.managerId, undefined);
  assert.equal(updated.employees.find(employee => employee.id === bindings.get('architect'))!.managerId, bindings.get('product'));
  assert.equal(updated.employees.find(employee => employee.id === bindings.get('developer'))!.managerId, bindings.get('architect'));
  for (const role of ['designer', 'tester', 'operator']) assert.equal(updated.employees.find(employee => employee.id === bindings.get(role))!.managerId, bindings.get('product'));
  const instance = updated.conversationWorkflows!.instances[0]!;
  assert.equal(instance.id, before.conversationWorkflows!.instances[0]!.id);
  assert.equal(instance.currentStepId, before.conversationWorkflows!.instances[0]!.currentStepId);
  assert.equal(instance.workflowTemplateVersion, 2);
  assert.equal(instance.sourceTeamVersion, 2);
  assert.deepEqual(instance.completions, before.conversationWorkflows!.instances[0]!.completions);
  assert.deepEqual(updated.conversationWorkflows!.defaults, before.conversationWorkflows!.defaults);
  assert.deepEqual(updated.conversationWorkflows!.selections, before.conversationWorkflows!.selections);
  assert.deepEqual(updated.memories, before.memories);
  assert.deepEqual(updated.runs, []);
  assert.equal(updated.employees.length, 6);
  const projectWorkflow = updated.projectTeams![0]!.workflows[0]!;
  assert.equal(projectWorkflow.steps.find(step => step.id === 'requirements')!.employeeId, bindings.get('product'));
  assert.equal(projectWorkflow.steps.find(step => step.id === 'architecture')!.employeeId, bindings.get('architect'));
  assert.equal(projectWorkflow.steps.find(step => step.id === 'implementation')!.employeeId, bindings.get('developer'));
  assert.equal(projectWorkflow.steps.find(step => step.id === 'deployment')!.employeeId, bindings.get('operator'));
  assert.equal(projectWorkflow.steps.length, 11);
  assert.equal(projectWorkflow.id, before.projectTeams![0]!.workflows[0]!.id);
  assert.equal(projectWorkflow.templateWorkflowVersion, 2);
  assert.deepEqual(planSoftwareDefaultsUpgrade(updated, now), { templateUpdates: [], removeWorkflowIds: [], skipped: [] });
});

test('adopted custom roster or any execution preserves the shared main definition and reports a skipped migration', async t => {
  const { store, project } = await idleAdoption(t);
  const before = store.snapshot();
  const customized = structuredClone(before);
  customized.employees.find(employee => employee.templateId === 'employee-template-product')!.modules.responsibilities.mission = '用户修改过的项目职责';
  const customPlan = planSoftwareDefaultsUpgrade(customized, now);
  assert.equal(customPlan.teamUpdate, undefined); assert.equal(customPlan.workflowUpdate, undefined);
  assert.ok(customPlan.skipped.some(message => message.includes('采用后的人员')));
  const changedHierarchy = structuredClone(before);
  delete changedHierarchy.employees.find(employee => employee.templateId === 'employee-template-developer')!.managerId;
  assert.equal(planSoftwareDefaultsUpgrade(changedHierarchy, now).workflowUpdate, undefined);
  const instance = before.conversationWorkflows!.instances[0]!;
  const employee = before.employees.find(value => value.templateId === 'employee-template-product')!;
  const run = await store.createRun({ projectId: project.id, employeeId: employee.id, request: 'A historical attempt', conversationWorkflow: { instanceId: instance.id, stepId: 'requirements' } });
  await store.updateRun(run.id, { status: 'failed', error: 'Fixture failure' });
  const executed = store.snapshot(); validateState(executed);
  const executedPlan = planSoftwareDefaultsUpgrade(executed, now);
  assert.equal(executedPlan.teamUpdate, undefined); assert.equal(executedPlan.workflowUpdate, undefined);
  assert.ok(executedPlan.skipped.some(message => message.includes('执行记录')));
  const unchangedRuns = structuredClone(executed.runs);
  await store.transaction(state => applySoftwareDefaultsUpgrade(state, executedPlan), { expectedRevision: executed.revision });
  assert.deepEqual(store.snapshot().runs, unchangedRuns);
  assert.deepEqual(store.snapshot().projectTeams, executed.projectTeams);
});

test('a stale upgrade plan refuses all changes before editing any template', async () => {
  const state = await legacy(); const plan = planSoftwareDefaultsUpgrade(state, now);
  state.teams[0]!.name = 'Changed after planning'; const before = structuredClone(state);
  assert.throws(() => applySoftwareDefaultsUpgrade(state, plan), /团队配置已变化/);
  assert.deepEqual(state, before);
});
