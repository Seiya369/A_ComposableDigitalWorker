import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTeamHierarchy } from '../src/domain/team-hierarchy.js';
import { fitTeamOrgChart, layoutTeamHierarchy, TEAM_ORG_CARD_HEIGHT, TEAM_ORG_CARD_WIDTH, zoomTeamOrgChart } from '../src/ui/team-org-layout.js';

test('a three-level product-led team is fully visible at the largest fit scale in wide and narrow windows', () => {
  const members = [{ memberId: 'product', templateId: 'product' }, { memberId: 'architect', templateId: 'architect', reportsTo: 'product' },
    ...['dev', 'design', 'qa', 'ops'].map(memberId => ({ memberId, templateId: memberId, reportsTo: memberId === 'dev' ? 'architect' : 'product' }))];
  const chart = layoutTeamHierarchy(buildTeamHierarchy(members));
  assert.deepEqual(chart.nodes.map(position => position.node.level), [1, 2, 3, 2, 2, 2]);
  for (const viewport of [{ width: 1200, height: 500 }, { width: 380, height: 300 }]) {
    const view = fitTeamOrgChart(chart, viewport);
    for (const { x, y } of chart.nodes) {
      assert.ok(view.x + x * view.scale >= 0);
      assert.ok(view.y + y * view.scale >= 0);
      assert.ok(view.x + (x + TEAM_ORG_CARD_WIDTH) * view.scale <= viewport.width + 1e-8);
      assert.ok(view.y + (y + TEAM_ORG_CARD_HEIGHT) * view.scale <= viewport.height + 1e-8);
    }
    assert.ok(Math.abs(chart.width * view.scale - viewport.width) < 1e-8 || Math.abs(chart.height * view.scale - viewport.height) < 1e-8, 'one viewport dimension must be filled');
  }
});

test('multiple-root chart subtrees keep cards apart at the same level and parents over their children', () => {
  const chart = layoutTeamHierarchy(buildTeamHierarchy([{ memberId: 'first', templateId: 'first' }, { memberId: 'second', templateId: 'second' },
    { memberId: 'a', templateId: 'a', reportsTo: 'first' }, { memberId: 'b', templateId: 'b', reportsTo: 'first' }]));
  for (const left of chart.nodes) for (const right of chart.nodes) {
    if (left === right || left.y !== right.y) continue;
    assert.ok(Math.abs(left.x - right.x) >= TEAM_ORG_CARD_WIDTH);
  }
  const positions = new Map(chart.nodes.map(position => [position.node.member.memberId, position]));
  assert.equal(positions.get('first')!.x, (positions.get('a')!.x + positions.get('b')!.x) / 2);
});

test('pointer-centered zoom preserves the chart coordinate under the cursor and remains bounded', () => {
  const previous = { scale: .75, x: 20, y: 30 };
  const pointer = { x: 200, y: 160 };
  const zoomed = zoomTeamOrgChart(previous, 1.5, pointer.x, pointer.y, .75);
  assert.equal((pointer.x - previous.x) / previous.scale, (pointer.x - zoomed.x) / zoomed.scale);
  assert.equal((pointer.y - previous.y) / previous.scale, (pointer.y - zoomed.y) / zoomed.scale);
  assert.equal(zoomTeamOrgChart(previous, 1e8, 0, 0, .75).scale, 4);
  assert.equal(zoomTeamOrgChart(previous, 1e-8, 0, 0, .75).scale, .05);
  const tinyFit = fitTeamOrgChart({ width: 100000, height: 10000 }, { width: 300, height: 300 });
  assert.equal(zoomTeamOrgChart(tinyFit, .5, 0, 0, tinyFit.scale).scale, tinyFit.scale);
});
