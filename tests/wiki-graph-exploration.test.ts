/* SPDX-License-Identifier: GPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { expandSemanticExploration, projectSemanticExploration, semanticFocus, startSemanticExploration, visibleSemanticNodeIds } from '../third_party/llm-wiki/web/graph-focus.js';
import { semanticGraphForDisplay, type WikiEdge, type WikiView } from '../third_party/llm-wiki/web/protocol.js';

function fixture(): WikiView {
  const ids = ['a', 'b', 'c', 'd', 'e', 'isolated', 'f', 'g', 'article', 'source', 'overview'];
  const nodes = ids.map(id => ({ id, label: `Knowledge ${id}`, type: id === 'article' ? 'synthesis' : id === 'source' ? 'source' : id === 'overview' ? 'overview' : ['b', 'd'].includes(id) ? 'entity' : 'concept', path: `${id}.md`, linkCount: 0, community: 0 }));
  const pages = nodes.map(node => ({ id: node.id, title: node.label, path: node.path, type: node.type, content: `Original ${node.id}`, markdown: '', entryIds: ['article'], citations: [], links: ['a', 'c', 'f', 'source'], ...(node.id === 'a' ? { aliases: ['Alpha alias'] } : {}) }));
  const edge = (id: string, source: string, target: string): WikiEdge => ({ id, source, target, weight: 1, relations: [{ id: `relation-${id}`, sourceId: target, targetId: source, predicate: 'depends on', summary: 'Original directed evidence', basis: 'explicit', entryIds: ['article'], citations: [{ sourceId: 'source', sourceVersion: 3, startLine: 2, endLine: 4 }] }] });
  return { schemaVersion: 1, spaceId: 'employee-a', version: 7, status: { state: 'ready' }, pages,
    graph: { kind: 'semantic', nodes, edges: [edge('ab', 'a', 'b'), edge('bc', 'c', 'b'), edge('cd', 'd', 'c'), edge('de', 'e', 'd'), edge('fg', 'f', 'g'), edge('article-link', 'a', 'article'), edge('source-link', 'source', 'f'), { id: 'cooccurrence-only', source: 'a', target: 'f', weight: 99 }], communities: [{ id: 0, nodeCount: ids.length, topNodes: ['Knowledge a'] }] } };
}
const allIds = (view: WikiView) => new Set(view.graph.nodes.map(node => node.id));
const sorted = (values: ReadonlySet<string>) => [...values].sort();

test('default exploration leaves the complete semantic canvas and original one-hop focus unchanged', () => {
  const view = fixture(), before = structuredClone(view), display = semanticGraphForDisplay(view);
  const projection = projectSemanticExploration(view, undefined, allIds(view));
  assert.deepEqual(sorted(projection.nodeIds), []); assert.deepEqual(projection.edges, []); assert.equal(projection.depth, 0); assert.equal(projection.canExpand, false);
  assert.deepEqual(sorted(semanticFocus(display, 'a').nodeIds), ['a', 'b']);
  assert.deepEqual(view, before, 'exploration is a projection, never a graph rewrite or a persistence operation');
});

test('each expansion adds exactly the next real undirected BFS layer and stops at its connected component', () => {
  const view = fixture(), allowed = allIds(view), before = structuredClone(view);
  const first = startSemanticExploration(view, 'a', allowed)!;
  assert.deepEqual(sorted(first.nodeIds), ['a', 'b']); assert.equal(first.depth, 1);
  const firstProjection = projectSemanticExploration(view, first, allowed);
  assert.deepEqual(sorted(firstProjection.nextNodeIds), ['c']); assert.equal(firstProjection.expandableCount, 1); assert.equal(firstProjection.canExpand, true);
  const second = expandSemanticExploration(view, first, allowed)!;
  assert.notEqual(second, first); assert.deepEqual(sorted(first.nodeIds), ['a', 'b']);
  assert.deepEqual(sorted(second.nodeIds), ['a', 'b', 'c']); assert.equal(second.depth, 2);
  const third = expandSemanticExploration(view, second, allowed)!;
  assert.deepEqual(sorted(third.nodeIds), ['a', 'b', 'c', 'd']); assert.equal(third.depth, 3);
  const fourth = expandSemanticExploration(view, third, allowed)!;
  assert.deepEqual(sorted(fourth.nodeIds), ['a', 'b', 'c', 'd', 'e']); assert.equal(fourth.depth, 4);
  assert.equal(projectSemanticExploration(view, fourth, allowed).canExpand, false);
  assert.equal(expandSemanticExploration(view, fourth, allowed), fourth, 'an exhausted expansion preserves its original immutable state and depth');
  assert.deepEqual(view, before); assert.ok(!fourth.nodeIds.has('f') && !fourth.nodeIds.has('article') && !fourth.nodeIds.has('source'));
});

test('a pair can initialize and fit once while isolated, unsupported and missing roots cannot acquire fabricated relationships', () => {
  const view = fixture(), allowed = allIds(view);
  const pair = { ...view, graph: { ...view.graph, nodes: view.graph.nodes.filter(node => ['a', 'b'].includes(node.id)), edges: view.graph.edges.filter(edge => edge.id === 'ab') } };
  const first = startSemanticExploration(pair, 'a', allowed)!;
  assert.equal(projectSemanticExploration(pair, first, allowed).nodeIds.size, 2, 'the first Expand action may fit an already complete pair');
  assert.equal(projectSemanticExploration(pair, first, allowed).canExpand, false);
  const isolated = startSemanticExploration(view, 'isolated', allowed)!;
  assert.equal(projectSemanticExploration(view, isolated, allowed).nodeIds.size, 1);
  assert.equal(projectSemanticExploration(view, isolated, allowed).expandableCount, 0);
  for (const root of ['article', 'source', 'overview', 'missing']) assert.equal(startSemanticExploration(view, root, allowed), undefined);
});

test('the highlighted subgraph contains all real induced edges without changing directed predicates or evidence', () => {
  const view = fixture(), allowed = allIds(view);
  const extra = structuredClone(view.graph.edges[0]!); extra.id = 'ac'; extra.source = 'a'; extra.target = 'c'; extra.relations![0] = { ...extra.relations![0]!, id: 'relation-ac', sourceId: 'c', targetId: 'a' };
  view.graph.edges.push(extra);
  const state = startSemanticExploration(view, 'a', allowed)!;
  const focus = projectSemanticExploration(view, state, allowed);
  assert.deepEqual(sorted(focus.nodeIds), ['a', 'b', 'c']); assert.deepEqual(focus.edges.map(edge => edge.id), ['ab', 'bc', 'ac']);
  assert.equal(focus.edges[0]!.relations![0], view.graph.edges[0]!.relations![0]);
  assert.equal(focus.edges[0]!.relations![0]!.sourceId, 'b'); assert.equal(focus.edges[0]!.relations![0]!.targetId, 'a');
  assert.equal(focus.edges[0]!.relations![0]!.predicate, 'depends on'); assert.deepEqual(focus.edges[0]!.relations![0]!.citations, [{ sourceId: 'source', sourceVersion: 3, startLine: 2, endLine: 4 }]);
  const hover = semanticFocus(semanticGraphForDisplay(view), 'g', undefined, focus.nodeIds);
  assert.deepEqual(sorted(hover.nodeIds), ['a', 'b', 'c']); assert.deepEqual(hover.edges.map(edge => edge.id), ['ab', 'bc', 'ac'], 'hover cannot replace the explored induced subgraph');
});

test('visible IDs share label, type, alias and selected one-hop query behavior without admitting document nodes', () => {
  const view = fixture();
  assert.deepEqual(sorted(visibleSemanticNodeIds(view, new Set(), 'Alpha alias', 'a')), ['a', 'b']);
  assert.deepEqual(sorted(visibleSemanticNodeIds(view, new Set(), 'Knowledge c', 'a')), ['c']);
  assert.deepEqual(sorted(visibleSemanticNodeIds(view, new Set(['concept']), 'entity', 'b')), ['b', 'd']);
  assert.deepEqual(sorted(visibleSemanticNodeIds(view, new Set(), 'Original article', 'a')), []);
  assert.ok(!visibleSemanticNodeIds(view, new Set(), '', 'a').has('source'));
  const allowed = visibleSemanticNodeIds(view, new Set(), 'Alpha alias', 'a');
  const state = startSemanticExploration(view, 'a', allowed)!;
  assert.deepEqual(sorted(state.nodeIds), ['a', 'b']); assert.equal(projectSemanticExploration(view, state, allowed).canExpand, false, 'query context cannot silently expand to unmatched two-hop nodes');
});

test('filters cannot traverse a hidden bridge or continue from a cached node disconnected from the visible root', () => {
  const view = fixture(), allowed = allIds(view);
  const first = startSemanticExploration(view, 'a', allowed)!;
  const third = expandSemanticExploration(view, expandSemanticExploration(view, first, allowed), allowed)!;
  const filtered = visibleSemanticNodeIds(view, new Set(['entity']), '', 'a');
  const focus = projectSemanticExploration(view, third, filtered);
  assert.deepEqual(sorted(focus.nodeIds), ['a']); assert.deepEqual(focus.edges, []); assert.equal(focus.canExpand, false);
  assert.deepEqual(sorted(startSemanticExploration(view, 'a', filtered)!.nodeIds), ['a']);
  assert.deepEqual(sorted(projectSemanticExploration(view, third, allowed).nodeIds), ['a', 'b', 'c', 'd'], 'a read-only filtered projection does not erase the prior valid exploration');
  const rootHidden = new Set(allowed); rootHidden.delete('a');
  assert.equal(startSemanticExploration(view, 'a', rootHidden), undefined); assert.equal(projectSemanticExploration(view, third, rootHidden).nodeIds.size, 0);
});

test('new roots reset to one hop and a different space or version invalidates the old exploration', () => {
  const view = fixture(), allowed = allIds(view), first = startSemanticExploration(view, 'a', allowed)!;
  const nextRoot = startSemanticExploration(view, 'd', allowed)!;
  assert.equal(nextRoot.depth, 1); assert.deepEqual(sorted(nextRoot.nodeIds), ['c', 'd', 'e']); assert.equal(nextRoot.rootId, 'd');
  for (const changed of [{ ...view, spaceId: 'employee-b' }, { ...view, version: 8 }]) {
    const projection = projectSemanticExploration(changed, first, allowed);
    assert.deepEqual(sorted(projection.nodeIds), []); assert.equal(projection.rootId, undefined); assert.equal(projection.depth, 0); assert.equal(projection.canExpand, false);
    assert.equal(expandSemanticExploration(changed, first, allowed), undefined);
  }
});

test('article or source reading data cannot alter the current graph exploration or invent page-cooccurrence edges', () => {
  const view = fixture(), allowed = allIds(view), state = startSemanticExploration(view, 'a', allowed)!;
  const before = projectSemanticExploration(view, state, allowed);
  const readerUpdate = { ...view, pages: view.pages.map(page => page.type === 'synthesis' || page.type === 'source' ? { ...page, content: 'Opened original document', links: ['a', 'e', 'f'] } : page) };
  const after = projectSemanticExploration(readerUpdate, state, allowed);
  assert.deepEqual(after, before); assert.deepEqual(sorted(state.nodeIds), ['a', 'b']);
  assert.ok(!after.edges.some(edge => edge.id === 'cooccurrence-only' || edge.id === 'article-link' || edge.id === 'source-link'));
});
