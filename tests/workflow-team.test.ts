import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkforceStore } from '../src/domain/store.js';
import { ARCHITECT_TEMPLATE_ID } from '../src/domain/seed.js';
import { adoptWorkflowTeam, captureWorkflowTeam, inferWorkflowTeam } from '../src/domain/workflow-team.js';
import { prepareSettingsImport } from '../src/domain/settings-transfer.js';
import type { WorkflowTemplate } from '../src/domain/types.js';

async function fixture(t: Parameters<Parameters<typeof test>[1]>[0]) {
  const directory = await mkdtemp(join(tmpdir(), 'workforce-adopt-team-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await WorkforceStore.open(join(directory, 'state.json'));
  const worker = await store.saveTemplate({ ...store.snapshot().templates[0]!, id: 'developer', name: '开发人员' });
  const team = await store.saveTeam({ id: 'software-team', name: '软件开发团', members: [{ memberId: 'lead', templateId: ARCHITECT_TEMPLATE_ID, name: '技术负责人' }, { memberId: 'dev', templateId: worker.id, name: '开发人员', reportsTo: 'lead' }] });
  const workflow = await store.saveWorkflowTemplate({ name: '迭代', roles: [{ id: 'reviewer', name: '技术负责人', description: '评审说明' }, { id: 'author', name: '开发人员' }],
    steps: [{ id: 'implement', name: '实现', roleId: 'author', instruction: '实现功能', inputs: ['设计'], outputs: ['实现'], acceptanceCriteria: ['检查通过'], timeoutMs: 12345 }, { id: 'review', name: '评审', roleId: 'reviewer', instruction: '核验结果' }], maxAttempts: 4 });
  return { store, team, workflow };
}

test('adoption captures all members and hierarchy, preserves step requirements, and detaches source changes', async t => {
  const { store, team, workflow } = await fixture(t);
  const definition = adoptWorkflowTeam(workflow, team, store.snapshot().templates);
  assert.equal(definition.team!.members[1]!.reportsTo, 'lead');
  assert.equal(definition.roles.find(role => role.id === 'author')!.memberId, 'dev');
  assert.deepEqual(definition.steps, workflow.steps);
  assert.equal(definition.roles.find(role => role.id === 'reviewer')!.description, '评审说明');
  const saved = await store.saveWorkflowTemplate({ ...workflow, ...definition }, { expectedVersion: workflow.version });
  await store.saveTeam({ ...team, name: '团队已更名', members: team.members.map(member => ({ ...member, name: '已修改' })) });
  assert.equal(store.snapshot().workflowTemplates!.find(item => item.id === saved.id)!.team!.name, '软件开发团');
  assert.equal(saved.maxAttempts, 4);
});

test('legacy inference requires an unambiguous exact binding and never invents owner matches', async t => {
  const { store, team, workflow } = await fixture(t);
  const bound = await store.bindTeamWorkflow(team.id, workflow.id, { author: 'dev', reviewer: 'lead' });
  const renamed = { ...workflow, name: '新名字', version: workflow.version + 1 };
  assert.ok(inferWorkflowTeam(renamed, [bound], store.snapshot().templates));
  assert.equal(inferWorkflowTeam({ ...renamed, steps: renamed.steps.map(step => ({ ...step, instruction: '已改变内容' })) }, [bound], store.snapshot().templates), undefined);
  const another = { ...bound, id: 'another-team' };
  assert.equal(inferWorkflowTeam(workflow, [bound, another], store.snapshot().templates), undefined);
  const duplicate = { ...team, members: team.members.map(member => ({ ...member, name: '同名人员' })) };
  const source = { ...workflow, roles: [{ id: 'someone', name: '同名人员' }], steps: [{ ...workflow.steps[0]!, roleId: 'someone' }] };
  assert.equal(adoptWorkflowTeam(source, duplicate, store.snapshot().templates).steps[0]!.roleId, '');
});

test('changing teams matches stable employee identity; removed owners require explicit reassignment', async t => {
  const { store, team, workflow } = await fixture(t);
  const adopted = adoptWorkflowTeam(workflow, team, store.snapshot().templates);
  const renamed = { ...team, id: 'new-team', members: team.members.filter(member => member.memberId === 'dev').map(member => ({ ...member, memberId: 'new-dev', name: '工程师', reportsTo: undefined })) };
  const changed = adoptWorkflowTeam(adopted, renamed, store.snapshot().templates);
  assert.ok(changed.steps[0]!.roleId);
  assert.equal(changed.steps[1]!.roleId, '');
  assert.equal(changed.roles[0]!.name, '工程师');
});

test('legacy inference preserves distinct roles assigned to one person and unused historical descriptions', async t => {
  const { store, team, workflow } = await fixture(t);
  const saved = await store.saveWorkflowTemplate({ ...workflow, roles: [...workflow.roles, { id: 'unused', name: '历史岗位', description: '保留历史说明' }] });
  const bound = await store.bindTeamWorkflow(team.id, saved.id, { author: 'lead', reviewer: 'lead' });
  const inferred = inferWorkflowTeam(saved, [bound], store.snapshot().templates)!;
  assert.deepEqual(inferred.roles.map(({ memberId: _memberId, ...role }) => role), saved.roles);
  assert.deepEqual(inferred.steps, saved.steps);
  assert.equal(inferred.roles.find(role => role.id === 'author')!.memberId, 'lead');
  assert.equal(inferred.team!.members.length, 2, 'unused team members remain available for selection');
});

test('domain rejects out-of-roster owners, cyclic reporting and missing employee references atomically', async t => {
  const { store, team, workflow } = await fixture(t);
  const adopted = adoptWorkflowTeam(workflow, team, store.snapshot().templates);
  const before = store.snapshot();
  await assert.rejects(store.saveWorkflowTemplate({ ...workflow, ...adopted, roles: adopted.roles.map(role => ({ ...role, memberId: 'outsider' })) }), /团队/);
  const cyclic = structuredClone(adopted.team!); cyclic.members[0]!.reportsTo = 'dev';
  await assert.rejects(store.saveWorkflowTemplate({ ...workflow, ...adopted, team: cyclic }), /循环/);
  const absent = structuredClone(adopted.team!); absent.members[0]!.templateId = 'missing-template';
  await assert.rejects(store.saveWorkflowTemplate({ ...workflow, ...adopted, team: absent }), /模板不存在/);
  assert.deepEqual(store.snapshot(), before);
});

test('standalone workflow export/import and draft-overwrite save preserve full roster and owners', async t => {
  const { store, team, workflow } = await fixture(t);
  const adopted = adoptWorkflowTeam(workflow, team, store.snapshot().templates);
  const saved = await store.saveWorkflowTemplate({ ...workflow, ...adopted }, { expectedVersion: workflow.version });
  const exported = store.exportBundle({ scope: 'template', kind: 'workflow', id: saved.id });
  assert.equal(exported.data.templates.length, 2); assert.equal(exported.data.teams.length, 0);
  const result = await store.importBundle(exported, { scope: 'template', requestId: 'adopted-workflow' });
  const copied = store.snapshot().workflowTemplates!.find(flow => flow.id === result.rootId)!;
  assert.notEqual(copied.team!.members[0]!.memberId, team.members[0]!.memberId);
  assert.equal(copied.team!.members[1]!.reportsTo, copied.team!.members[0]!.memberId);
  for (const step of copied.steps) assert.ok(copied.team!.members.some(member => member.memberId === copied.roles.find(role => role.id === step.roleId)!.memberId));
  const staged = prepareSettingsImport(store.snapshot(), exported, 'workflow', saved.id);
  const before = store.snapshot();
  const overwritten = await store.saveSettingsBundle(staged, { expectedVersion: saved.version }) as WorkflowTemplate;
  assert.equal(overwritten.id, saved.id); assert.equal(overwritten.team!.members.length, 2);
  assert.equal(overwritten.steps[0]!.timeoutMs, 12345);
  assert.deepEqual(store.snapshot().teams, before.teams);
  assert.equal(captureWorkflowTeam(team, before.templates).sourceTeamVersion, team.version);
});

test('adopted knowledge switch survives strict transfer and remapping, and invalid switch types are rejected', async t => {
  const { store, team, workflow } = await fixture(t);
  const disabled = await store.saveTeam({ ...team, knowledgeEnabled: false }, { expectedVersion: team.version });
  const adopted = adoptWorkflowTeam(workflow, disabled, store.snapshot().templates);
  assert.equal(adopted.team!.knowledgeEnabled, false);
  const saved = await store.saveWorkflowTemplate({ ...workflow, ...adopted }, { expectedVersion: workflow.version });
  const exported = store.exportBundle({ scope: 'template', kind: 'workflow', id: saved.id });
  assert.equal(exported.data.workflowTemplates[0]!.team!.knowledgeEnabled, false);
  const imported = await store.importBundle(exported, { scope: 'template', requestId: 'knowledge-gate-import' });
  assert.equal(store.snapshot().workflowTemplates!.find(entry => entry.id === imported.rootId)!.team!.knowledgeEnabled, false);
  const staged = prepareSettingsImport(store.snapshot(), exported, 'workflow', saved.id);
  const overwritten = await store.saveSettingsBundle(staged, { expectedVersion: saved.version }) as WorkflowTemplate;
  assert.equal(overwritten.team!.knowledgeEnabled, false);
  const bad = structuredClone(exported); bad.data.workflowTemplates[0]!.team!.knowledgeEnabled = 'false' as unknown as boolean;
  assert.throws(() => prepareSettingsImport(store.snapshot(), bad, 'workflow', saved.id), /布尔/);
});
