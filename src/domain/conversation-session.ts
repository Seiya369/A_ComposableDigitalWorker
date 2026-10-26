import type { WorkforceRun } from './types.js';

type ConversationRun = Pick<WorkforceRun, 'sessionId' | 'status' | 'parentRunId' | 'conversationWorkflow' | 'conversationEmployee' | 'workflow' | 'workTaskId'>;

/** These old root deliveries carry no workflow or workbench execution identity. */
export function isLegacyStandaloneRun(run: Pick<ConversationRun, 'parentRunId' | 'conversationWorkflow' | 'conversationEmployee' | 'workflow' | 'workTaskId'>): boolean {
  return !run.parentRunId && !run.conversationWorkflow && !run.conversationEmployee && !run.workflow && !run.workTaskId;
}

