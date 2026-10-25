import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { apply } from '../src/harness/host.js';
import { WorkforceStore } from '../src/domain/store.js';
import { ARCHITECT_TEMPLATE_ID } from '../src/domain/seed.js';
import type { EmployeeTemplate, TeamTemplate, WorkforceState, WorkflowTemplate } from '../src/domain/types.js';
import type { ImportPreview, ImportResult, TransferBundle } from '../src/domain/transfer-types.js';
import { exportSettingsBundle, prepareSettingsImport, settingsBundleForSave } from '../src/domain/settings-transfer.js';

/** Exercise the production HTTP handler; only its external host services are fixtures. */
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'graph-horses-http-'));
  const file = join(root, 'state.json');
  const seedStore = await WorkforceStore.open(file);
  const project = await seedStore.saveProject({ id: 'native-workspace', name: '原生项目', rootPath: root });
  let workspaces = [{ id: project.id, title: project.name, path: project.rootPath, sessionIds: [] }];
  let handler: ((req: IncomingMessage, res: ServerResponse) => Promise<void> | void) | undefined;
  const server = createServer((req, res) => {
    if (!handler) { res.writeHead(503).end(); return; }
    void Promise.resolve(handler(req, res)).catch(error => { res.writeHead(500).end(String(error)); });
  });
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const ctx = new Context();
  ctx.provide('webServer', { port: address.port, register(route: { handler: typeof handler }) { handler = route.handler; return () => { handler = undefined; }; } } as never);
  let admissionDenied = false;
  ctx.provide('connection', { admit: () => admissionDenied ? { rejection: 401 } : {} } as never);
  ctx.provide('skills', { register: () => () => undefined, list: async () => [{ name: 'installed-project-skill', description: '项目专用技能', source: 'project', invocation: { modelInvocable: true, userInvocable: true } }] } as never);
  ctx.provide('tools', { schemas: () => [{ name: 'read', description: 'Read files' }, { name: 'bash', description: 'Execute shell commands' }], guard: () => () => undefined } as never);
  ctx.provide('systemPrompt', { context: () => () => undefined } as never);
  ctx.provide('agents', { get: () => undefined, list: () => [] } as never);
  ctx.provide('workspaceRegistry', { list: () => workspaces } as never);
  let catalog = { groups: [{ id: 'configured-provider', name: '已配置供应商', models: [{ id: 'configured-model', name: '已配置模型' }] }], failures: [] };
  ctx.provide('sessionController', { modelCatalog: async () => catalog } as never);
  t.after(async () => {
    await ctx.fiber.dispose();
    server.closeAllConnections();
    await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
    await rm(root, { recursive: true, force: true });
  });
  await apply(ctx, { statePath: file, skillsDirectory: resolve('skills') });
  const request = async (body: string, headers: Record<string, string> = {}) => {
    const response = await fetch(`${origin}/digital-workers/api/command`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body });
    return { status: response.status, body: await response.json() as any };
  };
  const command = <T = unknown>(action: string, payload: unknown = {}, options: unknown = {}) => request(JSON.stringify({ action, payload, options })) as Promise<{ status: number; body: { result: T; state: WorkforceState; error?: string; code?: string } }>;
  const state = async (): Promise<WorkforceState> => {
    const response = await fetch(`${origin}/digital-workers/api/state`); assert.equal(response.status, 200); return response.json() as Promise<WorkforceState>;
  };
  const models = async (headers: Record<string, string> = {}) => {
    const response = await fetch(`${origin}/digital-workers/api/models`, { headers });
    return { status: response.status, body: await response.json() as any };
  };
  const capabilities = async (projectId?: string) => {
    const response = await fetch(`${origin}/digital-workers/api/capabilities${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`);
    return { status: response.status, body: await response.json() as any };
  };
  return { file, project, command, request, state, models, capabilities,
    denyAdmission() { admissionDenied = true; },
    proxyWrite: async (headers: Record<string, string>) => {
      const response = await fetch(`${origin}/digital-workers/api/command`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ action: 'work.saveBrief', payload: { projectId: project.id, goal: 'Desktop proxy delivery', completionCriteria: ['Saved through authenticated proxy'] } }) });
      return { status: response.status, body: await response.json() as any };
    }, changeModels() { catalog = { groups: [{ id: 'second-provider', name: '新供应商', models: [{ id: 'second-model', name: '新模型' }] }], failures: [] }; }, removeWorkspace() { workspaces = []; } };
}

test('HTTP workbench preserves task identity, dependencies and version-bound reviews without automatic model calls', async t => {
  const f = await fixture(t);
  const person = await f.command<any>('employee.create', { projectId: f.project.id, templateId: ARCHITECT_TEMPLATE_ID });
  const brief = await f.command<any>('work.saveBrief', { projectId: f.project.id, goal: '交付可验收的设计与实现', completionCriteria: ['设计与实现有对应证据'] }, { requestId: 'brief' });
  assert.equal(brief.status, 200);
  const task = await f.command<any>('work.saveTask', { projectId: f.project.id, title: '接口设计', goal: '定义接口约定', employeeId: person.body.result.id, acceptanceCriteria: ['接口输入输出明确'] }, { requestId: 'create-task' });
  assert.equal(task.status, 200); const saved = task.body.result;
  assert.equal(task.body.state.runs.length, 0, 'saving work must not start a model');
  const output = task.body.state.workState!.deliverables.find((entry: any) => entry.taskId === saved.id)!;
  const revision = await f.command<any>('work.saveDeliverable', { projectId: f.project.id, id: output.id, taskId: saved.id, title: output.title, content: '# 接口约定\n输入和输出已明确。' }, { requestId: 'revision', expectedVersion: output.version });
  assert.equal(revision.status, 200);
  const current = revision.body.state.workState!.tasks.find((entry: any) => entry.id === saved.id)!;
  const accepted = await f.command<any>('work.reviewTask', { projectId: f.project.id, id: saved.id, decision: 'accepted' }, { requestId: 'review', expectedVersion: current.version });
  assert.equal(accepted.status, 200, accepted.body.error); assert.equal(accepted.body.result.status, 'accepted');
  const descendant = await f.command<any>('work.saveTask', { projectId: f.project.id, title: '实现', goal: '按接口实现', employeeId: person.body.result.id, acceptanceCriteria: ['符合约定'], dependencyTaskIds: [saved.id] }, { requestId: 'downstream' });
  assert.equal(descendant.status, 200);
  const cross = await f.command('work.saveTask', { projectId: f.project.id, title: '非法引用', goal: '拒绝跨项目引用', employeeId: person.body.result.id, acceptanceCriteria: ['拒绝'], dependencyTaskIds: ['another-project-task'] });
  assert.equal(cross.status, 400);
  const completed = await f.command('work.completeProject', { projectId: f.project.id });
  assert.equal(completed.status, 400, 'unaccepted required work cannot complete a project');
  const before = await readFile(f.file, 'utf8');
  f.removeWorkspace();
  assert.equal((await f.command('work.pauseProject', { projectId: f.project.id })).status, 400);
  assert.equal(await readFile(f.file, 'utf8'), before, 'removed native workspaces cannot mutate project work');
});

test('HTTP native capabilities expose a safe inventory and reject unknown workspace roots', async t => {
  const f = await fixture(t);
  const before = await readFile(f.file, 'utf8');
  const catalog = await f.capabilities(f.project.id);
  assert.equal(catalog.status, 200);
  assert.deepEqual(Object.keys(catalog.body).sort(), ['defaultTools', 'limitations', 'mcpError', 'mcps', 'pluginError', 'plugins', 'skills', 'specialTools']);
  assert.deepEqual(catalog.body.plugins, []);
  assert.deepEqual(catalog.body.mcps, []);
  assert.match(catalog.body.pluginError, /插件管理服务/);
  assert.match(catalog.body.mcpError, /不可用/);
  assert.ok(catalog.body.defaultTools.some((tool: any) => tool.id === 'read' && tool.available));
  assert.ok(catalog.body.defaultTools.some((tool: any) => tool.id === 'bash' && tool.available));
  assert.ok(!JSON.stringify(catalog.body).includes(f.project.rootPath));
  assert.equal(await readFile(f.file, 'utf8'), before);
  assert.equal((await f.capabilities('unknown-native-workspace')).status, 400);
});

test('HTTP employee model catalog follows DSH configuration without changing workforce state', async t => {
  const f = await fixture(t);
  const before = await readFile(f.file, 'utf8');
  const first = await f.models();
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { models: [{ provider: 'configured-provider', providerName: '已配置供应商', model: 'configured-model', modelName: '已配置模型' }] });
  f.changeModels();
  const next = await f.models();
  assert.equal(next.status, 200);
  assert.equal(next.body.models[0].model, 'second-model');
  assert.equal(await readFile(f.file, 'utf8'), before);
  assert.equal((await f.models({ Origin: 'https://untrusted.invalid' })).status, 403);
});

test('HTTP workflow template CRUD, team binding and portable template roundtrip use the persisted API state', async t => {
  const f = await fixture(t);
  const saved = await f.command<WorkflowTemplate>('workflow.template.save', { name: '通用设计流程', description: '职责槽位', roles: [{ id: 'owner', name: '设计负责人' }], steps: [{ id: 'design', name: '设计', roleId: 'owner', instruction: '完成方案' }] });
  assert.equal(saved.status, 200); const workflow = saved.body.result;
  const team = await f.command<TeamTemplate>('team.save', { name: '设计团队', members: [{ memberId: 'architect', templateId: ARCHITECT_TEMPLATE_ID }] });
  assert.equal(team.status, 200);
  const bound = await f.command<TeamTemplate>('workflow.template.bind', { teamId: team.body.result.id, workflowTemplateId: workflow.id, bindings: { owner: 'architect' } }, { expectedVersion: team.body.result.version });
  assert.equal(bound.status, 200); assert.equal(bound.body.result.workflows![0]!.steps[0]!.memberId, 'architect');
  const exported = await f.command<TransferBundle>('bundle.export', { scope: 'template', kind: 'team', id: team.body.result.id });
  assert.equal(exported.status, 200); assert.equal(exported.body.result.formatVersion, 1);
  const preview = await f.command<ImportPreview>('bundle.preview', { document: exported.body.result, target: { scope: 'template' } });
  assert.equal(preview.status, 200); assert.equal(preview.body.result.counts.workflowTemplates, 1);
  const imported = await f.command<ImportResult>('bundle.import', { document: JSON.stringify(exported.body.result), target: { scope: 'template', requestId: 'template-roundtrip' } });
  assert.equal(imported.status, 200); assert.notEqual(imported.body.result.rootId, team.body.result.id);
  const copy = imported.body.state.teams.find(entry => entry.id === imported.body.result.rootId)!;
  assert.equal(copy.workflows![0]!.sourceTemplateId, imported.body.result.workflowTemplateIds[0]);
  const updated = await f.command<WorkflowTemplate>('workflow.template.save', { ...workflow, name: '通用设计流程更新' }, { expectedVersion: workflow.version });
  assert.equal(updated.status, 200); assert.equal(updated.body.result.version, 2);
  const stale = await f.command('workflow.template.delete', { id: workflow.id }, { expectedVersion: 1 });
  assert.equal(stale.status, 409);
  const removed = await f.command('workflow.template.delete', { id: workflow.id }, { expectedVersion: 2 });
  assert.equal(removed.status, 200); assert.ok(!removed.body.state.workflowTemplates!.some(entry => entry.id === workflow.id));
  assert.equal(removed.body.state.teams.find(entry => entry.id === team.body.result.id)!.workflows![0]!.name, '通用设计流程');
});

test('HTTP project bundles require an active native workspace and import paused people without starting jobs', async t => {
  const f = await fixture(t);
  const created = await f.command('employee.create', { projectId: f.project.id, templateId: ARCHITECT_TEMPLATE_ID });
  assert.equal(created.status, 200); const employee = created.body.state.employees[0]!;
  const exported = await f.command<TransferBundle>('bundle.export', { scope: 'project', kind: 'employee', id: employee.id, projectId: f.project.id });
  assert.equal(exported.status, 200); assert.ok(!JSON.stringify(exported.body.result).includes(f.project.rootPath));
  const preview = await f.command<ImportPreview>('bundle.preview', { document: exported.body.result, target: { scope: 'project', projectId: f.project.id } });
  assert.equal(preview.status, 200); assert.ok(preview.body.result.warnings.some(warning => warning.includes('暂停')));
  const imported = await f.command<ImportResult>('bundle.import', { document: exported.body.result, target: { scope: 'project', projectId: f.project.id, requestId: 'project-roundtrip' } });
  assert.equal(imported.status, 200); const copy = imported.body.state.employees.find(entry => entry.id === imported.body.result.rootId)!;
  assert.equal(copy.status, 'paused'); assert.deepEqual(copy.modules.permissions.allowedTools, []); assert.deepEqual(copy.modules.permissions.writePaths, []);
  assert.ok(copy.importReview?.requestedPermissions.allowedTools.length); assert.equal(imported.body.state.runs.length, 0);
  f.removeWorkspace(); const before = await readFile(f.file, 'utf8');
  for (const action of ['bundle.preview', 'bundle.import']) {
    const response = await f.command(action, { document: exported.body.result, target: { scope: 'project', projectId: f.project.id, requestId: 'removed-project' } });
    assert.equal(response.status, 400); assert.match(response.body.error!, /项目文件夹已被移除/);
  }
  assert.equal(await readFile(f.file, 'utf8'), before);
});

test('HTTP malformed JSON, unsupported portable formats, unsafe fields and oversized documents leave state unchanged', async t => {
  const f = await fixture(t);
  const exported = await f.command<TransferBundle>('bundle.export', { scope: 'template', kind: 'employee', id: ARCHITECT_TEMPLATE_ID });
  assert.equal(exported.status, 200);
  const before = await readFile(f.file, 'utf8');
  const malformed = await f.request('{"action":"bundle.import",'); assert.equal(malformed.status, 400);
  const invalid = structuredClone(exported.body.result); invalid.formatVersion = 999 as 1;
  const unsupported = await f.command('bundle.import', { document: invalid, target: { scope: 'template', requestId: 'bad-format' } });
  assert.equal(unsupported.status, 400); assert.equal(unsupported.body.code, 'VALIDATION');
  const credential = structuredClone(exported.body.result) as any; credential.data.templates[0].modules.model.apiKey = 'do-not-store';
  const rejected = await f.command('bundle.import', { document: credential, target: { scope: 'template', requestId: 'bad-secret' } }); assert.equal(rejected.status, 400);
  const oversized = await f.command('bundle.preview', { document: ' '.repeat(1_048_577), target: { scope: 'template' } });
  assert.equal(oversized.status, 400); assert.match(oversized.body.error!, /1 MiB/);
  assert.equal(await readFile(f.file, 'utf8'), before);
});

test('HTTP import lost-response retry accepts the old expectedRevision and rejects request ID reuse', async t => {
  const f = await fixture(t);
  const exported = await f.command<TransferBundle>('bundle.export', { scope: 'template', kind: 'employee', id: ARCHITECT_TEMPLATE_ID });
  const options = { expectedRevision: exported.body.state.revision };
  const payload = { document: exported.body.result, target: { scope: 'template', requestId: 'http-idempotent' } };
  const imported = await f.command<ImportResult>('bundle.import', payload, options); assert.equal(imported.status, 200);
  const committed = await readFile(f.file, 'utf8');
  const retried = await f.command<ImportResult>('bundle.import', payload, options);
  assert.equal(retried.status, 200); assert.equal(retried.body.result.rootId, imported.body.result.rootId);
  assert.equal(retried.body.state.revision, imported.body.state.revision); assert.equal(await readFile(f.file, 'utf8'), committed);
  const different = structuredClone(payload); (different.document.data.templates[0] as EmployeeTemplate).name += '不同版本';
  const conflict = await f.command('bundle.import', different, options);
  assert.equal(conflict.status, 409); assert.equal(conflict.body.code, 'CONFLICT'); assert.equal(await readFile(f.file, 'utf8'), committed);
});

test('HTTP object settings save atomically inserts imported dependencies and replaces only the selected template after explicit save', async t => {
  const f = await fixture(t);
  const state = await f.state();
  const current = state.templates.find(value => value.id === ARCHITECT_TEMPLATE_ID)!;
  const source = { ...structuredClone(current), id: 'imported-source', name: '导入职责', modules: { ...structuredClone(current.modules), collaboration: { ...current.modules.collaboration, allowedTemplateIds: ['imported-helper'] } } };
  const helper = { ...structuredClone(current), id: 'imported-helper', name: '导入依赖' };
  const sourceState = { ...structuredClone(state), templates: [...state.templates, source, helper] };
  const document = exportSettingsBundle(sourceState, 'employee', source);
  const staged = prepareSettingsImport(state, document, 'employee', current.id);
  const imported = staged.data.templates.find(value => value.id === current.id)!;
  imported.name = '导入后继续编辑';
  const bundle = settingsBundleForSave(state, 'employee', imported, staged);
  const untouched = await readFile(f.file, 'utf8');
  assert.equal((await f.state()).revision, state.revision, 'local preparation must not persist');
  const denied = await f.request(JSON.stringify({ action: 'settings.bundle.save', payload: { bundle }, options: { expectedVersion: current.version } }), { Origin: 'http://another-origin.invalid' });
  assert.equal(denied.status, 403); assert.equal(await readFile(f.file, 'utf8'), untouched);
  const saved = await f.command<EmployeeTemplate>('settings.bundle.save', { bundle }, { expectedVersion: current.version, expectedRevision: state.revision });
  assert.equal(saved.status, 200, saved.body.error);
  assert.equal(saved.body.result.id, current.id); assert.equal(saved.body.result.name, imported.name);
  assert.equal(saved.body.result.version, current.version + 1); assert.equal(saved.body.result.createdAt, current.createdAt);
  assert.equal(saved.body.state.revision, state.revision + 1);
  assert.ok(saved.body.state.templates.some(value => value.id === imported.modules.collaboration.allowedTemplateIds[0]));
  assert.deepEqual(saved.body.state.employees, state.employees);

  const committed = await readFile(f.file, 'utf8');
  const stale = await f.command('settings.bundle.save', { bundle }, { expectedVersion: current.version });
  assert.equal(stale.status, 409); assert.equal(await readFile(f.file, 'utf8'), committed);
  const invalid = structuredClone(bundle) as any; invalid.data.templates[0].modules.model.credential = 'must-reject';
  const rejected = await f.command('settings.bundle.save', { bundle: invalid }, { expectedVersion: saved.body.result.version });
  assert.equal(rejected.status, 400); assert.equal(await readFile(f.file, 'utf8'), committed);
});

test('HTTP library ordering requires revision and complete identities and persists without version churn', async t => {
  const f = await fixture(t);
  await f.command('template.save', { id: 'ordering-extra-a', name: '排序甲', modules: (await f.state()).templates[0]!.modules });
  await f.command('template.save', { id: 'ordering-extra-b', name: '排序乙', modules: (await f.state()).templates[0]!.modules });
  const before = await f.state(), ids = before.templates.filter(row => row.status !== 'archived').map(row => row.id).reverse();
  assert.equal((await f.command('library.reorder', { kind: 'employee', orderedIds: ids })).status, 400);
  assert.equal((await f.command('library.reorder', { kind: 'employee', orderedIds: [...ids, ids[0]] }, { expectedRevision: before.revision })).status, 400);
  const result = await f.command('library.reorder', { kind: 'employee', orderedIds: ids }, { expectedRevision: before.revision });
  assert.equal(result.status, 200, result.body.error);
  assert.deepEqual(result.body.state.templates.filter(row => row.status !== 'archived').map(row => row.id), ids);
  assert.deepEqual([...result.body.state.templates].sort((a,b) => a.id.localeCompare(b.id)), [...before.templates].sort((a,b) => a.id.localeCompare(b.id)));
  assert.equal((await f.command('library.reorder', { kind: 'employee', orderedIds: ids.reverse() }, { expectedRevision: before.revision })).status, 409);
  assert.deepEqual(await f.state(), result.body.state);
});

test('Desktop proxy saves through production routes only after native admission and explicit client intent', async t => {
  const f = await fixture(t);
  assert.equal((await f.proxyWrite({})).status, 403);
  assert.equal((await f.proxyWrite({ 'X-DSH-Graph-Horses': '1', Origin: 'https://untrusted.invalid' })).status, 403);
  assert.equal((await f.proxyWrite({ 'X-DSH-Graph-Horses': '1', 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  const saved = await f.proxyWrite({ 'X-DSH-Graph-Horses': '1' });
  assert.equal(saved.status, 200, saved.body.error);
  assert.equal(saved.body.result.goal, 'Desktop proxy delivery');
  f.denyAdmission();
  assert.equal((await f.proxyWrite({ 'X-DSH-Graph-Horses': '1' })).status, 401);
});
