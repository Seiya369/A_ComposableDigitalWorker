import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { WorkforceStore } from '../src/domain/store.js';
import { createBlankModules } from '../src/domain/seed.js';
import { KnowledgeRepository } from '../src/knowledge/repository.js';
import { KnowledgeEngine } from '../src/knowledge/engine.js';
import type { KnowledgeLibraryTarget } from '../src/knowledge/library-api.js';
import type { KnowledgeSnapshot } from '../src/knowledge/types.js';
import type { WikiBuildRequest, WikiLibraryView, WikiRuntime } from '../src/knowledge/wiki-types.js';

/** Version numbers are local to a space; bundled libraries can all publish v1. */
async function snapshotDirectory(root: string, snapshot: Pick<KnowledgeSnapshot, 'version' | 'sourceFingerprint'>): Promise<string> {
  const files = await readdir(root, { recursive: true });
  const matches = (await Promise.all(files.filter(path => basename(path) === 'snapshot.json').map(async path => {
    const manifest = JSON.parse(await readFile(join(root, path), 'utf8'));
    return manifest.version === snapshot.version && manifest.sourceFingerprint === snapshot.sourceFingerprint ? dirname(join(root, path)) : undefined;
  }))).filter((path): path is string => path !== undefined);
  assert.equal(matches.length, 1, 'The target snapshot version and exact source fingerprint must resolve one knowledge space');
  return matches[0]!;
}

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'workforce-shared-wiki-api-'));
  const store = await WorkforceStore.open(join(root, 'state.json'));
  const modules = createBlankModules();
  modules.responsibilities = { mission: 'Evidence', duties: ['Research'], boundaries: [] };
  modules.delivery.acceptanceCriteria = ['Cited evidence'];
  modules.model = { mode: 'override', provider: 'offline', model: 'fixture' };
  const first = await store.saveTemplate({ name: 'First', status: 'ready', modules });
  const second = await store.saveTemplate({ name: 'Second', status: 'ready', modules });
  const team = await store.saveTeam({ name: 'Shared', members: [{ memberId: 'lead', templateId: first.id }, { memberId: 'peer', templateId: second.id, reportsTo: 'lead' }] });
  const calls: WikiBuildRequest[] = [];
  const control: { pending?: Promise<void>; entered?: () => void; mutate?: (view: Omit<WikiLibraryView, 'status'>) => void; compileFailure?: Error } = {};
  const errors: unknown[] = [];
  const runtime: WikiRuntime = {
    async analysisPrompt() { return 'Unused by the deterministic compiler'; },
    async build(request) {
      calls.push(structuredClone(request));
      for (const entry of request.snapshot.entries) for (const citation of entry.citations) assert.equal(request.sources.find(source => source.id === citation.sourceId)?.version, citation.sourceVersion, 'Wiki builder receives the exact historical A version cited by the visible snapshot');
      control.entered?.();
      await control.pending;
      const pages = request.snapshot.entries.map(entry => ({ id: entry.id, path: `wiki/${entry.id}.md`, title: entry.title, type: 'synthesis' as const, content: entry.content, markdown: entry.content, entryIds: [entry.id], citations: entry.citations, links: [] }));
      const view: Omit<WikiLibraryView, 'status'> = { schemaVersion: 1, engine: { name: 'llm_wiki', version: 'fixture', revision: 'fixture' }, spaceId: request.spaceId, version: request.snapshot.version, pages, graph: { kind: 'semantic', nodes: [], edges: [], communities: [] } };
      control.mutate?.(view);
      return view;
    },
    async dispose() {},
  };
  const repository = new KnowledgeRepository(join(root, 'knowledge'));
  const engine = new KnowledgeEngine(store, repository, async request => {
    if (control.compileFailure) throw control.compileFailure;
    return ({
    entries: request.sources.map((source, index) => ({ id: `detail-${index}`, title: source.title, content: source.text, citations: [{ sourceId: source.id, sourceVersion: source.version, startLine: 1, endLine: source.text.split('\n').length }] })),
    overview: [{ id: 'overview', title: 'Overview', summary: 'Evidence', entryIds: request.sources.map((_, index) => `detail-${index}`) }],
    });
  }, error => { errors.push(error); }, runtime);
  t.after(async () => { await engine.dispose(); await rm(root, { recursive: true, force: true }); });
  await engine.start();
  const target: KnowledgeLibraryTarget = { scope: 'template', employeeId: first.id, library: 'employee' };
  return { store, engine, repository, calls, control, errors, first, second, team, target };
}

test('two employees and one team build Wiki views through the same runtime with isolated source sets', async t => {
  const f = await fixture(t);
  const spaces = [
    { target: f.target, marker: 'PRIVATE_FIRST_941' },
    { target: { ...f.target, employeeId: f.second.id }, marker: 'PRIVATE_SECOND_163' },
    { target: { ...f.target, library: 'team' as const, teamId: f.team.id }, marker: 'TEAM_SHARED_728' },
  ];
  for (const { target, marker } of spaces) await f.engine.upload({ target, files: [{ name: `${marker}.md`, content: marker }] });
  await f.engine.flush();
  const baseline = f.store.snapshot();
  const views = await Promise.all(spaces.map(({ target }) => f.engine.libraryWiki(target)));
  assert.equal(f.calls.length, 3);
  assert.equal(new Set(views.map(view => view.spaceId)).size, 3);
  for (const [index, view] of views.entries()) {
    assert.equal(view.status.state, 'ready');
    assert.ok(view.pages.some(page => page.content.includes(spaces[index]!.marker)));
    for (const other of spaces.filter((_, other) => other !== index)) assert.ok(!JSON.stringify(view).includes(other.marker));
    const call = f.calls.find(call => call.spaceId === view.spaceId)!;
    assert.ok(call.sources.some(source => source.text.includes(spaces[index]!.marker)));
    assert.ok(!call.sources.some(source => spaces.some((space, other) => other !== index && source.text.includes(space.marker))));
  }
  assert.deepEqual(f.store.snapshot(), baseline, 'Inspection does not create employee sessions, runs, configuration or shared memory');
});

test('Wiki inspection reuses target validation and refuses another project or team', async t => {
  const f = await fixture(t);
  await assert.rejects(f.engine.libraryWiki({ ...f.target, scope: 'project', projectId: 'other-project' }), /不属于/);
  await assert.rejects(f.engine.libraryWiki({ ...f.target, library: 'team', teamId: 'other-team' }), /请选择/);
  await assert.rejects(f.engine.libraryWiki({ ...f.target, employeeId: 'unknown-employee' }), /不存在/);
  assert.equal(f.calls.length, 0, 'Unauthorized targets never reach the shared runtime');
});

test('Wiki rebuilding preserves raw originals and published historical snapshots', async t => {
  const f = await fixture(t);
  const bytes = Buffer.from('\uFEFF# Preserved\r\nORIGINAL_BYTES_487\r\n');
  await f.engine.upload({ target: f.target, files: [{ name: 'original.md', base64: bytes.toString('base64') }] });
  await f.engine.flush();
  const original = await f.engine.library(f.target);
  const first = await f.engine.libraryWiki(f.target);
  const libraryPath = await snapshotDirectory(f.repository.rootPath, original.snapshot!);
  const oldSnapshotPath = join(libraryPath, 'B-knowledge', `v${original.snapshot!.version}.json`);
  const oldSnapshot = await readFile(oldSnapshotPath);
  const originalPath = join(libraryPath, 'A-originals', `${original.sources[0]!.original!.storageId}.json`);
  await f.engine.upload({ target: f.target, files: [], retry: true });
  await f.engine.flush();
  const current = await f.engine.library(f.target);
  const rebuilt = await f.engine.libraryWiki(f.target);
  assert.deepEqual(current.sources, original.sources);
  assert.ok(rebuilt.version > first.version);
  const source = original.sources[0]!;
  const space = f.calls[0]!.spaceId;
  assert.equal(rebuilt.spaceId, space);
  assert.equal(source.original!.byteLength, bytes.length);
  assert.ok(rebuilt.pages.some(page => page.content.includes('ORIGINAL_BYTES_487')));
  assert.equal(original.snapshot!.entries[0]!.content, first.pages[0]!.content);
  assert.deepEqual(await readFile(oldSnapshotPath), oldSnapshot);
  assert.deepEqual(Buffer.from(JSON.parse(await readFile(originalPath, 'utf8')).base64, 'base64'), bytes);
});

test('disabled Wiki libraries return no pages and never call the shared runtime', async t => {
  const f = await fixture(t);
  const target: KnowledgeLibraryTarget = { ...f.target, library: 'team', teamId: f.team.id };
  await f.engine.upload({ target, files: [{ name: 'shared.md', content: 'Disabled source remains preserved' }] });
  await f.engine.flush();
  await f.store.transaction(state => { state.teams.find(team => team.id === f.team.id)!.knowledgeEnabled = false; });
  const view = await f.engine.libraryWiki(target);
  assert.equal(view.status.state, 'disabled');
  assert.deepEqual(view.pages, []);
  assert.deepEqual(view.graph, { kind: 'semantic', nodes: [], edges: [], communities: [] });
  assert.equal(f.calls.length, 0);
});

test('malicious Wiki page paths cannot escape into project or plugin files', async t => {
  const f = await fixture(t);
  await f.engine.upload({ target: f.target, files: [{ name: 'source.md', content: 'Safe source stays intact' }] });
  await f.engine.flush();
  const source = (await f.engine.library(f.target)).sources[0]!;
  f.control.mutate = view => { view.pages[0]!.path = '../../escaped.md'; };
  await assert.rejects(f.engine.libraryWiki(f.target), /Unsafe.*Wiki page path/);
  const files = await readdir(f.repository.rootPath, { recursive: true });
  assert.ok(!files.some(path => path.endsWith('escaped.md') || path.endsWith('projection.json')));
  assert.deepEqual((await f.engine.library(f.target)).sources[0], source);
});

test('a late Wiki build cannot publish after its authorized source set changes', async t => {
  const f = await fixture(t);
  await f.engine.upload({ target: f.target, files: [{ name: 'changing.md', content: 'Old authorized version' }] });
  await f.engine.flush();
  let release!: () => void;
  const entered = new Promise<void>(resolve => { f.control.entered = resolve; });
  f.control.pending = new Promise<void>(resolve => { release = resolve; });
  const pending = f.engine.libraryWiki(f.target);
  await entered;
  try {
    await f.engine.upload({ target: f.target, files: [{ name: 'changing.md', content: 'New authorized version' }] });
    await f.engine.flush();
  } finally { release(); }
  await assert.rejects(pending, /资料已更新|conflict/);
  const files = await readdir(f.repository.rootPath, { recursive: true });
  assert.ok(!files.some(path => path.endsWith('projection.json')), 'Obsolete pages never become the published Wiki cache');
  assert.ok((await f.engine.library(f.target)).sources[0]!.text.includes('New authorized version'));
});

test('a failed recompilation keeps the old Wiki and its exact historical A citations readable', async t => {
  const f = await fixture(t);
  await f.engine.upload({ target: f.target, files: [{ name: 'versioned.md', content: 'CITED_OLD_A_VERSION_1' }] });
  await f.engine.flush();
  const previous = await f.engine.library(f.target);
  f.control.compileFailure = new Error('Offline compiler intentionally unavailable');
  await f.engine.upload({ target: f.target, files: [{ name: 'versioned.md', content: 'ACTIVE_NEW_A_VERSION_2' }] });
  await f.engine.flush();
  const active = await f.engine.library(f.target);
  assert.equal(active.status.state, 'failed');
  assert.equal(active.sources[0]!.version, 2);
  assert.ok(active.sources[0]!.text.includes('ACTIVE_NEW_A_VERSION_2'));
  assert.equal(active.snapshot!.version, previous.snapshot!.version);
  const wiki = await f.engine.libraryWiki(f.target);
  assert.equal(wiki.version, previous.snapshot!.version);
  assert.equal(wiki.status.state, 'failed');
  assert.ok(wiki.pages.some(page => page.content.includes('CITED_OLD_A_VERSION_1')));
  assert.ok(!wiki.pages.some(page => page.content.includes('ACTIVE_NEW_A_VERSION_2')));
  assert.equal(f.calls.at(-1)!.sources[0]!.version, 1);
  const citation = wiki.pages[0]!.citations[0]!;
  const raw = await f.engine.libraryDocument(f.target, 'A', citation.sourceId, citation.sourceVersion) as { version: number; text: string };
  assert.equal(raw.version, 1);
  assert.ok(raw.text.includes('CITED_OLD_A_VERSION_1'));
  assert.ok(f.errors.some(error => error instanceof Error && error.message.includes('intentionally unavailable')));
});

test('a legacy page-network cache is replaced locally without recompiling or changing A/B/C history', async t => {
  const f = await fixture(t);
  await f.engine.upload({ target: f.target, files: [{ name: 'legacy.md', content: 'Preserved full knowledge and evidence' }] });
  await f.engine.flush();
  const before = await f.engine.library(f.target);
  const files = await readdir(f.repository.rootPath, { recursive: true });
  const libraryPath = await snapshotDirectory(f.repository.rootPath, before.snapshot!);
  const immutableFiles = files.filter(path => path.endsWith('.json') && /(?:^|\/)(?:A-sources|A-originals|B-knowledge|C-overview)\//.test(path));
  const bytes = await Promise.all(immutableFiles.map(path => readFile(join(f.repository.rootPath, path))));
  const projectionPath = join(libraryPath, 'wiki', `v${before.snapshot!.version}`, 'projection.json');
  await mkdir(dirname(projectionPath), { recursive: true });
  await writeFile(projectionPath, JSON.stringify({ sourceFingerprint: before.snapshot!.sourceFingerprint, view: { schemaVersion: 1, pages: [], graph: { nodes: [{ type: 'synthesis' }], edges: [], communities: [] } } }));
  f.control.compileFailure = new Error('Inspection must not call a model');
  const view = await f.engine.libraryWiki(f.target);
  assert.equal(view.graph.kind, 'semantic');
  assert.deepEqual(view.graph.nodes, [], 'legacy articles do not become substitute concepts');
  assert.ok(view.pages.some(page => page.content.includes('Preserved full knowledge and evidence')));
  const saved = JSON.parse(await readFile(projectionPath, 'utf8'));
  assert.equal(saved.view.graph.kind, 'semantic');
  assert.deepEqual(saved.view.graph.nodes, []);
  const after = await f.engine.library(f.target);
  assert.deepEqual(after.snapshot, before.snapshot); assert.deepEqual(after.sources, before.sources);
  for (const [i, path] of immutableFiles.entries()) assert.deepEqual(await readFile(join(f.repository.rootPath, path)), bytes[i]);
  assert.deepEqual(f.errors, []);
});
