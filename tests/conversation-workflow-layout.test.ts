import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutConversationWorkflow, selectConversationWorkflowWindow, type ConversationWorkflowLayoutStep } from '../src/ui/conversation-workflow-layout.js';

const steps: ConversationWorkflowLayoutStep[] = [
  { id: 'plan', name: '需求确认' },
  { id: 'build', name: '开发实现' },
  { id: 'review', name: '交付验收', onRejectStepId: 'plan' },
];

type Point = { x: number; y: number };
// Inspect coordinates emitted by the real helper, including Bezier controls.
// Control-point bounds also bound the complete quadratic/cubic curve.
function inspectPath(path: string) {
  let current: Point = { x: 0, y: 0 };
  const points: Point[] = [], segments: { command: string; from: Point; to: Point; controls: Point[] }[] = [];
  for (const match of path.matchAll(/([MLHVQC])([^MLHVQC]*)/g)) {
    const command = match[1]!, values = match[2]!.trim().split(/[\s,]+/).map(Number), from = current;
    const arity = ({ M: 2, L: 2, H: 1, V: 1, Q: 4, C: 6 } as Record<string, number>)[command];
    assert.equal(values.length, arity, `complete ${command} command in ${path}`);
    assert.ok(values.every(Number.isFinite));
    const pairs: Point[] = command === 'H' ? [{ x: values[0]!, y: current.y }]
      : command === 'V' ? [{ x: current.x, y: values[0]! }]
      : Array.from({ length: values.length / 2 }, (_, index) => ({ x: values[index * 2]!, y: values[index * 2 + 1]! }));
    current = pairs.at(-1)!; points.push(...pairs);
    if (command !== 'M') segments.push({ command, from, to: current, controls: pairs.slice(0, -1) });
  }
  assert.ok(points.length && segments.length, 'a visible return has a complete, nonempty route');
  return { start: points[0]!, end: current, points, segments, minY: Math.min(...points.map(point => point.y)) };
}

function assertCrownReturn(layout: ReturnType<typeof layoutConversationWorkflow>, edge: ReturnType<typeof layoutConversationWorkflow>['edges'][number]) {
  const route = inspectPath(edge.path);
  const source = layout.nodes.find(node => node.id === edge.sourceId)!, target = layout.nodes.find(node => node.id === edge.targetId)!;
  for (const [endpoint, node] of [[route.start, source], [route.end, target]] as const) {
    assert.ok(Math.abs(endpoint.x - node.x) < .001 && Math.abs(endpoint.y - (node.y - 14)) < .001, 'the real endpoint is the exact circle crown');
    assert.ok(Math.abs(Math.hypot(endpoint.x - node.x, endpoint.y - node.y) - 14) < .001);
  }
  assert.ok(route.points.every(point => point.y <= layout.nodeY - 14 + .001), 'all line and Bezier controls stay on or above every circle crown, so the full path cannot enter any circle');
  const last = route.segments.at(-1)!;
  assert.equal(last.command, 'V'); assert.equal(last.from.x, last.to.x);
  assert.ok(last.to.y - last.from.y >= 5 - .001, 'the final downward stem contains the complete five-pixel arrow marker');
  assert.ok(route.minY - .5 >= layout.drawingTop - .001, 'the complete one-pixel stroke stays inside the SVG extent');
  return route;
}

test('visible nodes and circle-boundary sequence lines share the allocated strip coordinates', () => {
  const layout = layoutConversationWorkflow({ steps, visibleIds: steps.map(step => step.id), width: 300, aboveSpace: 32 });
  assert.equal(layout.nodeWidth, 100);
  assert.deepEqual(layout.nodes.map(node => [node.id, node.index, node.left, node.x, node.y]), [
    ['plan', 0, 0, 50, 16], ['build', 1, 100, 150, 16], ['review', 2, 200, 250, 16],
  ]);
  assert.deepEqual(layout.edges.filter(edge => edge.kind === 'sequence').map(edge => edge.path), ['M 64 16 H 136', 'M 164 16 H 236']);
  const reject = layout.edges.find(edge => edge.kind === 'reject')!;
  assert.equal(reject.sourceId, 'review'); assert.equal(reject.targetId, 'plan'); assert.equal(reject.lane, 0);
  assertCrownReturn(layout, reject);
  assert.equal(layout.reserveTop, 0); assert.equal(layout.height, 30);
  assert.equal(layout.contentHeight, 52); assert.equal(layout.drawingTop, -5); assert.equal(layout.drawingHeight, 57);
  assert.equal(layout.overflowReturnCount, 0);
});

test('explicit self retry and implicit default retry add no displayed return, lane or drawing space', () => {
  for (const width of [28, 52, 176]) {
    const definition = [{ id: 'self', name: '返工', onRejectStepId: 'self' }, { id: 'default' }];
    const input = { steps: definition, visibleIds: width === 176 ? ['self', 'default'] : ['self'], width, aboveSpace: 32 };
    const layout = layoutConversationWorkflow(input);
    assert.deepEqual(layout.edges.filter(edge => edge.kind === 'reject'), []);
    assert.deepEqual(layout.returns, []);
    assert.equal(layout.overflowReturnCount, 0);
    assert.equal(layout.drawingTop, 0);
    assert.deepEqual(layout, layoutConversationWorkflow({ ...input, steps: definition.map(({ onRejectStepId: _, ...step }) => step) }), 'the explicit self rule cannot change the visible geometry');
    assert.equal(definition[0]!.onRejectStepId, 'self', 'display filtering preserves the execution definition');
  }
});

test('self retry consumes no lane or overflow entry alongside true cross-step returns', () => {
  const definition = [
    { id: 'first', onRejectStepId: 'first' }, { id: 'second' },
    { id: 'third', onRejectStepId: 'first' }, { id: 'fourth', onRejectStepId: 'fourth' },
    { id: 'fifth', onRejectStepId: 'second' }, { id: 'sixth', onRejectStepId: 'sixth' },
  ];
  const input = { steps: definition, visibleIds: definition.map(step => step.id), width: 528, aboveSpace: 32 };
  const layout = layoutConversationWorkflow(input);
  assert.deepEqual(layout.returns.map(item => [item.sourceId, item.targetId]), [['third', 'first'], ['fifth', 'second']]);
  assert.deepEqual(layout.edges.filter(edge => edge.kind === 'reject').map(edge => edge.lane), [0, 1]);
  assert.equal(layout.overflowReturnCount, 0);
  for (const edge of layout.edges.filter(edge => edge.kind === 'reject')) assertCrownReturn(layout, edge);
  const noSelf = definition.map(step => step.onRejectStepId === step.id ? { id: step.id } : step);
  assert.deepEqual(layout, layoutConversationWorkflow({ ...input, steps: noSelf }));
});

test('hidden endpoints retain their real semantic target without drawing an edge to an ellipsis or across a gap', () => {
  const layout = layoutConversationWorkflow({ steps, visibleIds: ['build', 'review'], width: 224, beforeWidth: 24 });
  assert.deepEqual(layout.nodes.map(node => node.x), [74, 174]);
  assert.deepEqual(layout.edges.filter(edge => edge.kind === 'sequence').map(edge => [edge.sourceId, edge.targetId]), [['build', 'review']]);
  assert.equal(layout.returns[0]!.targetId, 'plan'); assert.equal(layout.returns[0]!.visible, false);
  assert.equal(layout.returns[0]!.drawn, false); assert.equal(layout.overflowReturnCount, 0);
  const gap = layoutConversationWorkflow({ steps: steps.map(({ onRejectStepId: _, ...step }) => step), visibleIds: ['plan', 'review'], width: 200 });
  assert.deepEqual(gap.edges, [], 'Visible but nonadjacent definition steps never acquire a sequence edge');
});

test('invalid or forward returns and unknown visible IDs do not create connections', () => {
  const values = [{ id: 'a', onRejectStepId: 'later' }, { id: 'later', onRejectStepId: 'missing' }];
  const layout = layoutConversationWorkflow({ steps: values, visibleIds: ['missing', 'later', 'a', 'a'], width: 176 });
  assert.deepEqual(layout.nodes.map(node => node.id), ['a', 'later'], 'Definition order remains authoritative');
  assert.deepEqual(layout.returns, []); assert.equal(layout.edges.length, 1);
  assert.equal(layout.reserveTop, 0); assert.equal(layout.height, 30);
  assert.equal(layout.contentHeight, 52); assert.equal(layout.drawingTop, 0); assert.equal(layout.drawingHeight, 52);
});

test('three admitted overlapping tracks preserve the fixed row and report every omitted visual return', () => {
  const values = Array.from({ length: 6 }, (_, index) => ({ id: String(index), ...(index ? { onRejectStepId: '0' } : {}) }));
  const layout = layoutConversationWorkflow({ steps: values, visibleIds: values.map(step => step.id), width: 528, aboveSpace: 32 });
  assert.deepEqual(layout.edges.filter(edge => edge.kind === 'reject').map(edge => edge.lane), [0, 1, 2]);
  assert.equal(layout.returns.length, 5); assert.equal(layout.overflowReturnCount, 2);
  assert.equal(layout.returns.filter(item => item.drawn).length, 3);
  assert.equal(layout.reserveTop, 0); assert.equal(layout.height, 30); assert.equal(layout.nodeY, 16);
  assert.equal(layout.drawingTop, -15); assert.equal(layout.drawingHeight, 67);
  assert.deepEqual(layout.edges.filter(edge => edge.kind === 'reject').map(edge => assertCrownReturn(layout, edge).minY), [-4, -9, -14], 'admitted tracks remain separated by five pixels');
  assert.ok(layout.edges.every(edge => !/NaN|Infinity/.test(edge.path)));
});

test('disjoint return intervals reuse a track instead of increasing the strip height', () => {
  const values = Array.from({ length: 6 }, (_, index) => ({ id: String(index), ...(index % 2 ? { onRejectStepId: String(index - 1) } : {}) }));
  const layout = layoutConversationWorkflow({ steps: values, visibleIds: values.map(step => step.id), width: 528, aboveSpace: 32 });
  assert.deepEqual(layout.edges.filter(edge => edge.kind === 'reject').map(edge => edge.lane), [0, 0, 0]);
  assert.equal(layout.reserveTop, 0); assert.equal(layout.height, 30); assert.equal(layout.overflowReturnCount, 0);
});

test('narrow widths reserve the real ellipsis widths and language changes do not change geometry', () => {
  const input = { steps, visibleIds: ['build'], width: 136, beforeWidth: 24, afterWidth: 24 };
  const narrow = layoutConversationWorkflow(input);
  assert.equal(narrow.nodeWidth, 88); assert.deepEqual(narrow.nodes.map(node => [node.left, node.x, node.width]), [[24, 68, 88]]);
  const localized = layoutConversationWorkflow({ ...input, steps: steps.map(step => ({ ...step, name: `Long English ${step.name}` })) });
  assert.deepEqual(localized.nodes, narrow.nodes); assert.deepEqual(localized.edges, narrow.edges);
  assert.equal(localized.returns[0]!.sourceName, 'Long English 交付验收');
});

test('empty, unmeasured and impossibly narrow layouts never emit overlapping circles or nonfinite paths', () => {
  for (const width of [0, 12, -1, NaN, Infinity]) {
    const layout = layoutConversationWorkflow({ steps, visibleIds: ['build'], width, beforeWidth: 24, afterWidth: 24 });
    assert.deepEqual(layout.nodes, []); assert.deepEqual(layout.edges, []);
    assert.ok(Number.isFinite(layout.width)); assert.ok(Number.isFinite(layout.nodeWidth));
  }
  assert.deepEqual(layoutConversationWorkflow({ steps: [], visibleIds: [], width: 300 }).nodes, []);
  assert.deepEqual(layoutConversationWorkflow({ steps, visibleIds: ['build'], width: 27 }).nodes, [], 'an allocated slot narrower than the 28px circle cannot paint a node');
  assert.equal(layoutConversationWorkflow({ steps, visibleIds: ['build'], width: 28 }).nodes.length, 1);
});

test('layout is deterministic and leaves the frozen workflow inputs untouched', () => {
  const frozen = Object.freeze(steps.map(step => Object.freeze({ ...step })));
  const ids = Object.freeze(['plan', 'build', 'review']);
  const before = JSON.stringify(frozen);
  const first = layoutConversationWorkflow({ steps: frozen, visibleIds: ids, width: 300, aboveSpace: 32 });
  const second = layoutConversationWorkflow({ steps: frozen, visibleIds: ids, width: 300, aboveSpace: 32 });
  assert.deepEqual(second, first); assert.equal(JSON.stringify(frozen), before);
});

test('a seven-slot overflow window holds the first four steps in place then centers steps five and six', () => {
  const definition = Array.from({ length: 12 }, (_, index) => ({ id: `step-${index + 1}`, name: `步骤${index + 1}` }));
  const geometry = (currentIndex: number) => {
    const window = selectConversationWorkflowWindow(12, 664, currentIndex);
    const layout = layoutConversationWorkflow({ steps: definition, visibleIds: definition.slice(window.start, window.start + window.count).map(step => step.id), width: 664, beforeWidth: window.beforeWidth, afterWidth: window.afterWidth });
    return { window, layout };
  };
  const initial = geometry(0);
  assert.deepEqual(initial.window, { start: 0, count: 7, beforeWidth: 24, afterWidth: 24 });
  for (const currentIndex of [1, 2, 3]) {
    const selected = geometry(currentIndex);
    assert.deepEqual(selected.window, initial.window);
    assert.deepEqual(selected.layout.nodes, initial.layout.nodes, 'early current-step changes preserve every visible node coordinate');
  }
  const fifth = geometry(4);
  assert.equal(fifth.window.start, 1); assert.equal(fifth.window.count, 7);
  assert.equal(fifth.layout.nodes.find(node => node.id === 'step-5')!.x, initial.layout.nodes.find(node => node.id === 'step-4')!.x, 'global step five enters the same central slot as the initial fourth step');
  assert.equal(geometry(5).window.start, 2);
  assert.deepEqual(fifth.layout.nodes.map(node => node.x), initial.layout.nodes.map(node => node.x), 'leading ellipsis appearance cannot shift the seven slot centers');
});

test('the tail window stops shifting once all final steps are visible and reversing returns to the beginning', () => {
  const definition = Object.freeze(Array.from({ length: 12 }, (_, index) => Object.freeze({ id: `step-${index + 1}`, name: `步骤${index + 1}` })));
  const before = JSON.stringify(definition);
  const geometry = (currentIndex: number) => {
    const window = selectConversationWorkflowWindow(definition.length, 664, currentIndex);
    return { window, layout: layoutConversationWorkflow({ steps: definition, visibleIds: definition.slice(window.start, window.start + window.count).map(step => step.id), width: 664, beforeWidth: window.beforeWidth, afterWidth: window.afterWidth }) };
  };
  const beginning = geometry(0), ninth = geometry(8);
  assert.deepEqual(ninth.window, { start: 5, count: 7, beforeWidth: 24, afterWidth: 24 });
  assert.deepEqual(ninth.layout.nodes.map(node => node.id), ['step-6', 'step-7', 'step-8', 'step-9', 'step-10', 'step-11', 'step-12']);
  for (const index of [9, 10, 11, 8]) assert.deepEqual(geometry(index), ninth, 'selecting steps nine through twelve keeps every tail node in its established position');
  assert.deepEqual(geometry(0), beginning);
  assert.equal(JSON.stringify(definition), before, 'changing a display window cannot mutate the frozen workflow definition');
});

test('a fully fitting workflow uses all available width without hidden ellipsis gutters', () => {
  for (const index of [0, 3, 8, 11]) assert.deepEqual(selectConversationWorkflowWindow(12, 1056, index), { start: 0, count: 12, beforeWidth: 0, afterWidth: 0 });
  assert.deepEqual(selectConversationWorkflowWindow(0, 664, 0), { start: 0, count: 0, beforeWidth: 0, afterWidth: 0 });
  const overflow = selectConversationWorkflowWindow(12, 1055, 0);
  assert.equal(overflow.count, 11); assert.equal(overflow.beforeWidth, 24); assert.equal(overflow.afterWidth, 24);
});

test('an extremely narrow window keeps the current semantic step without painting undersized or nonfinite circles', () => {
  const definition = Array.from({ length: 12 }, (_, index) => ({ id: `step-${index + 1}` }));
  const minimum = selectConversationWorkflowWindow(12, 76, 6);
  assert.deepEqual(minimum, { start: 6, count: 1, beforeWidth: 24, afterWidth: 24 });
  const visible = definition.slice(minimum.start, minimum.start + minimum.count).map(step => step.id);
  assert.equal(layoutConversationWorkflow({ steps: definition, visibleIds: visible, width: 76, beforeWidth: minimum.beforeWidth, afterWidth: minimum.afterWidth }).nodes.length, 1);
  for (const width of [0, 12, 27, -1, NaN, Infinity]) {
    const window = selectConversationWorkflowWindow(12, width, 6);
    assert.ok(Number.isSafeInteger(window.start) && window.start >= 0 && window.start < 12);
    assert.ok(Number.isSafeInteger(window.count) && window.count >= 0 && window.count <= 1);
    const layout = layoutConversationWorkflow({ steps: definition, visibleIds: definition.slice(window.start, window.start + window.count).map(step => step.id), width, beforeWidth: window.beforeWidth, afterWidth: window.afterWidth });
    assert.deepEqual(layout.nodes, []); assert.deepEqual(layout.edges, []);
  }
});

test('a narrow measured strip keeps one full current circle when ellipsis gutters would consume its diameter', () => {
  const definition = Array.from({ length: 12 }, (_, index) => ({ id: `step-${index + 1}` }));
  for (const width of [28, 52, 75, 76]) {
    const window = selectConversationWorkflowWindow(12, width, 6);
    assert.equal(window.start, 6); assert.equal(window.count, 1);
    assert.equal(window.beforeWidth, width === 76 ? 24 : 0);
    assert.equal(window.afterWidth, width === 76 ? 24 : 0);
    const layout = layoutConversationWorkflow({ steps: definition, visibleIds: ['step-7'], width, beforeWidth: window.beforeWidth, afterWidth: window.afterWidth });
    assert.equal(layout.nodes.length, 1, `a ${width}px strip retains the selected circle`);
    assert.equal(layout.nodes[0]!.id, 'step-7'); assert.equal(layout.nodes[0]!.x, width / 2);
    assert.ok(layout.nodes[0]!.width >= 28, 'the circle is never squeezed to make room for ellipses');
  }
});

test('zero, one and three return lanes keep the same thirty-pixel row and node anchors', () => {
  const definition = Array.from({ length: 6 }, (_, index) => ({ id: `step-${index + 1}`, name: `步骤${index + 1}` }));
  const referenceCenters = [44, 132, 220, 308, 396, 484];
  for (const offsetY of [0, 4, 12, 21.25]) {
    const baseline = layoutConversationWorkflow({ steps: definition, visibleIds: definition.map(step => step.id), width: 528, offsetY });
    for (const returns of [[], [5], [3, 4, 5]]) {
      const values = definition.map((step, index) => ({ ...step, ...(returns.includes(index) ? { onRejectStepId: 'step-1' } : {}) }));
      const layout = layoutConversationWorkflow({ steps: values, visibleIds: values.map(step => step.id), width: 528, offsetY, aboveSpace: 32 });
      assert.equal(layout.reserveTop, 0); assert.equal(layout.nodeY, 16 + offsetY); assert.equal(layout.height, 30);
      assert.equal(layout.offsetY, offsetY); assert.equal(layout.contentHeight, 52);
      assert.equal(layout.edges.filter(edge => edge.kind === 'reject').length, returns.length);
      assert.equal(layout.drawingHeight, Number((Math.max(30, 52 + offsetY) - layout.drawingTop).toFixed(3)));
      assert.deepEqual(layout.nodes.map(node => node.x), referenceCenters);
      assert.deepEqual(layout.nodes, baseline.nodes, 'adding return lanes cannot push any step down or reflow horizontal slots');
      assert.deepEqual(layout.edges.filter(edge => edge.kind === 'sequence'), baseline.edges);
      for (const edge of layout.edges.filter(edge => edge.kind === 'reject')) {
        const route = assertCrownReturn(layout, edge);
        assert.ok(route.minY - 1 >= -32, 'each complete track and drawing margin fit the measured space above its fixed circles');
        assert.ok(route.minY < layout.nodeY - 14 - .5, 'the whole horizontal stroke stays above the circle crown, including on the first track');
      }
    }
  }
});

test('legacy belowSpace has no influence on node position, row height or return admission', () => {
  const values = Array.from({ length: 6 }, (_, index) => ({ id: String(index), ...(index ? { onRejectStepId: '0' } : {}) }));
  const input = { steps: values, visibleIds: values.map(step => step.id), width: 528, offsetY: 7, aboveSpace: 9 };
  const stationary = layoutConversationWorkflow(input);
  for (const belowSpace of [0, 4, 5, 11, 12, 18, 23, 100, -1, NaN, Infinity]) {
    const layout = layoutConversationWorkflow({ ...input, belowSpace });
    assert.deepEqual(layout, stationary, 'spare space below a host row cannot move workflow content');
    assert.equal(layout.offsetY, 7); assert.equal(layout.nodeY, 23); assert.equal(layout.height, 30);
    assert.equal(layout.edges.filter(edge => edge.kind === 'reject').length, 3);
    assert.equal(layout.returns.length, 5); assert.equal(layout.overflowReturnCount, 2);
    assert.ok(layout.returns.every(edge => edge.targetId === '0' && edge.visible), 'space limitations preserve the true return targets');
  }
});

test('insufficient space above omits a complete return while preserving its actual target and overflow count', () => {
  const definition = Array.from({ length: 6 }, (_, index) => ({ id: `step-${index + 1}`, ...(index ? { onRejectStepId: 'step-1' } : {}) }));
  const input = { steps: definition, visibleIds: definition.map(step => step.id), width: 528 };
  const stationary = layoutConversationWorkflow(input);
  for (const [aboveSpace, expectedDrawn] of [[0, 0], [4.9, 0], [5, 1], [9.9, 1], [10, 2], [14.9, 2], [15, 3], [32, 3]]) {
    const layout = layoutConversationWorkflow({ ...input, aboveSpace });
    const paths = layout.edges.filter(edge => edge.kind === 'reject');
    assert.equal(paths.length, expectedDrawn); assert.equal(layout.returns.filter(edge => edge.drawn).length, expectedDrawn);
    assert.equal(layout.overflowReturnCount, 5 - expectedDrawn!);
    assert.equal(layout.returns.length, 5); assert.ok(layout.returns.every(edge => edge.targetId === 'step-1' && edge.visible));
    assert.deepEqual(layout.nodes, stationary.nodes);
    for (const edge of paths) {
      assert.equal(edge.targetId, 'step-1'); assert.match(edge.path, /^M .* V .* Q .* H .* Q .* V /, 'an admitted relation has its complete source, track and target path');
      const route = assertCrownReturn(layout, edge);
      assert.ok(layout.drawingTop >= -aboveSpace! - .001, 'the SVG never paints above the measured admission budget');
      assert.ok(route.minY - 1 >= -aboveSpace!, 'admission reserves the whole one-pixel drawing margin, not only the line center');
      assert.ok(route.minY < layout.nodes[0]!.y - 14 - .5, 'the painted track clears the whole circle crown and half its stroke width');
    }
  }
});

test('negative drawingTop expands only the SVG extent and never changes the native row or circle positions', () => {
  const definition = Array.from({ length: 6 }, (_, index) => ({ id: String(index), ...(index ? { onRejectStepId: '0' } : {}) }));
  const input = { steps: definition, visibleIds: definition.map(step => step.id), width: 528 };
  const single = layoutConversationWorkflow(input), three = layoutConversationWorkflow({ ...input, aboveSpace: 32 });
  assert.equal(single.drawingTop, 0); assert.equal(three.drawingTop, -15);
  assert.equal(single.height, 30); assert.equal(three.height, 30); assert.equal(three.reserveTop, 0);
  assert.equal(single.contentHeight, 52); assert.equal(three.contentHeight, 52);
  assert.deepEqual(three.nodes, single.nodes);
  assert.deepEqual(three.edges.filter(edge => edge.kind !== 'reject'), single.edges.filter(edge => edge.kind !== 'reject'));
  assert.equal(three.drawingTop + three.drawingHeight, single.drawingTop + single.drawingHeight, 'adding an upper lane does not move the bottom of the content');
});

test('circle-only rows and invalid offsets retain the same fixed footprint without inventing below-space translation', () => {
  const input = { steps, visibleIds: steps.map(step => step.id), width: 300, aboveSpace: 32 };
  for (const offsetY of [0, 4, 12, 21.25]) {
    const labels = layoutConversationWorkflow({ ...input, offsetY }), circles = layoutConversationWorkflow({ ...input, offsetY, showLabels: false });
    assert.equal(labels.height, 30); assert.equal(circles.height, 30); assert.equal(circles.reserveTop, 0);
    assert.equal(labels.contentHeight, 52); assert.equal(circles.contentHeight, 30);
    assert.equal(circles.nodeY, 16 + offsetY); assert.deepEqual(circles.nodes, labels.nodes); assert.deepEqual(circles.edges, labels.edges);
    assert.equal(circles.drawingHeight, Math.max(30, 30 + offsetY) - circles.drawingTop);
  }
  const baseline = layoutConversationWorkflow(input);
  for (const offsetY of [-1, NaN, Infinity]) assert.deepEqual(layoutConversationWorkflow({ ...input, offsetY }), baseline, 'invalid offsets normalize to zero');
  for (const aboveSpace of [-1, NaN, Infinity]) assert.deepEqual(layoutConversationWorkflow({ ...input, aboveSpace }), layoutConversationWorkflow({ ...input, aboveSpace: 0 }));
});

test('only real hidden adjacent steps receive short window-boundary continuation strokes', () => {
  const definition = Array.from({ length: 8 }, (_, index) => ({ id: `step-${index + 1}` }));
  const graph = (ids: string[]) => layoutConversationWorkflow({ steps: definition, visibleIds: ids, width: 312, beforeWidth: 24, afterWidth: 24 });
  const middle = graph(['step-3', 'step-4', 'step-5']);
  assert.deepEqual(middle.edges.filter(edge => edge.kind === 'continuation').map(edge => [edge.sourceId, edge.targetId]), [['step-2', 'step-3'], ['step-5', 'step-6']]);
  for (const edge of middle.edges.filter(edge => edge.kind === 'continuation')) {
    const points = edge.path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    assert.equal(points[2]! - points[0]!, 12); assert.equal(points[1], middle.nodeY);
  }
  assert.equal(graph(['step-1', 'step-2']).edges.filter(edge => edge.kind === 'continuation').length, 1);
  assert.equal(graph(['step-7', 'step-8']).edges.filter(edge => edge.kind === 'continuation').length, 1);
  const full = layoutConversationWorkflow({ steps: definition, visibleIds: definition.map(step => step.id), width: 704 });
  assert.equal(full.edges.filter(edge => edge.kind === 'continuation').length, 0);
  const minimum = layoutConversationWorkflow({ steps: definition, visibleIds: ['step-4'], width: 28 });
  assert.equal(minimum.edges.filter(edge => edge.kind === 'continuation').length, 0, 'a minimum-width circle does not invent space for an outside connector');
});
