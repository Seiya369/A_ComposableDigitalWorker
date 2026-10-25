import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkforceStore } from '../src/domain/store.js';
import { ARCHITECT_TEMPLATE_ID } from '../src/domain/seed.js';
import { usedWorkflowRoles } from '../src/domain/workflow-template.js';

test('used workflow roles retain role order and identity instead of merging names or duplicating repeated steps', () => {
  const workflow = {
    roles: [{ id: 'historical', name: '旧负责人', description: '历史配置不得丢失' }, { id: 'first', name: '同名负责人', description: '第一位' }, { id: 'second', name: '同名负责人', description: '第二位' }],
    steps: [{ id: 'one', name: '一步', roleId: 'second', instruction: '任务' }, { id: 'two', name: '二步', roleId: 'first', instruction: '任务' }, { id: 'three', name: '三步', roleId: 'second', instruction: '任务' }],
  };
  const before = structuredClone(workflow);
  assert.deepEqual(usedWorkflowRoles(workflow), [workflow.roles[1], workflow.roles[2]]);
  assert.deepEqual(workflow, before);
  assert.deepEqual(usedWorkflowRoles({ ...workflow, steps: [] }), []);
});

test('binding requires only used role IDs, rejects missing or unknown bindings, and preserves all historical role data', async t => {
  const root = await mkdtemp(join(tmpdir(), 'horses-workflow-used-roles-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = await WorkforceStore.open(join(root, 'state.json'));
  const workflow = await store.saveWorkflowTemplate({ name: '精简负责人映射', description: '保留旧说明', maxAttempts: 7,
    roles: [{ id: 'unused', name: '旧负责人', description: '只保留历史，不参与当前流程' }, { id: 'a', name: '评审负责人', description: '审查架构' }, { id: 'b', name: '评审负责人', description: '审查安全' }],
    steps: [{ id: 'architecture', name: '架构评审', roleId: 'a', instruction: '审查结构', inputs: ['设计'], outputs: ['报告'], acceptanceCriteria: ['有依据'], timeoutMs: 12_345 }, { id: 'security', name: '安全评审', roleId: 'b', instruction: '审查边界', acceptanceCriteria: ['保留风险'] }],
  });
  const team = await store.saveTeam({ name: '负责人不同身份', members: [{ memberId: 'left', templateId: ARCHITECT_TEMPLATE_ID }, { memberId: 'right', templateId: ARCHITECT_TEMPLATE_ID }] });
  const before = store.snapshot();
  await assert.rejects(store.bindTeamWorkflow(team.id, workflow.id, { a: 'left' }), /必须绑定/);
  assert.deepEqual(store.snapshot(), before);
  await assert.rejects(store.bindTeamWorkflow(team.id, workflow.id, { a: 'left', b: 'missing' }), /必须绑定/);
  assert.deepEqual(store.snapshot(), before);
  await assert.rejects(store.bindTeamWorkflow(team.id, workflow.id, { a: 'left', b: 'right', unknown: 'left' }), /未知岗位/);
  assert.deepEqual(store.snapshot(), before);

  const saved = await store.bindTeamWorkflow(team.id, workflow.id, { a: 'left', b: 'right' }, { expectedVersion: team.version });
  const bound = saved.workflows![0]!;
  assert.deepEqual(bound.steps.map(step => step.memberId), ['left', 'right'], 'same names must still bind by distinct role ID');
  assert.equal(bound.maxAttempts, 7);
  for (const [index, step] of bound.steps.entries()) {
    const { roleId: _roleId, id: _originalId, ...expected } = workflow.steps[index]!;
    const { id: _boundId, memberId: _memberId, ...actual } = step;
    assert.deepEqual(actual, expected);
  }
  const retained = store.snapshot().workflowTemplates!.find(value => value.id === workflow.id)!;
  assert.deepEqual(retained, workflow);
  assert.equal(retained.roles[0]!.description, '只保留历史，不参与当前流程');
  assert.equal(retained.roles.length, 3);
});

test('standalone role-based workflow is edited, bound and exported without requiring a team', async t => {
  const root = await mkdtemp(join(tmpdir(), 'horses-workflow-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = await WorkforceStore.open(join(root, 'state.json'));
  const workflow = await store.saveWorkflowTemplate({ name: '设计评审', description: '通用流程', roles: [{ id: 'reviewer', name: '评审负责人' }], steps: [{ id: 'review', name: '评审', roleId: 'reviewer', instruction: '核验方案', inputs: ['方案'], outputs: ['评审报告'], acceptanceCriteria: ['有证据'] }] });
  const bundle = store.exportBundle({ scope: 'template', kind: 'workflow', id: workflow.id });
  assert.equal(bundle.data.workflowTemplates[0]!.id, workflow.id);
  const team = await store.saveTeam({ name: '评审团', members: [{ memberId: 'architect', templateId: ARCHITECT_TEMPLATE_ID }] });
  const bound = await store.bindTeamWorkflow(team.id, workflow.id, { reviewer: 'architect' }, { expectedVersion: team.version });
  assert.equal(bound.workflows![0]!.steps[0]!.memberId, 'architect');
  assert.equal(bound.workflows![0]!.sourceTemplateId, workflow.id);
  const changed = await store.saveWorkflowTemplate({ ...workflow, name: '设计评审新版' }, { expectedVersion: workflow.version });
  assert.equal(store.snapshot().teams.find(entry => entry.id === team.id)!.workflows![0]!.name, '设计评审');
  await assert.rejects(store.bindTeamWorkflow(team.id, changed.id, { reviewer: 'missing' }), /成员/);
  const imported = await store.importBundle(bundle, { scope: 'template', requestId: 'workflow-copy' });
  assert.notEqual(imported.rootId, workflow.id);
  const copy = store.snapshot().workflowTemplates!.find(entry => entry.id === imported.rootId)!;
  assert.notEqual(copy.roles[0]!.id, 'reviewer');
  assert.equal(copy.steps[0]!.roleId, copy.roles[0]!.id);
  await store.deleteWorkflowTemplate(changed.id, { expectedVersion: changed.version });
  assert.equal(store.snapshot().teams.find(entry => entry.id === team.id)!.workflows![0]!.steps.length, 1);
});

test('workflow templates reject unknown roles and preserve persisted state on failure', async t => {
  const root = await mkdtemp(join(tmpdir(), 'horses-workflow-validation-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = await WorkforceStore.open(join(root, 'state.json')); const before = store.snapshot();
  await assert.rejects(store.saveWorkflowTemplate({ name: '错误流程', roles: [{ id: 'a', name: '角色' }], steps: [{ id: 's', name: '步骤', roleId: 'missing', instruction: '任务' }] }), /岗位|角色/);
  assert.deepEqual(store.snapshot(), before);
});

test('imported bound workflows point at version one of the remapped global workflow', async t => {
  const root = await mkdtemp(join(tmpdir(), 'horses-workflow-version-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = await WorkforceStore.open(join(root, 'state.json'));
  const first = await store.saveWorkflowTemplate({ name: '工作流', roles: [{ id: 'owner', name: '负责人' }], steps: [{ id: 'step', name: '步骤', roleId: 'owner', instruction: '任务' }] });
  const second = await store.saveWorkflowTemplate(first);
  const team = await store.saveTeam({ name: '团队', members: [{ memberId: 'a', templateId: ARCHITECT_TEMPLATE_ID }] });
  await store.bindTeamWorkflow(team.id, second.id, { owner: 'a' });
  const bundle = store.exportBundle({ scope: 'template', kind: 'team', id: team.id });
  const result = await store.importBundle(bundle, { scope: 'template', requestId: 'bound-version' });
  assert.equal(store.snapshot().teams.find(entry => entry.id === result.rootId)!.workflows![0]!.sourceTemplateVersion, 1);
});

test('project workflow snapshots retain the adopted global source version through portable roundtrip', async t => {
  const root = await mkdtemp(join(tmpdir(), 'horses-project-source-version-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = await WorkforceStore.open(join(root, 'state.json'));
  const project = await store.saveProject({ name: '项目', rootPath: root });
  const first = await store.saveWorkflowTemplate({ name: '版本来源流程', roles: [{ id: 'owner', name: '负责人' }], steps: [{ id: 'step', name: '步骤', roleId: 'owner', instruction: '任务' }] });
  const second = await store.saveWorkflowTemplate(first);
  const team = await store.saveTeam({ name: '团队', members: [{ memberId: 'a', templateId: ARCHITECT_TEMPLATE_ID }] });
  const bound = await store.bindTeamWorkflow(team.id, second.id, { owner: 'a' });
  const installed = await store.configureProjectTeam({ projectId: project.id, teamId: bound.id, teamVersion: bound.version, templateVersions: { [ARCHITECT_TEMPLATE_ID]: 1 } });
  assert.equal(installed.workflows[0]!.templateWorkflowVersion, second.version);
  const bundle = store.exportBundle({ scope: 'project', kind: 'workflow', projectId: project.id, teamId: installed.id, id: installed.workflows[0]!.id });
  assert.equal(bundle.data.projectTeams[0]!.workflows[0]!.templateWorkflowVersion, second.version);
  const imported = await store.importBundle(bundle, { scope: 'project', projectId: project.id, requestId: 'source-version' });
  assert.equal(store.snapshot().projectTeams!.find(entry => entry.id === imported.projectTeamIds[0])!.workflows[0]!.templateWorkflowVersion, second.version);
  const invalid = structuredClone(bundle); invalid.data.projectTeams[0]!.workflows[0]!.templateWorkflowVersion = 0;
  assert.throws(() => store.previewImport(invalid, { scope: 'project', projectId: project.id }), /版本/);
});

test('export detaches unavailable historical workflow provenance instead of attaching the latest global definition', async t => {
  const root = await mkdtemp(join(tmpdir(), 'horses-workflow-history-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = await WorkforceStore.open(join(root, 'state.json'));
  const first = await store.saveWorkflowTemplate({ name: '历史流程', roles: [{ id: 'owner', name: '负责人' }], steps: [{ id: 'step', name: '步骤', roleId: 'owner', instruction: '原始冻结任务' }] });
  const team = await store.saveTeam({ name: '历史团队', members: [{ memberId: 'a', templateId: ARCHITECT_TEMPLATE_ID }] });
  await store.bindTeamWorkflow(team.id, first.id, { owner: 'a' });
  await store.saveWorkflowTemplate({ ...first, steps: first.steps.map(step => ({ ...step, instruction: 'GLOBAL_LATEST_SENTINEL' })) });
  const exported = store.exportBundle({ scope: 'template', kind: 'team', id: team.id });
  assert.equal(exported.data.workflowTemplates.length, 0);
  assert.equal(exported.data.teams[0]!.workflows![0]!.sourceTemplateId, undefined);
  assert.equal(exported.data.teams[0]!.workflows![0]!.sourceTemplateVersion, undefined);
  assert.equal(exported.data.teams[0]!.workflows![0]!.steps[0]!.instruction, '原始冻结任务');
  assert.ok(!JSON.stringify(exported).includes('GLOBAL_LATEST_SENTINEL'));
  assert.equal(store.snapshot().teams.find(entry => entry.id === team.id)!.workflows![0]!.sourceTemplateId, first.id, '导出不得修改原团队');
  assert.ok(store.previewImport(exported, { scope: 'template' }).warnings.some(warning => warning.includes('对应版本') && warning.includes('冻结定义')));
  const imported = await store.importBundle(exported, { scope: 'template', requestId: 'history-copy' });
  const again = store.exportBundle({ scope: 'template', kind: 'team', id: imported.rootId });
  assert.equal(again.data.teams[0]!.workflows![0]!.steps[0]!.instruction, '原始冻结任务');
  assert.equal(again.data.workflowTemplates.length, 0);
});
