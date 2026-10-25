import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { WorkforceStore } from '../src/domain/store.js';
import { captureWorkflowTeam } from '../src/domain/workflow-team.js';
import { resolveConversationWorkflowDetails } from '../src/domain/conversation-workflow-details.js';
import { KnowledgeEngine } from '../src/knowledge/engine.js';
import { KnowledgeRepository } from '../src/knowledge/repository.js';
import { createWikiRuntime } from '../src/knowledge/wiki-runtime.js';
import type { KnowledgeCompiler } from '../src/knowledge/types.js';
import { applyPreviewPlan, assertOriginalRecordsPreserved, buildPreviewPlan, readPreviewDocuments, requireStoppedPort } from '../scripts/seed-project-preview.js';

const sha = (content: Uint8Array) => createHash('sha256').update(content).digest('hex');
async function tree(path: string, prefix = ''): Promise<Record<string, string>> {
  let entries; try { entries = await readdir(path, { withFileTypes: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
  const out: Record<string, string> = {};
  for (const entry of entries) {
    const name = join(prefix, entry.name), location = join(path, entry.name);
    if (entry.isDirectory()) Object.assign(out, await tree(location, name)); else if (entry.isFile()) out[name] = sha(await readFile(location));
  }
  return out;
}
async function closedPort() {
  const server = createServer(); await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); assert.ok(address && typeof address === 'object'); const port = address.port;
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())); return port;
}
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const directory = await mkdtemp(join(tmpdir(), 'workforce-project-preview-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'state.json'), store = await WorkforceStore.open(path);
  const project = await store.saveProject({ name: 'Original project', rootPath: directory });
  const team = store.snapshot().teams[0]!, templates = store.snapshot().templates;
  const flow = await store.saveWorkflowTemplate({ name: 'Original software process', roles: [{ id: 'architect', name: 'Architect', memberId: 'architect' }],
    team: captureWorkflowTeam(team, templates), steps: ['requirements', 'experience', 'architecture', 'delivery'].map(id => ({ id, name: id, roleId: 'architect', instruction: 'Original instruction', outputs: ['Original output'], acceptanceCriteria: ['Original criteria'] })) });
  await store.selectConversationWorkflow({ projectId: project.id, sessionId: 'session-original', workflowTemplateId: flow.id, workflowTemplateVersion: flow.version, templateVersions: Object.fromEntries(templates.map(template => [template.id, template.version])) }, { expectedRevision: store.snapshot().revision });
  return { path, projectId: project.id, store, directory };
}

test('preview planning is read-only, explicitly simulated and detached from real routing', async t => {
  const { store, projectId } = await fixture(t), before = store.snapshot();
  const plan = buildPreviewPlan(before, projectId, 'session-demo', await readPreviewDocuments(), '2026-10-25T12:00:00.000Z');
  assert.deepEqual(store.snapshot(), before);
  assert.equal(plan.runs.length, 5); assert.equal(plan.instance.completions.length, 3);
  assert.ok(plan.runs.every(run => run.request.startsWith('【演示】') && run.output?.includes('未发生模型执行或真实验收')));
  assert.ok(plan.runs.filter(run => run.acceptance).every(run => run.acceptance!.reviewer === '演示验收（模拟）' && run.acceptance!.note.includes('非真实验收')));
  assert.notEqual(plan.team.id, before.projectTeams![0]!.id);
  assert.ok(plan.employees.every(employee => employee.modules.knowledge.sources.length === 0 && employee.modules.permissions.writePaths.length === 0));
});

test('offline seed refuses a listening port and stale CAS before writing knowledge or state', async t => {
  const { store, projectId, path, directory } = await fixture(t), beforeBytes = await readFile(path);
  const plan = buildPreviewPlan(store.snapshot(), projectId, 'session-demo', await readPreviewDocuments());
  const server = createServer(); await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  try { await assert.rejects(requireStoppedPort(address.port), /port is listening/); await assert.rejects(applyPreviewPlan(path, plan, { expectedRevision: plan.expectedRevision, servicePort: address.port }), /port is listening/); }
  finally { await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())); }
  await assert.rejects(applyPreviewPlan(path, plan, { expectedRevision: plan.expectedRevision - 1, servicePort: await closedPort() }), /Fresh explicit revision/);
  assert.deepEqual(await readFile(path), beforeBytes); assert.deepEqual(await tree(join(directory, 'knowledge')), {});
});

test('isolated preview creates candidate Wiki, valid simulated history and is byte-idempotent', async t => {
  const { store, projectId, path, directory } = await fixture(t), before = store.snapshot();
  const plan = buildPreviewPlan(before, projectId, 'session-demo', await readPreviewDocuments());
  const result = await applyPreviewPlan(path, plan, { expectedRevision: before.revision, servicePort: await closedPort() });
  assert.equal(result.status, 'applied'); assert.equal(result.modelCalls, 0);
  const after = await store.reload(); assertOriginalRecordsPreserved(before, after, plan);
  const detail = resolveConversationWorkflowDetails(after, projectId, 'session-demo');
  assert.equal(detail.selectedStep?.latestDelivery?.status, 'awaiting-review');
  assert.equal(detail.selectedStep?.id, plan.team.workflows[0]!.steps[3]!.id);
  assert.equal(detail.selectedStep?.acceptedDelivery, undefined); assert.deepEqual(detail.selectedStep?.confirmedItems, []);
  const completed = resolveConversationWorkflowDetails(after, projectId, 'session-demo', { stepId: plan.team.workflows[0]!.steps[2]!.id });
  assert.equal(completed.selectedStep?.acceptedDelivery?.acceptance?.reviewer, '演示验收（模拟）');
  assert.equal(completed.selectedStep?.history?.length, 2); assert.equal(completed.selectedStep?.confirmedItems?.length, 3);
  assert.ok(completed.selectedStep!.confirmedItems!.every(item => item.title.startsWith('【演示】') && item.content.includes('非真实用户确认')));
  const knowledgeRoot = join(directory, 'knowledge', basename(path)), repository = new KnowledgeRepository(knowledgeRoot);
  const space = { kind: 'project' as const, projectId, teamId: plan.team.id };
  const sources = await repository.sources(space), snapshot = await repository.snapshot(space);
  assert.equal(sources.length, 6); assert.ok(sources.every(source => !source.verified && source.provenance.startsWith('demo:')));
  assert.equal(snapshot?.status, 'candidate'); assert.equal(snapshot?.compilationTrace?.modelCalls, 0);
  assert.ok(snapshot!.conceptGraph!.concepts.length >= 25 && snapshot!.conceptGraph!.relations.length >= 25);
  const stateBytes = await readFile(path), files = await tree(knowledgeRoot);
  const repeated = await applyPreviewPlan(path, buildPreviewPlan(after, projectId, 'session-demo', await readPreviewDocuments()), { expectedRevision: before.revision, servicePort: await closedPort() });
  assert.equal(repeated.status, 'already-applied'); assert.deepEqual(await readFile(path), stateBytes); assert.deepEqual(await tree(knowledgeRoot), files);
  const calls: unknown[] = [], errors: unknown[] = [], runtime = createWikiRuntime();
  const compiler: KnowledgeCompiler = Object.assign(async (request: unknown) => { calls.push(request); throw new Error('Preview must never call a model'); }, { incrementalVersion: 1 as const, conceptGraphVersion: 1 as const });
  const engine = new KnowledgeEngine(store, repository, compiler, error => errors.push(error), runtime);
  try {
    await engine.start();
    const library = await engine.library({ scope: 'project', projectId, employeeId: plan.employees[0]!.id, library: 'team', teamId: plan.team.id });
    assert.equal(library.status.state, 'ready'); assert.equal(library.sources.length, 6 + plan.projectMemoryInputs.length);
    const view = await engine.libraryWiki(library.target); assert.equal(view.graph.nodes.length, snapshot!.conceptGraph!.concepts.length);
    assert.equal(view.graph.edges.reduce((count, edge) => count + (edge.relations?.length ?? 0), 0), snapshot!.conceptGraph!.relations.length);
    await store.transaction(() => undefined, { expectedRevision: store.snapshot().revision });
  } finally { await engine.dispose(); await runtime.dispose(); }
  assert.deepEqual(calls, []); assert.deepEqual(errors, []);
});

test('optional full private clone preserves every original record and knowledge file', { skip: !process.env.WORKFORCE_PREVIEW_TEST_STATE }, async t => {
  const sourcePath = resolve(process.env.WORKFORCE_PREVIEW_TEST_STATE!), projectId = process.env.WORKFORCE_PREVIEW_TEST_PROJECT!, sessionId = process.env.WORKFORCE_PREVIEW_TEST_SESSION!;
  assert.ok(projectId && sessionId);
  const directory = await mkdtemp(join(tmpdir(), 'workforce-preview-full-clone-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, basename(sourcePath)), sourceKnowledge = resolve(dirname(sourcePath), 'knowledge', basename(sourcePath));
  await cp(sourcePath, path); const knowledgeRoot = resolve(directory, 'knowledge', basename(path)); await cp(sourceKnowledge, knowledgeRoot, { recursive: true });
  // Transplant only the temporary copy's explicit owner root. Never alter or
  // bypass the live owner's metadata; all copied content stays unchanged.
  const ownerPath = join(knowledgeRoot, '.owner.json'), owner = JSON.parse(await readFile(ownerPath, 'utf8'));
  assert.equal(owner.plugin, 'dsh-plugin-composable-workforce'); assert.equal(owner.rootPath, sourceKnowledge);
  await writeFile(ownerPath, JSON.stringify({ ...owner, rootPath: knowledgeRoot }));
  const originalFiles = await tree(knowledgeRoot), originalBytes = await readFile(sourcePath);
  const store = await WorkforceStore.open(path), before = store.snapshot();
  const plan = buildPreviewPlan(before, projectId, sessionId, await readPreviewDocuments());
  const result = await applyPreviewPlan(path, plan, { expectedRevision: before.revision, servicePort: await closedPort() });
  assert.equal(result.status, 'applied');
  const after = (await WorkforceStore.open(path)).snapshot(); assertOriginalRecordsPreserved(before, after, plan);
  const stagedFiles = await tree(knowledgeRoot), afterBytes = await readFile(path);
  for (const [file, hash] of Object.entries(originalFiles)) assert.equal(stagedFiles[file], hash, 'An original knowledge file was changed in the clone');
  assert.deepEqual(await readFile(sourcePath), originalBytes);
  const repeat = await applyPreviewPlan(path, buildPreviewPlan(after, projectId, sessionId, await readPreviewDocuments()), { expectedRevision: before.revision, servicePort: await closedPort() });
  assert.equal(repeat.status, 'already-applied'); assert.deepEqual(await tree(knowledgeRoot), stagedFiles); assert.deepEqual(await readFile(path), afterBytes);
  const current = resolveConversationWorkflowDetails(after, projectId, sessionId);
  assert.equal(current.selectedStep?.id, plan.team.workflows[0]!.steps[3]!.id);
  assert.equal(current.selectedStep?.latestDelivery?.status, 'awaiting-review'); assert.deepEqual(current.selectedStep?.confirmedItems, []);
  const complete = resolveConversationWorkflowDetails(after, projectId, sessionId, { stepId: plan.team.workflows[0]!.steps[2]!.id });
  assert.equal(complete.selectedStep?.history?.length, 2); assert.equal(complete.selectedStep?.confirmedItems?.length, 3);
  const repository = new KnowledgeRepository(knowledgeRoot), refreshedStore = await WorkforceStore.open(path), errors: unknown[] = [], calls: unknown[] = [];
  const runtime = createWikiRuntime();
  const compiler: KnowledgeCompiler = Object.assign(async (request: unknown) => { calls.push(request); throw new Error('No model calls are allowed in the clone'); }, { incrementalVersion: 1 as const, conceptGraphVersion: 1 as const });
  const engine = new KnowledgeEngine(refreshedStore, repository, compiler, error => errors.push(error), runtime);
  try {
    await engine.start();
    const library = await engine.library({ scope: 'project', projectId, employeeId: plan.employees[0]!.id, library: 'team', teamId: plan.team.id });
    assert.equal(library.status.state, 'ready'); assert.equal(library.sources.length, 6 + plan.projectMemoryInputs.length);
    const snapshot = library.snapshot!;
    assert.equal(snapshot.conceptGraph?.concepts.length, 29); assert.equal(snapshot.conceptGraph?.relations.length, 25);
    for (const reference of plan.projectMemoryInputs) {
      const source = library.sources.find(source => source.id === reference.id)!;
      assert.equal(sha(Buffer.from(source.title)), sha(Buffer.from(reference.title))); assert.equal(sha(Buffer.from(source.content)), sha(Buffer.from(reference.content))); assert.equal(sha(Buffer.from(source.provenance)), sha(Buffer.from(reference.provenance))); assert.equal(source.verified, true);
      const reading = snapshot.entries.find(entry => entry.citations.some(citation => citation.sourceId === reference.id))!;
      assert.ok(reading.title.startsWith('【既有项目记忆引用】')); assert.equal(sha(Buffer.from(reading.content)), sha(Buffer.from(reference.content)));
      assert.ok(snapshot.conceptGraph!.concepts.every(concept => concept.citations.every(citation => citation.sourceId !== reference.id)));
      assert.ok(snapshot.conceptGraph!.relations.every(relation => relation.citations.every(citation => citation.sourceId !== reference.id)));
    }
    await engine.libraryWiki(library.target);
    await refreshedStore.transaction(() => undefined, { expectedRevision: refreshedStore.snapshot().revision });
  } finally { await engine.dispose(); await runtime.dispose(); }
  assert.deepEqual(calls, []); assert.deepEqual(errors, []);
  const afterRestartFiles = await tree(knowledgeRoot);
  for (const [file, hash] of Object.entries(originalFiles)) assert.equal(afterRestartFiles[file], hash, 'Restart changed an original knowledge file');
  assert.deepEqual(await readFile(sourcePath), originalBytes);
  console.log(JSON.stringify({ fullPrivateClone: true, originalRevision: before.revision, originalKnowledgeFiles: Object.keys(originalFiles).length, originalRecordsPreserved: true, originalFileHashesPreserved: true, explicitProjectMemoryReferences: plan.projectMemoryInputs.length, manualConcepts: 29, manualRelations: 25, restartReady: true, byteIdempotent: true, modelCalls: 0 }));
});
