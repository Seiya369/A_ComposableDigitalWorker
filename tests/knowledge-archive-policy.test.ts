import assert from 'node:assert/strict';
import test from 'node:test';
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KnowledgeRepository } from '../src/knowledge/repository.js';
import { KnowledgeEngine } from '../src/knowledge/engine.js';
import { WorkforceStore } from '../src/domain/store.js';
import { createBlankModules } from '../src/domain/seed.js';
import { AUTO_ARCHIVE_CATEGORIES, defaultKnowledgeArchivePolicy } from '../src/knowledge/archive-policy.js';
import type { KnowledgeLibraryTarget } from '../src/knowledge/library-api.js';
import type { KnowledgeCompilation, KnowledgeCompileRequest, KnowledgeCompiler, KnowledgeSpace } from '../src/knowledge/types.js';
import { createWorkforceClient } from '../src/client/api.js';

const space: KnowledgeSpace = { kind: 'template', teamId: 'team' };
function compilation(request: KnowledgeCompileRequest): KnowledgeCompilation {
  const entries = request.sources.map((source, index) => ({ id: `entry-${index}`, title: source.title, content: source.text, citations: [{ sourceId: source.id, sourceVersion: source.version, startLine: 1, endLine: 1 }] }));
  return { entries, overview: entries.length ? [{ id: 'overview', title: 'Evidence', summary: 'Cited sources', entryIds: entries.map(entry => entry.id) }] : [] };
}
async function repositoryFixture(t: { after(fn: () => Promise<void>): void }) {
  const directory = await mkdtemp(join(tmpdir(), 'workforce-archive-policy-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'knowledge');
  return { directory, root, repository: new KnowledgeRepository(root) };
}
async function engineFixture(t: { after(fn: () => Promise<void>): void }, compiler?: KnowledgeCompiler) {
  const f = await repositoryFixture(t);
  const store = await WorkforceStore.open(join(f.directory, 'state.json'));
  const modules = createBlankModules();
  modules.responsibilities = { mission: 'Research', duties: ['Read evidence'], boundaries: [] };
  modules.delivery.acceptanceCriteria = ['Cited evidence'];
  modules.model = { mode: 'override', provider: 'fixture', model: 'offline' };
  const first = await store.saveTemplate({ name: 'First', status: 'ready', modules });
  const second = await store.saveTemplate({ name: 'Second', status: 'ready', modules });
  const team = await store.saveTeam({ name: 'Shared', members: [{ memberId: 'first', templateId: first.id }, { memberId: 'second', templateId: second.id, reportsTo: 'first' }] });
  let calls = 0;
  const errors: unknown[] = [];
  const engine = new KnowledgeEngine(store, f.repository, async request => {
    calls++;
    if (compiler) return compiler(request);
    return compilation(request);
  }, error => errors.push(error));
  t.after(() => engine.dispose());
  await engine.start();
  const target: KnowledgeLibraryTarget = { scope: 'template', employeeId: first.id, library: 'employee' };
  return { ...f, store, first, second, team, engine, target, errors, calls: () => calls };
}

test('missing archive policy preserves defaults without creating template or project files', async t => {
  const f = await repositoryFixture(t);
  const policy = await f.repository.archivePolicy(space);
  assert.deepEqual(policy, defaultKnowledgeArchivePolicy());
  policy.categories['task-evidence'] = false;
  assert.equal((await f.repository.archivePolicy(space)).categories['task-evidence'], true, 'defaults are fresh values');
  assert.deepEqual(await f.repository.archivePolicy({ kind: 'project', projectId: 'project', teamId: 'team', memberId: 'employee' }), defaultKnowledgeArchivePolicy());
  await assert.rejects(lstat(f.root), { code: 'ENOENT' }, 'read must not bind an employee directory or create an ownership marker');
});

test('archive policies persist independently, validate CAS, and do not increment for no-op saves', async t => {
  const f = await repositoryFixture(t);
  const first = await f.repository.updateArchivePolicy(space, { category: 'task-evidence', enabled: false, expectedVersion: 1 });
  assert.equal(first.version, 2);
  assert.equal(first.categories['task-evidence'], false);
  assert.deepEqual(await new KnowledgeRepository(f.root).archivePolicy(space), first);
  assert.deepEqual(await f.repository.archivePolicy({ ...space, memberId: 'employee' }), defaultKnowledgeArchivePolicy());
  assert.deepEqual(await f.repository.updateArchivePolicy(space, { category: 'task-evidence', enabled: false, expectedVersion: 2 }), first);
  await assert.rejects(f.repository.updateArchivePolicy(space, { category: 'environment/constraint', enabled: false, expectedVersion: 1 }), { code: 'CONFLICT' });
  assert.equal((await f.repository.archivePolicy(space)).categories['environment/constraint'], true);
  assert.equal((await lstat(join(f.root, 'templates/team/team/archive-policy.json'))).mode & 0o777, 0o600);
});

test('concurrent repository instances cannot overwrite a newer category switch', async t => {
  const f = await repositoryFixture(t);
  const other = new KnowledgeRepository(f.root);
  const results = await Promise.allSettled([
    f.repository.updateArchivePolicy(space, { category: 'task-evidence', enabled: false, expectedVersion: 1 }),
    other.updateArchivePolicy(space, { category: 'environment/constraint', enabled: false, expectedVersion: 1 }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.equal(rejected.reason.code, 'CONFLICT');
  const stored = await other.archivePolicy(space);
  assert.equal(stored.version, 2);
  assert.equal(AUTO_ARCHIVE_CATEGORIES.filter(category => !stored.categories[category]).length, 1);
});

test('invalid changes and revoked write guards cannot create or overwrite a policy', async t => {
  const f = await repositoryFixture(t);
  for (const invalid of [
    { category: 'reference', enabled: false, expectedVersion: 1 },
    { category: 'task-evidence', enabled: 'false', expectedVersion: 1 },
    { category: 'task-evidence', enabled: false, expectedVersion: 0 },
  ]) await assert.rejects(f.repository.updateArchivePolicy(space, invalid as never), { code: 'VALIDATION' });
  await assert.rejects(lstat(f.root), { code: 'ENOENT' });
  await assert.rejects(f.repository.updateArchivePolicy(space, { category: 'task-evidence', enabled: false, expectedVersion: 1 }, () => false), { code: 'KNOWLEDGE_WRITE_DISABLED' });
  let writable = true;
  const original = f.repository.archivePolicy.bind(f.repository);
  f.repository.archivePolicy = async target => { const policy = await original(target); writable = false; return policy; };
  await assert.rejects(f.repository.updateArchivePolicy(space, { category: 'task-evidence', enabled: false, expectedVersion: 1 }, () => writable), { code: 'KNOWLEDGE_WRITE_DISABLED' });
  assert.deepEqual(await original(space), defaultKnowledgeArchivePolicy());
});

test('corrupt or unknown stored policy fields fail closed instead of resetting switches', async t => {
  const f = await repositoryFixture(t);
  await f.repository.updateArchivePolicy(space, { category: 'task-evidence', enabled: false, expectedVersion: 1 });
  const path = join(f.root, 'templates/team/team/archive-policy.json');
  const value = JSON.parse(await readFile(path, 'utf8'));
  value.categories.reference = true;
  await writeFile(path, JSON.stringify(value));
  await assert.rejects(f.repository.archivePolicy(space), { code: 'VALIDATION' });
  await assert.rejects(f.repository.updateArchivePolicy(space, { category: 'task-evidence', enabled: true, expectedVersion: 2 }), { code: 'VALIDATION' });
});

test('switching archive admission keeps existing sources and snapshots and never schedules a model', async t => {
  const f = await engineFixture(t);
  await f.engine.upload({ target: f.target, files: [{ name: 'professional.md', content: 'Professional evidence' }] });
  await f.engine.flush();
  const before = await f.engine.library(f.target);
  const calls = f.calls();
  let current = before;
  for (const category of AUTO_ARCHIVE_CATEGORIES) {
    current = await f.engine.updateArchivePolicy({ target: f.target, category, enabled: false, expectedVersion: current.archivePolicy!.version });
    assert.equal(current.archivePolicy!.categories[category], false);
    assert.deepEqual(current.sources, before.sources);
    assert.deepEqual(current.snapshot, before.snapshot);
  }
  current = await f.engine.updateArchivePolicy({ target: f.target, category: 'task-evidence', enabled: true, expectedVersion: current.archivePolicy!.version });
  assert.equal(f.calls(), calls, 'neither disabling nor enabling starts compilation');
  assert.deepEqual(current.snapshot, before.snapshot);
  await assert.rejects(f.engine.updateArchivePolicy({ target: f.target, category: 'task-evidence', enabled: false, expectedVersion: 1 }), { code: 'CONFLICT' });
  assert.equal((await f.engine.library(f.target)).archivePolicy!.categories['task-evidence'], true);
});

test('policy mutations are scoped to the resolved employee or team and reject unrelated targets', async t => {
  const f = await engineFixture(t);
  await f.engine.updateArchivePolicy({ target: f.target, category: 'task-evidence', enabled: false, expectedVersion: 1 });
  assert.equal((await f.engine.library({ ...f.target, employeeId: f.second.id })).archivePolicy!.categories['task-evidence'], true);
  const teamTarget: KnowledgeLibraryTarget = { ...f.target, library: 'team', teamId: f.team.id };
  assert.equal((await f.engine.library(teamTarget)).archivePolicy!.categories['task-evidence'], true);
  await f.engine.updateArchivePolicy({ target: teamTarget, category: 'environment/constraint', enabled: false, expectedVersion: 1 });
  assert.equal((await f.engine.library(f.target)).archivePolicy!.categories['environment/constraint'], true);
  await assert.rejects(f.engine.updateArchivePolicy({ target: { ...teamTarget, teamId: 'unrelated-team' }, category: 'task-evidence', enabled: false, expectedVersion: 1 }), /请选择/);
  await assert.rejects(f.engine.updateArchivePolicy({ target: { ...f.target, scope: 'project', projectId: 'unrelated-project' }, category: 'task-evidence', enabled: false, expectedVersion: 1 }), /不属于/);
});

test('a changed policy aborts in-flight compilation and preserves its last published snapshot', async t => {
  let holding = false;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  let signal: AbortSignal | undefined;
  const f = await engineFixture(t, async request => {
    if (holding) {
      signal = request.signal;
      entered();
      await new Promise<void>((_resolve, reject) => {
        if (request.signal.aborted) reject(request.signal.reason);
        else request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true });
      });
    }
    return compilation(request);
  });
  await f.engine.upload({ target: f.target, files: [{ name: 'professional.md', content: 'First version' }] });
  await f.engine.flush();
  const before = await f.engine.library(f.target);
  assert.ok(before.snapshot, 'the baseline snapshot was actually published');
  holding = true;
  await f.engine.upload({ target: f.target, files: [{ name: 'professional.md', content: 'Changed version awaiting publication' }] });
  await started;
  const callsBeforePolicyChange = f.calls();
  await f.engine.updateArchivePolicy({ target: f.target, category: 'task-evidence', enabled: true, expectedVersion: 1 });
  assert.equal(signal?.aborted, false, 'saving the same setting is not a policy change');
  const current = await f.engine.updateArchivePolicy({ target: f.target, category: 'task-evidence', enabled: false, expectedVersion: 1 });
  assert.equal(signal?.aborted, true, 'a late model response cannot continue after the switch changes');
  assert.deepEqual(current.snapshot, before.snapshot);
  assert.equal(f.calls(), callsBeforePolicyChange, 'the policy change does not launch another compilation');
  assert.deepEqual(f.errors, []);
});

test('closed libraries and disposed engines cannot update archive policy', async t => {
  const f = await engineFixture(t);
  await f.store.archiveTemplate(f.first.id, { expectedVersion: f.first.version });
  await assert.rejects(f.engine.updateArchivePolicy({ target: f.target, category: 'task-evidence', enabled: false, expectedVersion: 1 }), { code: 'INVALID_STATE' });
  const otherTarget = { ...f.target, employeeId: f.second.id };
  await f.engine.dispose();
  await assert.rejects(f.engine.updateArchivePolicy({ target: otherTarget, category: 'task-evidence', enabled: false, expectedVersion: 1 }), { code: 'INVALID_STATE' });
});

test('policy transport sends its CAS request to the native authenticated API and keeps failures visible', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const target: KnowledgeLibraryTarget = { scope: 'template', employeeId: 'employee', library: 'employee' };
  const input = { target, category: 'task-evidence' as const, enabled: false, expectedVersion: 1 };
  const view = { target, archivePolicy: { ...defaultKnowledgeArchivePolicy(), version: 2, categories: { ...defaultKnowledgeArchivePolicy().categories, 'task-evidence': false } } };
  let changed = 0;
  let fail = false;
  globalThis.fetch = (async (path, options) => {
    assert.equal(path, '/digital-workers/api/knowledge/archive-policy');
    assert.equal(options?.method, 'POST');
    assert.equal(options?.credentials, 'same-origin');
    assert.deepEqual(JSON.parse(String(options?.body)), input);
    return new Response(JSON.stringify(fail ? { error: '自动归档设置已更新，请刷新后重试', code: 'CONFLICT' } : view), { status: fail ? 409 : 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  const client = createWorkforceClient({ onChange: () => { changed++; } });
  assert.deepEqual(await client.updateKnowledgeArchivePolicy!(input), view);
  assert.equal(changed, 1);
  fail = true;
  await assert.rejects(client.updateKnowledgeArchivePolicy!(input), /请刷新/);
  assert.equal(changed, 1, 'failed persistence never announces a successful mutation');
});
