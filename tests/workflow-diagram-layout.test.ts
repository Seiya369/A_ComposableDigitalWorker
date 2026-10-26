import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowDiagramLayout } from '../src/ui/workflow-diagram-layout.js';
import type { WorkflowTemplate } from '../src/domain/types.js';

function steps(count: number): WorkflowTemplate['steps'] {
  return Array.from({ length: count }, (_, index) => ({ id: `step-${index}`, name: `Step ${index}`, roleId: 'owner', instruction: 'Complete the stage', onRejectStepId: `step-${Math.max(0, index - 3)}` }));
}

test('workflow diagram fits responsive widths and keeps every node and return label inside the canvas', () => {
  for (const width of [240, 320, 480, 768, 1024, 1440]) {
    const layout = workflowDiagramLayout(steps(10), width);
    assert.equal(layout.width, width);
    assert.equal(layout.forwardEdges.length, 9);
    assert.equal(layout.returnEdges.length, 9);
    for (const node of layout.nodes) {
      assert.ok(node.x >= 0 && node.y >= 0);
      assert.ok(node.x + node.width <= width);
      assert.ok(node.y + node.height < layout.height);
    }
    for (const edge of layout.returnEdges) {
      assert.ok(edge.label.x > 0 && edge.label.x < width);
      assert.ok(edge.label.y > 0 && edge.label.y < layout.height);
      assert.doesNotMatch(edge.path, /NaN|Infinity/);
    }
  }
});

test('return labels receive distinct row tracks and all cross-row returns have distinct exterior lanes', () => {
  const layout = workflowDiagramLayout(steps(10), 1024);
  const labels = layout.returnEdges.map(edge => `${layout.nodes[edge.source]!.row}:${edge.label.y}`);
  assert.equal(new Set(labels).size, labels.length, 'labels cannot occupy the same source-row baseline');
  const crossRow = layout.returnEdges.filter(edge => layout.nodes[edge.source]!.row !== layout.nodes[edge.target]!.row);
  const lanes = crossRow.map(edge => / H ([\d.]+) V /.exec(edge.path)![1]);
  assert.equal(new Set(lanes).size, lanes.length, 'cross-row return trunks cannot share the same vertical lane');
  for (const edge of layout.returnEdges) {
    const source = layout.nodes[edge.source]!, target = layout.nodes[edge.target]!;
    assert.ok(edge.path.startsWith(`M ${source.x + source.width * .72} ${source.y + source.height}`));
    assert.ok(edge.path.endsWith(`V ${target.y + target.height}`));
    assert.ok(edge.label.x > source.x + source.width / 2, 'return text must not sit on the sequence turning line');
    assert.ok(edge.label.x < source.x + source.width * .72, 'return text stays before the return departure port');
  }
});

test('empty and self-rework drafts remain finite and a partial snake row connects at its turning edge', () => {
  const empty = workflowDiagramLayout([], 0);
  assert.deepEqual(empty.nodes, []);
  assert.ok(Number.isFinite(empty.height));
  const draft = steps(4); draft.forEach(step => { step.onRejectStepId = step.id; });
  const layout = workflowDiagramLayout(draft, 1024);
  assert.equal(layout.columns, 3);
  assert.equal(layout.nodes[2]!.x, layout.nodes[3]!.x);
  assert.deepEqual(layout.returnEdges, []);
  assert.doesNotMatch(layout.forwardEdges.join(' '), /NaN|Infinity/);
});

test('dense narrow workflows compress routing lanes without placing paths outside the canvas', () => {
  const layout = workflowDiagramLayout(steps(50), 240);
  for (const edge of layout.returnEdges) {
    const coordinates = edge.path.split(/[MHV ]+/).filter(Boolean).map(Number);
    assert.ok(coordinates.every(value => Number.isFinite(value) && value >= 0));
    assert.ok(edge.label.x >= 0 && edge.label.x <= layout.width);
  }
});
