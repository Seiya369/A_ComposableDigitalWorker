import { WorkService } from './service.js';
import type { WorkExecutor } from './types.js';

/** Dispatch is derived from committed state. No model work is performed during migration. */
export class WorkEngine {
  private stopped = true;
  private dirty = false;
  private unsubscribe?: () => void;
  private draining?: Promise<void>;
  constructor(readonly service: WorkService, private readonly executor: WorkExecutor, private readonly onError: (error: unknown) => void = () => undefined) {}
  async start(): Promise<void> { if (!this.stopped) return; await this.service.recover(); this.stopped = false; this.unsubscribe = this.service.persistence.subscribe(() => this.wake()); this.wake(); }
  private wake(): void {
    if (this.stopped) return; this.dirty = true; if (this.draining) return;
    this.draining = Promise.resolve().then(async () => {
      while (this.dirty && !this.stopped) { this.dirty = false;
        for (const action of this.service.actions()) { if (this.stopped) break;
          try { if (action.kind === 'dispatch') await this.service.dispatch(action.id); else if (action.kind === 'reconcile') await this.service.reconcile(action.id); else if (action.kind === 'cancel') await this.executor.cancel(action.id); else await this.executor.startReserved(action.id); }
          catch (error) { this.onError(error); if (action.kind === 'start') await this.service.failAttempt(action.id, error); }
        }
      }
    }).finally(() => { this.draining = undefined; if (this.dirty && !this.stopped) this.wake(); });
  }
  async idle(): Promise<void> { while (this.draining) await this.draining; }
  async dispose(): Promise<void> { this.stopped = true; this.unsubscribe?.(); this.unsubscribe = undefined; await this.draining; }
}
