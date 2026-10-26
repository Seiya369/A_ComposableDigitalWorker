import { isLegacyStandaloneRun } from '../domain/conversation-session.js';
import type { WorkforceRun } from '../domain/types.js';

type Block = { readonly reason: string };
interface BlockStore { getSnapshot(): Block | undefined; subscribe(listener: () => void): () => void }
interface BlockRegistry { set(sessionId: string, block: Block | undefined): void; storeFor(sessionId: string): BlockStore }
type Delivery = Pick<WorkforceRun, 'sessionId' | 'status' | 'parentRunId' | 'conversationWorkflow' | 'workflow' | 'workTaskId'>;

/** Public ComposerBlocks protects a one-shot delivery until its Host owner is released. */
export function createEmployeeConversationBlocks(registry: BlockRegistry, reason: () => string, isActive: () => boolean = () => true) {
  const pending = new Map<string, { block: Block; unsubscribe: () => void }>();
  let disposed = false;
  const hold = (sessionId: string) => {
    if (disposed || !isActive() || pending.has(sessionId)) return;
    const store = registry.storeFor(sessionId);
    const entry = { block: { reason: reason() }, unsubscribe: () => {} };
    pending.set(sessionId, entry);
    const ensure = () => {
      // The native registry is a single block seat: never overwrite another owner.
      if (!disposed && isActive() && pending.get(sessionId) === entry && !store.getSnapshot()) registry.set(sessionId, entry.block);
    };
    entry.unsubscribe = store.subscribe(ensure);
    ensure();
  };
  const release = (sessionId: string) => {
    const entry = pending.get(sessionId);
    if (!entry) return;
    pending.delete(sessionId); entry.unsubscribe();
    if (registry.storeFor(sessionId).getSnapshot() === entry.block) registry.set(sessionId, undefined);
  };
  const seed = (runs: readonly Delivery[]) => { for (const run of runs) if (run.sessionId && isLegacyStandaloneRun(run)) hold(run.sessionId); };
  return {
    hold,
    seed,
    async restore(load: () => Promise<readonly Delivery[]>): Promise<boolean> {
      try {
        const runs = await load();
        if (disposed || !isActive()) return false;
        seed(runs); return true;
      } catch (error) {
        if (disposed || !isActive()) return false;
        throw error;
      }
    },
    observe(sessionId: string, employeeSessionOwned: boolean | undefined) {
      if (disposed || !isActive()) return;
      if (employeeSessionOwned === true) hold(sessionId);
      else if (employeeSessionOwned === false) release(sessionId);
    },
    dispose() { if (disposed) return; disposed = true; for (const sessionId of [...pending.keys()]) release(sessionId); },
  };
}
