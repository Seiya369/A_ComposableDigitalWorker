import type { WorkforceRun, WorkforceState } from '../domain/types.js';
import type { WorkforceClient } from './client.js';

/** Match the exact attempt before dispatching to its authoritative review service. */
export function executionReviewContext(state: WorkforceState, run: WorkforceRun) {
  const task = run.workTaskId ? state.workState?.tasks.find(item => item.id === run.workTaskId && item.projectId === run.projectId) : undefined;
  const flow = run.workflow ? state.workflowRuns?.find(item => item.id === run.workflow!.workflowRunId && item.projectId === run.projectId) : undefined;
  const step = flow?.steps.find(item => item.status !== 'accepted');
  const current = run.workTaskId ? !!task && task.attemptRunIds.at(-1) === run.id : run.workflow ? !!step && step.attempts.at(-1)?.runId === run.id && !['succeeded', 'cancelled'].includes(flow!.status) : true;
  const reviewable = !run.conversationWorkflow && current && (run.workTaskId ? !!task && ['awaiting-review', 'needs-revalidation'].includes(task.status) : run.workflow ? step?.status === 'awaiting-review' && run.status === 'awaiting-review' : run.status === 'awaiting-review');
  return { task, flow, step, current, reviewable };
}

export async function reviewExecution(client: WorkforceClient, state: WorkforceState, run: WorkforceRun, decision: 'accepted' | 'rejected', note: string, requestId: string): Promise<unknown> {
  if (run.conversationWorkflow) throw new Error('请返回负责人对话的工作流详情验收。');
  const context = executionReviewContext(state, run);
  if (!context.reviewable) throw new Error('这次执行已不是当前待验收版本，请刷新后查看。');
  if (decision === 'rejected' && !note.trim()) throw new Error('请填写退回意见。');
  if (run.workTaskId) return client.workCommand('work.reviewTask', { projectId: run.projectId, id: context.task!.id, runId: run.id, decision, note: note.trim() }, { expectedVersion: context.task!.version, requestId });
  if (run.workflow) return client.controlWorkflow({ projectId: run.projectId, id: context.flow!.id, commandId: requestId, expectedVersion: context.flow!.version, action: 'review', runId: run.id, decision, note: note.trim() });
  return client.reviewRun(run.id, { decision, reviewer: '项目负责人', note: note.trim() }, { expectedVersion: run.version });
}
