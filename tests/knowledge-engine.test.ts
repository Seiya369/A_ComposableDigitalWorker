import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkforceStore } from '../src/domain/store.js';
import { WorkService } from '../src/work/service.js';
import type { WorkTask } from '../src/work/types.js';
import { createBlankModules } from '../src/domain/seed.js';
import { KnowledgeRepository } from '../src/knowledge/repository.js';
import { KnowledgeEngine } from '../src/knowledge/engine.js';
import type { KnowledgeCompilation, KnowledgeCompileRequest, KnowledgeCompiler, KnowledgeInput, KnowledgeSpace } from '../src/knowledge/types.js';

function compilation(request: KnowledgeCompileRequest): KnowledgeCompilation {
  return { entries: [{ categoryId: request.policy?.categories[0]?.id, id: 'detail', title: 'Detailed knowledge', content: request.sources.map(item => item.text).join('\n'), citations: request.sources.map(source => ({ sourceId: source.id, sourceVersion: source.version, startLine: 1, endLine: 1 })) }], overview: [{ id: 'map', title: 'Concept map', summary: 'Read the details before making a decision.', entryIds: ['detail'] }] };
}
const knowledgeDirectory = (repository: KnowledgeRepository, space: KnowledgeSpace) => join(repository.rootPath,
  ...(space.kind === 'template' ? ['templates', space.teamId] : ['projects', space.projectId!, 'teams', space.teamId]),
  ...(space.memberId ? ['employees', space.memberId] : ['team']));
async function fixture(t: { after: (fn: () => Promise<void>) => void }, compiler?: KnowledgeCompiler, templateSources: KnowledgeInput[] = [], enabled?: { template: boolean; project: boolean }) {
  const root = await mkdtemp(join(tmpdir(), 'workforce-knowledge-engine-'));
  const store = await WorkforceStore.open(join(root, 'state.json'));
  const modules = createBlankModules(); modules.responsibilities = { mission: 'Lead the research', duties: ['Research'], boundaries: [] }; modules.delivery.acceptanceCriteria = ['Cite evidence']; modules.model = { mode: 'override', provider: 'test', model: 'leader-model' };
  modules.knowledge.sources = [{ id: 'method', title: 'Working method', kind: 'text', value: 'Verify the source before publishing.' }];
  const leader = await store.saveTemplate({ name: 'Leader', status: 'ready', modules });
  const memberModules = createBlankModules(); memberModules.responsibilities = { mission: 'Research', duties: ['Read sources'], boundaries: [] }; memberModules.delivery.acceptanceCriteria = ['Cite evidence'];
  const member = await store.saveTemplate({ name: 'Member', status: 'ready', modules: memberModules });
  const team = await store.saveTeam({ name: 'Research', description: 'Shared team knowledge', members: [{ memberId: 'lead', templateId: leader.id }, { memberId: 'research', templateId: member.id, reportsTo: 'lead' }] });
  const project = await store.saveProject({ name: 'Project', rootPath: root });
  const installed = await store.configureProjectTeam({ projectId: project.id, teamId: team.id, teamVersion: team.version, templateVersions: { [leader.id]: leader.version, [member.id]: member.version } });
  if (enabled) await store.transaction(state => {
    Object.assign(state.teams.find(item => item.id === team.id)!, { knowledgeEnabled: enabled.template });
    Object.assign(state.projectTeams!.find(item => item.id === installed.id)!, { knowledgeEnabled: enabled.project });
  });
  const employees = store.snapshot().employees;
  const employee = employees.find(item => item.templateId === leader.id)!;
  const colleague = employees.find(item => item.templateId === member.id)!;
  const repository = new KnowledgeRepository(join(root, 'knowledge'));
  const calls: KnowledgeCompileRequest[] = []; const errors: unknown[] = [];
  const engine = new KnowledgeEngine(store, repository, async request => { calls.push(request); return compiler ? compiler(request) : compilation(request); }, error => errors.push(error));
  t.after(async () => { await engine.dispose(); await rm(root, { recursive: true, force: true }); });
  const space: KnowledgeSpace = { kind: 'project', projectId: project.id, teamId: installed.id };
  const privateSpace = { ...space, memberId: employee.id };
  for (const source of templateSources) await repository.ingest({ kind: 'template', teamId: team.id, memberId: 'lead' }, source);
  await engine.start();
  return { root, store, repository, engine, calls, errors, leader, team, project, installed, employee, colleague, space, privateSpace };
}

test('startup creates detached team/member libraries and archives historical input without paid compilation or UI employees', async t => {
  const f = await fixture(t);
  assert.equal(f.calls.length, 0);
  assert.equal(f.store.snapshot().employees.length, 2);
  assert.equal(f.store.snapshot().runs.length, 0);
  assert.ok((await f.repository.sources(f.privateSpace)).some(source => source.content.includes('Verify the source')));
  assert.equal(await f.repository.snapshot(f.privateSpace), undefined);
  await f.engine.flush();
  assert.equal(f.calls.length, 0);
});

test('structured C selection inputs exclude raw A/B bodies and bind exact B snapshot versions', async t => {
  const f = await fixture(t);
  await f.engine.prepareFor(f.employee);
  const documents = await f.engine.overviewDocumentsFor(f.employee);
  assert.ok(documents.some(document => document.library === 'employee' && document.entryIds?.includes('detail')));
  assert.ok(documents.every(document => document.layer === 'C' && document.verified === false));
  assert.doesNotMatch(JSON.stringify(documents), /Verify the source before publishing/);
  const snapshot = await f.repository.snapshot(f.privateSpace);
  const detail = await f.engine.readFor(f.employee, 'B', 'detail', undefined, 'employee') as { version: number; library: string };
  assert.equal(detail.version, snapshot!.version); assert.equal(detail.library, 'employee');
  const narrow = structuredClone(f.employee); narrow.modules.knowledge.projectMemory = false; narrow.modules.knowledge.employeeMemory = false;
  assert.deepEqual(await f.engine.overviewDocumentsFor(narrow), []);
});

test('A title search stays available after BC exists without returning source bodies', async t => {
  const f = await fixture(t);
  await f.engine.prepareFor(f.employee);
  const hits = await f.engine.searchFor(f.employee, 'Working method', 'A');
  assert.ok(hits.some(hit => hit.layer === 'A' && hit.library === 'employee'));
  assert.ok(hits.every(hit => hit.layer === 'A'));
  assert.doesNotMatch(JSON.stringify(hits), /Verify the source before publishing/);
  assert.deepEqual(await f.engine.searchFor(f.employee, 'Working method', 'B'), []);
});

test('disabled template and instance create no libraries, seed nothing and expose no knowledge', async t => {
  const f = await fixture(t, undefined, [], { template: false, project: false });
  await f.store.saveMemory({ projectId: f.project.id, scope: 'employee', employeeId: f.employee.id, title: 'While disabled', content: 'Retained domain record', source: { kind: 'user-confirmed', reference: 'User' } });
  await f.engine.ingestFor(f.employee, { id: 'disabled-input', title: 'Do not ingest', content: 'No library writes', provenance: 'runtime-input', verified: false });
  await f.engine.prepareFor(f.employee);
  await f.engine.flush();
  assert.deepEqual(f.engine.spacesForEmployee(f.employee), []);
  assert.equal(await f.engine.overviewFor(f.employee), '');
  assert.deepEqual(await f.engine.searchFor(f.employee, ''), []);
  await assert.rejects(f.engine.readFor(f.employee, 'A', 'disabled-input'), /不存在|无权/);
  await assert.rejects(readdir(knowledgeDirectory(f.repository, f.space)), { code: 'ENOENT' });
  await assert.rejects(readdir(knowledgeDirectory(f.repository, f.privateSpace)), { code: 'ENOENT' });
  await assert.rejects(readdir(knowledgeDirectory(f.repository, { kind: 'template', teamId: f.team.id })), { code: 'ENOENT' });
  assert.equal(f.calls.length, 0);
  await f.store.transaction(state => { Object.assign(state.projectTeams!.find(item => item.id === f.installed.id)!, { knowledgeEnabled: true }); });
  await f.engine.prepareFor(f.employee);
  assert.equal(f.engine.spacesForEmployee(f.employee).length, 2);
  assert.ok((await f.repository.sources(f.privateSpace)).some(source => source.content.includes('Retained domain record')));
  assert.ok(!(await f.repository.sources(f.privateSpace)).some(source => source.id === 'disabled-input'));
  await assert.rejects(readdir(knowledgeDirectory(f.repository, { kind: 'template', teamId: f.team.id })), { code: 'ENOENT' });
  assert.ok(f.calls.length > 0);
});

test('disabling keeps all existing instance bytes unchanged, blocks reads and restores current records on re-enable', async t => {
  const f = await fixture(t);
  const memory = await f.store.saveMemory({ projectId: f.project.id, scope: 'employee', employeeId: f.employee.id, title: 'Original', content: 'Original private knowledge', source: { kind: 'user-confirmed', reference: 'User' } });
  await f.engine.flush();
  const fileHashes = async (directory: string, prefix = ''): Promise<Record<string, string>> => {
    const result: Record<string, string> = {};
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const local = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) Object.assign(result, await fileHashes(join(directory, entry.name), local));
      else result[local] = createHash('sha256').update(await readFile(join(directory, entry.name))).digest('hex');
    }
    return result;
  };
  const directory = join(f.repository.rootPath, 'projects', f.project.id, 'teams', f.installed.id);
  const before = await fileHashes(directory);
  const calls = f.calls.length;
  await f.store.transaction(state => { Object.assign(state.projectTeams!.find(item => item.id === f.installed.id)!, { knowledgeEnabled: false }); });
  assert.deepEqual(f.engine.spacesForEmployee(f.employee), []);
  await f.store.deleteMemory(memory.id);
  const added = await f.store.saveMemory({ projectId: f.project.id, scope: 'employee', employeeId: f.employee.id, title: 'Added while disabled', content: 'Recover retained domain history later', source: { kind: 'user-confirmed', reference: 'User' } });
  const modules = structuredClone(f.employee.modules); modules.knowledge.sources = [];
  await f.store.updateEmployee(f.employee.id, { modules });
  await f.engine.ingestFor(f.employee, { id: 'runtime-while-disabled', title: 'Blocked input', content: 'Must not be archived', provenance: 'runtime-input', verified: false });
  await f.engine.prepareFor(f.employee);
  await f.engine.flush();
  assert.deepEqual(await fileHashes(directory), before);
  assert.equal(f.calls.length, calls);
  assert.equal(await f.engine.overviewFor(f.employee), '');
  assert.deepEqual(await f.engine.searchFor(f.employee, 'Original'), []);
  await assert.rejects(f.engine.readFor(f.employee, 'B', 'detail', undefined, 'employee'), /不存在|无权/);
  await assert.rejects(f.engine.readFor(f.employee, 'A', `memory:${memory.id}`, 1, 'employee'), /不存在|无权/);
  await f.store.transaction(state => { Object.assign(state.projectTeams!.find(item => item.id === f.installed.id)!, { knowledgeEnabled: true }); });
  await f.engine.prepareFor(f.employee);
  const sources = await f.repository.sources(f.privateSpace);
  assert.ok(sources.some(source => source.id === `memory:${added.id}`));
  assert.ok(!sources.some(source => source.id === `memory:${memory.id}` || source.id.startsWith('configuration:') || source.id === 'runtime-while-disabled'));
  assert.ok(f.calls.length > calls);
});

test('disabling aborts an in-flight instance compilation and rejects a provider late response', async t => {
  let began!: () => void; let release!: () => void;
  const entered = new Promise<void>(resolve => { began = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let first = true;
  const f = await fixture(t, async request => { if (first) { first = false; began(); await gate; } return compilation(request); });
  await f.store.saveMemory({ projectId: f.project.id, scope: 'employee', employeeId: f.employee.id, title: 'Pending', content: 'No publication after disabling', source: { kind: 'user-confirmed', reference: 'User' } });
  await entered;
  await f.store.transaction(state => { Object.assign(state.projectTeams!.find(item => item.id === f.installed.id)!, { knowledgeEnabled: false }); });
  assert.equal(f.calls[0]!.signal.aborted, true);
  await f.engine.flush();
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(await f.repository.snapshot(f.privateSpace), undefined);
  assert.deepEqual(f.engine.spacesForEmployee(f.employee), []);
  await f.store.transaction(state => { Object.assign(state.projectTeams!.find(item => item.id === f.installed.id)!, { knowledgeEnabled: true }); });
  await f.engine.flush();
  assert.ok(await f.repository.snapshot(f.privateSpace), 're-enabling resumes an interrupted compilation without requiring another source edit');
});

test('disabling a template leaves its existing A unchanged while the independent installed team remains readable', async t => {
  const f = await fixture(t);
  await f.engine.prepareFor(f.employee);
  const space: KnowledgeSpace = { kind: 'template', teamId: f.team.id, memberId: 'lead' };
  const before = await f.repository.sources(space);
  await f.store.transaction(state => { Object.assign(state.teams.find(item => item.id === f.team.id)!, { knowledgeEnabled: false }); });
  const modules = structuredClone(f.leader.modules); modules.knowledge.sources = [];
  await f.store.saveTemplate({ ...f.leader, modules }, { expectedVersion: f.leader.version });
  await f.engine.flush();
  assert.deepEqual(await f.repository.sources(space), before, 'disabled template sources must not be retired');
  assert.equal(f.engine.spacesForEmployee(f.employee).length, 2);
  assert.match(await f.engine.overviewFor(f.employee), /Concept map/);
});

test('disabling while archive admission waits for the repository lock prevents its delayed A write', async t => {
  const f = await fixture(t);
  const before = await f.repository.sources(f.privateSpace);
  const sharedBefore = await f.repository.sources(f.space);
  let release!: () => void; let began!: () => void;
  const entered = new Promise<void>(resolve => { began = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const internals = f.repository as unknown as { locked<T>(action: () => Promise<T>): Promise<T> };
  const holder = internals.locked(async () => { began(); await gate; });
  await entered;
  const admission = f.engine.ingestFor(f.employee, { id: 'waiting-input', title: 'Queued input', content: 'Must not outlive disabling', provenance: 'authorized-input', verified: false });
  await f.store.saveMemory({ projectId: f.project.id, scope: 'employee', employeeId: f.employee.id, title: 'Queued memory', content: 'Must not be archived after disabling', source: { kind: 'user-confirmed', reference: 'User' } });
  await f.store.transaction(state => { Object.assign(state.projectTeams!.find(item => item.id === f.installed.id)!, { knowledgeEnabled: false }); });
  release(); await holder; await admission; await f.engine.flush();
  assert.deepEqual(await f.repository.sources(f.privateSpace), before);
  assert.deepEqual(await f.repository.sources(f.space), sharedBefore);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.errors, []);
});

test('new task records retain private raw output, while accepted deliverables alone enter the team library', async t => {
  const f = await fixture(t);
  const run = await f.store.createRun({ projectId: f.project.id, employeeId: f.employee.id, request: 'Public research goal' });
  await f.store.updateRun(run.id, { status: 'running' });
  await f.store.updateRun(run.id, { status: 'awaiting-review', output: 'Private draft deliberation', artifacts: [{ id: 'report', title: 'Report', content: 'Verified deliverable' }] });
  await f.engine.flush();
  assert.ok((await f.repository.sources(f.privateSpace)).some(source => source.content.includes('Private draft deliberation')));
  assert.ok(!(await f.repository.sources(f.space)).some(source => source.content.includes('Public research goal')), 'an unreviewed standalone request remains private');
  assert.ok(!(await f.repository.sources(f.space)).some(source => source.content.includes('Private draft deliberation')));
  assert.ok(f.calls.every(call => call.model.model === 'leader-model'));
  await f.store.reviewRun(run.id, { decision: 'accepted', reviewer: 'User' });
  await f.engine.flush();
  assert.ok((await f.repository.sources(f.space)).some(source => source.content.includes('Verified deliverable')));
  const count = f.calls.length;
  await f.engine.flush();
  assert.equal(f.calls.length, count);
});

test('private memories and read authorization stay scoped to the employee, including caller/current flag intersection', async t => {
  const f = await fixture(t);
  await f.store.saveMemory({ projectId: f.project.id, employeeId: f.employee.id, scope: 'employee', title: 'Secret', content: 'Only the leader may read this', source: { kind: 'user-confirmed', reference: 'User' } });
  await f.engine.flush();
  assert.ok((await f.repository.sources(f.privateSpace)).some(source => source.content.includes('Only the leader')));
  assert.ok(!(await f.repository.sources({ ...f.space, memberId: f.colleague.id })).some(source => source.content.includes('Only the leader')));
  assert.ok(!(await f.repository.sources(f.space)).some(source => source.content.includes('Only the leader')));
  await assert.rejects(f.engine.readFor(f.colleague, 'A', `memory:${f.store.snapshot().memories[0]!.id}`, undefined, 'employee'));
  const narrower = structuredClone(f.employee); narrower.modules.knowledge.employeeMemory = false;
  assert.deepEqual(f.engine.spacesForEmployee(narrower), [f.space]);
  const modules = structuredClone(f.employee.modules); modules.knowledge.projectMemory = false;
  await f.store.updateEmployee(f.employee.id, { modules });
  assert.deepEqual(f.engine.spacesForEmployee(narrower), []);
});

test('C exposes library and B references, and duplicate ids require an explicit library', async t => {
  const f = await fixture(t);
  await f.store.saveMemory({ projectId: f.project.id, scope: 'project', title: 'Shared', content: 'Shared knowledge', source: { kind: 'user-confirmed', reference: 'User' } });
  await f.store.saveMemory({ projectId: f.project.id, scope: 'employee', employeeId: f.employee.id, title: 'Private', content: 'Private knowledge', source: { kind: 'user-confirmed', reference: 'User' } });
  await f.engine.flush();
  const overview = await f.engine.overviewFor(f.employee);
  assert.match(overview, /library.*team/); assert.match(overview, /library.*employee/); assert.match(overview, /detail/); assert.match(overview, /worker_memory_search/);
  await assert.rejects(f.engine.readFor(f.employee, 'B', 'detail'), /歧义|ambiguous/i);
  assert.equal((await f.engine.readFor(f.employee, 'B', 'detail', undefined, 'employee') as { id: string }).id, 'detail');
  const hits = await f.engine.searchFor(f.employee, 'Private');
  assert.ok(hits.some(hit => hit.library === 'employee' && hit.id === 'detail'));
});

test('a failed compiler keeps A and old BC, and retries on the next event without a timer loop', async t => {
  let fail = true;
  const f = await fixture(t, async request => { if (fail) throw new Error('provider unavailable'); return compilation(request); });
  await f.store.saveMemory({ projectId: f.project.id, scope: 'employee', employeeId: f.employee.id, title: 'Input', content: 'Persist this source', source: { kind: 'user-confirmed', reference: 'User' } });
  await f.engine.flush();
  assert.ok((await f.repository.sources(f.privateSpace)).some(source => source.content.includes('Persist this source')));
  assert.equal(await f.repository.snapshot(f.privateSpace), undefined);
  assert.ok(f.errors.length > 0);
  fail = false;
  await f.engine.flush();
  assert.ok(await f.repository.snapshot(f.privateSpace));
});

test('leader inherit reaches the same compiler route, while ambiguous roots never choose a model', async t => {
  const f = await fixture(t);
  const modules = structuredClone(f.employee.modules); modules.model = { mode: 'inherit' };
  await f.store.updateEmployee(f.employee.id, { modules });
  await f.store.saveMemory({ projectId: f.project.id, scope: 'employee', employeeId: f.employee.id, title: 'Input', content: 'Uncompiled', source: { kind: 'user-confirmed', reference: 'User' } });
  await f.engine.flush();
  assert.ok(f.calls.length > 0);
  assert.ok(f.calls.every(call => call.model.mode === 'inherit'));
  assert.ok((await f.repository.sources(f.privateSpace)).some(source => source.content.includes('Uncompiled')));
  const count = f.calls.length;
  await f.store.updateEmployee(f.employee.id, { modules: { ...modules, model: { mode: 'override', provider: 'test', model: 'new-model' } } });
  await f.engine.flush();
  assert.equal(f.calls.length, count, 'changing the model alone does not incur synthesis');
  await f.store.updateEmployee(f.colleague.id, { managerId: null });
  await f.store.saveMemory({ projectId: f.project.id, scope: 'employee', employeeId: f.employee.id, title: 'More', content: 'Still ambiguous', source: { kind: 'user-confirmed', reference: 'User' } });
  await f.engine.flush();
  assert.equal(f.calls.length, count);
});

test('team cancellation aborts an in-flight compilation and ignores its late response', async t => {
  let release!: () => void; let began!: () => void;
  const entered = new Promise<void>(resolve => { began = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture(t, async request => { began(); await gate; return compilation(request); });
  await f.store.saveMemory({ projectId: f.project.id, scope: 'employee', employeeId: f.employee.id, title: 'Input', content: 'Do not publish after cancellation', source: { kind: 'user-confirmed', reference: 'User' } });
  await entered;
  const before = await f.repository.sources(f.privateSpace);
  await f.store.cancelProjectTeams({ projectId: f.project.id, teams: [{ id: f.installed.id, version: f.installed.version! }] });
  assert.equal(f.calls[0]!.signal.aborted, true);
  await f.store.saveMemory({ projectId: f.project.id, scope: 'employee', employeeId: f.employee.id, title: 'After cancellation', content: 'No more archives', source: { kind: 'user-confirmed', reference: 'User' } });
  await f.engine.flush();
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await f.repository.snapshot(f.privateSpace), undefined);
  assert.deepEqual(f.engine.spacesForEmployee(f.employee), []);
  assert.deepEqual(await f.repository.sources(f.privateSpace), before, 'cancelled teams do not keep archiving later records');
});

test('prepareFor compiles only the caller visible startup libraries and batches file admission', async t => {
  const f = await fixture(t);
  await f.engine.ingestFor(f.employee, { id: 'file:one', title: 'First file', content: 'One', provenance: 'authorized-file:one', verified: false });
  await f.engine.ingestFor(f.employee, { id: 'file:two', title: 'Second file', content: 'Two', provenance: 'authorized-file:two', verified: false });
  assert.equal(f.calls.length, 0);
  await f.engine.prepareFor(f.employee);
  assert.equal(f.calls.filter(call => call.space.memberId === f.employee.id).length, 1);
  assert.ok(f.calls.every(call => call.space.kind === 'project' && call.space.teamId === f.installed.id));
  assert.ok(await f.repository.snapshot(f.privateSpace));
  await f.engine.prepareFor(f.employee);
  assert.equal(f.calls.filter(call => call.space.memberId === f.employee.id).length, 1);
});

test('source revisions abort stale synthesis, and the next compilation uses the revised version', async t => {
  let entered!: () => void; let release!: () => void; let first = true;
  const began = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture(t, async request => { if (first) { first = false; entered(); await gate; } return compilation(request); });
  const memory = await f.store.saveMemory({ projectId: f.project.id, scope: 'employee', employeeId: f.employee.id, title: 'Input', content: 'Old content', source: { kind: 'user-confirmed', reference: 'User' } });
  await began;
  await f.store.saveMemory({ ...memory, content: 'Revised content' }, { expectedVersion: memory.version });
  assert.equal(f.calls[0]!.signal.aborted, true);
  await f.engine.flush();
  release(); await new Promise(resolve => setImmediate(resolve));
  const snapshot = await f.repository.snapshot(f.privateSpace);
  assert.ok(snapshot?.entries[0]!.content.includes('Revised content'));
  assert.ok(!snapshot?.entries[0]!.content.includes('Old content'));
});

test('a new team creates libraries and compiles new material without introducing hidden UI records', async t => {
  const f = await fixture(t);
  const before = f.store.snapshot();
  const another = await f.store.saveTeam({ name: 'New team', description: 'New team knowledge', members: [{ memberId: 'lead', templateId: f.leader.id }] });
  await f.engine.flush();
  const space: KnowledgeSpace = { kind: 'template', teamId: another.id };
  assert.ok(await f.repository.snapshot(space));
  assert.equal(f.store.snapshot().employees.length, before.employees.length);
  assert.equal(f.store.snapshot().runs.length, before.runs.length);
});

test('dispose interrupts a provider that ignores abort and prevents all subsequent publication', async t => {
  let began!: () => void; let release!: () => void;
  const entered = new Promise<void>(resolve => { began = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture(t, async request => { began(); await gate; return compilation(request); });
  await f.store.saveMemory({ projectId: f.project.id, scope: 'employee', employeeId: f.employee.id, title: 'Input', content: 'Pending', source: { kind: 'user-confirmed', reference: 'User' } });
  await entered;
  await f.engine.dispose();
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls[0]!.signal.aborted, true);
  assert.equal(await f.repository.snapshot(f.privateSpace), undefined);
});

test('an id present only in the private library resolves even when the team has no published snapshot', async t => {
  const f = await fixture(t);
  await f.store.saveMemory({ projectId: f.project.id, scope: 'employee', employeeId: f.employee.id, title: 'Private', content: 'Private knowledge', source: { kind: 'user-confirmed', reference: 'User' } });
  await f.engine.flush();
  assert.equal((await f.engine.readFor(f.employee, 'B', 'detail') as { id: string }).id, 'detail');
});

test('detached template configuration is stored once and later platform edits do not alter project knowledge', async t => {
  const f = await fixture(t);
  const original = await f.repository.sources(f.privateSpace);
  assert.ok(original.some(source => source.id.startsWith('configuration:') && source.content.includes('Verify the source')));
  assert.ok(!original.some(source => source.id.startsWith('template:configuration:')));
  assert.equal(await f.repository.isSeeded(f.privateSpace), true);
  const modules = structuredClone(f.leader.modules);
  modules.knowledge.sources = [{ id: 'method', title: 'New method', kind: 'text', value: 'Later platform-only knowledge' }];
  await f.store.saveTemplate({ ...f.leader, modules }, { expectedVersion: f.leader.version });
  await f.engine.flush();
  assert.ok((await f.repository.sources({ kind: 'template', teamId: f.team.id, memberId: 'lead' })).some(source => source.content.includes('Later platform-only')));
  assert.ok(!(await f.repository.sources(f.privateSpace)).some(source => source.content.includes('Later platform-only')));
});

test('legacy teamInstanceId groups receive isolated libraries and standalone employees do not invent a team', async t => {
  const f = await fixture(t);
  const standalone = await f.store.createEmployee({ projectId: f.project.id, templateId: f.leader.id });
  assert.deepEqual(f.engine.spacesForEmployee(standalone), []);
  const employees = await f.store.instantiateTeam(f.project.id, f.team.id);
  const legacy = employees.find(employee => !employee.managerId)!;
  await f.store.saveMemory({ projectId: f.project.id, scope: 'employee', employeeId: legacy.id, title: 'Legacy private', content: 'Legacy group secret', source: { kind: 'user-confirmed', reference: 'User' } });
  await f.engine.flush();
  const legacySpaces = f.engine.spacesForEmployee(legacy);
  assert.equal(legacySpaces.length, 2);
  assert.ok(legacySpaces.every(space => space.teamId === legacy.teamInstanceId));
  assert.ok(!(await f.repository.sources(f.privateSpace)).some(source => source.content.includes('Legacy group secret')));
});

test('legacy installations copy a disabled template switch and later toggle independently of existing groups', async t => {
  const f = await fixture(t);
  const oldGroup = await f.store.instantiateTeam(f.project.id, f.team.id);
  const oldLeader = oldGroup.find(employee => !employee.managerId)!;
  await f.engine.flush();
  await f.store.transaction(state => { Object.assign(state.teams.find(item => item.id === f.team.id)!, { knowledgeEnabled: false }); });
  const newGroup = await f.store.instantiateTeam(f.project.id, f.team.id);
  const newLeader = newGroup.find(employee => !employee.managerId)!;
  const newSpace: KnowledgeSpace = { kind: 'project', projectId: f.project.id, teamId: newLeader.teamInstanceId!, memberId: newLeader.id };
  await f.store.saveMemory({ projectId: f.project.id, scope: 'employee', employeeId: newLeader.id, title: 'While disabled', content: 'Recover the legacy record on explicit re-enable', source: { kind: 'user-confirmed', reference: 'User' } });
  await f.engine.flush();
  assert.equal(f.engine.spacesForEmployee(oldLeader).length, 2, 'the previously installed group keeps its own enabled setting');
  assert.deepEqual(f.engine.spacesForEmployee(newLeader), []);
  await assert.rejects(readdir(knowledgeDirectory(f.repository, newSpace)), { code: 'ENOENT' });
  await f.store.transaction(state => {
    for (const employee of state.employees) if (employee.teamInstanceId === newLeader.teamInstanceId && employee.projectId === f.project.id) Object.assign(employee, { legacyTeamKnowledgeEnabled: true });
  });
  await f.engine.prepareFor(newLeader);
  assert.equal(f.engine.spacesForEmployee(newLeader).length, 2);
  assert.ok((await f.repository.sources(newSpace)).some(source => source.content.includes('Recover the legacy record')));
  await f.store.transaction(state => { Object.assign(state.employees.find(employee => employee.id === newLeader.id)!, { legacyTeamKnowledgeEnabled: false }); });
  assert.deepEqual(f.engine.spacesForEmployee(newGroup.find(employee => employee.id !== newLeader.id)!), [], 'one disabled member closes the whole legacy group');
  assert.equal(f.engine.spacesForEmployee(oldLeader).length, 2);
});

test('clearing a template description withdraws its active source without changing the project snapshot', async t => {
  const f = await fixture(t);
  const templateSpace: KnowledgeSpace = { kind: 'template', teamId: f.team.id };
  assert.ok((await f.repository.sources(templateSpace)).some(source => source.id === 'team-description'));
  await f.store.saveTeam({ ...f.team, description: '' }, { expectedVersion: f.team.version });
  await f.engine.flush();
  assert.ok(!(await f.repository.sources(templateSpace)).some(source => source.id === 'team-description'));
  assert.ok((await f.repository.sources(f.space)).some(source => source.id === 'team-description'));
});

test('withdrawing a memory hides stale C/B and search while preserving explicit A history', async t => {
  let fail = false;
  const f = await fixture(t, async request => { if (fail) throw new Error('Provider temporarily unavailable'); return compilation(request); });
  const memory = await f.store.saveMemory({ projectId: f.project.id, scope: 'employee', employeeId: f.employee.id, title: 'Withdraw me', content: 'Withdrawn private claim', source: { kind: 'user-confirmed', reference: 'User' } });
  await f.engine.flush();
  assert.ok((await f.engine.searchFor(f.employee, 'Withdrawn')).some(hit => hit.summary.includes('Withdrawn')));
  fail = true;
  await f.store.deleteMemory(memory.id);
  await f.engine.flush();
  assert.ok(!(await f.repository.sources(f.privateSpace)).some(source => source.id === `memory:${memory.id}`));
  assert.match(await f.engine.overviewFor(f.employee), /来源已撤回待重编/);
  assert.ok(!(await f.engine.searchFor(f.employee, 'Withdrawn')).some(hit => hit.summary.includes('Withdrawn')));
  await assert.rejects(f.engine.readFor(f.employee, 'B', 'detail', undefined, 'employee'), /withdrawn|重编/);
  assert.equal((await f.engine.readFor(f.employee, 'A', `memory:${memory.id}`, 1, 'employee') as { content: string }).content, memory.content);
});

test('removing configured project files retires runtime file sources but retains their original versions', async t => {
  const f = await fixture(t);
  const modules = structuredClone(f.employee.modules);
  modules.knowledge.sources.push({ id: 'document', title: 'Document', kind: 'project-file', value: 'docs/context.md' });
  modules.capabilities.tools.push({ id: 'worker_read_file', description: 'Read authorized files' });
  modules.permissions.allowedTools.push('worker_read_file'); modules.permissions.readPaths.push('docs/**');
  const current = await f.store.updateEmployee(f.employee.id, { modules });
  await f.engine.flush();
  const id = `file-${createHash('sha256').update('docs/context.md').digest('hex')}`;
  await f.engine.ingestFor(current, { id, title: 'Document', content: 'Authorized file knowledge', provenance: 'authorized-file:docs/context.md', verified: false });
  await f.engine.prepareFor(current);
  assert.ok((await f.repository.sources(f.privateSpace)).some(source => source.id === id));
  await f.store.updateEmployee(f.employee.id, { modules: f.employee.modules });
  await f.engine.flush();
  assert.ok(!(await f.repository.sources(f.privateSpace)).some(source => source.id === id));
  assert.equal((await f.repository.read(f.privateSpace, 'A', id, 1) as { content: string }).content, 'Authorized file knowledge');
});

test('manual workbench deliverables are archived privately and become team knowledge only after current acceptance', async t => {
  const f = await fixture(t);
  const work = new WorkService(f.store);
  const task = await work.command('work.saveTask', { projectId: f.project.id, employeeId: f.employee.id, title: 'Public task', goal: 'Public goal', inputs: ['Private task input'], acceptanceCriteria: ['Evidence checked'] }) as WorkTask;
  await f.engine.flush();
  assert.ok(!(await f.repository.sources(f.space)).some(source => source.id === `work-task:${task.id}`), 'a plan alone does not trigger knowledge ingestion');
  const deliverableId = task.requiredDeliverableIds[0]!;
  await work.command('work.saveDeliverable', { projectId: f.project.id, id: deliverableId, taskId: task.id, title: 'Report', content: 'Manual deliverable content' });
  await f.engine.flush();
  assert.ok((await f.repository.sources(f.space)).some(source => source.id === `work-task:${task.id}` && source.content.includes('Public goal')));
  assert.ok(!(await f.repository.sources(f.space)).some(source => source.content.includes('Manual deliverable content') || source.content.includes('Private task input')));
  assert.ok((await f.repository.sources(f.privateSpace)).some(source => source.content.includes('Manual deliverable content')));
  await work.command('work.reviewTask', { projectId: f.project.id, id: task.id, decision: 'accepted' });
  await f.engine.flush();
  assert.ok((await f.repository.sources(f.space)).some(source => source.id === `work-result:${deliverableId}` && source.content.includes('Manual deliverable content')));
  assert.equal(f.store.snapshot().runs.length, 0);
  await work.command('work.reviewDeliverable', { projectId: f.project.id, id: deliverableId, decision: 'rejected', note: 'Evidence changed' });
  await f.engine.flush();
  assert.ok(!(await f.repository.sources(f.space)).some(source => source.id === `work-result:${deliverableId}`));
});

test('C pending exposes only visible raw metadata so an unavailable model does not hide evidence', async t => {
  const f = await fixture(t);
  await f.store.updateEmployee(f.colleague.id, { managerId: null });
  const memory = await f.store.saveMemory({ projectId: f.project.id, scope: 'employee', employeeId: f.employee.id, title: 'Evidence about indexing', content: 'Raw body must not be injected before reading', source: { kind: 'user-confirmed', reference: 'User' } });
  await f.engine.flush();
  const overview = await f.engine.overviewFor(f.employee);
  assert.match(overview, /C 待编纂/); assert.match(overview, /A 元数据索引/); assert.ok(overview.includes(`memory:${memory.id}`));
  assert.ok(!overview.includes(memory.content));
  const results = await f.engine.searchFor(f.employee, 'indexing');
  assert.ok(results.some(result => result.id === `memory:${memory.id}` && result.layer === 'A' && result.version === 1));
  assert.ok(results.every(result => !result.summary.includes(memory.content)));
});

test('narrow caller file visibility hides derived knowledge without globally withdrawing the source', async t => {
  const f = await fixture(t);
  const modules = structuredClone(f.employee.modules);
  modules.knowledge.sources.push({ id: 'file', title: 'File evidence', kind: 'project-file', value: 'docs/evidence.md' });
  modules.capabilities.tools.push({ id: 'worker_read_file', description: 'Read' }); modules.permissions.allowedTools.push('worker_read_file'); modules.permissions.readPaths = ['docs/**'];
  const current = await f.store.updateEmployee(f.employee.id, { modules });
  const id = `file-${createHash('sha256').update('docs/evidence.md').digest('hex')}`;
  await f.engine.ingestFor(current, { id, title: 'File evidence', content: 'Private file claim', provenance: 'authorized-file', verified: false });
  await f.engine.prepareFor(current);
  const narrow = structuredClone(current); narrow.modules.knowledge.sources = [];
  assert.ok(!(await f.engine.overviewFor(narrow)).includes('File evidence'));
  assert.ok(!(await f.engine.searchFor(narrow, 'Private')).some(result => result.summary.includes('Private file claim')));
  await assert.rejects(f.engine.readFor(narrow, 'A', id, 1, 'employee'), /权限|授权/);
  await assert.rejects(f.engine.readFor(narrow, 'B', 'detail', undefined, 'employee'), /权限|授权/);
  assert.ok((await f.repository.sources(f.privateSpace)).some(source => source.id === id));
  assert.equal((await f.engine.readFor(current, 'A', id, 1, 'employee') as { content: string }).content, 'Private file claim');
  const revoked = structuredClone(modules); revoked.permissions.readPaths = [];
  await f.store.updateEmployee(f.employee.id, { modules: revoked });
  await f.engine.flush();
  assert.ok(!(await f.repository.sources(f.privateSpace)).some(source => source.id === id));
  await assert.rejects(f.engine.readFor(current, 'A', id, 1, 'employee'), /权限|授权/);
});

test('a slow model in one team does not block another team raw admission or task preparation', async t => {
  let hangTeam = ''; let began!: () => void; let release!: () => void;
  const entered = new Promise<void>(resolve => { began = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture(t, async request => { if (request.space.teamId === hangTeam) { began(); await gate; } return compilation(request); });
  const otherMembers = await f.store.instantiateTeam(f.project.id, f.team.id);
  const other = otherMembers.find(employee => !employee.managerId)!;
  await f.engine.flush();
  hangTeam = f.installed.id;
  await f.store.saveMemory({ projectId: f.project.id, scope: 'employee', employeeId: f.employee.id, title: 'Slow input', content: 'Slow team data', source: { kind: 'user-confirmed', reference: 'User' } });
  await entered;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        await f.engine.ingestFor(other, { id: 'other-input', title: 'Other input', content: 'Other team data', provenance: 'user-input', verified: false });
        await f.engine.prepareFor(other);
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Another team was blocked by the slow model')), 5_000); }),
    ]);
    assert.ok((await f.repository.snapshot({ kind: 'project', projectId: f.project.id, teamId: other.teamInstanceId!, memberId: other.id }))?.entries.some(entry => entry.content.includes('Other team data')));
    assert.equal(await f.repository.snapshot(f.privateSpace), undefined);
  } finally { if (timer) clearTimeout(timer); release(); }
  await f.engine.flush();
});

test('withdrawing installed configuration and restarting never revives it from a template copy', async t => {
  const f = await fixture(t);
  const modules = structuredClone(f.employee.modules); modules.knowledge.sources = [];
  await f.store.updateEmployee(f.employee.id, { modules });
  await f.engine.flush();
  assert.deepEqual(await f.repository.sources(f.privateSpace), []);
  assert.equal(await f.repository.isSeeded(f.privateSpace), true);
  await f.repository.ingest({ kind: 'template', teamId: f.team.id, memberId: 'lead' }, { id: 'later-research', title: 'Later research', content: 'Added after installation', provenance: 'research', verified: false });
  await f.engine.dispose();
  const restarted = new KnowledgeEngine(f.store, f.repository, async request => compilation(request), () => undefined);
  try {
    await restarted.start();
    assert.deepEqual(await f.repository.sources(f.privateSpace), []);
    assert.equal(await f.repository.isSeeded(f.privateSpace), true);
  } finally { await restarted.dispose(); }
});

test('independent template research seeds A once with provenance while configuration uses its detached source', async t => {
  const f = await fixture(t, undefined, [{ id: 'research', title: 'Reusable research', content: 'Original research snapshot', provenance: 'research-paper', verified: false }]);
  const original = await f.repository.sources(f.privateSpace);
  assert.ok(original.some(source => source.id === 'template:research' && source.provenance.includes('template-snapshot:')));
  assert.equal(original.filter(source => source.content.includes('Verify the source')).length, 1);
  await f.repository.ingest({ kind: 'template', teamId: f.team.id, memberId: 'lead' }, { id: 'research', title: 'Reusable research', content: 'Updated platform research', provenance: 'research-paper', verified: false });
  await f.engine.flush();
  const detached = await f.repository.sources(f.privateSpace);
  assert.ok(detached.some(source => source.content === 'Original research snapshot'));
  assert.ok(!detached.some(source => source.content === 'Updated platform research'));
});

test('immediate disposal archives committed events so reinstall startup preserves all knowledge bytes and source versions', async t => {
  const f = await fixture(t);
  const memory = await f.store.saveMemory({ projectId: f.project.id, scope: 'employee', employeeId: f.employee.id, title: 'Last event before stop', content: 'Must be archived before uninstall', source: { kind: 'user-confirmed', reference: 'User' } });
  await f.engine.dispose();
  const files = async (directory: string, prefix = ''): Promise<Record<string, string>> => {
    const result: Record<string, string> = {};
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const local = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) Object.assign(result, await files(join(directory, entry.name), local));
      else result[local] = createHash('sha256').update(await readFile(join(directory, entry.name))).digest('hex');
    }
    return result;
  };
  const before = await files(f.repository.rootPath);
  const sourcesBefore = (await f.repository.sources(f.privateSpace)).map(source => [source.id, source.version, source.hash]);
  let calls = 0;
  const restarted = new KnowledgeEngine(f.store, f.repository, async request => { calls++; return compilation(request); }, () => undefined);
  try {
    await restarted.start();
    const sourcesAfter = (await f.repository.sources(f.privateSpace)).map(source => [source.id, source.version, source.hash]);
    assert.deepEqual(sourcesAfter, sourcesBefore, 'startup must not repair missing last-event archives');
    assert.deepEqual(await files(f.repository.rootPath), before, 'normal reinstall must preserve each knowledge file byte-for-byte');
    assert.ok(sourcesBefore.some(source => source[0] === `memory:${memory.id}`));
    assert.equal(calls, 0);
    assert.equal(f.calls.length, 0);
  } finally { await restarted.dispose(); }
});
