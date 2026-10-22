import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkforceStore } from '../src/domain/store.js';
import { ARCHITECT_TEMPLATE_ID } from '../src/domain/seed.js';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'graph-horses-transfer-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await WorkforceStore.open(join(root, 'state.json'));
  const project = await store.saveProject({ name: '本地项目', rootPath: root });
  return { root, store, project };
}

test('template and project transfer preserve the librarian switch', async t => {
  const { store, project } = await fixture(t);
  const template = store.snapshot().templates[0]!;
  const team = await store.saveTeam({ name: '无长期记忆', knowledgeEnabled: false, members: [{ memberId: 'lead', templateId: template.id }] });
  const imported = await store.importBundle(store.exportBundle({ scope: 'template', kind: 'team', id: team.id }), { scope: 'template', requestId: 'librarian-template' });
  assert.equal(store.snapshot().teams.find(team => team.id === imported.rootId)?.knowledgeEnabled, false);
  const installed = await store.configureProjectTeam({ projectId: project.id, teamId: team.id, teamVersion: team.version, templateVersions: { [template.id]: template.version } });
  const bundle = store.exportBundle({ scope: 'project', projectId: project.id, kind: 'team', id: installed.id });
  assert.equal(bundle.data.projectTeams[0]?.knowledgeEnabled, false);
  assert.equal(bundle.data.teams[0]?.knowledgeEnabled, false);
  const result = await store.importBundle(bundle, { scope: 'project', projectId: project.id, requestId: 'librarian-project' });
  assert.equal(store.snapshot().projectTeams?.find(team => team.id === result.rootId)?.knowledgeEnabled, false);
});

test('team bundles close dependencies and remap members, reports, delegation and legacy workflow steps', async t => {
  const { store } = await fixture(t);
  const source = store.snapshot().templates[0]!;
  const helper = await store.saveTemplate({ ...source, id: undefined, name: '协作人' });
  source.modules.collaboration.allowedTemplateIds = [helper.id];
  await store.saveTemplate(source);
  const team = await store.saveTeam({ name: '可移植团队', members: [{ memberId: 'lead', templateId: source.id }, { memberId: 'helper', templateId: helper.id, reportsTo: 'lead' }], workflows: [{ id: 'legacy-flow', name: '旧流程', steps: [{ id: 'step', name: '评审', memberId: 'helper', instruction: '审查方案' }] }] });
  const bundle = store.exportBundle({ scope: 'template', kind: 'team', id: team.id });
  assert.equal(bundle.formatVersion, 1);
  assert.equal(bundle.data.templates.length, 2);
  const result = await store.importBundle(bundle, { scope: 'template', requestId: 'once' });
  const imported = store.snapshot().teams.find(entry => entry.id === result.rootId)!;
  assert.notEqual(imported.id, team.id);
  assert.ok(imported.members.every(member => !['lead', 'helper'].includes(member.memberId)));
  assert.equal(imported.members[1]!.reportsTo, imported.members[0]!.memberId);
  assert.equal(imported.workflows![0]!.steps[0]!.memberId, imported.members[1]!.memberId);
  assert.notEqual(imported.workflows![0]!.steps[0]!.id, 'step');
  const lead = store.snapshot().templates.find(entry => entry.id === imported.members[0]!.templateId)!;
  assert.deepEqual(lead.modules.collaboration.allowedTemplateIds, [imported.members[1]!.templateId]);
  const repeated = await store.importBundle(bundle, { scope: 'template', requestId: 'once' });
  assert.equal(repeated.rootId, result.rootId);
  assert.equal(store.snapshot().teams.filter(entry => entry.name === team.name).length, 2);
  await assert.rejects(store.importBundle(bundle, { scope: 'template', requestId: 'once', projectId: 'different' }), /请求|项目|CONFLICT/);
});

test('import rejects unsupported, dangerous, dangling and excessive documents without any partial commit', async t => {
  const { store } = await fixture(t);
  const original = store.exportBundle({ scope: 'template', kind: 'employee', id: ARCHITECT_TEMPLATE_ID });
  const before = store.snapshot();
  const mutations = [
    (b: any) => { b.formatVersion = 999; },
    (b: any) => { b.data.templates[0].modules.model.apiKey = 'secret'; },
    (b: any) => { b.data.templates[0].modules.collaboration.allowedTemplateIds = ['missing']; },
    (b: any) => { b.data.templates.push(structuredClone(b.data.templates[0])); },
  ];
  for (const mutation of mutations) {
    const broken = structuredClone(original); mutation(broken);
    await assert.rejects(store.importBundle(broken, { scope: 'template', requestId: 'bad' }));
    assert.deepEqual(store.snapshot(), before);
  }
  assert.throws(() => store.previewImport('{"__proto__":{}}', { scope: 'template' }), /安全|键|格式/);
  assert.throws(() => store.previewImport(' '.repeat(2_000_001), { scope: 'template' }), /大小|上限|过大/);
});

test('project instance export omits local data and import requires selected project with safe paused capabilities', async t => {
  const { store, root, project } = await fixture(t);
  const employee = await store.createEmployee({ projectId: project.id, templateId: ARCHITECT_TEMPLATE_ID });
  await store.saveMemory({ projectId: project.id, employeeId: employee.id, scope: 'employee', title: '私有记忆', content: 'PRIVATE_MEMORY', source: { kind: 'user-confirmed', reference: '确认' } });
  await store.createRun({ projectId: project.id, employeeId: employee.id, request: 'PRIVATE_RUN' });
  const bundle = store.exportBundle({ scope: 'project', kind: 'employee', id: employee.id, projectId: project.id });
  const encoded = JSON.stringify(bundle);
  for (const value of [root, 'PRIVATE_MEMORY', 'PRIVATE_RUN', 'rootPath', 'runs', 'memories']) assert.ok(!encoded.includes(value));
  assert.throws(() => store.previewImport(bundle, { scope: 'project' }), /项目/);
  const target = await store.saveProject({ id: 'another-project', name: '新项目', rootPath: await mkdtemp(join(tmpdir(), 'graph-horses-target-')) });
  t.after(() => rm(target.rootPath, { recursive: true, force: true }));
  const result = await store.importBundle(bundle, { scope: 'project', projectId: target.id, requestId: 'project-import' });
  const imported = store.snapshot().employees.find(entry => entry.id === result.rootId)!;
  assert.equal(imported.projectId, target.id);
  assert.equal(imported.status, 'paused');
  assert.deepEqual(imported.modules.permissions.writePaths, []);
  assert.equal(imported.modules.permissions.allowShell, false);
  assert.equal(imported.modules.permissions.allowNetwork, false);
  assert.deepEqual(imported.modules.permissions.allowedTools, []);
  assert.equal(store.snapshot().runs.length, 1);
  assert.equal(store.snapshot().memories.length, 1);
});

test('project team and workflow instances travel with assigned people and import without overwriting source', async t => {
  const { store, project } = await fixture(t);
  const team = await store.saveTeam({ name: '交付团队', members: [{ memberId: 'owner', templateId: ARCHITECT_TEMPLATE_ID }], workflows: [{ id: 'flow', name: '交付', steps: [{ id: 'draft', name: '方案', memberId: 'owner', instruction: '写方案' }] }] });
  const installed = await store.configureProjectTeam({ projectId: project.id, teamId: team.id, teamVersion: team.version, templateVersions: { [ARCHITECT_TEMPLATE_ID]: store.snapshot().templates.find(entry => entry.id === ARCHITECT_TEMPLATE_ID)!.version } });
  const workflow = installed.workflows[0]!;
  const bundle = store.exportBundle({ scope: 'project', kind: 'workflow', id: workflow.id, teamId: installed.id, projectId: project.id });
  const result = await store.importBundle(bundle, { scope: 'project', projectId: project.id, requestId: 'workflow-import' });
  const imported = store.snapshot().projectTeams!.find(entry => entry.id === result.projectTeamIds[0])!;
  assert.notEqual(imported.id, installed.id);
  assert.equal(imported.workflows[0]!.id, result.rootId);
  assert.equal(imported.workflows[0]!.steps[0]!.employeeId, imported.members[0]!.employeeId);
  assert.ok(imported.members.every(member => store.snapshot().employees.find(entry => entry.id === member.employeeId)?.status === 'paused'));
  assert.equal(store.snapshot().workflowRuns?.length ?? 0, 0);
});

test('receipts survive restart and reject a reused request ID with a different document', async t => {
  const { store } = await fixture(t);
  const bundle = store.exportBundle({ scope: 'template', kind: 'employee', id: ARCHITECT_TEMPLATE_ID });
  const first = await store.importBundle(bundle, { scope: 'template', requestId: 'durable' });
  const reopened = await WorkforceStore.open(store.filePath);
  assert.deepEqual(await reopened.importBundle(bundle, { scope: 'template', requestId: 'durable' }), first);
  const changed = structuredClone(bundle); changed.data.templates[0]!.name += '变体';
  const before = reopened.snapshot();
  await assert.rejects(reopened.importBundle(changed, { scope: 'template', requestId: 'durable' }), { code: 'CONFLICT' });
  assert.deepEqual(reopened.snapshot(), before);
});

test('legacy embedded workflow exports directly and every imported definition can export again', async t => {
  const { store } = await fixture(t);
  const team = await store.saveTeam({ name: '旧团队', members: [{ memberId: 'owner', templateId: ARCHITECT_TEMPLATE_ID }], workflows: [{ id: 'flow', name: '旧流程', steps: [{ id: 'step', name: '初稿', memberId: 'owner', instruction: '完成任务' }] }] });
  const bundle = store.exportBundle({ scope: 'template', kind: 'workflow', teamId: team.id, id: 'flow' });
  const result = await store.importBundle(bundle, { scope: 'template', requestId: 'legacy-flow' });
  const exported = store.exportBundle({ scope: 'template', kind: 'workflow', id: result.rootId, teamId: result.teamIds[0]! });
  assert.equal(exported.kind, 'workflow'); assert.equal(exported.data.teams[0]!.workflows![0]!.name, '旧流程');
});

test('export strips credentials and local file references but retains declarative module settings', async t => {
  const { store } = await fixture(t);
  const template = store.snapshot().templates[0]!;
  template.modules.knowledge.sources.push(
    { id: 'file', title: '本机文件', kind: 'project-file', value: 'docs/private.md' },
    { id: 'url', title: '有凭据链接', kind: 'url', value: 'https://example.com/api?token=secret-value' },
  );
  template.modules.model.provider = undefined;
  await store.saveTemplate(template);
  const bundle = store.exportBundle({ scope: 'template', kind: 'employee', id: template.id });
  assert.ok(!JSON.stringify(bundle).includes('private.md')); assert.ok(!JSON.stringify(bundle).includes('secret-value'));
  const result = await store.importBundle(bundle, { scope: 'template', requestId: 'settings' });
  const copy = store.snapshot().templates.find(entry => entry.id === result.rootId)!;
  assert.deepEqual(copy.modules.permissions, template.modules.permissions);
});

test('project workflows with a repeated custom source marker still export as distinct definitions', async t => {
  const { store, project } = await fixture(t);
  const team = await store.saveTeam({ name: '自建流程团队', members: [{ memberId: 'owner', templateId: ARCHITECT_TEMPLATE_ID }] });
  const installed = await store.configureProjectTeam({ projectId: project.id, teamId: team.id, teamVersion: team.version, templateVersions: { [ARCHITECT_TEMPLATE_ID]: 1 } });
  await store.transaction(state => {
    const target = state.projectTeams!.find(entry => entry.id === installed.id)!;
    target.workflows = ['first', 'second'].map(id => ({ id, templateWorkflowId: 'project-custom', name: id, steps: [{ id: 's', name: '步骤', employeeId: target.members[0]!.employeeId, instruction: '完成' }] }));
  });
  const bundle = store.exportBundle({ scope: 'project', kind: 'team', id: installed.id, projectId: project.id });
  assert.equal(new Set(bundle.data.teams[0]!.workflows!.map(flow => flow.id)).size, 2);
  const result = await store.importBundle(bundle, { scope: 'project', projectId: project.id, requestId: 'custom-pair' });
  assert.equal(store.snapshot().projectTeams!.find(entry => entry.id === result.rootId)!.workflows.length, 2);
});

test('lost-response retries with the original expected revision return the receipt without another commit', async t => {
  const { store } = await fixture(t);
  const bundle = store.exportBundle({ scope: 'template', kind: 'employee', id: ARCHITECT_TEMPLATE_ID });
  const options = { expectedRevision: store.snapshot().revision };
  const [first, second] = await Promise.all([
    store.importBundle(bundle, { scope: 'template', requestId: 'retry-stale' }, options),
    store.importBundle(bundle, { scope: 'template', requestId: 'retry-stale' }, options),
  ]);
  assert.equal(first.rootId, second.rootId);
  const revision = store.snapshot().revision;
  assert.equal((await store.importBundle(bundle, { scope: 'template', requestId: 'retry-stale' }, options)).rootId, first.rootId);
  assert.equal(store.snapshot().revision, revision);
});
