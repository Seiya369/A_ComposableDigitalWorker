/** Presentation-only projection. Host admission and execution stay behind this transport. */
export interface ConversationWorkflowSnapshot {
  projectId?: string;
  sessionId: string;
  revision: number;
  selection: 'inherit' | 'override';
  workflowTemplateId?: string;
  workflowName?: string;
  instanceVersion?: number;
  currentStepId?: string;
  ownerName?: string;
  unavailableReason?: string;
  steps: Array<{ id: string; name: string; status: 'pending' | 'current' | 'completed'; employeeName?: string; onRejectStepId?: string }>;
  choices: Array<{ id: string; name: string; version: number; disabled?: boolean; disabledReason?: string }>;
  busy?: boolean;
  /** Shared progress cannot change while another conversation executes this instance. */
  progressBusy?: boolean;
  /** Human-readable preparation/execution feedback for this conversation only. */
  activity?: { stage: string; label: string; since?: string };
}

export interface ConversationWorkflowTransport {
  load(sessionId: string, signal?: AbortSignal): Promise<ConversationWorkflowSnapshot>;
  selectWorkflow(sessionId: string, workflowTemplateId: string | null, snapshot: ConversationWorkflowSnapshot): Promise<unknown>;
  selectStep(sessionId: string, stepId: string, snapshot: ConversationWorkflowSnapshot): Promise<unknown>;
}

export interface ConversationWorkflowClientState {
  snapshot?: ConversationWorkflowSnapshot;
  loading: boolean;
  pending: boolean;
  error?: string;
}

export interface ConversationWorkflowController {
  read(sessionId: string): ConversationWorkflowClientState;
  subscribe(sessionId: string, listener: () => void): () => void;
  refresh(sessionId: string): Promise<void>;
  selectWorkflow(sessionId: string, workflowTemplateId: string | null): Promise<boolean>;
  selectStep(sessionId: string, stepId: string): Promise<boolean>;
  dispose(): void;
}

type Entry = {
  state: ConversationWorkflowClientState;
  listeners: Set<() => void>;
  request?: AbortController;
  generation: number;
};

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** One lifecycle-owned cache for both native slots; polling only covers mounted sessions. */
export function createConversationWorkflowController(
  transport: ConversationWorkflowTransport,
  options: { pollMs?: number } = {},
): ConversationWorkflowController {
  const entries = new Map<string, Entry>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let disposed = false;
  let mutation = false;

  function entry(sessionId: string): Entry {
    let found = entries.get(sessionId);
    if (!found) {
      found = { state: { loading: true, pending: false }, listeners: new Set(), generation: 0 };
      entries.set(sessionId, found);
    }
    return found;
  }
  function publish(target: Entry, state: ConversationWorkflowClientState) {
    if (disposed) return;
    target.state = state;
    for (const listener of target.listeners) listener();
  }
  async function refresh(sessionId: string) {
    if (disposed) return;
    const target = entry(sessionId);
    target.request?.abort();
    const controller = new AbortController();
    target.request = controller;
    const generation = ++target.generation;
    try {
      const snapshot = await transport.load(sessionId, controller.signal);
      if (disposed || generation !== target.generation || controller.signal.aborted) return;
      publish(target, { snapshot, loading: false, pending: target.state.pending });
    } catch (error) {
      if (disposed || generation !== target.generation || controller.signal.aborted) return;
      publish(target, { ...target.state, loading: false, error: message(error) });
    } finally {
      if (target.request === controller) target.request = undefined;
    }
  }
  function updateTimer() {
    const active = [...entries.values()].some(target => target.listeners.size > 0);
    if (!active || disposed) {
      if (timer) clearInterval(timer);
      timer = undefined;
    } else if (!timer) {
      timer = setInterval(() => {
        if (mutation) return;
        for (const [sessionId, target] of entries) {
          if (target.listeners.size && !target.request) void refresh(sessionId);
        }
      }, options.pollMs ?? 1000);
    }
  }
  async function mutate(sessionId: string, operation: (snapshot: ConversationWorkflowSnapshot) => Promise<unknown>, changesProgress = false) {
    const target = entry(sessionId);
    if (disposed || mutation || !target.state.snapshot || target.state.loading || target.state.snapshot.busy
      || (changesProgress && target.state.snapshot.progressBusy)) return false;
    const snapshot = target.state.snapshot;
    mutation = true;
    // Invalidate reads admitted before the mutation so stale polling cannot win.
    for (const cached of entries.values()) { cached.generation++; cached.request?.abort(); cached.request = undefined; }
    const related = [...entries].filter(([id, cached]) => id === sessionId || (snapshot.projectId && cached.state.snapshot?.projectId === snapshot.projectId));
    for (const [, cached] of related) publish(cached, { ...cached.state, pending: true, error: undefined });
    try {
      await operation(snapshot);
      await Promise.all(related.filter(([id, cached]) => id === sessionId || cached.listeners.size > 0).map(([id]) => refresh(id)));
      return true;
    } catch (error) {
      // A CAS conflict must refresh the effective selection without retrying the user's write.
      await Promise.all(related.filter(([id, cached]) => id === sessionId || cached.listeners.size > 0).map(([id]) => refresh(id)));
      publish(target, { ...target.state, error: message(error) });
      return false;
    } finally {
      mutation = false;
      for (const [, cached] of related) publish(cached, { ...cached.state, pending: false });
    }
  }

  return {
    read: sessionId => entry(sessionId).state,
    subscribe(sessionId, listener) {
      if (disposed) return () => {};
      const target = entry(sessionId);
      target.listeners.add(listener);
      if (target.listeners.size === 1) void refresh(sessionId);
      updateTimer();
      return () => {
        target.listeners.delete(listener);
        if (!target.listeners.size) { target.generation++; target.request?.abort(); target.request = undefined; }
        updateTimer();
      };
    },
    refresh,
    selectWorkflow: (sessionId, workflowTemplateId) => mutate(sessionId, snapshot => transport.selectWorkflow(sessionId, workflowTemplateId, snapshot)),
    selectStep: (sessionId, stepId) => mutate(sessionId, snapshot => transport.selectStep(sessionId, stepId, snapshot), true),
    dispose() {
      disposed = true;
      if (timer) clearInterval(timer);
      timer = undefined;
      for (const target of entries.values()) { target.generation++; target.request?.abort(); target.listeners.clear(); }
      entries.clear();
    },
  };
}
