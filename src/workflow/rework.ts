import type { WorkforceRun } from '../domain/types.js';
import type { WorkflowRun } from './types.js';
import { invariant } from '../domain/errors.js';

/** Runtime failure retries locally; only a rejected acceptance uses the configured return. */
export function workflowRetryPlan(flow: WorkflowRun, task?: Pick<WorkforceRun, 'acceptance'>) {
  const currentIndex = flow.steps.findIndex(step => step.status !== 'accepted');
  invariant(currentIndex >= 0, '工作流已结束');
  const targetId = task?.acceptance?.decision === 'rejected' ? flow.definition.steps[currentIndex]!.onRejectStepId : undefined;
  const targetIndex = targetId === undefined ? currentIndex : flow.definition.steps.findIndex(step => step.id === targetId);
  invariant(targetIndex >= 0 && targetIndex <= currentIndex, '退回目标无效，请检查工作流定义');
  const exhaustedIndex = flow.steps.findIndex((step, index) => index >= targetIndex && index <= currentIndex && step.attempts.length >= (flow.definition.maxAttempts ?? 3));
  return { currentIndex, targetIndex, exhaustedIndex };
}
