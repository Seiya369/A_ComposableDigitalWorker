import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { KnowledgeRepository } from '../src/knowledge/repository.js';
import { KNOWLEDGE_SOURCE_CATEGORIES, normalizeKnowledgeCategory } from '../src/knowledge/library-api.js';
import { knowledgeCategoryForInput, LEGACY_KNOWLEDGE_CATEGORY_DIRECTORIES } from '../src/knowledge/categories.js';
import { prepareKnowledgeUploads } from '../src/knowledge/ingestion.js';
import type { KnowledgeSpace } from '../src/knowledge/types.js';

const space: KnowledgeSpace = { kind: 'template', teamId: 'category-fixture', memberId: 'employee' };
const input = { id: 'reference:one', title: 'Legacy reference', content: 'Exact original text', provenance: 'fixture', verified: false };

test('category folders match the four UI labels and project legacy sources without moving version history', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'workforce-category-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repo = new KnowledgeRepository(join(directory, 'knowledge'));
  const first = await repo.ingest(space, input);
  const path = join(repo.rootPath, 'templates/category-fixture/employees/employee');
  const originalPath = join(path, 'A-sources', encodeURIComponent(input.id), 'v1.json');
  const bytes = await readFile(originalPath);
  await repo.syncCategoryDirectories(space);
  assert.deepEqual((await readdir(join(path, '分类目录'))).sort(), KNOWLEDGE_SOURCE_CATEGORIES.map(item => item.label).sort());
  const referencePath = join(path, '分类目录/专业知识/index.json');
  const projection = JSON.parse(await readFile(referencePath, 'utf8'));
  assert.equal(projection.sources[0].id, input.id);
  assert.equal(resolve(path, '分类目录/专业知识', projection.sources[0].sourceFile), originalPath);
  assert.deepEqual(await readFile(originalPath), bytes);
  const next = await repo.ingest(space, { ...input, category: 'environment/constraint' });
  await repo.syncCategoryDirectories(space);
  assert.deepEqual(JSON.parse(await readFile(referencePath, 'utf8')).sources, []);
  assert.equal(JSON.parse(await readFile(join(path, '分类目录/工作约束/index.json'), 'utf8')).sources[0].version, next.version);
  await assert.rejects(repo.retire(space, input.id, undefined, first.version), { code: 'CONFLICT' });
  assert.equal((await repo.sources(space))[0]!.version, next.version);
  await repo.retire(space, input.id, undefined, next.version);
  await repo.syncCategoryDirectories(space);
  assert.deepEqual(JSON.parse(await readFile(join(path, '分类目录/工作约束/index.json'), 'utf8')).sources, []);
  assert.deepEqual(await readFile(originalPath), bytes);
});

test('four canonical categories accept all six legacy upload IDs and reject unknown IDs', () => {
  assert.deepEqual(KNOWLEDGE_SOURCE_CATEGORIES.map(category => category.label), ['专业知识', '任务档案', '复盘经验', '工作约束']);
  const categories = ['reference', 'requirement/decision/correction', 'task-evidence', 'incident/reflection-proposal', 'environment/constraint', 'preference/capability-evidence'];
  const expected = ['reference', 'task-evidence', 'task-evidence', 'incident/reflection-proposal', 'environment/constraint', 'incident/reflection-proposal'];
  assert.deepEqual(categories.map(normalizeKnowledgeCategory), expected);
  assert.deepEqual(prepareKnowledgeUploads(categories.map((category, index) => ({ name: `${index}.md`, content: 'Exact text', category }))).map(item => item.category), expected);
  assert.throws(() => normalizeKnowledgeCategory(null), /分类/);
  assert.throws(() => normalizeKnowledgeCategory('guessed-preference'), /分类/);
});

test('legacy A category aliases normalize without version churn or changing A/B history and verification state', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'workforce-category-history-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repo = new KnowledgeRepository(join(directory, 'knowledge'));
  const first = await repo.ingest(space, { ...input, category: 'task-evidence', verified: true });
  const path = join(repo.rootPath, 'templates/category-fixture/employees/employee');
  const sourcePath = join(path, 'A-sources', encodeURIComponent(input.id), 'v1.json');
  const record = JSON.parse(await readFile(sourcePath, 'utf8'));
  record.category = 'requirement/decision/correction';
  await writeFile(sourcePath, JSON.stringify(record));
  const sourceBytes = await readFile(sourcePath);
  const fingerprint = await repo.fingerprint(space);
  await repo.publish(space, { entries: [{ id: 'article', title: 'Task', content: 'Candidate task knowledge', citations: [{ sourceId: first.id, sourceVersion: 1, startLine: 1, endLine: 1 }] }], overview: [{ id: 'overview', title: 'Tasks', summary: 'Tasks', entryIds: ['article'] }] }, fingerprint);
  const historyPath = join(path, 'B-knowledge', 'v1.json');
  const historyBytes = await readFile(historyPath);
  const current = await repo.ingest(space, { ...input, category: 'requirement/decision/correction', verified: true });
  assert.equal(current.version, 1);
  assert.equal(current.category, 'task-evidence');
  assert.equal(current.verified, true);
  await repo.syncCategoryDirectories(space);
  assert.equal((await repo.sources(space))[0]!.category, 'task-evidence');
  assert.equal(await repo.fingerprint(space), fingerprint);
  assert.deepEqual(await readFile(sourcePath), sourceBytes);
  assert.deepEqual(await readFile(historyPath), historyBytes);
  const unverified = await repo.ingest(space, { ...input, category: 'task-evidence', verified: false });
  assert.equal(unverified.version, 2, 'verification remains an independent source change');
  assert.equal(unverified.category, 'task-evidence');
  assert.equal(unverified.verified, false);
});

test('legacy derived category indexes migrate while unknown files and unknown indexes stay untouched', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'workforce-category-migration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repo = new KnowledgeRepository(join(directory, 'knowledge'));
  await repo.ingest(space, input);
  const path = join(repo.rootPath, 'templates/category-fixture/employees/employee/分类目录');
  const originalPath = join(path, '../A-sources', encodeURIComponent(input.id), 'v1.json');
  const originalBytes = await readFile(originalPath);
  for (const legacy of LEGACY_KNOWLEDGE_CATEGORY_DIRECTORIES) {
    await mkdir(join(path, legacy.label), { recursive: true });
    await writeFile(join(path, legacy.label, 'index.json'), JSON.stringify({ schemaVersion: 1, category: legacy.id, name: legacy.label, sources: [] }));
  }
  await writeFile(join(path, '需求决策', 'my-notes.md'), 'User original; keep me.');
  await writeFile(join(path, '偏好经验', 'index.json'), JSON.stringify({ mine: true }));
  await repo.syncCategoryDirectories(space);
  assert.deepEqual((await readdir(path)).sort(), [...KNOWLEDGE_SOURCE_CATEGORIES.map(category => category.label), '需求决策', '偏好经验'].sort());
  assert.deepEqual(await readdir(join(path, '需求决策')), ['my-notes.md']);
  assert.equal(await readFile(join(path, '需求决策', 'my-notes.md'), 'utf8'), 'User original; keep me.');
  assert.equal(await readFile(join(path, '偏好经验', 'index.json'), 'utf8'), '{"mine":true}');
  await assert.rejects(readdir(join(path, '投喂马料')), { code: 'ENOENT' });
  assert.deepEqual(await readFile(originalPath), originalBytes, 'renaming the derived reference folder never rewrites original A evidence');
});

test('business provenance routes confirmed memories and task incidents without guessing from their text', () => {
  const memory = (kind: string, category?: 'reference') => ({ ...input, id: 'memory:one', category, provenance: JSON.stringify({ kind: 'confirmed-memory', id: 'one', source: { kind } }), content: 'I prefer this. "status": "failed". This is not a type declaration.', verified: true });
  assert.equal(knowledgeCategoryForInput(memory('user-confirmed')), 'task-evidence');
  assert.equal(knowledgeCategoryForInput(memory('user-confirmed', 'reference')), 'task-evidence', 'old auto-classified reference memories are normalized without changing A');
  assert.equal(knowledgeCategoryForInput(memory('accepted-artifact')), 'task-evidence');
  assert.equal(knowledgeCategoryForInput(memory('project-file')), 'reference');
  assert.equal(knowledgeCategoryForInput({ ...input, id: 'run:one', provenance: 'run:one@1', content: JSON.stringify({ status: 'succeeded', output: { status: 'failed' } }) }), 'task-evidence');
  assert.equal(knowledgeCategoryForInput({ ...input, id: 'run:one', provenance: 'run:one@1', content: JSON.stringify({ status: 'failed' }) }), 'incident/reflection-proposal');
  assert.equal(knowledgeCategoryForInput({ ...input, content: 'A user preference and failure report' }), 'reference');
});

test('removal rollback restores only an absent active mapping and never replaces newer uploaded material', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'workforce-category-rollback-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repo = new KnowledgeRepository(join(directory, 'knowledge'));
  const first = await repo.ingest(space, input);
  await repo.retire(space, input.id, undefined, first.version);
  await repo.restoreActive(space, input.id, first.version);
  assert.equal((await repo.sources(space))[0]!.version, first.version);
  await repo.retire(space, input.id);
  const next = await repo.ingest(space, { ...input, content: 'Concurrent newer evidence' });
  await repo.restoreActive(space, input.id, first.version);
  assert.equal((await repo.sources(space))[0]!.version, next.version);
});

test('category projections reject linked folders and disabled write guards', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'workforce-category-links-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repo = new KnowledgeRepository(join(directory, 'knowledge'));
  await repo.ensure(space);
  const path = join(repo.rootPath, 'templates/category-fixture/employees/employee/分类目录/专业知识');
  await rm(path, { recursive: true });
  await symlink(directory, path, 'dir');
  await assert.rejects(repo.syncCategoryDirectories(space), /Symbolic links/);
  await assert.rejects(repo.syncCategoryDirectories(space, () => false), { code: 'KNOWLEDGE_WRITE_DISABLED' });
});
