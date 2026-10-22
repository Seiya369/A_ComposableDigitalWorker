import assert from 'node:assert/strict';
import test from 'node:test';
import { deliverableStatus, isDeliverableAccepted } from '../src/ui/workbench-state.js';

test('a formerly accepted version is visibly stale after input invalidation', () => {
  const revision = { version: 2, createdAt: '2026-10-19T00:00:00Z', inputVersions: [], review: { decision: 'accepted' as const, reviewer: '项目负责人', note: '通过', at: '2026-10-19T01:00:00Z' }, reviews: [], invalidatedAt: '2026-10-19T02:00:00Z', invalidationReason: '接口修订' };
  assert.equal(deliverableStatus(revision), '需重新验证');
  assert.equal(isDeliverableAccepted(revision), false);
  assert.equal(revision.review.decision, 'accepted');
});

test('an unproduced outcome cannot appear accepted and a current accepted revision can', () => {
  assert.equal(deliverableStatus(undefined), '待产出');
  assert.equal(isDeliverableAccepted(undefined), false);
  const revision = { version: 1, createdAt: '2026-10-19T00:00:00Z', inputVersions: [], review: { decision: 'accepted' as const, reviewer: '负责人', note: '', at: '2026-10-19T01:00:00Z' }, reviews: [] };
  assert.equal(deliverableStatus(revision), '已验收');
  assert.equal(isDeliverableAccepted(revision), true);
});
