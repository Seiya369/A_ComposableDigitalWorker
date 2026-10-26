import type { ConversationEmployeeChoice, ConversationEmployeeMode, ConversationEmployeeView } from '../domain/conversation-employee.js';

export type ConversationEmployeeSnapshot = ConversationEmployeeView;
export interface ConversationEmployeeTransport {
  load(sessionId: string, signal?: AbortSignal): Promise<ConversationEmployeeSnapshot>;
  select(sessionId: string, choice: Pick<ConversationEmployeeChoice, 'kind' | 'id'>, mode: ConversationEmployeeMode, snapshot: ConversationEmployeeSnapshot): Promise<unknown>;
  clear(sessionId: string, snapshot: ConversationEmployeeSnapshot): Promise<unknown>;
}
export interface ConversationEmployeeClientState { snapshot?: ConversationEmployeeSnapshot; loading: boolean; pending: boolean; error?: string }
export interface ConversationEmployeeController {
  read(sessionId: string): ConversationEmployeeClientState;
  subscribe(sessionId: string, listener: () => void): () => void;
  refresh(sessionId: string): Promise<void>;
  select(sessionId: string, choice: Pick<ConversationEmployeeChoice, 'kind' | 'id'>, mode: ConversationEmployeeMode): Promise<boolean>;
  clear(sessionId: string): Promise<boolean>;
  dispose(): void;
}
type Entry = { state: ConversationEmployeeClientState; listeners: Set<() => void>; generation: number; request?: AbortController };

/** A resident choice belongs to exactly one native conversation; writes never lock another. */
export function createConversationEmployeeController(transport: ConversationEmployeeTransport, options: { pollMs?: number } = {}): ConversationEmployeeController {
  const entries = new Map<string, Entry>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let disposed = false;
  const entry = (sessionId: string) => {
    let found = entries.get(sessionId);
    if (!found) { found = { state: { loading: true, pending: false }, listeners: new Set(), generation: 0 }; entries.set(sessionId, found); }
    return found;
  };
  const publish = (target: Entry, state: ConversationEmployeeClientState) => {
    if (disposed) return;
    target.state = state;
    for (const listener of target.listeners) listener();
  };
  const refresh = async (sessionId: string) => {
    if (disposed) return;
    const target = entry(sessionId);
    target.request?.abort();
    const request = new AbortController(), generation = ++target.generation;
    target.request = request;
    try {
      const snapshot = await transport.load(sessionId, request.signal);
      if (!disposed && generation === target.generation && !request.signal.aborted) publish(target, { snapshot, loading: false, pending: target.state.pending });
    } catch (error) {
      if (!disposed && generation === target.generation && !request.signal.aborted) publish(target, { ...target.state, loading: false, error: error instanceof Error ? error.message : String(error) });
    } finally { if (target.request === request) target.request = undefined; }
  };
  const updateTimer = () => {
    if (disposed || ![...entries.values()].some(target => target.listeners.size)) { if (timer) clearInterval(timer); timer = undefined; return; }
    if (!timer) timer = setInterval(() => { for (const [id, target] of entries) if (target.listeners.size && !target.request && !target.state.pending) void refresh(id); }, options.pollMs ?? 2_000);
  };
  const mutate = async (sessionId: string, operation: (snapshot: ConversationEmployeeSnapshot) => Promise<unknown>, clear = false) => {
    const target = entry(sessionId), snapshot = target.state.snapshot;
    if (disposed || !snapshot?.enabled || target.state.loading || target.state.pending || snapshot.busy || !snapshot.projectId || (clear && !snapshot.conversationEmployee)) return false;
    target.generation++; target.request?.abort(); target.request = undefined;
    publish(target, { ...target.state, pending: true, error: undefined });
    try { await operation(snapshot); await refresh(sessionId); return !disposed; }
    catch (error) { await refresh(sessionId); publish(target, { ...target.state, error: error instanceof Error ? error.message : String(error) }); return false; }
    finally { publish(target, { ...target.state, pending: false }); }
  };
  return {
    read: sessionId => entry(sessionId).state,
    subscribe(sessionId, listener) {
      if (disposed) return () => {};
      const target = entry(sessionId); target.listeners.add(listener);
      if (target.listeners.size === 1) void refresh(sessionId);
      updateTimer();
      return () => { target.listeners.delete(listener); if (!target.listeners.size) { target.generation++; target.request?.abort(); target.request = undefined; } updateTimer(); };
    },
    refresh,
    select: (sessionId, choice, mode) => mutate(sessionId, snapshot => transport.select(sessionId, choice, mode, snapshot)),
    clear: sessionId => mutate(sessionId, snapshot => transport.clear(sessionId, snapshot), true),
    dispose() { disposed = true; if (timer) clearInterval(timer); for (const target of entries.values()) { target.generation++; target.request?.abort(); target.listeners.clear(); } entries.clear(); },
  };
}
