import assert from 'node:assert/strict';
import test from 'node:test';
import { nodeSize } from '../third_party/llm-wiki/web/graph-style.js';

test('Wiki node radii halve the previous display while preserving degree and density proportions', () => {
  // Radii from the preceding display for zero, quarter and maximum degree.
  const previousRadii = [5.656854249492381, 12.727922061357857, 19.79898987322333];
  const currentRadii = [0, 4, 16].map(degree => nodeSize(degree, 16, 150));
  for (const [index, radius] of currentRadii.entries()) assert.ok(Math.abs(radius - previousRadii[index]! / 2) < 1e-12);
  assert.ok(Math.abs(currentRadii[1]! / currentRadii[0]! - 2.25) < 1e-12);
  assert.ok(Math.abs(currentRadii[2]! / currentRadii[0]! - 3.5) < 1e-12);
  assert.equal(nodeSize(4, 16, 600) / currentRadii[1]!, .5, 'the existing crowded-graph adjustment remains proportional');
  assert.ok(Number.isFinite(nodeSize(0, 0, 1)), 'isolated nodes retain a usable finite radius');
});
