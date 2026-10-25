import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Context } from '@deepseek-ai/cordis';
import { WorkforceStore } from '../src/domain/store.js';
import { createBlankModules } from '../src/domain/seed.js';
import { buildEmployeePrompt } from '../src/domain/prompt.js';
import { KnowledgeEngine } from '../src/knowledge/engine.js';
import { KnowledgeRepository } from '../src/knowledge/repository.js';
import { apply } from '../src/harness/host.js';
import type { KnowledgeCompileRequest } from '../src/knowledge/types.js';
import type { KnowledgeLibraryTarget } from '../src/knowledge/library-api.js';
import type { EmployeeModules } from '../src/domain/types.js';

async function fixture(t: TestContext, sources: EmployeeModules['knowledge']['sources'] = []) {
  const root = await mkdtemp(join(tmpdir(), 'workforce-knowledge-removal-'));
  const store = await WorkforceStore.open(join(root, 'state.json'));
  const modules = createBlankModules();
  modules.responsibilities = { mission: 'Research', duties: ['Read evidence'], boundaries: [] };
  modules.model = { mode: 'override', provider: 'fixture', model: 'offline' };
  modules.knowledge.sources = sources;
  const worker = await store.saveTemplate({ name: 'Worker', status: 'ready', modules });
  const other = await store.saveTemplate({ name: 'Other', status: 'ready', modules: { ...modules, knowledge: { ...modules.knowledge, sources: [] } } });
  const team = await store.saveTeam({ name: 'Team', description: 'Team context', members: [{ memberId: 'worker', templateId: worker.id }, { memberId: 'other', templateId: other.id, reportsTo: 'worker' }] });
  const project = await store.saveProject({ name: 'Project', rootPath: root });
  const repository = new KnowledgeRepository(join(root, 'knowledge'));
  const requests: KnowledgeCompileRequest[] = [];
  const gate: { pending?: Promise<void> } = {};
  const create = () => new KnowledgeEngine(store, repository, async request => {
    requests.push(request);
    await gate.pending;
    return {
      entries: request.sources.map((source, index) => ({ id: `entry-${index}`, title: source.title, content: source.text, citations: [{ sourceId: source.id, sourceVersion: source.version, startLine: 1, endLine: source.text.split('\n').length }] })),
      overview: [{ id: 'topics', title: 'Topics', summary: 'Candidate map', entryIds: request.sources.map((_, index) => `entry-${index}`) }],
    };
  }, () => undefined);
  let engine = create();
  t.after(async () => { await engine.dispose(); await rm(root, { recursive: true, force: true }); });
  await engine.start();
  const target: KnowledgeLibraryTarget = { scope: 'template', employeeId: worker.id, library: 'employee' };
  return { root, store, repository, worker, other, team, project, target, requests, gate,
    get engine() { return engine; },
    async restart() { await engine.dispose(); engine = create(); await engine.start(); },
  };
}

test('removing an upload withdraws only its active reference while preserving original bytes and explicit version history', async t => {
  const f = await fixture(t);
  const bytes = Buffer.from('# 原始专业资料\nSOURCE_REMOVAL_SENTINEL\n');
  await f.engine.upload({ target: f.target, files: [{ name: '原始资料.md', base64: bytes.toString('base64') }, { name: '保留资料.md', content: 'Kept reference' }] });
  await f.engine.flush();
  const before = await f.engine.library(f.target);
  const source = before.sources.find(item => item.title === '原始资料.md')!;
  const result = await f.engine.remove({ target: f.target, sourceId: source.id, version: source.version });
  assert.equal(result.removedSourceId, source.id);
  assert.equal(result.employee, undefined);
  assert.ok(!result.library.sources.some(item => item.id === source.id));
  assert.equal(result.library.sources.find(item => item.title === '保留资料.md')?.text, 'Kept reference');
  await assert.rejects(f.engine.libraryDocument(f.target, 'A', source.id), { code: 'NOT_FOUND' });
  assert.equal((await f.engine.libraryDocument(f.target, 'A', source.id, source.version) as { content: string }).content, bytes.toString());
  const originalPath = (await readdir(f.repository.rootPath, { recursive: true })).find(path => path.endsWith(`A-originals/${source.original!.storageId}.json`))!;
  const original = JSON.parse(await readFile(join(f.repository.rootPath, originalPath), 'utf8'));
  assert.deepEqual(Buffer.from(original.base64, 'base64'), bytes);
  await f.restart();
  assert.ok(!(await f.engine.library(f.target)).sources.some(item => item.id === source.id));
});

test('configuration removal updates the real employee modules and never revives after reconciliation or restart', async t => {
  const f = await fixture(t, [{ id: 'config-note', title: 'Configured reference', kind: 'text', value: 'CONFIG_DELETE_SENTINEL' }]);
  const source = (await f.engine.library(f.target)).sources.find(item => item.title === 'Configured reference')!;
  const result = await f.engine.remove({ target: f.target, sourceId: source.id, version: source.version });
  assert.equal(result.employee?.id, f.worker.id);
  assert.equal(result.employee?.version, f.worker.version + 1);
  assert.deepEqual(result.employee?.modules.knowledge.sources, []);
  const employee = await f.store.createEmployee({ projectId: f.project.id, templateId: f.worker.id });
  assert.doesNotMatch(buildEmployeePrompt(employee), /CONFIG_DELETE_SENTINEL/);
  await f.engine.flush();
  await f.restart();
  assert.deepEqual((await f.engine.library(f.target)).sources, []);
  assert.equal((await f.engine.libraryDocument(f.target, 'A', source.id, source.version) as { content: string }).content, 'CONFIG_DELETE_SENTINEL');
});

test('removing a project file reference updates only the selected employee and preserves the user project file', async t => {
  const f = await fixture(t, [{ id: 'file-ref', title: 'Spec', kind: 'project-file', value: 'spec.md' }]);
  await writeFile(join(f.root, 'spec.md'), 'USER_PROJECT_FILE_SENTINEL');
  const employee = await f.store.createEmployee({ projectId: f.project.id, templateId: f.worker.id });
  const id = `file-${createHash('sha256').update('spec.md').digest('hex')}`;
  await f.engine.ingestFor(employee, { id, title: 'Spec', content: 'USER_PROJECT_FILE_SENTINEL', provenance: 'authorized-project-file', verified: false });
  await f.engine.flush();
  const target: KnowledgeLibraryTarget = { scope: 'project', projectId: f.project.id, employeeId: employee.id, library: 'employee' };
  const source = (await f.engine.library(target)).sources.find(item => item.id === id)!;
  const result = await f.engine.remove({ target, sourceId: id, version: source.version });
  assert.equal(result.employee?.id, employee.id);
  assert.deepEqual(result.employee?.modules.knowledge.sources, []);
  assert.equal(f.store.snapshot().templates.find(item => item.id === f.worker.id)!.modules.knowledge.sources.length, 1);
  assert.equal(await readFile(join(f.root, 'spec.md'), 'utf8'), 'USER_PROJECT_FILE_SENTINEL');
  await f.engine.flush();
  assert.ok(!(await f.engine.library(target)).sources.some(item => item.id === id));
});

test('version conflicts, invalid input, other categories and foreign library targets cannot remove current sources', async t => {
  const f = await fixture(t);
  const initial = await f.engine.upload({ target: f.target, files: [{ name: 'versioned.md', content: 'v1' }] });
  const source = initial.library.sources.find(item => item.id === initial.uploaded[0])!;
  await f.engine.upload({ target: f.target, files: [{ name: 'versioned.md', content: 'v2' }, { name: 'constraint.md', content: 'Must remain', category: 'environment/constraint' }] });
  await assert.rejects(f.engine.remove({ target: f.target, sourceId: source.id, version: source.version }), { code: 'CONFLICT' });
  const current = await f.engine.library(f.target);
  assert.equal(current.sources.find(item => item.id === source.id)?.text, 'v2');
  const environment = current.sources.find(item => item.title === 'constraint.md')!;
  await assert.rejects(f.engine.remove({ target: f.target, sourceId: environment.id, version: environment.version }), /专业资料/);
  await assert.rejects(f.engine.remove({ target: { ...f.target, employeeId: f.other.id }, sourceId: source.id, version: 1 }), { code: 'NOT_FOUND' });
  await assert.rejects(f.engine.remove({ target: { ...f.target, scope: 'project', projectId: 'foreign' }, sourceId: source.id, version: 1 }), /不属于/);
  for (const id of ['../escape', '', 'a/b']) await assert.rejects(f.engine.remove({ target: f.target, sourceId: id, version: 1 }), /ID 无效/);
  for (const version of [0, -1, 1.2, NaN]) await assert.rejects(f.engine.remove({ target: f.target, sourceId: source.id, version }), /版本无效/);
  for (const employeeVersion of [0, -1, 1.2, NaN]) await assert.rejects(f.engine.remove({ target: f.target, sourceId: source.id, version: 2, employeeVersion }), /员工版本无效/);
  assert.equal((await f.engine.library(f.target)).sources.length, 2);
});

test('configuration removal detects stale employee edits before retiring any reference', async t => {
  const f = await fixture(t, [{ id: 'spec', title: 'Spec', kind: 'text', value: 'Keep this configured source' }]);
  const source = (await f.engine.library(f.target)).sources[0]!;
  await f.store.saveTemplate({ ...f.worker, name: 'Changed by another editor' });
  await assert.rejects(f.engine.remove({ target: f.target, sourceId: source.id, version: source.version, employeeVersion: f.worker.version }), { code: 'CONFLICT' });
  assert.equal((await f.engine.library(f.target)).sources.find(item => item.id === source.id)?.version, source.version);
  assert.equal(f.store.snapshot().templates.find(item => item.id === f.worker.id)!.modules.knowledge.sources.length, 1);
});

test('retirement IO failure leaves employee modules and active material unchanged', async t => {
  const f = await fixture(t, [{ id: 'spec', title: 'Spec', kind: 'text', value: 'Retain on failed retirement' }]);
  const source = (await f.engine.library(f.target)).sources[0]!;
  const before = f.store.snapshot();
  const retire = t.mock.method(f.repository, 'retire', async () => { throw new Error('Simulated retirement IO failure'); });
  await assert.rejects(f.engine.remove({ target: f.target, sourceId: source.id, version: source.version }), /retirement IO/);
  retire.mock.restore();
  assert.deepEqual(f.store.snapshot(), before);
  assert.equal((await f.engine.library(f.target)).sources.find(item => item.id === source.id)?.version, source.version);
});

test('retirement rechecks source version after a concurrent upload and never changes employee configuration on conflict', async t => {
  const f = await fixture(t, [{ id: 'spec', title: 'Spec', kind: 'text', value: 'Old value' }]);
  const source = (await f.engine.library(f.target)).sources[0]!;
  const before = f.store.snapshot();
  const originalRetire = f.repository.retire.bind(f.repository);
  const retire = t.mock.method(f.repository, 'retire', async (space, id, canWrite, expectedVersion) => {
    await f.repository.ingest(space, { ...source, content: 'Concurrent new value' }, canWrite);
    return originalRetire(space, id, canWrite, expectedVersion);
  });
  await assert.rejects(f.engine.remove({ target: f.target, sourceId: source.id, version: source.version }), { code: 'CONFLICT' });
  retire.mock.restore();
  assert.deepEqual(f.store.snapshot(), before);
  assert.equal((await f.engine.library(f.target)).sources.find(item => item.id === source.id)?.content, 'Concurrent new value');
});

test('employee persistence failure restores the exact active source version and cannot erase a concurrent upload', async t => {
  const f = await fixture(t, [{ id: 'spec', title: 'Spec', kind: 'text', value: 'Original configured material' }]);
  const view = await f.engine.library(f.target);
  const source = view.sources[0]!;
  const before = f.store.snapshot();
  const save = t.mock.method(f.store, 'saveTemplate', async () => { throw new Error('Simulated store IO failure'); });
  await assert.rejects(f.engine.remove({ target: f.target, sourceId: source.id, version: source.version }), /store IO/);
  assert.deepEqual(f.store.snapshot(), before);
  assert.deepEqual((await f.engine.library(f.target)).sources.find(item => item.id === source.id), source);
  save.mock.restore();
  const concurrentSave = t.mock.method(f.store, 'saveTemplate', async () => {
    const space = { kind: 'template' as const, teamId: `employee-${createHash('sha256').update(JSON.stringify(f.worker.id)).digest('hex').slice(0, 40)}`, memberId: f.worker.id };
    await f.repository.ingest(space, { ...source, content: 'New upload must survive compensation' });
    throw new Error('Simulated concurrent store failure');
  });
  await assert.rejects(f.engine.remove({ target: f.target, sourceId: source.id, version: source.version }), /concurrent store/);
  concurrentSave.mock.restore();
  assert.deepEqual(f.store.snapshot(), before);
  const current = (await f.engine.library(f.target)).sources.find(item => item.id === source.id)!;
  assert.equal(current.content, 'New upload must survive compensation');
  assert.equal(current.version, source.version + 1);
});

test('failed rollback is reported explicitly and leaves historical material readable', async t => {
  const f = await fixture(t, [{ id: 'spec', title: 'Spec', kind: 'text', value: 'Auditable original' }]);
  const source = (await f.engine.library(f.target)).sources[0]!;
  const before = f.store.snapshot();
  const save = t.mock.method(f.store, 'saveTemplate', async () => { throw new Error('Simulated store IO failure'); });
  const restore = t.mock.method(f.repository, 'restoreActive', async () => { throw new Error('Simulated rollback IO failure'); });
  await assert.rejects(f.engine.remove({ target: f.target, sourceId: source.id, version: source.version }), error => error instanceof AggregateError && error.errors.length === 2 && /恢复有效资料引用也失败/.test(error.message));
  save.mock.restore(); restore.mock.restore();
  assert.deepEqual(f.store.snapshot(), before);
  assert.equal((await f.engine.libraryDocument(f.target, 'A', source.id, source.version) as { content: string }).content, source.content);
  await f.restart();
  assert.equal((await f.engine.library(f.target)).sources.find(item => item.id === source.id)?.content, source.content);
});

test('disabled team libraries reject removal without changing active material or the employee configuration', async t => {
  const f = await fixture(t);
  const target: KnowledgeLibraryTarget = { ...f.target, library: 'team', teamId: f.team.id };
  const uploaded = await f.engine.upload({ target, files: [{ name: 'team.md', content: 'TEAM_RETAIN_SENTINEL' }] });
  const source = uploaded.library.sources.find(item => item.id === uploaded.uploaded[0])!;
  await f.store.saveTeam({ ...f.team, knowledgeEnabled: false }, { expectedVersion: f.team.version });
  await assert.rejects(f.engine.remove({ target, sourceId: source.id, version: source.version }), /关闭/);
  assert.equal((await f.engine.library(target)).status.state, 'disabled');
  await f.store.saveTeam({ ...f.store.snapshot().teams.find(item => item.id === f.team.id)!, knowledgeEnabled: true });
  assert.ok((await f.engine.library(target)).sources.some(item => item.id === source.id));
});

test('disposed engines reject removal instead of reporting a skipped queue entry as success', async t => {
  const f = await fixture(t);
  const uploaded = await f.engine.upload({ target: f.target, files: [{ name: 'keep.md', content: 'Keep after dispose' }] });
  const source = uploaded.library.sources[0]!;
  await f.engine.dispose();
  await assert.rejects(f.engine.remove({ target: f.target, sourceId: source.id, version: source.version }), /关闭/);
  await f.restart();
  assert.equal((await f.engine.library(f.target)).sources.find(item => item.id === source.id)?.content, source.content);
});

test('removal cancels compilation using withdrawn evidence and stale work cannot republish it', async t => {
  const f = await fixture(t);
  let release!: () => void;
  f.gate.pending = new Promise<void>(done => { release = done; });
  const uploaded = await f.engine.upload({ target: f.target, files: [{ name: 'pending.md', content: 'WITHDRAW_DURING_COMPILE' }] });
  const source = uploaded.library.sources.find(item => item.id === uploaded.uploaded[0])!;
  const request = f.requests.find(item => item.space.memberId === f.worker.id && item.sources.some(value => value.id === source.id));
  assert.ok(request, 'Compilation started for the uploaded source');
  const removed = await f.engine.remove({ target: f.target, sourceId: source.id, version: source.version });
  assert.equal(request.signal.aborted, true);
  assert.deepEqual(removed.library.sources, []);
  release(); f.gate.pending = undefined;
  await f.engine.flush();
  assert.equal((await f.engine.library(f.target)).snapshot, undefined);
});

test('production HTTP removal validates versions, target membership and origin, and returns the updated employee', async t => {
  const root = await mkdtemp(join(tmpdir(), 'workforce-knowledge-removal-http-'));
  const statePath = join(root, 'state.json');
  const seed = await WorkforceStore.open(statePath);
  const modules = createBlankModules();
  modules.knowledge.sources = [{ id: 'http-spec', title: 'HTTP configured source', kind: 'text', value: 'HTTP_REMOVE_SENTINEL' }];
  const employee = await seed.saveTemplate({ name: 'HTTP worker', modules });
  const project = await seed.saveProject({ id: 'native-project', name: 'Native project', rootPath: root });
  let handler: ((req: IncomingMessage, res: ServerResponse) => Promise<void> | void) | undefined;
  const server = createServer((req, res) => { void Promise.resolve(handler?.(req, res)).catch(error => { res.writeHead(500).end(String(error)); }); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const ctx = new Context();
  ctx.provide('webServer', { port: address.port, register(route: { handler: typeof handler }) { handler = route.handler; return () => { handler = undefined; }; } } as never);
  ctx.provide('connection', { admit: () => ({}) } as never);
  ctx.provide('skills', { register: () => () => undefined, list: async () => [] } as never);
  ctx.provide('tools', { schemas: () => [], guard: () => () => undefined } as never);
  ctx.provide('systemPrompt', { context: () => () => undefined } as never);
  ctx.provide('agents', { get: () => undefined, list: () => [] } as never);
  ctx.provide('workspaceRegistry', { list: () => [{ id: project.id, title: project.name, path: root, sessionIds: [] }] } as never);
  t.after(async () => {
    await ctx.fiber.dispose(); server.closeAllConnections();
    await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
    await rm(root, { recursive: true, force: true });
  });
  await apply(ctx, { statePath, skillsDirectory: resolve('skills') });
  const target: KnowledgeLibraryTarget = { scope: 'template', employeeId: employee.id, library: 'employee' };
  const response = await fetch(`${origin}/digital-workers/api/knowledge?${new URLSearchParams(target as unknown as Record<string, string>)}`);
  assert.equal(response.status, 200);
  const view = await response.json() as { sources: Array<{ id: string; version: number }> };
  const source = view.sources[0]!;
  const remove = async (body: unknown, requestOrigin = origin) => {
    const value = await fetch(`${origin}/digital-workers/api/knowledge/remove`, { method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: value.status, body: await value.json() as any };
  };
  for (const extra of [{ version: 0 }, { version: '1' }, { employeeVersion: 0 }, { sourceId: '../escape' }, { target: {} }]) {
    assert.equal((await remove({ target, sourceId: source.id, version: source.version, ...extra })).status, 400);
  }
  assert.equal((await remove({ target, sourceId: source.id, version: source.version }, 'https://untrusted.invalid')).status, 403);
  assert.equal((await remove({ target: { ...target, scope: 'project', projectId: 'foreign-project' }, sourceId: source.id, version: source.version })).status, 400);
  const stale = await remove({ target, sourceId: source.id, version: source.version, employeeVersion: employee.version + 1 });
  assert.equal(stale.status, 409); assert.equal(stale.body.code, 'CONFLICT');
  const result = await remove({ target, sourceId: source.id, version: source.version, employeeVersion: employee.version });
  assert.equal(result.status, 200, result.body.error);
  assert.equal(result.body.removedSourceId, source.id);
  assert.deepEqual(result.body.library.sources, []);
  assert.equal(result.body.employee.id, employee.id);
  assert.equal(result.body.employee.version, employee.version + 1);
  assert.deepEqual(result.body.employee.modules.knowledge.sources, []);
  const disk = await WorkforceStore.open(statePath);
  assert.deepEqual(disk.snapshot().templates.find(item => item.id === employee.id)!.modules.knowledge.sources, []);
});
