import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTeamMember } from '../src/domain/team-member-removal.js';
import { WorkforceStore } from '../src/domain/store.js';
import { ARCHITECT_TEMPLATE_ID } from '../src/domain/seed.js';
import type { TeamMember, TeamWorkflow } from '../src/domain/types.js';

const members: TeamMember[] = [
  { memberId: 'product', name: '产品', templateId: ARCHITECT_TEMPLATE_ID },
  { memberId: 'architect', name: '架构', templateId: ARCHITECT_TEMPLATE_ID, reportsTo: 'product' },
  { memberId: 'developer', name: '开发', templateId: ARCHITECT_TEMPLATE_ID, reportsTo: 'architect' },
];
const workflows: TeamWorkflow[] = [{ id: 'software', name: '软件工程', sourceTemplateId: 'original-flow', sourceTemplateVersion: 4, maxAttempts: 5, steps: [
  { id: 'plan', name: '方案', memberId: 'architect', instruction: '做方案', outputs: ['设计文档'], acceptanceCriteria: ['通过评审'], timeoutMs: 12345 },
  { id: 'build', name: '实现', memberId: 'developer', instruction: '做实现', onRejectStepId: 'plan' },
] }];

test('a referenced team position requires an explicit valid successor and leaves the draft unchanged on failure', () => {
  const baseline = structuredClone({ members, workflows });
  for (const successor of [undefined, '', 'missing', 'architect']) assert.throws(() => removeTeamMember(members, workflows, 'architect', successor), /接手人/);
  assert.throws(() => removeTeamMember(members, workflows, 'missing', 'product'), /不存在/);
  assert.deepEqual({ members, workflows }, baseline);
});

test('removing a position reassigns its steps and reparents direct reports without changing frozen workflow details or sources', () => {
  const result = removeTeamMember(members, workflows, 'architect', 'developer');
  assert.deepEqual(result.members.map(item => [item.memberId, item.reportsTo]), [['product', undefined], ['developer', 'product']]);
  assert.deepEqual(result.workflows, workflows.map(workflow => ({ ...workflow, steps: workflow.steps.map(step => ({ ...step, memberId: step.memberId === 'architect' ? 'developer' : step.memberId })) })));
  result.workflows[0]!.steps[0]!.outputs!.push('caller mutation');
  result.members[0]!.name = 'caller mutation';
  assert.deepEqual(workflows[0]!.steps[0]!.outputs, ['设计文档']);
  assert.equal(members[0]!.name, '产品');
});

test('a nonreferenced root can be removed without a successor and its children become roots', () => {
  const result = removeTeamMember(members, workflows, 'product');
  assert.equal(result.members[0]!.memberId, 'architect');
  assert.equal(Object.hasOwn(result.members[0]!, 'reportsTo'), false);
  assert.equal(result.members[1]!.reportsTo, 'architect');
  assert.deepEqual(result.workflows, workflows);
  assert.throws(() => removeTeamMember([members[1]!], workflows, 'architect'), /接手人/);
});

test('saving and removing a team template preserves installed people, hierarchy, workflows, pending tasks, memory, and global adopted snapshots', async t => {
  const root = await mkdtemp(join(tmpdir(), 'team-member-removal-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'state.json');
  const store = await WorkforceStore.open(file);
  const project = await store.saveProject({ name: '隔离项目', rootPath: root });
  const template = store.snapshot().templates.find(item => item.id === ARCHITECT_TEMPLATE_ID)!;
  const team = await store.saveTeam({ name: '软件开发团', members, workflows });
  await store.saveWorkflowTemplate({ id: 'adopted', name: '独立流程', team: { sourceTeamId: team.id, sourceTeamVersion: team.version, name: team.name, members }, roles: [{ id: 'role', name: '架构', memberId: 'architect' }], steps: [{ id: 'step', name: '评审', roleId: 'role', instruction: '评审' }] });
  const projectTeam = await store.configureProjectTeam({ projectId: project.id, teamId: team.id, teamVersion: team.version, templateVersions: { [template.id]: template.version } });
  const employeeId = projectTeam.members.find(member => member.memberId === 'architect')!.employeeId;
  await store.createRun({ projectId: project.id, employeeId, request: '保留的待处理工作' });
  await store.saveMemory({ projectId: project.id, employeeId, scope: 'employee', title: '保留知识', content: '独立项目知识', source: { kind: 'user-confirmed', reference: '测试用户明确确认' } });
  const before = store.snapshot();
  const patch = removeTeamMember(team.members, team.workflows ?? [], 'architect', 'product');
  const changed = await store.saveTeam({ ...team, ...patch }, { expectedVersion: team.version });
  const after = store.snapshot();
  for (const key of ['employees', 'projectTeams', 'workflowTemplates', 'runs', 'memories'] as const) assert.deepEqual(after[key], before[key], `${key} remain separate snapshots`);
  assert.equal(changed.members.length, 2); assert.equal(changed.workflows![0]!.steps[0]!.memberId, 'product');
  assert.equal(changed.members.find(member => member.memberId === 'developer')!.reportsTo, 'product');
  await store.deleteTeam(changed.id, { expectedVersion: changed.version });
  const reopened = (await WorkforceStore.open(file)).snapshot();
  for (const key of ['employees', 'projectTeams', 'workflowTemplates', 'runs', 'memories'] as const) assert.deepEqual(reopened[key], before[key], `${key} survive whole template removal`);
  assert.equal(reopened.teams.some(item => item.id === team.id), false);
});
