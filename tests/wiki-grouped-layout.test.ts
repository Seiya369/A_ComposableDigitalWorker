/* SPDX-License-Identifier: GPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { fitGraphCameraRatio, groupedSemanticLayout } from '../third_party/llm-wiki/web/graph-layout.js';
import { semanticFocus } from '../third_party/llm-wiki/web/graph-focus.js';
import type { WikiView } from '../third_party/llm-wiki/web/protocol.js';

function fixture(): WikiView['graph'] {
  const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, index) => ({ id, label: `知识 ${id}`, type: 'concept', path: `${id}.md`, linkCount: index === 1 ? 2 : index < 5 ? 1 : 0,
    // Deliberately split the first component across communities and share a community with a disconnected component.
    community: index === 1 ? 1 : 0 }));
  return { kind: 'semantic', nodes, edges: [['a', 'b'], ['b', 'c'], ['d', 'e']].map(([source, target], index) => ({ id: `edge-${index}`, source, target, weight: 1,
    relations: [{ id: `relation-${index}`, sourceId: source, targetId: target, predicate: '关联', basis: 'explicit', entryIds: ['entry'],
      citations: [{ sourceId: 'source', sourceVersion: 1, startLine: 1, endLine: 1 }] }] })), communities: [{ id: 0, nodeCount: 5, topNodes: ['知识 a'] }, { id: 1, nodeCount: 1, topNodes: ['知识 b'] }] };
}

test('grouped overview follows actual components, retaining isolates and cross-community semantic links', () => {
  const graph = fixture(); const before = structuredClone(graph); const layout = groupedSemanticLayout(graph, 'space');
  assert.deepEqual(graph, before, 'visual layout cannot mutate graph contents or add synthetic links');
  assert.equal(layout.groups.length, 3);
  assert.deepEqual(layout.groups.map(group => [...group.nodeIds].sort()), [['a', 'b', 'c'], ['d', 'e'], ['f']]);
  assert.equal(layout.groups[0].label, '知识 b', 'group name comes from an actual central semantic node');
  assert.deepEqual([...layout.positions.keys()].sort(), graph.nodes.map(node => node.id));
  for (const point of layout.positions.values()) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
});

test('semantic grouping is deterministic across input ordering and independent of page navigation', () => {
  const graph = fixture(); const layout = groupedSemanticLayout(graph, 'space');
  const reordered = { ...graph, nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse(), communities: [...graph.communities].reverse() };
  const again = groupedSemanticLayout(reordered, 'space');
  assert.deepEqual([...again.positions], [...layout.positions]);
  assert.deepEqual(again.groups, layout.groups);
});

test('one circular frame retains component metadata without allocating separate component boxes', () => {
  const graph = fixture(), layout = groupedSemanticLayout(graph, 'space');
  const values = [...layout.positions.values()];
  assert.ok(values.every(point => Math.abs(Math.hypot(point.x, point.y) - 100) < 1e-8), 'this small graph uses one actual circle centered at the origin');
  for (const group of layout.groups) for (const id of group.nodeIds) {
    const point = layout.positions.get(id)!;
    assert.ok(Math.hypot(point.x - group.x, point.y - group.y) <= group.radius - 25.9, 'component envelopes describe actual global coordinates only');
  }
  const relabeled = { ...graph, nodes: graph.nodes.map(node => ({ ...node, label: `Renamed ${node.id}`, community: 99 - node.community })) };
  assert.deepEqual([...groupedSemanticLayout(relabeled, 'space').positions], [...layout.positions], 'changing display groups or labels cannot rearrange the semantic network');
});

test('isolated-only and empty knowledge retain their actual topology', () => {
  const graph = fixture(); graph.edges = []; graph.nodes = graph.nodes.slice(0, 2).map(node => ({ ...node, linkCount: 0 }));
  const layout = groupedSemanticLayout(graph, 'space');
  assert.equal(layout.positions.size, 2); assert.equal(layout.groups.length, 2); assert.equal(graph.edges.length, 0);
  assert.deepEqual(groupedSemanticLayout({ kind: 'semantic', nodes: [], edges: [], communities: [] }, 'space'), { groups: [], positions: new Map() });
});

test('one-hop focus includes real neighbors and predicates without adding two-hop or unrelated groups', () => {
  const graph = fixture(); const focus = semanticFocus(graph, 'a');
  assert.deepEqual([...focus.nodeIds].sort(), ['a', 'b']);
  assert.deepEqual(focus.edges.map(edge => edge.id), ['edge-0']);
  assert.equal(focus.edges[0].relations?.[0].predicate, '关联');
  assert.deepEqual([...semanticFocus(graph, 'b').nodeIds].sort(), ['a', 'b', 'c']);
  assert.deepEqual([...semanticFocus(graph, 'f').nodeIds], ['f']);
  assert.equal(semanticFocus(graph, 'f').edges.length, 0);
});

test('edge focus retains the exact relationship and invalid focus never fabricates a neighborhood', () => {
  const graph = fixture(); const focus = semanticFocus(graph, undefined, 'edge-2');
  assert.deepEqual([...focus.nodeIds].sort(), ['d', 'e']); assert.equal(focus.edges[0], graph.edges[2]);
  assert.deepEqual([...semanticFocus(graph, 'not-a-concept').nodeIds], []);
  assert.equal(semanticFocus(graph, undefined, 'not-a-relation').edges.length, 0);
});


test('a large unrelated-only library stays deterministic and finite without constructing links or a shelf of boxes', () => {
  const graph = fixture(); graph.edges = [];
  graph.nodes = Array.from({ length: 512 }, (_, index) => ({ ...graph.nodes[0], id: `isolated-${index}`, label: `Isolated ${index}`, linkCount: 0 }));
  const before = structuredClone(graph), layout = groupedSemanticLayout(graph, 'isolates');
  assert.deepEqual(graph, before); assert.equal(layout.positions.size, 512); assert.equal(layout.groups.length, 512);
  assert.equal(new Set([...layout.positions.values()].map(point => `${point.x}:${point.y}`)).size, 512);
  assert.ok([...layout.positions.values()].every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
  assert.deepEqual([...groupedSemanticLayout({ ...graph, nodes: [...graph.nodes].reverse() }, 'isolates').positions], [...layout.positions]);
});

test('camera fitting may zoom out to keep a larger exploration set inside the actual viewport', () => {
  const viewport = { width: 600, height: 400 }, points = [{ x: 250, y: 180 }, { x: 350, y: 220 }];
  const before = structuredClone(points), first = fitGraphCameraRatio(points, viewport)!;
  const expanded = [...points, { x: -100, y: -200 }, { x: 800, y: 700 }];
  const next = fitGraphCameraRatio(expanded, viewport)!;
  assert.ok(next > first && next > 1, 'fitting must zoom out instead of always approaching a fixed .65 ratio');
  assert.ok(900 / next <= viewport.width - 128 + .001 && 900 / next <= viewport.height - 128 + .001);
  assert.deepEqual(points, before, 'a camera request never moves a graph node');
  assert.equal(fitGraphCameraRatio([], viewport), undefined);
  assert.equal(fitGraphCameraRatio([{ x: 2, y: 3 }], viewport), .65);
  assert.equal(fitGraphCameraRatio([{ x: NaN, y: Infinity }], viewport), undefined);
});


function circularFixture(total: number): WikiView['graph'] {
  const source = fixture(), nodes = Array.from({ length: total }, (_, index) => ({ ...source.nodes[0], id: `node-${String(index).padStart(3, '0')}`, label: `Concept ${index}`, community: Math.floor(index / 8), linkCount: 0 }));
  const pairs: Array<[number, number]> = [];
  if (total >= 8) {
    const core = Math.min(5, total);
    for (let a = 0; a < core; a++) for (let b = a + 1; b < core; b++) pairs.push([a, b]);
    for (let index = core; index < total; index++) pairs.push([index % core, index]);
  }
  const edges = pairs.map(([a, b], index) => ({ ...source.edges[0], id: `edge-${String(index).padStart(4, '0')}`, source: nodes[a].id, target: nodes[b].id }));
  for (const node of nodes) node.linkCount = edges.filter(edge => edge.source === node.id || edge.target === node.id).length;
  return { kind: 'semantic', nodes, edges, communities: [] };
}

function assertRegularRings(layout: ReturnType<typeof groupedSemanticLayout>, expectedCounts?: number[]) {
  const rings = new Map<number, Array<{ x: number; y: number }>>();
  for (const point of layout.positions.values()) {
    const radius = Math.round(Math.hypot(point.x, point.y) * 1e7) / 1e7;
    const members = rings.get(radius) ?? []; members.push(point); rings.set(radius, members);
  }
  const ordered = [...rings].sort(([a], [b]) => a - b);
  if (expectedCounts) assert.deepEqual(ordered.map(([, members]) => members.length), expectedCounts);
  for (const [radius, members] of ordered) {
    if (!radius) { assert.equal(members.length, 1); continue; }
    const angles = members.map(point => (Math.atan2(point.y, point.x) + Math.PI * 2) % (Math.PI * 2)).sort((a, b) => a - b);
    for (let index = 0; index < angles.length; index++) {
      const gap = (angles[(index + 1) % angles.length] - angles[index] + Math.PI * 2) % (Math.PI * 2);
      if (angles.length > 1) assert.ok(Math.abs(gap - Math.PI * 2 / angles.length) < 1e-7, `ring radius ${radius} has uniform angular spacing`);
    }
  }
  if (layout.positions.size > 1) assert.ok(Math.abs(ordered.at(-1)![0] - 100) < 1e-7, 'the complete graph has one regular circular perimeter');
  return ordered;
}

test('41 concepts form regular 5/12/24 concentric rings with genuinely higher-degree nodes inside', () => {
  const graph = circularFixture(41), before = structuredClone(graph), layout = groupedSemanticLayout(graph, 'space');
  assertRegularRings(layout, [5, 12, 24]);
  const degree = (id: string) => new Set(graph.edges.filter(edge => edge.source === id || edge.target === id).map(edge => edge.source === id ? edge.target : edge.source)).size;
  const ranked = [...layout.positions].sort(([, a], [, b]) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
  for (const [innerId, inner] of ranked) for (const [outerId, outer] of ranked) if (Math.hypot(inner.x, inner.y) + 1e-6 < Math.hypot(outer.x, outer.y)) assert.ok(degree(innerId) >= degree(outerId), 'an outer node never outranks an inner node by real neighbor count');
  assert.deepEqual(graph, before, 'circular layout does not add, remove or rewrite any semantic node, edge or evidence');
  const reordered = { ...graph, nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() };
  assert.deepEqual([...groupedSemanticLayout(reordered, 'space').positions], [...layout.positions], 'multi-ring phase and neighbor ordering are deterministic after input reordering');
  const metadata = { ...graph, nodes: graph.nodes.map(node => ({ ...node, label: `Translated ${node.id}`, community: 99 - node.community, linkCount: 999 })) };
  assert.deepEqual([...groupedSemanticLayout(metadata, 'space').positions], [...layout.positions], 'labels, group colors and cached link statistics never change circle geometry');
});

test('empty, single, double, small stars and nine-node networks preserve a readable circular form', () => {
  assert.deepEqual([...groupedSemanticLayout(circularFixture(1), 'space').positions.values()], [{ x: 0, y: 0 }]);
  const double = groupedSemanticLayout(circularFixture(2), 'space'); assertRegularRings(double, [2]);
  const [a, b] = [...double.positions.values()]; assert.ok(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - 200) < 1e-8, 'two nodes are diametrically opposed');
  assertRegularRings(groupedSemanticLayout(circularFixture(7), 'space'), [7]);
  assertRegularRings(groupedSemanticLayout(circularFixture(9), 'space'), [3, 6]);
  const star = circularFixture(4); star.edges = [1, 2, 3].map((index) => ({ ...fixture().edges[0], id: `star-${index}`, source: star.nodes[0].id, target: star.nodes[index].id }));
  const centered = groupedSemanticLayout(star, 'space'); assertRegularRings(centered, [1, 3]);
  assert.deepEqual(centered.positions.get(star.nodes[0].id), { x: 0, y: 0 }, 'the unique small-star hub occupies the center');
});

test('large circular layouts keep all nodes evenly spaced, deterministic and semantically unchanged', () => {
  const graph = circularFixture(512), before = structuredClone(graph), layout = groupedSemanticLayout(graph, 'space');
  const rings = assertRegularRings(layout); assert.ok(rings.length > 3);
  assert.equal(layout.positions.size, 512); assert.equal(new Set([...layout.positions.values()].map(point => `${point.x}:${point.y}`)).size, 512);
  assert.deepEqual(graph, before);
  assert.deepEqual([...groupedSemanticLayout({ ...graph, nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() }, 'space').positions], [...layout.positions]);
});
