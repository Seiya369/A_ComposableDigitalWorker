import type { ConversationEmployeeTransport } from './conversation-employee.js';
import type { ConversationEmployeeView } from '../domain/conversation-employee.js';

type Requester = <T>(path: string, body?: unknown, signal?: AbortSignal) => Promise<T>;
interface ConversationEmployeeTransportOptions { beforeSelection?: (sessionId: string) => void; onSessionReopened?: (sessionId: string) => void }

/** Reads and explicit mutations are separate. Browsing employee cards never starts a model. */
export function createConversationEmployeeTransport(request: Requester, options: ConversationEmployeeTransportOptions = {}): ConversationEmployeeTransport {
  const command = async (sessionId: string, action: string, payload: object, snapshot: ConversationEmployeeView) => {
    if (!snapshot.enabled || !snapshot.projectId || snapshot.sessionId !== sessionId) throw new Error('此对话不支持员工常驻');
    options.beforeSelection?.(sessionId);
    const response = await request<{ result?: { sessionReopened?: boolean }; sessionReopened?: boolean }>('/command', { action,
      payload: { sessionId, projectId: snapshot.projectId, ...payload },
      options: { expectedRevision: snapshot.revision, expectedVersion: snapshot.conversationEmployee?.version ?? 0 } });
    if (response.result?.sessionReopened || response.sessionReopened) options.onSessionReopened?.(sessionId);
    return response;
  };
  return {
    load: (sessionId, signal) => request<ConversationEmployeeView>(`/conversation-employee?sessionId=${encodeURIComponent(sessionId)}`, undefined, signal),
    select: (sessionId, choice, mode, snapshot) => command(sessionId, 'conversation.employee.select', { [choice.kind === 'employee' ? 'employeeId' : 'templateId']: choice.id, mode }, snapshot),
    clear: (sessionId, snapshot) => command(sessionId, 'conversation.employee.clear', {}, snapshot),
  };
}
