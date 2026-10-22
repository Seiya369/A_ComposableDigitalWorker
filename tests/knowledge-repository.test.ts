import assert from 'node:assert/strict';
import { chmod, link, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { KnowledgeRepository, knowledgeRootFor } from '../src/knowledge/repository.js';
import type { KnowledgeCompilation, KnowledgeSpace } from '../src/knowledge/types.js';

const team: KnowledgeSpace = { kind: 'template', teamId: 'research' };
const input = { id: 'meeting', title: 'Meeting', content: '\uFEFFFirst\r\nSecond\0', provenance: 'task:one', verified: false };
const compilation = (sourceVersion = 1): KnowledgeCompilation => ({
  entries: [{ id: 'principle', title: 'Principle', content: 'First is a candidate principle.', citations: [{ sourceId: 'meeting', sourceVersion, startLine: 1, endLine: 2 }] }],
  overview: [{ id: 'map', title: 'Map', summary: 'A candidate principle.', entryIds: ['principle'] }],
});

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'workforce-knowledge-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return new KnowledgeRepository(join(root, 'knowledge'));
}

test('knowledge paths use the plugin state namespace and private detached libraries', async t => {
  assert.equal(knowledgeRootFor('/tmp/profile/state.json'), resolve('/tmp/profile/knowledge/state.json'));
  const repo = await fixture(t);
  await repo.ensure(team);
  assert.deepEqual(JSON.parse(await readFile(join(repo.rootPath, '.owner.json'), 'utf8')), { plugin: 'dsh-plugin-composable-workforce', schemaVersion: 1, rootPath: repo.rootPath });
  assert.deepEqual((await readdir(join(repo.rootPath, 'templates/research/team'))).sort(), ['A-sources', 'B-knowledge', 'C-overview']);
  assert.equal((await stat(repo.rootPath)).mode & 0o777, 0o700);
  await repo.ingest(team, input);
  assert.deepEqual(await repo.sources({ kind: 'project', teamId: 'research', projectId: 'p1' }), []);
  assert.deepEqual(await repo.sources({ ...team, memberId: 'alice' }), []);
});

test('ingest retains originals, minimally normalizes reading text, deduplicates and versions verification', async t => {
  const repo = await fixture(t);
  const first = await repo.ingest(team, input);
  assert.equal(first.content, input.content);
  assert.equal(first.text, 'First\nSecond[U+0000]');
  assert.ok(first.processing.length >= 3);
  assert.equal((await repo.ingest(team, input)).version, 1);
  const second = await repo.ingest(team, { ...input, verified: true });
  assert.equal(second.version, 2);
  assert.equal((await repo.read(team, 'A', 'meeting', 1) as typeof first).verified, false);
  const third = await repo.ingest(team, { ...input, verified: true, content: 'Revised' });
  assert.equal(third.version, 3);
  assert.deepEqual((await repo.sources(team)).map(source => source.version), [3]);
});

test('publish validates accurate references and atomically preserves versioned candidate snapshots', async t => {
  const repo = await fixture(t);
  await repo.ingest(team, input);
  const fingerprint = await repo.fingerprint(team);
  const first = await repo.publish(team, compilation(), fingerprint);
  assert.equal(first.status, 'candidate');
  assert.equal(first.version, 1);
  assert.match(await repo.overview(team), /principle/);
  assert.deepEqual(await repo.read(team, 'B', 'principle', 1), first.entries[0]);
  await repo.ingest(team, { ...input, content: 'Changed\nStill two lines' });
  await assert.rejects(repo.publish(team, compilation(), fingerprint), /changed|更新|conflict/i);
  const nextFingerprint = await repo.fingerprint(team);
  await assert.rejects(repo.publish(team, compilation(1), nextFingerprint), /outdated|过时/i);
  assert.match(await repo.overview(team), /Sources changed/);
  const invalid = compilation(2);
  invalid.entries[0]!.citations[0]!.endLine = 3;
  await assert.rejects(repo.publish(team, invalid, nextFingerprint), /line|行/i);
  const dangling = compilation(2);
  dangling.overview[0]!.entryIds = ['missing'];
  await assert.rejects(repo.publish(team, dangling, nextFingerprint), /reference|引用/i);
  await assert.rejects(repo.publish(team, { entries: [], overview: [] }, nextFingerprint), /complete|完整/i);
  assert.equal((await repo.snapshot(team))!.version, 1);
  const second = await repo.publish(team, compilation(2), nextFingerprint);
  assert.equal(second.version, 2);
  assert.deepEqual(await repo.read(team, 'B', 'principle', 1), first.entries[0]);
});

test('source namespace IDs are encoded and uncommitted snapshot files stay invisible', async t => {
  const repo = await fixture(t);
  const namespaced = { ...input, id: 'run:task-1' };
  const source = await repo.ingest(team, namespaced);
  assert.equal((await repo.read(team, 'A', namespaced.id) as typeof source).id, namespaced.id);
  assert.ok((await readdir(join(repo.rootPath, 'templates/research/team/A-sources/01-reference'))).includes('run%3Atask-1'));
  const next = compilation();
  next.entries[0]!.citations[0]!.sourceId = namespaced.id;
  await repo.publish(team, next, await repo.fingerprint(team));
  await writeFile(join(repo.rootPath, 'templates/research/team/B-knowledge/v2.json'), JSON.stringify(next.entries), { mode: 0o600 });
  await assert.rejects(repo.read(team, 'B', 'principle', 2), /not published/);
  assert.equal((await repo.publish(team, next, await repo.fingerprint(team))).version, 3);
  assert.deepEqual(await repo.read(team, 'B', 'principle', 1), next.entries[0]);
});

test('concurrent repository instances serialize deduplication and source versions', async t => {
  const repo = await fixture(t);
  const other = new KnowledgeRepository(repo.rootPath);
  const duplicates = await Promise.all(Array.from({ length: 8 }, (_, index) => (index % 2 ? repo : other).ingest(team, input)));
  assert.deepEqual(duplicates.map(source => source.version), Array(8).fill(1));
  await Promise.all([repo.ingest(team, { ...input, content: 'v2' }), other.ingest(team, { ...input, content: 'v3' })]);
  assert.equal((await repo.sources(team))[0]!.version, 3);
});

test('queued raw, retirement and seed writes recheck their dynamic scope after obtaining the repository lock', async t => {
  const repo = await fixture(t);
  const project: KnowledgeSpace = { kind: 'project', projectId: 'p1', teamId: 'research' };
  await repo.ingest(team, input);
  await repo.ensure(project);
  const files = async (directory: string, prefix = ''): Promise<Record<string, string>> => {
    const result: Record<string, string> = {};
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const local = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) Object.assign(result, await files(join(directory, entry.name), local));
      else result[local] = await readFile(join(directory, entry.name), 'utf8');
    }
    return result;
  };
  const before = await files(repo.rootPath);
  const internals = repo as unknown as { locked<T>(action: () => Promise<T>): Promise<T> };
  for (const operation of [
    (canWrite: () => boolean) => repo.ingest(team, { ...input, content: 'Queued new revision' }, canWrite),
    (canWrite: () => boolean) => repo.retire(team, input.id, canWrite),
    (canWrite: () => boolean) => repo.markSeeded(project, { teamId: 'source', version: 1 }, canWrite),
  ]) {
    let release!: () => void; let began!: () => void; let enabled = true;
    const entered = new Promise<void>(resolve => { began = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const holder = internals.locked(async () => { began(); await gate; });
    await entered;
    const waiting = operation(() => enabled).then(() => undefined, error => error as { code?: string });
    enabled = false; release(); await holder;
    assert.equal((await waiting)?.code, 'KNOWLEDGE_WRITE_DISABLED');
    assert.deepEqual(await files(repo.rootPath), before, 'a disabled queued operation must leave knowledge bytes and seed state unchanged');
  }
});

test('a scope disabled after its immutable source write cannot commit a new active index', async t => {
  const repo = await fixture(t);
  await repo.ingest(team, input);
  let enabled = true;
  const internals = repo as unknown as { write(path: string, value: unknown, signal?: AbortSignal, canWrite?: () => boolean): Promise<void> };
  const write = internals.write.bind(repo);
  internals.write = async (path, value, signal, canWrite) => {
    await write(path, value, signal, canWrite);
    if (path.endsWith('A-sources/01-reference/meeting/v2.json')) enabled = false;
  };
  await assert.rejects(repo.ingest(team, { ...input, content: 'Completed immutable write' }, () => enabled), { code: 'KNOWLEDGE_WRITE_DISABLED' });
  assert.equal((await repo.sources(team))[0]!.version, 1);
  assert.equal((await repo.read(team, 'A', input.id, 2) as { content: string }).content, 'Completed immutable write', 'disabling does not undo an already completed immutable file write');
});

test('rejects traversal, linked paths, invalid references and excessive input', async t => {
  const repo = await fixture(t);
  await assert.rejects(repo.ensure({ ...team, teamId: '../escape' }), /path|路径|标识/i);
  await assert.rejects(repo.ensure({ ...team, memberId: '..' }), /path|路径|标识/i);
  await assert.rejects(repo.ingest(team, { ...input, id: 'a/b' }), /path|路径|标识/i);
  await assert.rejects(repo.ingest(team, { ...input, content: 'x'.repeat(2_000_001) }), /large|过长|大小/i);
  await repo.ensure(team);
  await symlink(join(repo.rootPath, 'templates/research/team'), join(repo.rootPath, 'templates/linked'));
  await assert.rejects(repo.ensure({ ...team, teamId: 'linked' }), /link|链接/i);
  await repo.ingest(team, input);
  const invalid = compilation();
  invalid.entries[0]!.citations = [];
  await assert.rejects(repo.publish(team, invalid, await repo.fingerprint(team)), /reference|引用/i);
  await assert.rejects(repo.read(team, 'A', 'meeting', -1), /version|版本/i);
});

test('does not claim or chmod a nonempty directory without its ownership marker', async t => {
  const repo = await fixture(t);
  await mkdir(repo.rootPath, { mode: 0o755 });
  await chmod(repo.rootPath, 0o755);
  await writeFile(join(repo.rootPath, 'user-data.txt'), 'Keep this file');
  await assert.rejects(repo.ensure(team), /ownership/);
  assert.equal((await stat(repo.rootPath)).mode & 0o777, 0o755);
  assert.equal(await readFile(join(repo.rootPath, 'user-data.txt'), 'utf8'), 'Keep this file');
  assert.deepEqual(await readdir(repo.rootPath), ['user-data.txt']);
});

test('distinguishes absent knowledge from corrupt or hard-linked storage', async t => {
  const repo = await fixture(t);
  const absent = (error: unknown) => (error as { code?: string }).code === 'NOT_FOUND';
  await assert.rejects(repo.read(team, 'A', 'constructor'), absent);
  await assert.rejects(repo.read(team, 'B', 'missing'), absent);
  await repo.ingest(team, input);
  await link(join(repo.rootPath, 'templates/research/team/A-sources/01-reference/meeting/v1.json'), join(repo.rootPath, 'alias.json'));
  await assert.rejects(repo.read(team, 'A', 'meeting'), error => !absent(error) && /Hard links/.test(String(error)));
});

test('cancelled compilation cannot replace a published snapshot', async t => {
  const repo = await fixture(t);
  await repo.ingest(team, input);
  const fingerprint = await repo.fingerprint(team);
  await repo.publish(team, compilation(), fingerprint);
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(repo.publish(team, compilation(), fingerprint, cancelled.signal), { name: 'AbortError' });
  assert.equal((await repo.snapshot(team))!.version, 1);
  const duringWrite = new AbortController();
  const internals = repo as unknown as { write(path: string, value: unknown, signal?: AbortSignal): Promise<void> };
  const write = internals.write.bind(repo);
  internals.write = async (path, value, signal) => {
    await write(path, value, signal);
    if (path.endsWith('B-knowledge/v2.json')) duringWrite.abort();
  };
  await assert.rejects(repo.publish(team, compilation(), fingerprint, duringWrite.signal), { name: 'AbortError' });
  assert.equal((await repo.snapshot(team))!.version, 1);
  await assert.rejects(repo.read(team, 'B', 'principle', 2), { code: 'NOT_FOUND' });
});

test('retired sources leave audit history but cannot support active knowledge', async t => {
  const repo = await fixture(t);
  await repo.ingest(team, input);
  const before = await repo.fingerprint(team);
  await repo.publish(team, compilation(), before);
  await repo.retire(team, 'meeting');
  assert.deepEqual(await repo.sources(team), []);
  const after = await repo.fingerprint(team);
  assert.notEqual(after, before);
  await assert.rejects(repo.read(team, 'A', 'meeting'), { code: 'NOT_FOUND' });
  assert.equal((await repo.read(team, 'A', 'meeting', 1) as { content: string }).content, input.content);
  await assert.rejects(repo.read(team, 'B', 'principle'), /source withdrawn.*requires recompilation/i);
  await assert.rejects(repo.publish(team, compilation(), after), /outdated|withdrawn/i);
  assert.equal((await repo.snapshot(team))!.version, 1);
  await repo.retire(team, 'meeting');
  assert.equal(await repo.fingerprint(team), after);
  const restored = await repo.ingest(team, input);
  assert.equal(restored.version, 2);
  await repo.publish(team, compilation(2), await repo.fingerprint(team));
  assert.equal((await repo.read(team, 'B', 'principle') as { id: string }).id, 'principle');
});

test('rejects a linked knowledge parent before a missing repository root can be created', async t => {
  const container = await mkdtemp(join(tmpdir(), 'workforce-knowledge-parent-'));
  t.after(() => rm(container, { recursive: true, force: true }));
  const outside = join(container, 'outside');
  await mkdir(outside);
  await symlink(outside, join(container, 'knowledge'));
  const repo = new KnowledgeRepository(knowledgeRootFor(join(container, 'state.json')));
  await assert.rejects(repo.ensure(team), /Symbolic links/);
  assert.deepEqual(await readdir(outside), []);
});

test('empty template seeding is durable, detached and only available to project spaces', async t => {
  const repo = await fixture(t);
  const project: KnowledgeSpace = { kind: 'project', projectId: 'p1', teamId: 'research' };
  assert.equal(await repo.isSeeded(project), false);
  await repo.markSeeded(project, { teamId: 'template-team', version: 1 });
  await repo.markSeeded(project, { teamId: 'template-team', version: 1 });
  const reloaded = new KnowledgeRepository(repo.rootPath);
  assert.equal(await reloaded.isSeeded(project), true);
  assert.deepEqual(await reloaded.sources(project), []);
  assert.equal(await reloaded.isSeeded({ ...project, memberId: 'alice' }), false);
  await assert.rejects(repo.markSeeded(team, { teamId: 'template-team', version: 1 }), /project/i);
  await assert.rejects(repo.markSeeded(project, { teamId: 'template-team', version: 2 }), /already initialized/i);
});
