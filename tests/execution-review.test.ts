import test from 'node:test';
import assert from 'node:assert/strict';
import type { WorkforceRun, WorkforceState } from '../src/domain/types.js';
import type { WorkforceClient } from '../src/ui/client.js';
import { executionReviewContext, reviewExecution } from '../src/ui/execution-review.js';

const run = (patch: Partial<WorkforceRun> = {}) => ({ id: 'run', projectId: 'project', status: 'awaiting-review', version: 4, ...patch }) as WorkforceRun;
const state = (patch: Partial<WorkforceState> = {}) => ({ runs: [], ...patch }) as WorkforceState;
const client = () => {
  const calls: unknown[][] = [];
  return { calls, value: Object.fromEntries(['reviewRun', 'workCommand', 'controlWorkflow'].map(name => [name, async (...args: unknown[]) => { calls.push([name, ...args]); }])) as unknown as WorkforceClient };
};

test('standalone review preserves the original run version and authoritative API', async () => {
  const transport = client();
  await reviewExecution(transport.value, state(), run(), 'accepted', ' 可交付 ', 'receipt');
  assert.deepEqual(transport.calls, [['reviewRun', 'run', { decision: 'accepted', reviewer: '项目负责人', note: '可交付' }, { expectedVersion: 4 }]]);
});

test('work task review sends the exact latest attempt and task version', async () => {
  const transport = client();
  const snapshot = state({ workState: { tasks: [{ id: 'task', projectId: 'project', status: 'awaiting-review', attemptRunIds: ['run'], version: 9 }], deliverables: [], events: [], receipts: [], briefs: [] } as WorkforceState['workState'] });
  const attempt = run({ workTaskId: 'task' });
  await reviewExecution(transport.value, snapshot, attempt, 'rejected', '缺少用例', 'receipt');
  assert.deepEqual(transport.calls, [['workCommand', 'work.reviewTask', { projectId: 'project', id: 'task', runId: 'run', decision: 'rejected', note: '缺少用例' }, { expectedVersion: 9, requestId: 'receipt' }]]);
  snapshot.workState!.tasks[0]!.attemptRunIds.push('new-run');
  assert.equal(executionReviewContext(snapshot, attempt).reviewable, false);
  await assert.rejects(reviewExecution(transport.value, snapshot, attempt, 'accepted', '', 'later'), /当前待验收版本/);
  assert.equal(transport.calls.length, 1);
});

test('old structured workflow reviews remain available while paused and use workflow CAS', async () => {
  const transport = client();
  const snapshot = state({ workflowRuns: [{ id: 'flow', projectId: 'project', status: 'paused', version: 6, steps: [{ stepId: 'step', status: 'awaiting-review', attempts: [{ runId: 'run' }] }] }] as WorkforceState['workflowRuns'] });
  const attempt = run({ workflow: { workflowRunId: 'flow', stepId: 'step', attempt: 1, timeoutMs: 1000 } });
  await reviewExecution(transport.value, snapshot, attempt, 'accepted', '', 'receipt');
  assert.deepEqual(transport.calls, [['controlWorkflow', { projectId: 'project', id: 'flow', commandId: 'receipt', expectedVersion: 6, action: 'review', runId: 'run', decision: 'accepted', note: '' }]]);
  snapshot.workflowRuns![0]!.steps[0]!.attempts.push({ runId: 'new-run', number: 2, createdAt: 'now' });
  assert.equal(executionReviewContext(snapshot, attempt).current, false);
  await assert.rejects(reviewExecution(transport.value, snapshot, attempt, 'rejected', 'missing', 'later'), /当前待验收版本/);
});

test('missing or cross-project execution parents cannot fall back to standalone review', async () => {
  const transport = client();
  const missing = run({ workTaskId: 'task' });
  assert.equal(executionReviewContext(state(), missing).current, false);
  await assert.rejects(reviewExecution(transport.value, state(), missing, 'accepted', '', 'r'), /当前待验收版本/);
  const foreign = state({ workflowRuns: [{ id: 'flow', projectId: 'another', status: 'awaiting-review', steps: [{ status: 'awaiting-review', attempts: [{ runId: 'run' }] }] }] as WorkforceState['workflowRuns'] });
  await assert.rejects(reviewExecution(transport.value, foreign, run({ workflow: { workflowRunId: 'flow', stepId: 'step', attempt: 1, timeoutMs: 1000 } }), 'accepted', '', 'r'), /当前待验收版本/);
  assert.equal(transport.calls.length, 0);
});

test('empty rejection note and non-review status never issue a mutation', async () => {
  const transport = client();
  await assert.rejects(reviewExecution(transport.value, state(), run(), 'rejected', ' ', 'r'), /退回意见/);
  await assert.rejects(reviewExecution(transport.value, state(), run({ status: 'running' }), 'accepted', '', 'r'), /当前待验收版本/);
  assert.equal(transport.calls.length, 0);
});

test('modern conversation workflow roots and children never enter the legacy review API', async () => {
  const transport = client();
  for (const parentRunId of [undefined, 'owner']) {
    const attempt = run({ conversationWorkflow: { instanceId: 'instance', stepId: 'step' }, ...(parentRunId ? { parentRunId } : {}) });
    assert.equal(executionReviewContext(state(), attempt).reviewable, false);
    await assert.rejects(reviewExecution(transport.value, state(), attempt, 'accepted', '', 'r'), /负责人对话的工作流详情/);
  }
  assert.equal(transport.calls.length, 0);
});
