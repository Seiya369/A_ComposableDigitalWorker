import type { ProjectWorkflow, WorkforceRun, WorkforceState } from '../domain/types.js';

/** Definitions are reusable; each execution freezes its own project-scoped copy. */
export interface WorkflowStepRequirements {
  inputs?: string[];
  outputs?: string[];
  acceptanceCriteria?: string[];
  timeoutMs?: number;
}
export type WorkflowStatus = 'running' | 'paused' | 'awaiting-review' | 'blocked' | 'succeeded' | 'cancelled';
export type WorkflowStepStatus = 'pending' | 'running' | 'awaiting-review' | 'accepted' | 'blocked' | 'cancelled';
export interface WorkflowAttempt { runId: string; number: number; createdAt: string; feedback?: string }
export interface WorkflowStepRun { stepId: string; status: WorkflowStepStatus; attempts: WorkflowAttempt[]; error?: string }
export interface WorkflowEvent { at: string; kind: string; message: string; stepId?: string; runId?: string }
export interface WorkflowRun {
  id: string;
  projectId: string;
  projectTeamId: string;
  workflowId: string;
  requestId: string;
  definition: ProjectWorkflow;
  request: string;
  status: WorkflowStatus;
  steps: WorkflowStepRun[];
  version: number;
  commands: Array<{ id: string; fingerprint: string }>;
  events: WorkflowEvent[];
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}
export interface WorkflowTaskLink { workflowRunId: string; stepId: string; attempt: number; timeoutMs: number }
export interface StartWorkflowInput { projectId: string; projectTeamId: string; workflowId: string; workflowVersion: number; request: string; requestId: string }
export interface WorkflowCommandInput {
  projectId: string;
  id: string;
  commandId: string;
  expectedVersion: number;
  action: 'pause' | 'resume' | 'cancel' | 'retry' | 'review';
  runId?: string;
  decision?: 'accepted' | 'rejected';
  note?: string;
}
export interface SaveProjectWorkflowInput { projectId: string; projectTeamId: string; workflow: ProjectWorkflow; expectedVersion: number }

/** No HTTP, React, Cordis, clock or model dependency in the persistence contract. */
export interface WorkflowPersistence {
  snapshot(): WorkforceState;
  transaction<T>(operation: (state: WorkforceState) => T): Promise<T>;
  subscribe(listener: () => void): () => void;
}
/** The adapter runs an already persisted work order. It must never create another. */
export interface WorkflowExecutor {
  startReserved(runId: string): Promise<WorkforceRun>;
  cancel(runId: string): Promise<void>;
}
