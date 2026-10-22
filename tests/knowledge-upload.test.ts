import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createBlankModules } from '../src/domain/seed.js';
import { WorkforceStore } from '../src/domain/store.js';
import { KnowledgeEngine } from '../src/knowledge/engine.js';
import { KnowledgeRepository } from '../src/knowledge/repository.js';
import type { KnowledgeSource } from '../src/knowledge/types.js';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const directory = await mkdtemp(join(tmpdir(), 'knowledge-upload-'));
  const store = await WorkforceStore.open(join(directory, 'state.json'));
  const modules = createBlankModules();
  modules.model = { mode: 'override', provider: 'synthetic', model: 'synthetic' };
  const template = await store.saveTemplate({ name: '投喂测试员工', modules });
  const team = await store.saveTeam({ name: '投喂测试团队', members: [{ memberId: 'lead', templateId: template.id }] });
  const project = await store.saveProject({ name: '投喂测试项目', rootPath: directory });
  const installed = await store.configureProjectTeam({ projectId: project.id, teamId: team.id, teamVersion: team.version, templateVersions: { [template.id]: template.version } });
  const employee = store.snapshot().employees.find(item => item.id === installed.members[0]!.employeeId)!;
  const repository = new KnowledgeRepository(join(directory, 'knowledge'));
  const engine = new KnowledgeEngine(store, repository, async request => ({ entries: request.sources.map((source, i) => ({ id: `detail-${i}`, categoryId: request.policy.categories[0]!.id, title: source.title, content: source.text, citations: [{ sourceId: source.id, sourceVersion: source.version, startLine: 1, endLine: 1 }] })), overview: request.sources.map((source, i) => ({ id: `concept-${i}`, title: source.title, summary: '候选资料', entryIds: [`detail-${i}`] })) }), error => { throw error; });
  t.after(async () => { await engine.dispose(); await rm(directory, { recursive: true, force: true }); });
  await engine.start();
  return { directory, store, template, team, project, employee, repository, engine, installed };
}

const document = () => {
  const bytes = Buffer.from('\uFEFF回执资料\r\n超时并不证明扣款失败。', 'utf8');
  return { name: '回执.md', mediaType: 'text/markdown', content: bytes.toString('utf8'), parser: 'utf8-text-v1', originalFile: { name: '回执.md', mediaType: 'text/markdown', encoding: 'base64' as const, data: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') } };
};

test('feeding a saved team employee archives original bytes privately without saving any role configuration', async t => {
  const f = await fixture(t);
  const before = await readFile(f.store.filePath, 'utf8');
  const material = document();
  const result = await f.engine.uploadFor({ kind: 'project', projectId: f.project.id, employeeId: f.employee.id }, material);
  assert.equal(result.status, 'archived');
  assert.equal(result.category, 'reference');
  assert.equal(result.version, 1);
  assert.equal(await readFile(f.store.filePath, 'utf8'), before, 'upload committed unrelated role or permission fields');
  const space = { kind: 'project' as const, projectId: f.project.id, teamId: f.installed.id, memberId: f.employee.id };
  const stored = await f.repository.read(space, 'A', result.sourceId, 1) as KnowledgeSource;
  assert.equal(stored.originalFile!.data, material.originalFile.data);
  assert.equal(stored.originalFile!.sha256, material.originalFile.sha256);
  assert.equal(stored.content, material.content);
  assert.equal(stored.text, '回执资料\n超时并不证明扣款失败。');
  assert.equal(stored.verified, false);
  const visible = await f.engine.readFor(f.employee, 'A', result.sourceId, 1, 'employee') as Record<string, unknown>;
  assert.equal(visible.originalFile, undefined, 'raw binary must not enter agent context');
  assert.deepEqual(visible.attachment, { name: '回执.md', mediaType: 'text/markdown', sha256: material.originalFile.sha256, bytes: Buffer.from(material.originalFile.data, 'base64').length });
  assert.ok(!(await f.repository.sources({ ...space, memberId: undefined })).some(source => source.id === result.sourceId));
  await f.engine.flush();
  assert.equal((await f.repository.snapshot(space))!.status, 'candidate');
});

test('feeding resolves saved membership and rejects disabled or mismatched libraries before writing', async t => {
  const f = await fixture(t);
  const target = { kind: 'template' as const, teamId: f.team.id, memberId: 'lead', templateId: f.template.id };
  await assert.rejects(f.engine.uploadFor({ ...target, templateId: 'another-template' }, document()), /关系|保存|分团/);
  await assert.rejects(f.engine.uploadFor({ kind: 'project', projectId: 'another-project', employeeId: f.employee.id }, document()), /关系|保存|分团/);
  const before = await readFile(f.store.filePath, 'utf8');
  const first = await f.engine.uploadFor(target, document());
  const repeated = await f.engine.uploadFor(target, document());
  assert.equal(first.sourceId, repeated.sourceId);
  assert.equal(repeated.version, 1);
  assert.equal(await readFile(f.store.filePath, 'utf8'), before);
  assert.equal((await f.engine.uploadedSourcesFor(target)).length, 1);
  assert.equal(JSON.stringify(await f.engine.uploadedSourcesFor(target)).includes(document().originalFile.data), false);
  await f.store.setProjectTeamKnowledge({ projectId: f.project.id, teamId: f.installed.id, enabled: false, version: f.installed.version ?? 1 });
  const projectTarget = { kind: 'project' as const, projectId: f.project.id, employeeId: f.employee.id };
  await assert.rejects(f.engine.uploadFor(projectTarget, document()), /启用/);
  await assert.rejects(f.engine.uploadedSourcesFor(projectTarget), /启用/);
  assert.equal((await f.engine.uploadedSourcesFor(target)).length, 1, 'project override affected the template library');
});

test('closing the librarian while an upload waits for another writer prevents its archive commit', async t => {
  const f = await fixture(t);
  await f.engine.flush();
  const lock = join(f.repository.rootPath, '.write.lock');
  await writeFile(lock, JSON.stringify({ pid: process.pid, token: 'synthetic-external-writer' }), { flag: 'wx' });
  const target = { kind: 'project' as const, projectId: f.project.id, employeeId: f.employee.id };
  const pending = f.engine.uploadFor(target, document());
  const rejected = assert.rejects(pending, /disabled|状态|归属/i);
  await new Promise(done => setTimeout(done, 40));
  try {
    await f.store.setProjectTeamKnowledge({ projectId: f.project.id, teamId: f.installed.id, enabled: false, version: f.installed.version ?? 1 });
    await rejected;
  } finally { await unlink(lock); }
  await f.engine.flush();
  const sources = await f.repository.sources({ kind: 'project', projectId: f.project.id, teamId: f.installed.id, memberId: f.employee.id });
  assert.ok(!sources.some(source => source.id.startsWith('upload:')));
});
