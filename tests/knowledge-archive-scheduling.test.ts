import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkforceStore } from '../src/domain/store.js';
import { createBlankModules } from '../src/domain/seed.js';
import { KnowledgeEngine } from '../src/knowledge/engine.js';
import { KnowledgeRepository } from '../src/knowledge/repository.js';
import { WorkService } from '../src/work/service.js';
import type { KnowledgeCompilation, KnowledgeCompileRequest, KnowledgeCompiler } from '../src/knowledge/types.js';

function compilation(request: KnowledgeCompileRequest): KnowledgeCompilation {
  const entries = request.sources.map((source, i) => ({ id: `entry-${i}`, title: source.title, content: source.text,
    citations: [{ sourceId: source.id, sourceVersion: source.version, startLine: 1, endLine: 1 }] }));
  return { entries, overview: entries.length ? [{ id: 'overview', title: 'Knowledge', summary: 'Candidate evidence', entryIds: entries.map(entry => entry.id) }] : [] };
}
async function fixture(t: { after(fn: () => Promise<void>): void }, fail = false, compile?: KnowledgeCompiler) {
  const root = await mkdtemp(join(tmpdir(), 'workforce-archive-scheduling-'));
  const store = await WorkforceStore.open(join(root, 'state.json'));
  const modules = createBlankModules();
  modules.responsibilities = { mission: 'Research', duties: ['Research'], boundaries: [] };
  modules.delivery.acceptanceCriteria = ['Review evidence']; modules.model = { mode: 'override', provider: 'test', model: 'offline' };
  const template = await store.saveTemplate({ name: 'Researcher', status: 'ready', modules });
  const project = await store.saveProject({ name: 'Project', rootPath: root });
  const employee = await store.createEmployee({ projectId: project.id, templateId: template.id });
  const repository = new KnowledgeRepository(join(root, 'knowledge'));
  const calls: KnowledgeCompileRequest[] = [];
  const compiler: KnowledgeCompiler = Object.assign(async (request: KnowledgeCompileRequest) => {
    calls.push(request); if (fail) throw new Error('Fixture failure'); return compile ? compile(request) : compilation(request);
  }, { incrementalVersion: 1 as const });
  const engine = new KnowledgeEngine(store, repository, compiler, () => {});
  t.after(async () => { await engine.dispose(); await rm(root, { recursive: true, force: true }); });
  await engine.start();
  const target = { scope: 'project' as const, projectId: project.id, employeeId: employee.id, library: 'employee' as const };
  const space = engine.spacesForEmployee(employee).find(item => item.memberId === employee.id)!;
  const run = () => store.createRun({ projectId: project.id, employeeId: employee.id, request: 'Complete a reviewed task' });
  return { store, employee, project, engine, repository, calls, target, space, run };
}

test('strict automatic compilation waits through running and awaiting-review, then compiles once at acceptance', async t => {
  const f = await fixture(t); const run = await f.run();
  await f.store.updateRun(run.id, { status: 'running', sessionId: 'native-session' });
  await f.engine.flush(); assert.equal(f.calls.length, 0);
  await f.store.updateRun(run.id, { status: 'awaiting-review', output: 'Candidate task result' });
  await f.engine.flush(); assert.equal(f.calls.length, 0);
  assert.ok((await f.repository.sources(f.space)).some(source => source.id === `run:${run.id}`), 'local task archive does not call the model');
  await f.engine.prepareFor(f.employee); assert.equal(f.calls.length, 0, 'another task preparation is not an automatic stage');
  await f.store.reviewRun(run.id, { decision: 'accepted', reviewer: 'Owner' });
  await f.engine.flush(); assert.equal(f.calls.length, 1);
  const version = (await f.repository.snapshot(f.space))!.version;
  await f.store.transaction(state => { const item = state.runs.find(item => item.id === run.id)!; item.version++; item.updatedAt = new Date().toISOString(); item.usage = { inputTokens: 50, outputTokens: 20 }; });
  await f.store.updateEmployee(f.employee.id, { name: 'New display name' });
  await f.engine.flush(); await f.engine.prepareFor(f.employee);
  assert.equal(f.calls.length, 1, 'metadata, refresh, and preparation cannot create another paid checkpoint');
  assert.equal((await f.repository.snapshot(f.space))!.version, version);
});

test('a failed strict compilation waits for manual retry or a relevant new stage', async t => {
  const f = await fixture(t, true); const run = await f.run();
  await f.store.updateRun(run.id, { status: 'failed', error: 'Business task failed' });
  await f.engine.flush(); assert.equal(f.calls.length, 1);
  await f.store.updateEmployee(f.employee.id, { name: 'Unrelated edit' });
  await f.engine.flush(); await f.engine.prepareFor(f.employee); await f.engine.flush();
  assert.equal(f.calls.length, 1);
  await f.engine.upload({ target: f.target, files: [], retry: true }); await f.engine.flush();
  assert.equal(f.calls.length, 2, 'explicit retry remains available');
  const next = await f.run(); await f.store.updateRun(next.id, { status: 'cancelled' }); await f.engine.flush();
  assert.equal(f.calls.length, 3, 'a new relevant terminal task phase may retry the changed source set');
});

test('archive switches suppress new automatic admission and retain existing evidence without model calls', async t => {
  const f = await fixture(t); const first = await f.run();
  await f.store.updateRun(first.id, { status: 'failed', error: 'Original incident' }); await f.engine.flush();
  const before = await f.repository.sources(f.space); const snapshot = await f.repository.snapshot(f.space);
  await f.engine.updateArchivePolicy({ target: f.target, category: 'incident/reflection-proposal', enabled: false, expectedVersion: 1 });
  assert.equal(f.calls.length, 1); assert.deepEqual(await f.repository.sources(f.space), before); assert.deepEqual(await f.repository.snapshot(f.space), snapshot);
  const second = await f.run(); await f.store.updateRun(second.id, { status: 'failed', error: 'Do not automatically admit' }); await f.engine.flush();
  assert.equal(f.calls.length, 1); assert.deepEqual(await f.repository.sources(f.space), before);
  await f.engine.updateArchivePolicy({ target: f.target, category: 'incident/reflection-proposal', enabled: true, expectedVersion: 2 });
  await f.engine.flush(); assert.equal(f.calls.length, 1, 'enabling alone does not schedule model catch-up');
  const third = await f.run(); await f.store.updateRun(third.id, { status: 'cancelled' }); await f.engine.flush();
  assert.equal(f.calls.length, 2);
  assert.ok((await f.repository.sources(f.space)).some(source => source.id === `run:${second.id}`));
});

test('explicit confirmed knowledge updates immediately without inventing a task phase', async t => {
  const f = await fixture(t);
  await f.store.saveMemory({ projectId: f.project.id, scope: 'employee', employeeId: f.employee.id, title: 'Owner confirmed', content: 'Use reviewed evidence', source: { kind: 'user-confirmed', reference: 'Owner' } });
  await f.engine.flush(); assert.equal(f.calls.length, 1);
  assert.equal(f.store.snapshot().runs.length, 0);
  await f.engine.flush(); assert.equal(f.calls.length, 1);
});

test('disabled task and incident archives retain owned task and result history through retry, but real deletion withdraws them', async t => {
  const f = await fixture(t);
  const work = new WorkService(f.store);
  await work.command('work.saveTask', { projectId: f.project.id, employeeId: f.employee.id, title: 'Retryable task', goal: 'Keep evidence', acceptanceCriteria: ['Reviewed'] });
  const task = work.snapshot().tasks[0]!;
  const result = work.snapshot().deliverables.find(item => item.taskId === task.id)!;
  await work.command('work.saveDeliverable', { projectId: f.project.id, taskId: task.id, id: result.id, title: result.title, content: 'Original task output' });
  await f.store.transaction(state => { const item = state.workState!.tasks.find(item => item.id === task.id)!; item.status = 'blocked'; item.error = 'Original task failure'; item.version++; });
  await f.engine.flush();
  const before = await f.repository.sources(f.space);
  const snapshot = await f.repository.snapshot(f.space);
  assert.ok(snapshot);
  assert.ok(before.some(source => source.id === `work-task:${task.id}` && source.category === 'incident/reflection-proposal'));
  assert.ok(before.some(source => source.id === `work-result:${result.id}` && source.category === 'task-evidence'));
  await f.engine.updateArchivePolicy({ target: f.target, category: 'incident/reflection-proposal', enabled: false, expectedVersion: 1 });
  await f.engine.updateArchivePolicy({ target: f.target, category: 'task-evidence', enabled: false, expectedVersion: 2 });
  const calls = f.calls.length;
  await work.command('work.retryTask', { projectId: f.project.id, id: task.id });
  await f.engine.flush();
  assert.equal(work.snapshot().tasks.find(item => item.id === task.id)!.status, 'running');
  assert.deepEqual(await f.repository.sources(f.space), before, 'a running retry does not withdraw frozen automatic evidence');
  assert.deepEqual((await f.engine.library(f.target)).snapshot, snapshot, 'its existing knowledge remains readable');
  assert.equal(f.calls.length, calls);
  await f.store.transaction(state => {
    state.workState!.tasks = state.workState!.tasks.filter(item => item.id !== task.id);
    state.workState!.deliverables = state.workState!.deliverables.filter(item => item.taskId !== task.id);
    state.workState!.events = state.workState!.events.filter(item => item.taskId !== task.id);
    state.runs = state.runs.filter(item => item.workTaskId !== task.id);
  });
  await f.engine.flush();
  assert.ok(!(await f.repository.sources(f.space)).some(source => source.id === `work-task:${task.id}` || source.id === `work-result:${result.id}`));
  assert.equal((await f.engine.library(f.target)).snapshot, undefined, 'disabled admission does not bypass deletion and expose its old derived knowledge');
});

test('disabled archives do not retain a task or result reassigned outside the private library', async t => {
  const f = await fixture(t);
  const other = await f.store.createEmployee({ projectId: f.project.id, templateId: f.employee.templateId });
  const work = new WorkService(f.store);
  await work.command('work.saveTask', { projectId: f.project.id, employeeId: f.employee.id, title: 'Owned task', goal: 'Owned result', acceptanceCriteria: ['Reviewed'] });
  const task = work.snapshot().tasks[0]!; const result = work.snapshot().deliverables[0]!;
  await work.command('work.saveDeliverable', { projectId: f.project.id, taskId: task.id, id: result.id, title: result.title, content: 'Private task evidence' });
  await f.store.transaction(state => { const item = state.workState!.tasks.find(item => item.id === task.id)!; item.status = 'blocked'; item.version++; });
  await f.engine.flush();
  await f.engine.updateArchivePolicy({ target: f.target, category: 'incident/reflection-proposal', enabled: false, expectedVersion: 1 });
  await f.engine.updateArchivePolicy({ target: f.target, category: 'task-evidence', enabled: false, expectedVersion: 2 });
  await work.command('work.saveTask', { projectId: f.project.id, id: task.id, employeeId: other.id, title: task.title, goal: task.goal, acceptanceCriteria: task.acceptanceCriteria });
  await f.engine.flush();
  assert.ok(!(await f.repository.sources(f.space)).some(source => source.id === `work-task:${task.id}` || source.id === `work-result:${result.id}`), 'record identity alone cannot retain another employee’s evidence');
});

test('a disabled task archive retains an owned run when it resumes, and retires it when the run is removed', async t => {
  const f = await fixture(t); const run = await f.run();
  await f.store.updateRun(run.id, { status: 'running' });
  await f.store.updateRun(run.id, { status: 'awaiting-review', output: 'Existing reviewable output' });
  await f.engine.flush();
  const before = await f.repository.sources(f.space);
  assert.ok(before.some(source => source.id === `run:${run.id}`));
  await f.engine.updateArchivePolicy({ target: f.target, category: 'task-evidence', enabled: false, expectedVersion: 1 });
  await f.store.updateRun(run.id, { status: 'running' });
  await f.engine.flush();
  assert.deepEqual(await f.repository.sources(f.space), before);
  await f.store.transaction(state => { state.runs = state.runs.filter(item => item.id !== run.id); });
  await f.engine.flush();
  assert.ok(!(await f.repository.sources(f.space)).some(source => source.id === `run:${run.id}`));
  assert.equal(f.calls.length, 0, 'retention and withdrawal need no paid checkpoint');
});

test('re-reading identical authorized documents cannot retry a failed compiler on each turn', async t => {
  const f = await fixture(t, true);
  const input = { id: 'authorized-reference', title: 'Reference', content: 'Unchanged authorized evidence', provenance: 'runtime-authorized', verified: false };
  await f.engine.ingestFor(f.employee, input); await f.engine.prepareFor(f.employee);
  assert.equal(f.calls.length, 1);
  await f.engine.ingestFor(f.employee, input); await f.engine.prepareFor(f.employee); await f.engine.flush();
  assert.equal(f.calls.length, 1);
  await f.engine.ingestFor(f.employee, { ...input, content: 'Changed authorized evidence' }); await f.engine.prepareFor(f.employee);
  assert.equal(f.calls.length, 2, 'a real explicit document revision may request compilation');
});

test('usage and version notifications cannot cancel the only compilation of a stable phase', async t => {
  let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void; const ready = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture(t, false, async request => { entered(); await ready; return compilation(request); });
  t.after(() => { release(); return Promise.resolve(); });
  const run = await f.run(); await f.store.updateRun(run.id, { status: 'failed', error: 'Stable task failure' });
  await started;
  await f.store.transaction(state => { const item = state.runs.find(item => item.id === run.id)!; item.version++; item.updatedAt = new Date().toISOString(); item.usage = { inputTokens: 100, outputTokens: 20 }; });
  assert.equal(f.calls[0]!.signal.aborted, false);
  release(); await f.engine.flush();
  assert.equal(f.calls.length, 1); assert.ok(await f.repository.snapshot(f.space));
});
