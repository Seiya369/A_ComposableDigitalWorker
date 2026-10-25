import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkforceStore } from '../src/domain/store.js';
import { createBlankModules } from '../src/domain/seed.js';
import { KnowledgeRepository } from '../src/knowledge/repository.js';
import { KnowledgeEngine } from '../src/knowledge/engine.js';
import { KNOWLEDGE_SOURCE_CATEGORIES, type KnowledgeLibraryTarget } from '../src/knowledge/library-api.js';
import { KNOWLEDGE_UPLOAD_LIMITS, extractKnowledgeUpload, prepareKnowledgeUploads } from '../src/knowledge/ingestion.js';
import { textDocx, textPdf } from './fixtures/knowledge-documents.js';
import type { KnowledgeCompileRequest } from '../src/knowledge/types.js';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'workforce-library-api-'));
  const store = await WorkforceStore.open(join(root, 'state.json'));
  const modules = createBlankModules();
  modules.responsibilities = { mission: 'Work', duties: ['Research'], boundaries: [] };
  modules.delivery.acceptanceCriteria = ['Evidence'];
  modules.model = { mode: 'override', provider: 'fixture', model: 'leader-model' };
  const leader = await store.saveTemplate({ name: 'Leader', status: 'ready', modules });
  const worker = await store.saveTemplate({ name: 'Worker', status: 'ready', modules: { ...modules, model: { mode: 'override', provider: 'fixture', model: 'worker-model' } } });
  const team = await store.saveTeam({ name: 'Team', description: 'Shared constraints', members: [{ memberId: 'leader', templateId: leader.id }, { memberId: 'worker', templateId: worker.id, reportsTo: 'leader' }] });
  const project = await store.saveProject({ name: 'Project', rootPath: root });
  const repository = new KnowledgeRepository(join(root, 'knowledge'));
  const calls: KnowledgeCompileRequest[] = [];
  const failure = { active: false };
  const gate: { pending?: Promise<void> } = {};
  const engine = new KnowledgeEngine(store, repository, async request => {
    calls.push(request);
    await gate.pending;
    if (failure.active) throw new Error('Provider temporarily unavailable');
    return { entries: request.sources.map((source, index) => ({ id: `detail-${index}`, title: source.title, content: `候选：${source.text}`, citations: [{ sourceId: source.id, sourceVersion: source.version, startLine: 1, endLine: source.text.split('\n').length }] })), overview: [{ id: 'map', title: 'Wiki', summary: 'Candidate knowledge', entryIds: request.sources.map((_, index) => `detail-${index}`) }] };
  }, () => undefined);
  t.after(async () => { await engine.dispose(); await rm(root, { recursive: true, force: true }); });
  await engine.start();
  const target: KnowledgeLibraryTarget = { scope: 'template', employeeId: worker.id, library: 'employee' };
  return { root, store, repository, engine, calls, leader, worker, team, project, target, failure, gate };
}

test('standalone template upload preserves exact original bytes and publishes categorized candidate Wiki through its shadow', async t => {
  const f = await fixture(t);
  const before = f.store.snapshot();
  const bytes = Buffer.from('\uFEFF# Evidence\r\nA useful condition.\r\n', 'utf8');
  const response = await f.engine.upload({ target: f.target, files: [{ name: 'Evidence.MD', base64: bytes.toString('base64'), category: 'environment/constraint' }] });
  assert.equal(response.uploaded.length, 1);
  await f.engine.flush();
  const view = await f.engine.library(f.target);
  assert.equal(view.enabled, true); assert.equal(view.status.state, 'ready');
  assert.equal(view.compiler.role, 'employee-shadow'); assert.equal(view.compiler.model?.model, 'worker-model');
  assert.equal(view.categories.find(category => category.id === 'environment/constraint')?.count, 1);
  assert.equal(view.categories.length, 4); assert.equal(view.sources[0]!.content, bytes.toString('utf8'));
  assert.equal(view.sources[0]!.text, '# Evidence\nA useful condition.\n');
  const original = view.sources[0]!.original!;
  const originalPath = (await readdir(f.repository.rootPath, { recursive: true })).find(path => path.endsWith(`A-originals/${original.storageId}.json`));
  assert.ok(originalPath);
  const stored = JSON.parse(await readFile(join(f.repository.rootPath, originalPath), 'utf8'));
  assert.deepEqual(Buffer.from(stored.base64, 'base64'), bytes);
  assert.equal(view.snapshot?.status, 'candidate'); assert.ok(view.snapshot?.entries[0]!.citations.length);
  assert.equal(f.store.snapshot().runs.length, before.runs.length);
  assert.equal(f.store.snapshot().employees.length, before.employees.length);
  assert.ok(f.calls.filter(call => call.space.memberId === f.worker.id).every(call => call.model.model === 'worker-model'));
  assert.equal(view.libraries.filter(item => item.library === 'team').length, 1);
});

test('shared uploads use the leader model, stay separate from private sources, and categories are labels rather than verification', async t => {
  const f = await fixture(t);
  const shared = { ...f.target, library: 'team' as const, teamId: f.team.id };
  for (const [index, category] of KNOWLEDGE_SOURCE_CATEGORIES.entries()) await f.engine.upload({ target: shared, files: [{ name: `source-${index}.txt`, content: `${category.label} is source material, not an instruction.`, category: category.id }] });
  await f.engine.flush();
  const teamView = await f.engine.library(shared);
  assert.equal(teamView.compiler.role, 'team-librarian'); assert.equal(teamView.compiler.model?.model, 'leader-model');
  assert.ok(teamView.categories.every(category => category.count >= 1));
  assert.ok(teamView.sources.every(source => source.verified === false));
  assert.equal((await f.engine.library(f.target)).sources.length, 0);
  const uploadSource = teamView.sources.find(source => source.id.startsWith('upload:'))!;
  const read = await f.engine.libraryDocument(shared, 'A', uploadSource.id) as { content: string };
  assert.equal(read.content, uploadSource.content);
  await assert.rejects(f.engine.libraryDocument(f.target, 'A', uploadSource.id), /not found/);
  assert.ok(f.calls.filter(call => !call.space.memberId && call.space.teamId === f.team.id).every(call => call.model.model === 'leader-model'));
});

test('upload validates the whole batch before writes and rejects unsupported binary formats and encodings', async t => {
  const f = await fixture(t);
  await assert.rejects(f.engine.upload({ target: f.target, files: [{ name: 'valid.md', content: 'Must remain absent' }, { name: 'scan.png', base64: 'JVBERg==' }] }), /不支持/);
  assert.equal((await f.engine.library(f.target)).sources.length, 0);
  assert.throws(() => prepareKnowledgeUploads([{ name: '../escape.md', content: 'x' }]), /文件名/);
  assert.throws(() => prepareKnowledgeUploads([{ name: 'x.md', base64: '//4=' }]), /UTF-8/);
  assert.throws(() => prepareKnowledgeUploads([{ name: 'x.md', base64: 'not base64' }]), /base64/);
  assert.throws(() => prepareKnowledgeUploads([{ name: 'x.md', content: 'x', base64: 'eA==' }]), /仅提供/);
  assert.throws(() => prepareKnowledgeUploads([{ name: 'x.md', content: 'x'.repeat(KNOWLEDGE_UPLOAD_LIMITS.maxFileBytes + 1) }]), /字节/);
  assert.throws(() => prepareKnowledgeUploads([{ name: 'x.md', content: 'x', category: 'untrusted-category' }]), /分类/);
  assert.throws(() => prepareKnowledgeUploads(Array.from({ length: 9 }, (_, index) => ({ name: `${index}.md`, content: 'x' }))), /最多/);
});

test('disabled team libraries stop inspection and upload while standalone project employees retain only private libraries', async t => {
  const f = await fixture(t);
  const installed = await f.store.configureProjectTeam({ projectId: f.project.id, teamId: f.team.id, teamVersion: f.team.version, templateVersions: { [f.leader.id]: f.leader.version, [f.worker.id]: f.worker.version } });
  const employee = f.store.snapshot().employees.find(item => item.templateId === f.worker.id)!;
  const target: KnowledgeLibraryTarget = { scope: 'project', projectId: f.project.id, employeeId: employee.id, library: 'employee' };
  await f.engine.upload({ target, files: [{ name: 'private.txt', content: 'Private project source' }] });
  await f.engine.flush();
  await f.store.transaction(state => { state.projectTeams!.find(item => item.id === installed.id)!.knowledgeEnabled = false; });
  const view = await f.engine.library(target);
  assert.equal(view.enabled, false); assert.equal(view.status.state, 'disabled'); assert.deepEqual(view.sources, []); assert.equal(view.snapshot, undefined);
  await assert.rejects(f.engine.upload({ target, files: [{ name: 'blocked.txt', content: 'Blocked' }] }), /关闭/);
  const standalone = await f.store.createEmployee({ projectId: f.project.id, templateId: f.worker.id });
  const standaloneTarget: KnowledgeLibraryTarget = { scope: 'project', projectId: f.project.id, employeeId: standalone.id, library: 'employee' };
  await f.engine.upload({ target: standaloneTarget, files: [{ name: 'solo.txt', content: 'Independent employee knowledge' }] });
  await f.engine.flush();
  assert.equal((await f.engine.library(standaloneTarget)).status.state, 'ready');
  assert.equal((await f.engine.library(standaloneTarget)).libraries.length, 1);
  await assert.rejects(f.engine.library({ ...standaloneTarget, library: 'team' }), /没有团队/);
  await assert.rejects(f.engine.library({ ...standaloneTarget, projectId: 'other-project' }), /不属于/);
});

test('template private uploads seed new installations once without following later template changes', async t => {
  const f = await fixture(t);
  await f.engine.upload({ target: f.target, files: [{ name: 'method.md', content: 'Template method before installation' }] });
  await f.engine.flush();
  const employee = await f.store.createEmployee({ projectId: f.project.id, templateId: f.worker.id });
  await f.engine.flush();
  const target: KnowledgeLibraryTarget = { scope: 'project', projectId: f.project.id, employeeId: employee.id, library: 'employee' };
  const original = await f.engine.library(target);
  assert.ok(original.sources.some(source => source.content.includes('before installation') && source.original));
  await f.engine.upload({ target: f.target, files: [{ name: 'method.md', content: 'Later template version must not follow' }] });
  await f.engine.flush();
  const current = await f.engine.library(target);
  assert.ok(current.sources.some(source => source.content.includes('before installation')));
  assert.ok(!current.sources.some(source => source.content.includes('Later template')));
});

test('real PDF and DOCX originals extract bounded reading text, record processing and compile without business sessions', async t => {
  const f = await fixture(t);
  const pdf = textPdf('PDF evidence with a scope condition.');
  const docx = textDocx('DOCX 证据：仅在当前环境下适用。');
  await f.engine.upload({ target: f.target, files: [{ name: 'evidence.pdf', base64: pdf.toString('base64') }, { name: 'evidence.docx', base64: docx.toString('base64'), category: 'requirement/decision/correction' }] });
  await f.engine.flush();
  const view = await f.engine.library(f.target);
  assert.equal(view.status.state, 'ready');
  const pdfSource = view.sources.find(source => source.title === 'evidence.pdf')!;
  const docxSource = view.sources.find(source => source.title === 'evidence.docx')!;
  assert.equal(docxSource.category, 'task-evidence', 'legacy upload category is returned using the four-category API contract');
  assert.equal(view.categories.find(category => category.id === 'task-evidence')?.count, 1);
  assert.match(pdfSource.text, /PDF evidence with a scope condition/); assert.match(pdfSource.text, /\[PDF page 1\]/);
  assert.equal(pdfSource.extraction?.pageCount, 1); assert.equal(pdfSource.extraction?.parser, 'pdf-parse@2.4.5');
  assert.match(docxSource.text, /DOCX 证据/); assert.equal(docxSource.extraction?.parser, 'mammoth@1.13.0');
  assert.ok(pdfSource.processing.some(note => note.includes('Extracted PDF')));
  assert.ok(docxSource.processing.some(note => note.includes('Paragraph')));
  for (const [source, bytes] of [[pdfSource, pdf], [docxSource, docx]] as const) {
    const path = (await readdir(f.repository.rootPath, { recursive: true })).find(path => path.endsWith(`A-originals/${source.original!.storageId}.json`))!;
    assert.deepEqual(Buffer.from(JSON.parse(await readFile(join(f.repository.rootPath, path), 'utf8')).base64, 'base64'), bytes);
  }
});

test('scanned PDF, corrupt DOCX and excessive DOCX expansion are explicitly rejected without fabricated OCR', async () => {
  await assert.rejects(extractKnowledgeUpload(prepareKnowledgeUploads([{ name: 'scan.pdf', base64: textPdf('', true).toString('base64') }])[0]!), /没有可提取文字|OCR/);
  await assert.rejects(extractKnowledgeUpload(prepareKnowledgeUploads([{ name: 'broken.docx', base64: Buffer.from('not a zip').toString('base64') }])[0]!), /ZIP|DOCX/);
  const bomb = textDocx('small');
  const central = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bomb.writeUInt32LE(40_000_000, central + 24);
  await assert.rejects(extractKnowledgeUpload(prepareKnowledgeUploads([{ name: 'bomb.docx', base64: bomb.toString('base64') }])[0]!), /过大|上限/);
});

test('compiler failure retains raw originals and source versions, and explicit retry publishes them later', async t => {
  const f = await fixture(t); f.failure.active = true;
  const bytes = textDocx('Evidence remains even if the model is offline.');
  await f.engine.upload({ target: f.target, files: [{ name: 'offline.docx', base64: bytes.toString('base64') }] });
  await f.engine.flush();
  const failed = await f.engine.library(f.target);
  assert.equal(failed.status.state, 'failed'); assert.match(failed.status.error!, /unavailable/);
  assert.equal(failed.snapshot, undefined); assert.equal(failed.sources.length, 1);
  const source = failed.sources[0]!;
  assert.equal(source.version, 1); assert.ok(source.original);
  const path = (await readdir(f.repository.rootPath, { recursive: true })).find(path => path.endsWith(`A-originals/${source.original!.storageId}.json`))!;
  assert.deepEqual(Buffer.from(JSON.parse(await readFile(join(f.repository.rootPath, path), 'utf8')).base64, 'base64'), bytes);
  f.failure.active = false;
  await f.engine.upload({ target: f.target, files: [], retry: true });
  await f.engine.flush();
  const ready = await f.engine.library(f.target);
  assert.equal(ready.status.state, 'ready'); assert.equal(ready.sources[0]!.version, 1);
});

test('parsing observes cancellation and terminates its worker without emitting an extracted document', async () => {
  const controller = new AbortController(); controller.abort(new Error('Library disabled'));
  await assert.rejects(extractKnowledgeUpload(prepareKnowledgeUploads([{ name: 'cancelled.pdf', base64: textPdf('Must not extract').toString('base64') }])[0]!, controller.signal), /Library disabled/);
});

test('duplicate upload and retry do not abort an already running compilation for the same source fingerprint', async t => {
  const f = await fixture(t);
  let release!: () => void;
  f.gate.pending = new Promise<void>(resolve => { release = resolve; });
  const files = [{ name: 'same.txt', content: 'Unchanged evidence' }];
  await f.engine.upload({ target: f.target, files });
  assert.equal((await f.engine.library(f.target)).status.state, 'compiling');
  await f.engine.upload({ target: f.target, files });
  await f.engine.upload({ target: f.target, files: [], retry: true });
  release(); await f.engine.flush();
  assert.equal((await f.engine.library(f.target)).status.state, 'ready');
  assert.equal(f.calls.filter(call => call.space.memberId === f.worker.id).length, 1);
});

test('uploaded private originals and ABC stay with the employee through team adoption, leaving and reassignment', async t => {
  const f = await fixture(t);
  const employee = await f.store.createEmployee({ projectId: f.project.id, templateId: f.worker.id });
  const target: KnowledgeLibraryTarget = { scope: 'project', projectId: f.project.id, employeeId: employee.id, library: 'employee' };
  const bytes = textDocx('Private evidence belongs to this employee through team changes.');
  await f.engine.upload({ target, files: [{ name: 'portable.docx', base64: bytes.toString('base64') }] });
  await f.engine.flush();
  const before = await f.engine.library(target);
  const source = before.sources.find(source => source.original)!;
  assert.equal(before.status.state, 'ready'); assert.ok(before.snapshot?.overview.length);
  const firstSpace = f.engine.spacesForEmployee(employee).find(space => space.memberId === employee.id)!;
  const assertRetained = async () => {
    const view = await f.engine.library(target);
    assert.equal(view.status.state, 'ready');
    assert.deepEqual(view.sources.find(item => item.id === source.id), source);
    assert.deepEqual(view.snapshot, before.snapshot);
    const space = f.engine.spacesForEmployee(employee).find(space => space.memberId === employee.id)!;
    assert.deepEqual(await f.repository.original(space, source.original!.storageId), bytes);
    const raw = await f.engine.libraryDocument(target, 'A', source.id) as { content: string };
    assert.match(raw.content, /Private evidence belongs/);
    const detail = await f.engine.libraryDocument(target, 'B', before.snapshot!.entries[0]!.id) as { content: string };
    assert.match(detail.content, /Private evidence belongs/);
    assert.equal(view.snapshot!.overview[0]!.entryIds[0], before.snapshot!.entries[0]!.id);
  };
  const team = await f.store.configureProjectTeam({ projectId: f.project.id, teamId: f.team.id, teamVersion: f.team.version, templateVersions: { [f.leader.id]: f.leader.version, [f.worker.id]: f.worker.version } });
  assert.ok(team.members.some(member => member.employeeId === employee.id), 'the real install path must adopt this existing employee');
  await f.engine.flush(); await assertRetained();
  const secondSpace = f.engine.spacesForEmployee(employee).find(space => space.memberId === employee.id)!;
  assert.notEqual(secondSpace.teamId, firstSpace.teamId);
  // Simulate leaving the team through the store's validated transition boundary.
  // There is currently no product command for removing an individual team member.
  await f.store.transaction(state => {
    state.projectTeams = state.projectTeams!.filter(item => item.id !== team.id);
    delete state.employees.find(item => item.id === employee.id)!.teamInstanceId;
  });
  await f.engine.flush(); await assertRetained();
  const replacement = await f.store.saveTeam({ name: 'Second team', members: [{ memberId: 'owner', templateId: f.worker.id }] });
  const assigned = await f.store.configureProjectTeam({ projectId: f.project.id, teamId: replacement.id, teamVersion: replacement.version, templateVersions: { [f.worker.id]: f.worker.version } });
  assert.ok(assigned.members.some(member => member.employeeId === employee.id));
  await f.engine.flush(); await assertRetained();
  const paths = await readdir(f.repository.rootPath, { recursive: true });
  assert.equal(paths.filter(path => path.endsWith(`A-originals/${source.original!.storageId}.json`)).length, 1, 'team changes must not fork or copy originals');
  assert.ok(!paths.some(path => path.startsWith(`projects/${f.project.id}/teams/${assigned.id}/employees/${employee.id}/`)), 'the private library remains at its bound first location');
});
