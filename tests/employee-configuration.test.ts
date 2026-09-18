import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkforceStore } from '../src/domain/store.js';
import { ARCHITECT_TEMPLATE_ID, createBlankModules } from '../src/domain/seed.js';
import type { MutationOptions, SaveEmployeeConfigurationInput, TeamTemplate } from '../src/domain/types.js';

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'workforce-employee-config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'state.json');
  const store = await WorkforceStore.open(file);
  const template = store.snapshot().templates.find(item => item.id === ARCHITECT_TEMPLATE_ID)!;
  const team = await store.saveTeam({ name: '软件开发团', members: [
    { memberId: 'boss', templateId: template.id },
    { memberId: 'lead', templateId: template.id, name: '团队技术负责人', reportsTo: 'boss' },
    { memberId: 'child', templateId: template.id, reportsTo: 'lead' },
    { memberId: 'grandchild', templateId: template.id, reportsTo: 'child' },
  ] });
  const target = await store.saveTeam({ name: '新项目团', members: [{ memberId: 'head', templateId: template.id }] });
  return { root, file, store, template, team, target };
}

function reference(team: TeamTemplate, memberId = 'lead') {
  return { teamId: team.id, teamVersion: team.version, memberId };
}

async function rejectsWithoutWrite(store: WorkforceStore, file: string, input: SaveEmployeeConfigurationInput, code: string, options?: MutationOptions) {
  const before = store.snapshot();
  const diskBefore = await readFile(file, 'utf8');
  await assert.rejects(store.saveEmployeeConfiguration(input, options), { code });
  assert.deepEqual(store.snapshot(), before);
  assert.equal(await readFile(file, 'utf8'), diskBefore);
}

test('new employee configuration and team membership persist together in one revision', async t => {
  const { file, store, team } = await fixture(t);
  const modules = createBlankModules();
  modules.responsibilities.mission = '负责应用开发';
  const before = store.snapshot();
  const saved = await store.saveEmployeeConfiguration({
    template: { name: '开发人员', modules },
    membership: { target: { ...reference(team, 'developer'), reportsTo: 'lead' } },
  });
  assert.equal(saved.version, 1);
  assert.equal(store.snapshot().revision, before.revision + 1);
  const updatedTeam = store.snapshot().teams.find(item => item.id === team.id)!;
  assert.equal(updatedTeam.version, team.version + 1);
  assert.deepEqual(updatedTeam.members.at(-1), { memberId: 'developer', templateId: saved.id, reportsTo: 'lead' });
  assert.deepEqual(store.snapshot().employees, before.employees);
  assert.deepEqual(store.snapshot().memories, before.memories);
  modules.responsibilities.mission = '外部变更';
  saved.name = '外部变更';
  assert.equal(store.snapshot().templates.at(-1)!.name, '开发人员');
  assert.equal(store.snapshot().templates.at(-1)!.modules.responsibilities.mission, '负责应用开发');
  assert.deepEqual((await WorkforceStore.open(file)).snapshot(), store.snapshot());
});

test('all seven modules and a new manager save together while retaining the member alias', async t => {
  const { file, store, template, team } = await fixture(t);
  const modules = createBlankModules();
  modules.responsibilities = { mission: '管理技术方案', duties: ['编写方案'], boundaries: ['仅负责本项目'] };
  modules.capabilities = { skills: [{ id: 'review', name: '评审', description: '技术评审' }], tools: [] };
  modules.model = { mode: 'override', provider: 'test', model: 'test-model' };
  modules.knowledge = { sources: [{ id: 'scope', title: '项目范围', kind: 'text', value: '应用开发' }], projectMemory: true, employeeMemory: false, memoryWritePolicy: 'explicit-only' };
  modules.permissions = { allowedTools: [], readPaths: ['docs/**'], writePaths: [], allowShell: false, allowNetwork: false };
  modules.collaboration = { canDelegate: false, allowedTemplateIds: [], maxDepth: 1, maxConcurrent: 2, escalationRules: ['需求冲突时升级'] };
  modules.delivery = { requiredArtifacts: ['架构文档'], acceptanceCriteria: ['经过技术评审'], reviewRequired: true };
  const before = store.snapshot().revision;
  const saved = await store.saveEmployeeConfiguration({
    template: { ...template, name: '技术负责人', modules },
    membership: { source: reference(team), target: reference(team) },
  }, { expectedVersion: template.version });
  assert.equal(store.snapshot().revision, before + 1);
  assert.equal(saved.version, template.version + 1);
  assert.deepEqual(saved.modules, modules);
  const changedTeam = store.snapshot().teams.find(item => item.id === team.id)!;
  assert.equal(changedTeam.version, team.version + 1);
  assert.deepEqual(changedTeam.members.find(item => item.memberId === 'lead'), { memberId: 'lead', templateId: template.id, name: '团队技术负责人' });
  assert.equal(changedTeam.members.find(item => item.memberId === 'child')!.reportsTo, 'lead');
  assert.deepEqual((await WorkforceStore.open(file)).snapshot(), store.snapshot());
});

test('moving one membership preserves its alias, reparents direct reports and leaves other teams and project data untouched', async t => {
  const { root, store, template, team, target } = await fixture(t);
  const project = await store.saveProject({ name: '真实项目', rootPath: root });
  const employee = await store.createEmployee({ projectId: project.id, templateId: template.id });
  await store.saveMemory({ projectId: project.id, scope: 'employee', employeeId: employee.id, title: '已确认事实', content: '项目独有记忆', source: { kind: 'user-confirmed', reference: '用户确认' } });
  const before = store.snapshot();
  await store.saveEmployeeConfiguration({
    template: { ...template, description: '新的岗位说明' },
    membership: { source: reference(team), target: { ...reference(target, 'moved-lead'), reportsTo: 'head' } },
  }, { expectedVersion: template.version });
  const after = store.snapshot();
  const sourceAfter = after.teams.find(item => item.id === team.id)!;
  assert.equal(sourceAfter.members.some(item => item.memberId === 'lead'), false);
  assert.equal(sourceAfter.members.find(item => item.memberId === 'child')!.reportsTo, 'boss');
  assert.equal(sourceAfter.members.find(item => item.memberId === 'grandchild')!.reportsTo, 'child');
  assert.deepEqual(after.teams.find(item => item.id === target.id)!.members.at(-1), { memberId: 'moved-lead', templateId: template.id, name: '团队技术负责人', reportsTo: 'head' });
  assert.deepEqual(after.teams.filter(item => ![team.id, target.id].includes(item.id)), before.teams.filter(item => ![team.id, target.id].includes(item.id)));
  assert.deepEqual(after.employees, before.employees);
  assert.deepEqual(after.memories, before.memories);
  assert.deepEqual(after.projects, before.projects);
});

test('removing a root membership promotes its direct reports without removing other uses of the same template', async t => {
  const { store, template, team, target } = await fixture(t);
  await store.saveEmployeeConfiguration({ template, membership: { source: reference(team, 'boss') } }, { expectedVersion: template.version });
  const updated = store.snapshot().teams.find(item => item.id === team.id)!;
  assert.equal(updated.members.some(item => item.memberId === 'boss'), false);
  assert.equal(updated.members.find(item => item.memberId === 'lead')!.reportsTo, undefined);
  assert.equal(updated.members.find(item => item.memberId === 'child')!.reportsTo, 'lead');
  assert.deepEqual(store.snapshot().teams.find(item => item.id === target.id), target);
  assert.equal(store.snapshot().templates.some(item => item.id === template.id), true);
});

test('saving a role without membership changes no team', async t => {
  const { store, template } = await fixture(t);
  const before = store.snapshot().teams;
  await store.saveEmployeeConfiguration({ template: { ...template, description: '独立岗位编辑' } }, { expectedVersion: template.version });
  assert.deepEqual(store.snapshot().teams, before);
});

test('stale source, target and template versions each reject the whole save', async t => {
  const { store, file, template, team, target } = await fixture(t);
  const base = { template: { ...template, name: '不应保存' }, membership: { source: reference(team), target: reference(target, 'moved') } };
  await rejectsWithoutWrite(store, file, { ...base, membership: { ...base.membership, source: { ...reference(team), teamVersion: team.version + 1 } } }, 'CONFLICT');
  await rejectsWithoutWrite(store, file, { ...base, membership: { ...base.membership, target: { ...reference(target, 'moved'), teamVersion: target.version + 1 } } }, 'CONFLICT');
  await rejectsWithoutWrite(store, file, base, 'CONFLICT', { expectedVersion: template.version + 1 });
});

test('missing templates, teams and removed source members cannot be recreated by an old editor', async t => {
  const { store, file, template, team, target } = await fixture(t);
  await rejectsWithoutWrite(store, file, { template: { ...template, id: 'deleted-template' } }, 'NOT_FOUND', { expectedVersion: 1 });
  await store.deleteTeam(target.id);
  await rejectsWithoutWrite(store, file, { template, membership: { target: reference(target, 'new') } }, 'NOT_FOUND');
  const changed = await store.saveTeam({ ...team, members: team.members.filter(item => item.memberId !== 'lead').map(item => item.reportsTo === 'lead' ? { ...item, reportsTo: 'boss' } : item) });
  await rejectsWithoutWrite(store, file, { template, membership: { source: reference(team), target: reference(team) } }, 'CONFLICT');
  await rejectsWithoutWrite(store, file, { template, membership: { source: reference(changed), target: reference(changed) } }, 'NOT_FOUND');
});

test('source template mismatch and changing the same-team identity reject instead of replacing members', async t => {
  const { store, file, template, team } = await fixture(t);
  const other = await store.saveTemplate({ name: '其他岗位', modules: createBlankModules() });
  await rejectsWithoutWrite(store, file, { template: other, membership: { source: reference(team), target: reference(team) } }, 'CONFLICT');
  await rejectsWithoutWrite(store, file, { template, membership: { source: reference(team), target: reference(team, 'renamed-member') } }, 'CONFLICT');
});

test('invalid manager and duplicate target identity never leave behind a newly created template', async t => {
  const { store, file, team, target } = await fixture(t);
  for (const destination of [
    { ...reference(team, 'new'), reportsTo: 'missing' },
    { ...reference(team, 'new'), reportsTo: 'head' },
    { ...reference(team, 'new'), reportsTo: 'new' },
  ]) await rejectsWithoutWrite(store, file, { template: { name: '不得残留的新岗位', modules: createBlankModules() }, membership: { target: destination } }, 'VALIDATION');
  await rejectsWithoutWrite(store, file, { template: { name: '不得残留的新岗位', modules: createBlankModules() }, membership: { target: reference(target, 'head') } }, 'CONFLICT');
});

test('cycles, foreign managers and duplicate destination identities roll back moves and module edits', async t => {
  const { store, file, template, team, target } = await fixture(t);
  for (const reportsTo of ['lead', 'grandchild', 'head']) await rejectsWithoutWrite(store, file, {
    template: { ...template, description: '不得残留的修改' },
    membership: { source: reference(team), target: { ...reference(team), reportsTo } },
  }, 'VALIDATION');
  await rejectsWithoutWrite(store, file, { template, membership: { source: reference(team), target: reference(target, 'head') } }, 'CONFLICT');
  await rejectsWithoutWrite(store, file, { template, membership: { source: reference(team), target: { ...reference(target, 'moved'), reportsTo: 'boss' } } }, 'VALIDATION');
});

test('invalid role modules roll back an otherwise valid move', async t => {
  const { store, file, template, team, target } = await fixture(t);
  const modules = structuredClone(template.modules);
  modules.permissions.readPaths = ['../private'];
  await rejectsWithoutWrite(store, file, { template: { ...template, modules }, membership: { source: reference(team), target: reference(target, 'moved') } }, 'VALIDATION');
});

test('another store committing first cannot cause a stale role-and-team save to overwrite disk', async t => {
  const { store, file, template, team } = await fixture(t);
  const other = await WorkforceStore.open(file);
  await other.saveTeam({ ...team, description: '其他窗口已修改' }, { expectedVersion: team.version });
  await rejectsWithoutWrite(store, file, { template, membership: { source: reference(team), target: reference(team) } }, 'CONFLICT', { expectedVersion: template.version });
  await store.reload();
  await rejectsWithoutWrite(store, file, { template, membership: { source: reference(team), target: reference(team) } }, 'CONFLICT', { expectedVersion: template.version });
});
