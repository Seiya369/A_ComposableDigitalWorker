import type { WorkforceRun } from './types.js';

type ConversationRun = Pick<WorkforceRun, 'sessionId' | 'status' | 'parentRunId' | 'conversationWorkflow' | 'workflow' | 'workTaskId'>;

/** These old root deliveries carry no workflow or workbench execution identity. */
export function isLegacyStandaloneRun(run: Pick<ConversationRun, 'parentRunId' | 'conversationWorkflow' | 'workflow' | 'workTaskId'>): boolean {
  return !run.parentRunId && !run.conversationWorkflow && !run.workflow && !run.workTaskId;
}

