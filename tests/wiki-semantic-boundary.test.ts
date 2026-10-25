import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWikiRuntime, LLM_WIKI_ENGINE } from '../src/knowledge/wiki-runtime.js';
import type { WikiBuildRequest, WikiLibraryView, WikiPage } from '../src/knowledge/wiki-types.js';

/** The wire contract's fixed Markdown envelope, independently authored fixture data. */
function serializeReadingPage(page: WikiPage, sourcePageId: (id: string) => string): void {
  const sourceIds = [...new Set(page.citations.map(citation => sourcePageId(citation.sourceId)))];
  page.markdown = `---\ntitle: ${JSON.stringify(page.title)}\ntype: ${page.type}\nsources: ${JSON.stringify(sourceIds)}\nrelated: ${JSON.stringify(page.links)}\n---\n${page.content}${page.links.length ? `\n\n${page.links.map(id => `[[${id}]]`).join(' · ')}` : ''}`;
}

function fixture() {
  const spaceId = 'semantic-boundary';
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  const pageId = (kind: string, id: string) => `p-${hash(`${spaceId}\0${kind}\0${id}`)}`;
  const citation = { sourceId: 'source', sourceVersion: 1, startLine: 1, endLine: 1 };
  const evidence = { entryIds: ['article'], citations: [citation] };
  const request: WikiBuildRequest = { spaceId, sources: [{ id: 'source', title: 'Source', text: 'Supported fact', content: 'Supported fact', version: 1, hash: 'source-hash', provenance: 'fixture', verified: false, createdAt: '2026-10-24', processing: [] }], snapshot: {
    version: 1, sourceFingerprint: 'fingerprint', status: 'candidate', createdAt: '2026-10-24',
    entries: [{ id: 'article', title: 'Reorganized knowledge', content: 'Complete knowledge body', citations: [citation] }], overview: [{ id: 'overview', title: 'Authorized theme', summary: 'Authorized overview summary', entryIds: ['article'] }],
    conceptGraph: { schemaVersion: 1, concepts: [
      { id: 'method', name: 'Method', kind: 'concept', summary: 'A method', ...evidence },
      { id: 'system', name: 'System', kind: 'entity', summary: 'A concrete system', ...evidence },
    ], relations: [{ id: 'used-by', sourceId: 'method', targetId: 'system', predicate: 'used by', basis: 'explicit', ...evidence }] },
  } };
  const pages: WikiPage[] = [
    ...request.snapshot.conceptGraph!.concepts.map(concept => ({ id: pageId('concept', concept.id), path: `wiki/${concept.kind === 'entity' ? 'entities' : 'concepts'}/${pageId('concept', concept.id)}.md`, title: concept.name, type: concept.kind!, content: concept.summary, markdown: '', entryIds: concept.entryIds, citations: concept.citations, links: [pageId('concept', concept.id === 'method' ? 'system' : 'method'), pageId('entry', 'article'), pageId('source', 'source')] })),
    { id: pageId('entry', 'article'), path: `wiki/synthesis/${pageId('entry', 'article')}.md`, title: 'Reorganized knowledge', type: 'synthesis', content: 'Complete knowledge body', markdown: '', entryIds: ['article'], citations: [citation], links: [pageId('concept', 'method'), pageId('concept', 'system'), pageId('source', 'source')] },
    { id: pageId('source', 'source'), path: `wiki/sources/${pageId('source', 'source')}.md`, title: 'Source', type: 'source', content: 'Supported fact', markdown: '', entryIds: ['article'], citations: [citation], links: [pageId('entry', 'article'), pageId('concept', 'method'), pageId('concept', 'system')] },
    { id: pageId('overview', 'overview'), path: 'wiki/overview.md', title: '知识概览', type: 'overview', content: '## Authorized theme\n\nAuthorized overview summary', markdown: '', entryIds: ['article'], citations: [], links: [pageId('entry', 'article')] },
  ];
  for (const page of pages) serializeReadingPage(page, id => pageId('source', id));
  const [left, right] = pages;
  const view: Omit<WikiLibraryView, 'status'> = { schemaVersion: 1, engine: LLM_WIKI_ENGINE, spaceId, version: 1, pages, graph: {
    kind: 'semantic', nodes: [left!, right!].map(page => ({ id: page.id, path: page.path, label: page.title, type: page.type, linkCount: 1, community: 0 })),
    edges: [{ id: `e-${hash([left!.id, right!.id].sort().join('\0'))}`, source: left!.id, target: right!.id, weight: 1, relations: [{ id: `r-${hash(`${spaceId}\0relation\0used-by`)}`, sourceId: left!.id, targetId: right!.id, predicate: 'used by', basis: 'explicit', ...evidence }] }],
    communities: [{ id: 0, nodeCount: 2, cohesion: 1, meanIntraDegree: 1, topNodes: ['Method', 'System'] }],
  } };
  return { request, view };
}

async function respond(t: { after(fn: () => Promise<void>): void }, view: Omit<WikiLibraryView, 'status'>) {
  const folder = await mkdtemp(join(tmpdir(), 'wiki-semantic-boundary-'));
  const enginePath = join(folder, 'response.cjs');
  await writeFile(enginePath, `const view=${JSON.stringify(view)};require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);console.log(JSON.stringify({id:m.id,ok:true,value:view}));});`);
  const runtime = createWikiRuntime({ enginePath });
  t.after(async () => { await runtime.dispose(); await rm(folder, { recursive: true, force: true }); });
  return runtime;
}

test('semantic JSON boundary accepts complete reading pages without turning them into graph nodes', async t => {
  const f = fixture(); const runtime = await respond(t, f.view);
  const view = await runtime.build(f.request);
  assert.equal(view.pages.length, 5); assert.equal(view.graph.nodes.length, 2); assert.equal(view.graph.edges.length, 1);
  assert.equal(view.pages.find(page => page.type === 'synthesis')!.content, 'Complete knowledge body');
});

test('semantic JSON boundary rejects structural nodes, invented or missing relations, direction changes and inflated degrees', async t => {
  const cases: Array<(view: Omit<WikiLibraryView, 'status'>) => void> = [
    view => { delete view.graph.kind; },
    view => { view.graph.nodes[0]!.type = 'source'; },
    view => { view.graph.nodes[0]!.label = 'Invented knowledge'; },
    view => { view.pages[0]!.content = 'Rewritten concept definition'; },
    view => { view.graph.edges[0]!.relations = []; },
    view => { view.graph.edges = []; view.graph.nodes.forEach(node => { node.linkCount = 0; }); },
    view => { const r = view.graph.edges[0]!.relations![0]!; [r.sourceId, r.targetId] = [r.targetId, r.sourceId]; },
    view => { view.graph.edges[0]!.relations![0]!.predicate = 'Invented relationship'; },
    view => { view.graph.edges[0]!.relations![0]!.citations = []; },
    view => { view.graph.edges[0]!.relations![0]!.basis = 'inferred'; },
    view => { view.graph.edges[0]!.relations!.push(structuredClone(view.graph.edges[0]!.relations![0]!)); view.graph.edges[0]!.weight = 2; },
    view => { view.graph.edges[0]!.weight = 99; },
    view => { view.graph.nodes[0]!.linkCount = 5; },
    view => { view.graph.communities[0]!.nodeCount = view.pages.length; },
    view => { view.graph.communities[0]!.cohesion = 0; },
    view => { view.graph.communities[0]!.topNodes = ['Source']; },
  ];
  for (const mutate of cases) {
    const f = fixture(); mutate(f.view);
    const runtime = await respond(t, f.view);
    await assert.rejects(runtime.build(f.request), /semantic|reading page/);
    await runtime.dispose();
  }
});

test('reading-page boundary rejects changed A/B/C text, hidden Markdown changes, unknown identities and colliding paths', async t => {
  const cases: Array<(pages: WikiPage[]) => void> = [
    pages => { pages.find(page => page.type === 'source')!.content = 'OTHER_LIBRARY_PRIVATE_SOURCE'; },
    pages => { pages.find(page => page.type === 'synthesis')!.content = 'OTHER_LIBRARY_PRIVATE_ARTICLE'; },
    pages => { pages.find(page => page.type === 'overview')!.content = 'OTHER_LIBRARY_PRIVATE_OVERVIEW'; },
    pages => { pages.find(page => page.type === 'source')!.title = 'Another library source'; },
    pages => { pages.find(page => page.type === 'synthesis')!.title = 'Another library article'; },
    pages => { pages.find(page => page.type === 'source')!.markdown += '\nHIDDEN_OTHER_LIBRARY_DATA'; },
    pages => { pages.find(page => page.type === 'overview')!.markdown = '---\ntitle: Injected overview\n---'; },
    pages => { pages.find(page => page.type === 'source')!.path = pages.find(page => page.type === 'synthesis')!.path; },
    pages => { pages.find(page => page.type === 'synthesis')!.id = `p-${'a'.repeat(64)}`; },
    pages => { pages.find(page => page.type === 'synthesis')!.entryIds = []; },
    pages => { pages.find(page => page.type === 'source')!.citations = []; },
    pages => { pages.find(page => page.type === 'overview')!.links = []; },
    pages => { pages.find(page => page.type === 'source')!.aliases = ['Unrelated private alias']; },
  ];
  for (const mutate of cases) {
    const f = fixture(); mutate(f.view.pages);
    const runtime = await respond(t, f.view);
    await assert.rejects(runtime.build(f.request), /reading page/);
    await runtime.dispose();
  }
});

test('the JSON boundary refuses missing reading pages even when the semantic graph remains complete', async t => {
  for (const type of ['source', 'synthesis', 'overview']) {
    const f = fixture(); f.view.pages = f.view.pages.filter(page => page.type !== type);
    const runtime = await respond(t, f.view);
    await assert.rejects(runtime.build(f.request), /reading pages are incomplete/);
    await runtime.dispose();
  }
});

test('legacy articles remain readable with exact A/B/C pages and an empty semantic graph', async t => {
  const f = fixture(); delete f.request.snapshot.conceptGraph;
  f.view.pages = f.view.pages.filter(page => !['concept', 'entity'].includes(page.type));
  const ids = new Set(f.view.pages.map(page => page.id));
  const sourceId = f.view.pages.find(page => page.type === 'source')!.id;
  for (const page of f.view.pages) { page.links = page.links.filter(id => ids.has(id)); serializeReadingPage(page, () => sourceId); }
  f.view.graph = { kind: 'semantic', nodes: [], edges: [], communities: [] };
  const runtime = await respond(t, f.view);
  const result = await runtime.build(f.request);
  assert.equal(result.pages.length, 3);
  assert.equal(result.pages.find(page => page.type === 'synthesis')!.content, 'Complete knowledge body');
  assert.deepEqual(result.graph.nodes, []);
});

test('JSON object property order cannot reject otherwise identical exact source evidence', async t => {
  const f = fixture();
  const reorder = (citation: typeof f.request.snapshot.entries[number]['citations'][number]) => ({ endLine: citation.endLine, startLine: citation.startLine, sourceVersion: citation.sourceVersion, sourceId: citation.sourceId });
  for (const page of f.view.pages) page.citations = page.citations.map(reorder);
  for (const edge of f.view.graph.edges) for (const relation of edge.relations ?? []) relation.citations = relation.citations.map(reorder);
  const runtime = await respond(t, f.view);
  assert.equal((await runtime.build(f.request)).pages.length, 5);
});
