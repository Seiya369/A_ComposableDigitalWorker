import { WorkflowRepository } from './repository.js';
import type { WorkflowExecutor } from './types.js';

/** One scheduler per persistence writer. Committed state is its only source of truth. */
export class WorkflowEngine {
  private unsubscribe?: () => void;
  private dirty = false;
  private stopped = true;
  private draining?: Promise<void>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  constructor(readonly repository: WorkflowRepository, private readonly executor: WorkflowExecutor, private readonly onError: (error: unknown) => void,
    private readonly allowProject?: (projectId: string) => boolean) {}
  async start(): Promise<void> {
    if (!this.stopped) return;
    await this.repository.recover();
    this.stopped = false;
    this.unsubscribe = this.repository.persistence.subscribe(() => this.wake());
    this.wake();
  }
  private wake(): void {
    if (this.stopped) return;
    this.dirty = true;
    if (this.draining) return;
    this.draining = Promise.resolve().then(async () => {
      while (this.dirty && !this.stopped) {
        this.dirty = false;
        for (const action of this.repository.actions(this.allowProject)) {
          if (this.stopped) break;
          try {
            if (action.kind === 'advance') await this.repository.advance(action.id);
            else if (action.kind === 'start') await this.executor.startReserved(action.id);
            else await this.executor.cancel(action.id);
          } catch (error) {
            this.onError(error);
            if (!this.retryTimer) { this.retryTimer = setTimeout(() => { this.retryTimer = undefined; this.wake(); }, 1000); this.retryTimer.unref(); }
          }
        }
      }
    }).finally(() => { this.draining = undefined; if (this.dirty && !this.stopped) this.wake(); });
  }
  async idle(): Promise<void> { while (this.draining) await this.draining; }
  async dispose(): Promise<void> { this.stopped = true; this.unsubscribe?.(); this.unsubscribe = undefined; if (this.retryTimer) clearTimeout(this.retryTimer); this.retryTimer = undefined; await this.draining; }
}
