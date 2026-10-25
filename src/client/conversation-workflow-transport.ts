import type { ConversationWorkflowView } from '../domain/conversation-workflow.js';
import type { ConversationWorkflowTransport } from './conversation-workflow.js';

type NativeWorkflowView = Omit<ConversationWorkflowView, 'projectId' | 'steps' | 'owner'> & {
  owner?: { id: string; name: string };
  projectId: string | null; revision: number; busy?: boolean;
  sessionHandoffRequired?: boolean;
  steps: Array<ConversationWorkflowView['steps'][number] & { employeeName?: string }>;
};
type WorkflowRequester = <T>(path: string, body?: unknown, signal?: AbortSignal) => Promise<T>;
interface ConversationWorkflowTransportOptions {
  beforeSelection?: (sessionId: string) => void;
  onSessionReopened?: (sessionId: string) => void;
}

/** Keep the full host projection private so admission submits the exact previewed versions. */
export function createConversationWorkflowTransport(request: WorkflowRequester, options: ConversationWorkflowTransportOptions = {}): { transport: ConversationWorkflowTransport; dispose(): void } {
  const views = new Map<string, NativeWorkflowView>();
  const handoffs = new Map<string, Promise<NativeWorkflowView>>();
  const handedOff = new Set<string>();
  let disposed = false;
  const reopened = (sessionId: string, response: { result?: { sessionReopened?: boolean }; sessionReopened?: boolean }) => {
    if (!disposed && (response.result?.sessionReopened === true || response.sessionReopened === true)) options.onSessionReopened?.(sessionId);
  };
  const transport: ConversationWorkflowTransport = {
    async load(sessionId, signal) {
      const path = `/conversation-workflow?sessionId=${encodeURIComponent(sessionId)}`;
      let view = await request<NativeWorkflowView>(path, undefined, signal);
      if (!disposed && !signal?.aborted && view.projectId && view.sessionHandoffRequired && !view.busy && !handedOff.has(sessionId)) {
        // Re-entering this conversation may join an already pending handoff.
        // Refresh its public navigation capability without repeating the Host command.
        options.beforeSelection?.(sessionId);
        let handoff = handoffs.get(sessionId);
        if (!handoff) {
          handoff = (async () => {
            // Host Agent disposal may retire this very slot and abort its GET.
            // The idempotent handoff must settle before deciding whether navigation can resume.
            const response = await request<{ result?: { sessionReopened?: boolean }; sessionReopened?: boolean }>('/command',
              { action: 'conversation.workflow.resume', payload: { projectId: view.projectId, sessionId } });
            if (!disposed) handedOff.add(sessionId);
            reopened(sessionId, response);
            return disposed ? view : request<NativeWorkflowView>(path);
          })().finally(() => { if (handoffs.get(sessionId) === handoff) handoffs.delete(sessionId); });
          handoffs.set(sessionId, handoff);
        }
        view = await handoff;
      }
      if (!disposed && !signal?.aborted) views.set(sessionId, view);
      return { sessionId, revision: view.revision, selection: view.selection,
        ...(view.projectId ? { projectId: view.projectId } : {}),
        ...(view.workflowTemplateId ? { workflowTemplateId: view.workflowTemplateId } : {}),
        ...(view.name ? { workflowName: view.name } : {}),
        ...(view.instanceVersion !== undefined ? { instanceVersion: view.instanceVersion } : {}),
        ...(view.currentStepId ? { currentStepId: view.currentStepId } : {}),
        ...(view.owner ? { ownerName: view.owner.name } : {}),
        ...(view.unavailableReason ? { unavailableReason: view.unavailableReason } : {}),
        ...(view.busy !== undefined ? { busy: view.busy } : {}),
        steps: view.steps.map(step => ({ id: step.id, name: step.name, status: step.status,
          ...(step.onRejectStepId ? { onRejectStepId: step.onRejectStepId } : {}),
          ...(step.employeeName ? { employeeName: step.employeeName } : step.employeeId === view.owner?.id ? { employeeName: view.owner.name } : {}) })),
        choices: view.choices.map(choice => ({ id: choice.id, name: choice.name, version: choice.version, disabled: !choice.available,
          ...(choice.unavailableReason ? { disabledReason: choice.unavailableReason } : {}) })),
      };
    },
    async selectWorkflow(sessionId, workflowTemplateId, snapshot) {
      const view = views.get(sessionId);
      if (disposed || !view?.projectId || view.revision !== snapshot.revision || view.projectId !== snapshot.projectId) throw new Error('工作流配置已更新，请刷新后重新选择');
      const choice = workflowTemplateId ? view.choices.find(choice => choice.id === workflowTemplateId) : undefined;
      if (workflowTemplateId && (!choice || !choice.available)) throw new Error(choice?.unavailableReason || '工作流暂不可用');
      options.beforeSelection?.(sessionId);
      const response = await request<{ result?: { sessionReopened?: boolean }; sessionReopened?: boolean }>('/command', { action: 'conversation.workflow.select', payload: { projectId: view.projectId, sessionId, workflowTemplateId,
        ...(choice ? { workflowTemplateVersion: choice.version, templateVersions: choice.templateVersions } : {}) }, options: { expectedRevision: snapshot.revision } });
      reopened(sessionId, response);
      return response;
    },
    async selectStep(sessionId, stepId, snapshot) {
      if (disposed || !snapshot.projectId || snapshot.instanceVersion === undefined) throw new Error('请先选择工作流');
      options.beforeSelection?.(sessionId);
      const response = await request<{ result?: { sessionReopened?: boolean }; sessionReopened?: boolean }>('/command', { action: 'conversation.workflow.step', payload: { projectId: snapshot.projectId, sessionId, stepId, instanceVersion: snapshot.instanceVersion }, options: { expectedRevision: snapshot.revision } });
      reopened(sessionId, response);
      return response;
    },
  };
  return { transport, dispose() { disposed = true; views.clear(); handoffs.clear(); handedOff.clear(); } };
}
