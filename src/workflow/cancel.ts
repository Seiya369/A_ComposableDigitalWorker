import type { WorkforceState } from '../domain/types.js';
import type { WorkflowRun } from './types.js';

/** Shared by explicit workflow cancellation and project team removal, inside one transaction. */
export function cancelWorkflow(state: WorkforceState, flow: WorkflowRun, at: string, message = '工作流已取消'): void {
  if (['succeeded', 'cancelled'].includes(flow.status)) return;
  flow.status = 'cancelled'; flow.finishedAt = at; flow.updatedAt = at; flow.version++;
  for (const step of flow.steps) if (step.status !== 'accepted') {
    step.status = 'cancelled';
    const task = state.runs.find(task => task.id === step.attempts.at(-1)?.runId);
    if (task && ['queued', 'awaiting-review'].includes(task.status)) {
      task.status = 'cancelled'; task.version++; task.updatedAt = at; task.finishedAt = at;
    }
  }
  flow.events.push({ at, kind: 'cancelled', message });
  flow.events = flow.events.slice(-300);
}
