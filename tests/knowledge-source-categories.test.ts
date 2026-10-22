import assert from 'node:assert/strict';
import { link, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { KnowledgeRepository } from '../src/knowledge/repository.js';
import type { KnowledgeInput, KnowledgeSpace } from '../src/knowledge/types.js';

const team: KnowledgeSpace = { kind: 'template', teamId: 'research' };
const folders = ['01-reference', '02-requirements-decisions', '03-task-evidence', '04-incidents-reflections', '05-environment-constraints', '06-preferences-capabilities'];
const categories = ['reference', 'requirements-decisions', 'task-evidence', 'incidents-reflections', 'environment-constraints', 'preferences-capabilities'] as const;
const input = { id: 'reference:one', title: 'Original', content: '\uFEFF一\r\n二\0', provenance: 'submitted document', verified: false };
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const container = await mkdtemp(join(tmpdir(), 'workforce-source-categories-'));
  t.after(() => rm(container, { recursive: true, force: true }));
  return new KnowledgeRepository(join(container, 'knowledge'));
}

test('new libraries create six real source folders and archive each source in its declared category', async t => {
  const repo = await fixture(t);
  await repo.ensure(team);
  const root = join(repo.rootPath, 'templates/research/team/A-sources');
  assert.deepEqual((await readdir(root)).sort(), folders);
  for (const [index, category] of categories.entries()) {
    const value = await repo.ingest(team, { ...input, id: `source:${index}`, category } as KnowledgeInput);
    assert.equal(value.category, category);
    const stored = join(root, folders[index]!, `source%3A${index}`, 'v1.json');
    assert.ok((await stat(stored)).isFile());
    assert.equal(JSON.parse(await readFile(stored, 'utf8')).content, input.content);
    assert.deepEqual(await repo.read(team, 'A', value.id, 1), value);
  }
});

test('classification changes version the source without changing original bytes or reading coordinates', async t => {
  const repo = await fixture(t);
  const first = await repo.ingest(team, input);
  assert.equal(first.category, 'reference');
  const second = await repo.ingest(team, { ...input, category: 'task-evidence', classificationReason: 'Execution observation; not accepted.' });
  assert.equal(second.version, 2);
  assert.equal(second.hash, first.hash);
  assert.equal(second.content, first.content);
  assert.equal(second.text, first.text);
  assert.equal((await repo.ingest(team, { ...input, category: 'task-evidence', classificationReason: 'Execution observation; not accepted.' })).version, 2);
  assert.equal((await repo.read(team, 'A', input.id, 1) as typeof first).category, 'reference');
  assert.equal((await repo.read(team, 'A', input.id, 2) as typeof first).category, 'task-evidence');
  for (const category of ['../escape', '01-reference', '', null]) {
    await assert.rejects(repo.ingest(team, { ...input, category } as unknown as KnowledgeInput), /category/);
  }
  await assert.rejects(repo.ingest(team, { ...input, classificationReason: 'x'.repeat(2_001) }), /classification reason/);
  assert.equal((await repo.sources(team))[0]!.version, 2);
});

test('legacy initialization preserves active, retired and orphan versions byte for byte and keeps published citations readable', async t => {
  const repo = await fixture(t);
  const first = await repo.ingest(team, input);
  const second = await repo.ingest(team, { ...input, verified: true });
  const retired = await repo.ingest(team, { ...input, id: 'retired' });
  await repo.retire(team, 'retired');
  const compiled = {
    entries: [{ id: 'detail', title: 'Detail', content: 'Original observation.', citations: [{ sourceId: input.id, sourceVersion: 2, startLine: 1, endLine: 2 }] }],
    overview: [{ id: 'concept', title: 'Concept', summary: 'Original observation.', entryIds: ['detail'] }],
  };
  const published = await repo.publish(team, compiled, await repo.fingerprint(team));
  const root = join(repo.rootPath, 'templates/research/team/A-sources');
  const originalBytes = new Map<string, string>();
  for (const source of [first, second, { ...second, version: 3 }, retired]) {
    const legacy = { ...source } as Record<string, unknown>;
    delete legacy.category;
    delete legacy.classificationReason;
    const local = `${encodeURIComponent(source.id)}/v${source.version}.json`;
    const raw = JSON.stringify(legacy, null, 4) + '\n';
    await mkdir(join(root, encodeURIComponent(source.id)), { recursive: true });
    await writeFile(join(root, local), raw);
    originalBytes.set(local, raw);
  }
  await rm(join(root, '01-reference', encodeURIComponent(input.id)), { recursive: true });
  await rm(join(root, '01-reference', 'retired'), { recursive: true });
  const other = new KnowledgeRepository(repo.rootPath);
  await Promise.all([repo.ensure(team), other.ensure(team), other.sources(team)]);
  for (const [local, raw] of originalBytes) {
    assert.equal(await readFile(join(root, '01-reference', local), 'utf8'), raw);
    await assert.rejects(stat(join(root, local)), { code: 'ENOENT' });
  }
  const current = (await other.sources(team))[0]!;
  assert.equal(current.version, 2);
  assert.equal(current.category, 'reference');
  assert.match(current.classificationReason!, /legacy/i);
  assert.equal((await other.read(team, 'A', input.id, 3) as typeof first).version, 3);
  assert.equal((await other.read(team, 'A', 'retired', 1) as typeof first).hash, first.hash);
  assert.deepEqual(await other.read(team, 'B', 'detail', published.version), compiled.entries[0]);
  assert.equal((await other.ingest(team, { ...input, verified: true, category: 'task-evidence' })).version, 4);
  await other.ensure(team);
  assert.equal(await readFile(join(root, '01-reference', encodeURIComponent(input.id), 'v3.json'), 'utf8'), originalBytes.get(`${encodeURIComponent(input.id)}/v3.json`));
});

test('interrupted immutable publication recovers its private pending name without overwriting completed bytes', async t => {
  const repo = await fixture(t);
  const source = await repo.ingest(team, input);
  const root = join(repo.rootPath, 'templates/research/team/A-sources');
  const directory = join(root, '01-reference', encodeURIComponent(source.id));
  const raw = await readFile(join(directory, 'v1.json'), 'utf8');
  const pending = join(directory, '.pending-00000000-0000-4000-8000-000000000000');
  await link(join(directory, 'v1.json'), pending);
  await new KnowledgeRepository(repo.rootPath).ensure(team);
  assert.equal(await readFile(join(directory, 'v1.json'), 'utf8'), raw);
  await assert.rejects(stat(pending), { code: 'ENOENT' });
  assert.deepEqual(await repo.read(team, 'A', source.id), source);
  const flat = join(root, encodeURIComponent(source.id));
  await mkdir(flat);
  await writeFile(join(flat, 'v1.json'), raw);
  await repo.ensure(team);
  await assert.rejects(stat(flat), { code: 'ENOENT' });
  await mkdir(flat);
  const conflict = JSON.stringify({ ...source, title: 'Conflicting metadata' });
  await writeFile(join(flat, 'v1.json'), conflict);
  await assert.rejects(repo.ensure(team), /Conflicting immutable/);
  assert.equal(await readFile(join(directory, 'v1.json'), 'utf8'), raw);
  assert.equal(await readFile(join(flat, 'v1.json'), 'utf8'), conflict);
});

test('legacy migration rejects invalid UTF-8 without silently replacing original bytes', async t => {
  const repo = await fixture(t);
  const source = await repo.ingest(team, input);
  const root = join(repo.rootPath, 'templates/research/team/A-sources');
  const directory = join(root, encodeURIComponent(source.id));
  await mkdir(directory);
  const raw = Buffer.from(JSON.stringify(source));
  raw[raw.indexOf(Buffer.from('Original'))] = 0xff;
  const legacy = join(directory, 'v1.json');
  await writeFile(legacy, raw);
  await rm(join(root, '01-reference', encodeURIComponent(source.id)), { recursive: true });
  await assert.rejects(repo.ensure(team), /UTF-8/);
  assert.deepEqual(await readFile(legacy), raw);
  await assert.rejects(stat(join(root, '01-reference', encodeURIComponent(source.id), 'v1.json')), { code: 'ENOENT' });
});

test('invalid spaces and categories are rejected before creating any knowledge directory', async t => {
  const repo = await fixture(t);
  await assert.rejects(repo.ensure({ ...team, teamId: '../outside' }), /path/);
  await assert.rejects(stat(repo.rootPath), { code: 'ENOENT' });
  await assert.rejects(repo.ingest(team, { ...input, category: '../../outside' } as unknown as KnowledgeInput), /category/);
  await assert.rejects(stat(repo.rootPath), { code: 'ENOENT' });
});

test('legacy source IDs equal to category folder names remain separately readable and idempotent', async t => {
  const repo = await fixture(t);
  const source = await repo.ingest(team, { ...input, id: '01-reference' });
  const root = join(repo.rootPath, 'templates/research/team/A-sources');
  const legacy = { ...source } as Record<string, unknown>;
  delete legacy.category;
  const raw = JSON.stringify(legacy) + '\n';
  await writeFile(join(root, '01-reference', 'v1.json'), raw);
  await rm(join(root, '01-reference', '01-reference'), { recursive: true });
  await repo.ensure(team);
  const restored = await repo.read(team, 'A', '01-reference', 1) as typeof source;
  assert.equal(restored.content, source.content);
  assert.equal((await repo.ingest(team, { ...input, id: '01-reference' })).version, 1);
  assert.equal(await readFile(join(root, '01-reference', '01-reference', 'v1.json'), 'utf8'), raw);
});

test('legacy source links are refused without copying material from outside the managed library', async t => {
  const repo = await fixture(t);
  await repo.ensure(team);
  const root = join(repo.rootPath, 'templates/research/team/A-sources');
  const outside = join(repo.rootPath, 'outside');
  await mkdir(outside);
  await writeFile(join(outside, 'v1.json'), 'do not read or migrate');
  await symlink(outside, join(root, 'legacy-linked'));
  await assert.rejects(repo.ensure(team), /Symbolic links/);
  assert.equal(await readFile(join(outside, 'v1.json'), 'utf8'), 'do not read or migrate');
  assert.deepEqual(await readdir(join(root, '01-reference')), []);
});

test('initialization refuses duplicate historical source identities across category folders', async t => {
  const repo = await fixture(t);
  const source = await repo.ingest(team, input);
  await repo.retire(team, source.id);
  const root = join(repo.rootPath, 'templates/research/team/A-sources');
  const original = join(root, '01-reference', encodeURIComponent(source.id), 'v1.json');
  const conflictingDirectory = join(root, '03-task-evidence', encodeURIComponent(source.id));
  await mkdir(conflictingDirectory);
  const conflict = JSON.stringify({ ...source, category: 'task-evidence' });
  await writeFile(join(conflictingDirectory, 'v1.json'), conflict);
  const originalBytes = await readFile(original, 'utf8');
  await assert.rejects(repo.ensure(team), /duplicate category locations/);
  assert.equal(await readFile(original, 'utf8'), originalBytes);
  assert.equal(await readFile(join(conflictingDirectory, 'v1.json'), 'utf8'), conflict);
});

test('queued initialization rechecks its live write guard before legacy migration', async t => {
  const repo = await fixture(t);
  const source = await repo.ingest(team, input);
  const root = join(repo.rootPath, 'templates/research/team/A-sources');
  const legacy = join(root, encodeURIComponent(source.id));
  await import('node:fs/promises').then(fs => fs.rename(join(root, '01-reference', encodeURIComponent(source.id)), legacy));
  const lockPath = join(repo.rootPath, '.write.lock');
  await writeFile(lockPath, JSON.stringify({ pid: process.pid, token: 'synthetic-migration-blocker' }));
  let enabled = true;
  const queued = repo.ensure(team, () => enabled);
  await new Promise(done => setTimeout(done, 40));
  enabled = false;
  await rm(lockPath);
  await assert.rejects(queued, /disabled|cancelled/i);
  assert.ok((await stat(join(legacy, 'v1.json'))).isFile());
  await assert.rejects(stat(join(root, '01-reference', encodeURIComponent(source.id), 'v1.json')), { code: 'ENOENT' });
});
