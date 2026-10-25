import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { WorkforceStore } from '../src/domain/store.js';
import { exportSettingsBundle, prepareSettingsImport, settingsBundleForSave } from '../src/domain/settings-transfer.js';
import type { EmployeeTemplate, TeamTemplate, WorkflowTemplate } from '../src/domain/types.js';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'object-settings-transfer-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await WorkforceStore.open(join(root, 'state.json'));
  const original = store.snapshot().templates[0]!;
  const helper = await store.saveTemplate({ ...original, id: undefined, name: '依赖员工' });
  const source = await store.saveTemplate({ ...original, id: undefined, name: '导入岗位', modules: { ...structuredClone(original.modules), collaboration: { ...original.modules.collaboration, allowedTemplateIds: [helper.id] } } });
  const workflow = await store.saveWorkflowTemplate({ name: '导入流程', roles: [{ id: 'author', name: '作者' }], steps: [{ id: 'write', roleId: 'author', name: '编写', instruction: '提交原稿' }] });
  const team = await store.saveTeam({ name: '导入团队', members: [{ memberId: 'lead', templateId: source.id }, { memberId: 'helper', templateId: helper.id, reportsTo: 'lead' }], workflows: [{ id: 'bound', name: workflow.name, sourceTemplateId: workflow.id, sourceTemplateVersion: workflow.version, steps: [{ id: 'bound-write', memberId: 'lead', name: '编写', instruction: '提交原稿' }] }] });
  const project = await store.saveProject({ name: '本地项目', rootPath: root });
  await store.configureProjectTeam({ projectId: project.id, teamId: team.id, teamVersion: team.version, templateVersions: { [source.id]: source.version, [helper.id]: helper.version } });
  return { root, store, original, helper, source, workflow, team };
}

test('employee import replaces only an in-memory form, re-export includes changed draft and staged dependencies, save commits atomically', async t => {
  const f = await fixture(t);
  const before = f.store.snapshot(); const bytes = await readFile(f.store.filePath, 'utf8');
  const document = exportSettingsBundle(before, 'employee', f.source);
  const staged = prepareSettingsImport(before, JSON.stringify(document), 'employee', f.original.id);
  const imported = staged.data.templates.find(value => value.id === staged.root.id)!;
  assert.equal(imported.id, f.original.id); assert.equal(imported.version, f.original.version); assert.equal(imported.createdAt, f.original.createdAt);
  assert.equal(imported.name, f.source.name);
  const dependencyId = imported.modules.collaboration.allowedTemplateIds[0]!;
  assert.ok(staged.data.templates.some(value => value.id === dependencyId));
  assert.ok(!before.templates.some(value => value.id === dependencyId));
  assert.deepEqual(f.store.snapshot(), before); assert.equal(await readFile(f.store.filePath, 'utf8'), bytes);

  const edited = { ...structuredClone(imported), name: '导入后继续编辑', modules: { ...structuredClone(imported.modules), responsibilities: { ...imported.modules.responsibilities, mission: '未保存的新职责' } } };
  const outbound = exportSettingsBundle(before, 'employee', edited, staged);
  assert.equal(outbound.data.templates.find(value => value.id === edited.id)!.modules.responsibilities.mission, '未保存的新职责');
  assert.ok(outbound.data.templates.some(value => value.id === dependencyId));
  const saved = await f.store.saveSettingsBundle(settingsBundleForSave(before, 'employee', edited, staged), { expectedVersion: f.original.version }) as EmployeeTemplate;
  assert.equal(saved.id, f.original.id); assert.equal(saved.version, f.original.version + 1); assert.equal(saved.createdAt, f.original.createdAt);
  assert.equal(saved.name, edited.name); assert.equal(saved.modules.responsibilities.mission, '未保存的新职责');
  const after = f.store.snapshot(); assert.equal(after.revision, before.revision + 1);
  assert.ok(after.templates.some(value => value.id === dependencyId));
  assert.deepEqual(after.templates.find(value => value.id === f.source.id), f.source);
  assert.deepEqual(after.employees, before.employees); assert.deepEqual(after.projectTeams, before.projectTeams);
  const dependency = after.templates.find(value => value.id === dependencyId)!;
  const resaved = await f.store.saveSettingsBundle(settingsBundleForSave(after, 'employee', { ...saved, name: '再次保存同一导入草稿' }, staged), { expectedVersion: saved.version }) as EmployeeTemplate;
  assert.equal(resaved.version, saved.version + 1);
  assert.deepEqual(f.store.snapshot().templates.find(value => value.id === dependencyId), dependency, 'saving a retained import draft must not alter already committed dependency identity');
});

test('team import remaps dependency templates, membership, reporting and adopted workflow references before one save', async t => {
  const f = await fixture(t);
  const target = await f.store.saveTeam({ name: '当前团队', members: [] }); const before = f.store.snapshot();
  const staged = prepareSettingsImport(before, exportSettingsBundle(before, 'team', f.team), 'team', target.id);
  const imported = staged.data.teams[0]!;
  assert.equal(imported.id, target.id); assert.equal(imported.version, target.version);
  assert.notEqual(imported.members[0]!.memberId, 'lead');
  assert.equal(imported.members[1]!.reportsTo, imported.members[0]!.memberId);
  assert.equal(imported.workflows![0]!.steps[0]!.memberId, imported.members[0]!.memberId);
  assert.notEqual(imported.workflows![0]!.sourceTemplateId, f.workflow.id);
  assert.ok(staged.data.workflowTemplates.some(value => value.id === imported.workflows![0]!.sourceTemplateId));
  const edited = { ...imported, description: '继续编辑团队说明' };
  const saved = await f.store.saveSettingsBundle(settingsBundleForSave(before, 'team', edited, staged), { expectedVersion: target.version }) as TeamTemplate;
  assert.equal(saved.description, edited.description); assert.equal(saved.version, target.version + 1);
  const after = f.store.snapshot(); assert.equal(after.revision, before.revision + 1);
  assert.deepEqual(after.teams.find(value => value.id === f.team.id), f.team);
  assert.deepEqual(after.employees, before.employees); assert.deepEqual(after.projectTeams, before.projectTeams);
});

test('workflow import retains target identity and fresh role/step references, and unsaved new roots save without an existing version', async t => {
  const f = await fixture(t);
  const target = await f.store.saveWorkflowTemplate({ name: '旧流程', roles: [{ id: 'reader', name: '阅读' }], steps: [{ id: 'read', roleId: 'reader', name: '阅读', instruction: '阅读资料' }] }); const before = f.store.snapshot();
  const staged = prepareSettingsImport(before, exportSettingsBundle(before, 'workflow', f.workflow), 'workflow', target.id);
  const imported = staged.data.workflowTemplates[0]!;
  assert.equal(imported.id, target.id); assert.equal(imported.version, target.version); assert.equal(imported.createdAt, target.createdAt);
  assert.notEqual(imported.roles[0]!.id, 'author'); assert.equal(imported.steps[0]!.roleId, imported.roles[0]!.id);
  const saved = await f.store.saveSettingsBundle(settingsBundleForSave(before, 'workflow', { ...imported, name: '修改后的流程' }, staged), { expectedVersion: target.version }) as WorkflowTemplate;
  assert.equal(saved.id, target.id); assert.equal(saved.version, target.version + 1);

  const newBundle = prepareSettingsImport(f.store.snapshot(), exportSettingsBundle(before, 'workflow', f.workflow), 'workflow', 'stable-new-draft');
  assert.equal(newBundle.root.id, 'stable-new-draft');
  const created = await f.store.saveSettingsBundle(newBundle) as WorkflowTemplate;
  assert.equal(created.id, 'stable-new-draft'); assert.equal(created.version, 1);
});

test('export redacts machine knowledge while save transport preserves legitimate local file declarations', async t => {
  const f = await fixture(t); const state = f.store.snapshot();
  const root = structuredClone(f.source);
  root.modules.knowledge.sources.push({ id: 'local', title: '本地配置文件', kind: 'project-file', value: 'reference.md' });
  assert.ok(!exportSettingsBundle(state, 'employee', root).data.templates.find(value => value.id === root.id)!.modules.knowledge.sources.some(value => value.kind === 'project-file'));
  const forSave = settingsBundleForSave(state, 'employee', root);
  assert.ok(forSave.data.templates.find(value => value.id === root.id)!.modules.knowledge.sources.some(value => value.id === 'local'));
  const saved = await f.store.saveSettingsBundle(forSave, { expectedVersion: root.version }) as EmployeeTemplate;
  assert.ok(saved.modules.knowledge.sources.some(value => value.id === 'local'));
});

test('wrong scope/type, unsafe JSON, cycles, oversized or dangling imports and stale/changed dependencies never commit', async t => {
  const f = await fixture(t); const state = f.store.snapshot(); const bytes = await readFile(f.store.filePath, 'utf8');
  const document = exportSettingsBundle(state, 'team', f.team);
  assert.throws(() => prepareSettingsImport(state, document, 'employee', f.original.id), /相同类型/);
  assert.throws(() => prepareSettingsImport(state, ' '.repeat(1_048_577), 'team', f.team.id), /上限/);
  assert.throws(() => prepareSettingsImport(state, '{"__proto__":{}}', 'team', f.team.id), /不安全/);
  const cyclic: any = structuredClone(document); cyclic.data.self = cyclic;
  assert.throws(() => prepareSettingsImport(state, cyclic, 'team', f.team.id), /层级|字段/);
  const hierarchy = structuredClone(document); hierarchy.data.teams[0]!.members[0]!.reportsTo = hierarchy.data.teams[0]!.members[0]!.memberId;
  assert.throws(() => prepareSettingsImport(state, hierarchy, 'team', f.team.id), /循环/);
  const dangling = structuredClone(document); dangling.data.teams[0]!.members[0]!.templateId = 'missing';
  assert.throws(() => prepareSettingsImport(state, dangling, 'team', f.team.id), /不存在/);
  await assert.rejects(f.store.saveSettingsBundle(document), /更新|刷新/);
  await assert.rejects(f.store.saveSettingsBundle(document, { expectedVersion: f.team.version + 1 }), /更新|刷新/);
  const changedDependency = structuredClone(document); changedDependency.data.templates[0]!.name = '不能覆盖现有依赖';
  await assert.rejects(f.store.saveSettingsBundle(changedDependency, { expectedVersion: f.team.version }), /依赖配置/);
  const extra = structuredClone(document); extra.data.workflowTemplates.push({ ...structuredClone(f.workflow), id: 'unreferenced' });
  await assert.rejects(f.store.saveSettingsBundle(extra, { expectedVersion: f.team.version }), /额外配置/);
  assert.deepEqual(f.store.snapshot(), state); assert.equal(await readFile(f.store.filePath, 'utf8'), bytes);
});

test('settings helpers bundle for browsers without Node builtins', async () => {
  const result = await build({ entryPoints: ['src/domain/settings-transfer.ts'], bundle: true, platform: 'browser', format: 'esm', write: false, logLevel: 'silent' });
  assert.equal(result.outputFiles.length, 1);
  assert.doesNotMatch(result.outputFiles[0]!.text, /node:(?:crypto|buffer|fs)/);
});
