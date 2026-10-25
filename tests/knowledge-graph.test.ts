import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { KnowledgeLibraryView } from '../src/knowledge/library-api.js';
import type { KnowledgeConcept, KnowledgeEntry, KnowledgeSource } from '../src/knowledge/types.js';
import { buildKnowledgeGraph, KnowledgeGraph } from '../src/ui/KnowledgeGraph.js';
import { fitGraph, layoutConceptGraph, relationGeometry } from '../src/ui/knowledge-graph-layout.js';

const citation = { sourceId: 'a', sourceVersion: 1, startLine: 4, endLine: 4 };
const source = (id: string, version = 1): KnowledgeSource => ({ id, version, title: `资料 ${id}`, content: '内容', text: '内容', provenance: 'test', verified: false, hash: 'hash', createdAt: '2026-10-24', processing: [] });
const article = (id: string): KnowledgeEntry => ({ id, title: `文章 ${id}`, content: '正文', citations: [citation] });
const concept = (id: string, name: string, entryIds = ['first']): KnowledgeConcept => ({ id, name, summary: `${name}的说明`, entryIds, citations: [citation] });
const library = (): KnowledgeLibraryView => ({ target: { scope: 'template', employeeId: 'employee', library: 'employee' }, enabled: true, title: '认知记忆', compiler: { role: 'employee-shadow' }, categories: [], sources: [source('a'), source('b')], status: { state: 'ready' }, supportedExtensions: ['.md'], maxFileBytes: 100, maxUploadBytes: 200, libraries: [],
  snapshot: { version: 1, sourceFingerprint: 'hash', createdAt: '2026-10-24', status: 'candidate', entries: [article('first'), article('second')], overview: [{ id: 'old-topic', title: '不应假造节点的导航标题', summary: '', entryIds: ['first', 'second'] }], conceptGraph: { schemaVersion: 1, concepts: [concept('module', '模块划分'), { ...concept('boundary', '职责边界'), aliases: ['责任边界'] }, concept('isolated', '独立概念', ['second'])], relations: [{ id: 'basis', sourceId: 'module', targetId: 'boundary', predicate: '依据', summary: '模块划分依据职责边界', basis: 'explicit', entryIds: ['first'], citations: [citation] }] } } });

test('graph uses declared concepts and named relationships, without title or citation edges', () => {
  const view = library(); const graph = buildKnowledgeGraph(view, view.snapshot!.entries);
  assert.deepEqual(graph.concepts.map(node => node.name), ['模块划分', '职责边界', '独立概念']);
  assert.deepEqual(graph.relations.map(edge => [edge.sourceId, edge.predicate, edge.targetId]), [['module', '依据', 'boundary']]);
  assert.equal(graph.concepts.length, 3, 'unconnected concepts remain visible');
  assert.ok(!graph.concepts.some(node => /导航标题|文章|资料/.test(node.name)));
  assert.equal(graph.sources.get(JSON.stringify(['a', 2])), undefined, 'a current source must not replace a cited historical version');
  assert.equal(graph.sources.get(JSON.stringify(['a', 1]))?.version, 1);
  assert.deepEqual(view.snapshot!.conceptGraph!.concepts[0].entryIds, ['first']);
});

test('duplicates and missing endpoints do not produce ghost nodes or relations', () => {
  const view = library(); const data = view.snapshot!.conceptGraph!;
  data.concepts.push(data.concepts[0]); data.relations.push(data.relations[0], { ...data.relations[0], id: 'missing', targetId: 'absent' });
  data.concepts[0].entryIds.push('first', 'missing-article');
  const graph = buildKnowledgeGraph(view, [...view.snapshot!.entries, view.snapshot!.entries[0]]);
  assert.equal(graph.concepts.length, 3); assert.equal(graph.relations.length, 1); assert.equal(graph.articles.length, 2);
  assert.deepEqual(graph.concepts.find(node => node.id === 'module')?.entryIds, ['first']);
  const filtered = buildKnowledgeGraph(view, [view.snapshot!.entries[1]]);
  assert.deepEqual(filtered.concepts.map(node => node.id), ['isolated']); assert.equal(filtered.relations.length, 0);
});

test('legacy snapshots remain readable without inventing concepts from article titles', () => {
  const view = library(); delete view.snapshot!.conceptGraph;
  const html = renderToStaticMarkup(createElement(KnowledgeGraph, { view, entries: view.snapshot!.entries, onEntry() {}, onSource() {}, onRebuild() {} }));
  assert.match(html, /aria-label="概念知识图谱"/); assert.match(html, /概念图谱待整理/);
  assert.match(html, /aria-label="打开知识文章"/); assert.match(html, /aria-label="重新整理图谱"/);
  assert.doesNotMatch(html, /aria-label="查看概念 /); assert.doesNotMatch(html, /来源资料|主题→|候选知识/);
});

test('concept graph renders accessible node, predicate, search and view controls', () => {
  const view = library(); view.snapshot!.conceptGraph!.relations[0].basis = 'inferred';
  const html = renderToStaticMarkup(createElement(KnowledgeGraph, { view, entries: view.snapshot!.entries, onEntry() {}, onSource() {} }));
  assert.match(html, /aria-label="查看概念 模块划分"/); assert.match(html, /aria-label="查看关系 模块划分 依据 职责边界"/);
  assert.match(html, /is-inferred/); assert.match(html, /marker-end=/); assert.match(html, /aria-label="搜索概念"/);
  for (const label of ['概念图谱画布', '定位概念', '放大图谱', '缩小图谱', '适配图谱']) assert.ok(html.includes(`aria-label="${label}"`));
  assert.doesNotMatch(html, /关联文章|来源依据|篇文章|份资料|不应假造节点/);
});

test('empty and retained graphs report compilation failure without exposing internal errors', () => {
  const view = library(); view.status = { state: 'failed', error: 'INTERNAL_PROVIDER_ERROR secret diagnostic' };
  const render = () => renderToStaticMarkup(createElement(KnowledgeGraph, { view, entries: view.snapshot!.entries, onEntry() {}, onSource() {}, onRebuild() {} }));
  const retained = render();
  assert.match(retained, /图谱整理失败/); assert.match(retained, /title="整理失败，点击重试"/);
  assert.doesNotMatch(retained, /INTERNAL_PROVIDER_ERROR|secret diagnostic/);
  delete view.snapshot!.conceptGraph;
  const legacy = render(); assert.match(legacy, /图谱整理失败/); assert.doesNotMatch(legacy, /概念图谱待整理/);
  view.snapshot!.conceptGraph = { schemaVersion: 1, concepts: [], relations: [] }; view.status = { state: 'ready' };
  const empty = render(); assert.match(empty, /暂无可展示概念/); assert.doesNotMatch(empty, /概念图谱待整理|图谱整理失败/);
  view.status = { state: 'compiling' }; assert.match(render(), /正在整理概念图谱/);
});

test('all concepts stay accessible and their names are escaped', () => {
  const view = library(); const title = '<script>概念</script>'.repeat(10);
  view.snapshot!.conceptGraph!.concepts = Array.from({ length: 280 }, (_, index) => concept(String(index), index === 279 ? title : `概念 ${index}`));
  const html = renderToStaticMarkup(createElement(KnowledgeGraph, { view, entries: view.snapshot!.entries, onEntry() {}, onSource() {} }));
  assert.equal((html.match(/aria-label="查看概念 /g) ?? []).length, 280);
  assert.ok(html.includes(title.replaceAll('<', '&lt;').replaceAll('>', '&gt;'))); assert.doesNotMatch(html, /<script>/);
});

test('force layout is finite and stable under reordered nodes and edges', () => {
  const view = library(); const data = view.snapshot!.conceptGraph!;
  const layout = layoutConceptGraph(data.concepts, data.relations);
  assert.deepEqual(layout, layoutConceptGraph([...data.concepts].reverse(), [...data.relations].reverse()));
  for (const position of layout.values()) {
    assert.ok(Number.isFinite(position.x) && Number.isFinite(position.y)); assert.ok(position.width >= 104 && position.width <= 208);
  }
  for (const a of layout.values()) for (const b of layout.values()) if (a.id !== b.id) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 70);
  const one = layoutConceptGraph([concept('one', '唯一概念')], []); assert.equal(one.get('one')?.x, 0); assert.equal(one.get('one')?.y, 0);
  assert.equal(layoutConceptGraph([], []).size, 0);
});

test('fit keeps ordinary graphs visible in desktop and narrow windows', () => {
  const view = library(); const data = view.snapshot!.conceptGraph!; const layout = layoutConceptGraph(data.concepts, data.relations);
  for (const [width, height] of [[900, 500], [340, 220]]) {
    const transform = fitGraph(layout, width, height);
    for (const node of layout.values()) {
      assert.ok((node.x - node.width / 2) * transform.scale + transform.x >= 0);
      assert.ok((node.x + node.width / 2) * transform.scale + transform.x <= width);
      assert.ok((node.y - node.height / 2) * transform.scale + transform.y >= 0);
      assert.ok((node.y + node.height / 2) * transform.scale + transform.y <= height);
    }
  }
  assert.deepEqual(fitGraph(new Map(), 400, 200), { x: 200, y: 100, scale: 1 });
});

test('parallel and reverse relations have separate labelled paths and self links stay finite', () => {
  const from = { id: 'a', x: 0, y: 0, width: 100, height: 44 }; const to = { ...from, id: 'b', x: 300 };
  const a = relationGeometry(from, to, 0, 2); const b = relationGeometry(to, from, 1, 2);
  assert.notEqual(a.labelY, b.labelY); assert.notEqual(a.path, b.path);
  assert.ok(a.labelX > from.x && a.labelX < to.x);
  const self = relationGeometry(from, from); assert.match(self.path, / C /); assert.ok(Number.isFinite(self.labelY));
});
