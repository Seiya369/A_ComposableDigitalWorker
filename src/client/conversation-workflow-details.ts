import type { ConversationWorkflowDetails, ConversationWorkflowDetailsSelection, ConversationWorkflowReviewInput } from '../domain/conversation-workflow-details.js';
import type { WorkforceClient } from '../ui/client.js';

export type ConversationWorkflowWikiClient = Pick<WorkforceClient, 'knowledgeLibrary' | 'knowledgeWiki' | 'knowledgeSource'>;

export interface ConversationWorkflowDetailsClient {
  projectWikiClient?: ConversationWorkflowWikiClient;
  load(sessionId: string, selection?: ConversationWorkflowDetailsSelection, signal?: AbortSignal): Promise<ConversationWorkflowDetails>;
  review(input: ConversationWorkflowReviewInput): Promise<ConversationWorkflowDetails>;
}

export function createConversationWorkflowDetailsClient(request: <T>(path: string, body?: unknown, signal?: AbortSignal) => Promise<T>, projectWikiClient?: ConversationWorkflowWikiClient): ConversationWorkflowDetailsClient {
  return {
    projectWikiClient,
    load(sessionId, selection = {}, signal) {
      const query = new URLSearchParams({ sessionId,
        ...(selection.stepId !== undefined ? { stepId: selection.stepId } : {}),
        ...(selection.runId !== undefined ? { runId: selection.runId } : {}),
        ...(selection.runVersion !== undefined ? { runVersion: String(selection.runVersion) } : {}) });
      return request<ConversationWorkflowDetails>(`/conversation-workflow/details?${query}`, undefined, signal);
    },
    review: input => request<ConversationWorkflowDetails>('/conversation-workflow/review', input),
  };
}
