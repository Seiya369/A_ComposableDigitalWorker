import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSeedState, ARCHITECT_TEMPLATE_ID, SOFTWARE_TEAM_ID } from '../src/domain/seed.js';
import { validateState } from '../src/domain/validation.js';
import { WorkforceStore } from '../src/domain/store.js';
import { conversationWorkflowChoices } from '../src/domain/conversation-workflow.js';
import { loadEmployeeSkills } from '../src/harness/skills.js';

test('fresh install supplies complete software roles, knowledge policies and executable non-demo workflows', async () => {
  const seed = createSeedState('2026-10-25T00:00:00.000Z'); validateState(seed);
  const presets = JSON.parse(await readFile('skills/software-development-presets.json', 'utf8'));
  const skills = await loadEmployeeSkills('skills');
  assert.equal(seed.templates.length, 6);
  assert.equal(seed.templates[0]!.id, ARCHITECT_TEMPLATE_ID);
  const team = seed.teams.find(team => team.id === SOFTWARE_TEAM_ID)!;
  assert.equal(team.members.length, 6);
  assert.equal(team.members.filter(member => !member.reportsTo).length, 1);
  assert.equal(team.members.find(member => member.memberId === 'product')!.reportsTo, undefined);
  assert.equal(team.members.find(member => member.memberId === 'architect')!.reportsTo, 'product');
  assert.equal(team.members.find(member => member.memberId === 'developer')!.reportsTo, 'architect');
  for (const role of ['designer', 'tester', 'operator']) assert.equal(team.members.find(member => member.memberId === role)!.reportsTo, 'product');
  for (const role of presets.roles) {
    const member = team.members.find(member => member.memberId === role.role)!;
    const employee = seed.templates.find(employee => employee.id === member.templateId)!;
    assert.equal(employee.status, 'ready');
    assert.ok(employee.modules.responsibilities.duties.length >= 3);
    assert.ok(employee.modules.responsibilities.boundaries.length >= 3);
    assert.deepEqual(employee.modules.capabilities.skills.map(skill => skill.id), [role.required, ...role.preferred.map((skill: { id: string }) => skill.id)]);
    for (const skill of employee.modules.capabilities.skills) assert.ok(skills.has(skill.id));
    assert.equal(employee.modules.knowledge.projectMemory, true);
    assert.equal(employee.modules.knowledge.employeeMemory, true);
    assert.equal(employee.modules.knowledge.memoryWritePolicy, 'explicit-only');
    assert.ok(employee.modules.knowledge.sources.length >= 2);
    assert.equal(employee.modules.model.mode, 'inherit');
  }
  assert.equal(seed.workflowTemplates!.length, 1);
  assert.equal(seed.workflowTemplates![0]!.id, 'workflow-template-software');
  assert.equal(seed.workflowTemplates![0]!.steps.length, 11);
  assert.equal(seed.workflowTemplates![0]!.steps.find(step => step.id === 'requirements')!.roleId, 'product');
  assert.equal(seed.workflowTemplates![0]!.steps.find(step => step.id === 'architecture')!.roleId, 'architect');
  assert.equal(seed.workflowTemplates![0]!.steps.find(step => step.id === 'implementation')!.roleId, 'developer');
  assert.equal(seed.workflowTemplates![0]!.steps.find(step => step.id === 'verification')!.roleId, 'tester');
  assert.match(seed.workflowTemplates![0]!.steps.find(step => step.id === 'implementation')!.instruction, /根因.*修复/);
  assert.equal(team.workflows!.length, 1);
  const flow = seed.workflowTemplates![0]!;
  assert.equal(flow.steps.find(step => step.id === 'deployment')!.roleId, 'operator');
  assert.ok(flow.steps.findIndex(step => step.id === 'deployment') > flow.steps.findIndex(step => step.id === 'acceptance'));
  assert.ok(flow.steps.findIndex(step => step.id === 'deployment') < flow.steps.findIndex(step => step.id === 'retrospective'));
  assert.equal(flow.steps.find(step => step.id === 'release')!.onRejectStepId, 'release');
  assert.equal(flow.steps.find(step => step.id === 'acceptance')!.onRejectStepId, 'implementation');
  assert.match(flow.steps.find(step => step.id === 'release')!.instruction, /不对公众发布或部署生产/);
  assert.match(flow.steps.find(step => step.id === 'deployment')!.instruction, /未获授权|缺少授权/);
  assert.match(seed.templates.find(template => template.id === 'employee-template-tester')!.modules.collaboration.escalationRules.join(' '), /直接向产品负责人.*独立/);
  for (const workflow of seed.workflowTemplates!) {
    assert.deepEqual(workflow.team!.members, team.members);
    for (const step of workflow.steps) {
      assert.ok(step.inputs!.length && step.outputs!.length && step.acceptanceCriteria!.length);
      assert.ok(workflow.roles.find(role => role.id === step.roleId)?.memberId);
      assert.ok(step.onRejectStepId);
    }
    const bound = team.workflows!.find(bound => bound.sourceTemplateId === workflow.id)!;
    assert.equal(bound.steps.length, workflow.steps.length);
  }
  assert.ok(conversationWorkflowChoices(seed, 'new-project').every(choice => choice.available));
  assert.doesNotMatch(JSON.stringify(seed), /【演示】|demo-preview|首版仅|仅配置本架构师/);
  for (const key of ['projects', 'employees', 'runs', 'memories'] as const) assert.deepEqual(seed[key], []);
  const changed = createSeedState(); changed.templates[0]!.modules.knowledge.sources[0]!.value = 'mutated';
  assert.notEqual(createSeedState().templates[0]!.modules.knowledge.sources[0]!.value, 'mutated');
});

test('default workflow installs its complete roster on selection; opening existing state never overwrites user definitions', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'workforce-defaults-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'state.json'), store = await WorkforceStore.open(file);
  const project = await store.saveProject({ name: 'new project', rootPath: directory });
  const flow = store.snapshot().workflowTemplates![0]!;
  await store.selectConversationWorkflow({ projectId: project.id, sessionId: 'session-defaults', workflowTemplateId: flow.id, workflowTemplateVersion: flow.version, templateVersions: Object.fromEntries(store.snapshot().templates.map(template => [template.id, template.version])) }, { expectedRevision: store.snapshot().revision });
  assert.equal(store.snapshot().employees.length, 6);
  assert.equal(store.snapshot().runs.length, 0);
  const before = await readFile(file, 'utf8'); await WorkforceStore.open(file);
  assert.equal(await readFile(file, 'utf8'), before);
  const legacy = createSeedState(); legacy.templates = legacy.templates.slice(0, 1); legacy.teams = []; delete legacy.workflowTemplates;
  legacy.templates[0]!.name = '用户定制岗位'; await writeFile(file, JSON.stringify(legacy));
  const legacyBytes = await readFile(file, 'utf8'); const reopened = await WorkforceStore.open(file);
  assert.equal(reopened.snapshot().templates.length, 1);
  assert.equal(await readFile(file, 'utf8'), legacyBytes);
});
