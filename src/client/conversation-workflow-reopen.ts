/** Public navigation facts, separated from host admission and React component lifetime. */
export interface ConversationReopenNavigation {
  isCurrentConversation(sessionId: string): boolean;
  isConversationVisible(): boolean;
  beginNavigation(): AbortSignal;
  reloadBlockReason(sessionId: string): string | undefined;
  /** Refresh the native Client generation after persisting this same selected identity. */
  reloadSession(sessionId: string): void;
}

export function createConversationReopenNavigation(navigation: ConversationReopenNavigation) {
  const pending = new Map<string, AbortSignal>();
  const notices = new Map<string, string>();
  const listeners = new Set<() => void>();
  let disposed = false;
  const publish = () => { if (!disposed) for (const listener of listeners) listener(); };
  const attemptReload = (sessionId: string) => {
    const signal = pending.get(sessionId);
    if (disposed || !signal || signal.aborted || !navigation.isConversationVisible()) { pending.delete(sessionId); return; }
    const reason = navigation.reloadBlockReason(sessionId);
    if (reason) { notices.set(sessionId, reason); publish(); return; }
    pending.delete(sessionId); notices.delete(sessionId); publish(); navigation.reloadSession(sessionId);
  };
  return {
    beforeSelection(sessionId: string) {
      if (disposed) return;
      if (!navigation.isCurrentConversation(sessionId)) { pending.delete(sessionId); return; }
      if (!pending.get(sessionId) || pending.get(sessionId)?.aborted) pending.set(sessionId, navigation.beginNavigation());
    },
    onSessionReopened: attemptReload,
    read(sessionId: string) { return notices.get(sessionId); },
    subscribe(listener: () => void) { if (disposed) return () => {}; listeners.add(listener); return () => { listeners.delete(listener); }; },
    retry(sessionId: string) {
      if (disposed || !notices.has(sessionId) || !navigation.isCurrentConversation(sessionId)) return;
      pending.set(sessionId, navigation.beginNavigation()); attemptReload(sessionId);
    },
    dispose() { disposed = true; pending.clear(); notices.clear(); listeners.clear(); },
  };
}

export type ConversationReopenRecovery = Pick<ReturnType<typeof createConversationReopenNavigation>, 'read' | 'subscribe' | 'retry'>;
