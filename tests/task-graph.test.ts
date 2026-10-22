import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutTaskGraph, relatedTaskIds } from '../src/ui/task-graph.js';

test('dependency layout places every predecessor before a joined task and remains stable across input order', () => {
  const nodes = [{ id: 'join', dependencyIds: ['front', 'back'] }, { id: 'front', dependencyIds: ['spec'] }, { id: 'spec', dependencyIds: [] }, { id: 'back', dependencyIds: ['spec'] }];
  const layout = layoutTaskGraph(nodes);
  const positions = new Map(layout.nodes.map(node => [node.id, node]));
  for (const edge of layout.edges) assert.ok(positions.get(edge.from)!.x < positions.get(edge.to)!.x);
  assert.equal(layout.edges.length, 4);
  assert.deepEqual(layout, layoutTaskGraph([...nodes].reverse()));
  const boxes = layout.nodes.map(node => `${node.x}/${node.y}`);
  assert.equal(new Set(boxes).size, nodes.length);
});

test('graph focus follows transitive dependencies without unrelated branches', () => {
  const nodes = [{ id: 'a', dependencyIds: [] }, { id: 'b', dependencyIds: ['a'] }, { id: 'c', dependencyIds: ['b'] }, { id: 'other', dependencyIds: ['a'] }];
  assert.deepEqual([...relatedTaskIds(nodes, 'c', 'upstream')].sort(), ['a', 'b', 'c']);
  assert.deepEqual([...relatedTaskIds(nodes, 'b', 'downstream')].sort(), ['b', 'c']);
  assert.deepEqual([...relatedTaskIds(nodes, 'missing', 'upstream')], []);
});

test('invalid graph data is finite, reports cycles and never draws missing endpoints', () => {
  const layout = layoutTaskGraph([{ id: 'a', dependencyIds: ['b', 'missing'] }, { id: 'b', dependencyIds: ['a'] }]);
  assert.equal(layout.hasCycle, true);
  assert.equal(layout.edges.length, 2);
  assert.ok(layout.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y)));
});
