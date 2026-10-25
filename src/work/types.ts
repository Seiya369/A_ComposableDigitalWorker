import type { WorkforceRun, WorkforceState } from '../domain/types.js';

/** Project work is separate from employee definitions and individual execution attempts. */
export type WorkTaskStatus = 'draft' | 'ready' | 'running' | 'awaiting-review' | 'accepted' | 'blocked' | 'needs-revalidation' | 'cancelled';
export interface DeliverableVersionRef { deliverableId: string; version: number }
export interface WorkReview { decision: 'accepted' | 'rejected'; reviewer: string; note: string; at: string }
export interface DeliverableRevision {
  version: number; content?: string; path?: string; mediaType?: string; producerRunId?: string;
  inputVersions: DeliverableVersionRef[]; review?: WorkReview; reviews: WorkReview[];
  invalidatedAt?: string; invalidationReason?: string; createdAt: string;
}
export interface WorkDeliverable {
  id: string; projectId: string; taskId: string; title: string; version: number;
  revisions: DeliverableRevision[]; createdAt: string; updatedAt: string;
}
export interface ProjectBrief {
  id: string; projectId: string; goal: string; scope: string; completionCriteria: string[];
  requiredDeliverableIds: string[]; autoDispatch: boolean;
  status: 'draft' | 'running' | 'paused' | 'completed'; maxConcurrent: number;
  version: number; createdAt: string; updatedAt: string;
}
export interface WorkTask {
  id: string; projectId: string; title: string; goal: string; employeeId: string;
  inputs: string[]; acceptanceCriteria: string[]; dependencyTaskIds: string[];
  requiredDeliverableIds: string[]; attemptRunIds: string[]; status: WorkTaskStatus;
  /** Automatic scheduling remains off until a human explicitly starts this project. */
  manualReview: true; inputVersions: DeliverableVersionRef[];
  error?: string; feedback?: string; sourceWorkflow?: { projectTeamId: string; workflowId: string; stepId: string };
  version: number; createdAt: string; updatedAt: string;
}
export interface WorkEvent { id: string; projectId: string; taskId?: string; kind: string; message: string; at: string }
export interface WorkReceipt { id: string; fingerprint: string; result: WorkCommandResult; createdAt: string }
export interface ProjectWorkState {
  briefs: ProjectBrief[]; tasks: WorkTask[]; deliverables: WorkDeliverable[];
  events: WorkEvent[]; receipts: WorkReceipt[];
}
export interface WorkCommandOptions { requestId?: string; expectedVersion?: number; expectedRevision?: number }
export interface SaveBriefInput { projectId: string; goal: string; scope?: string; completionCriteria: string[]; requiredDeliverableIds?: string[]; maxConcurrent?: number }
export interface SaveWorkTaskInput {
  projectId: string; id?: string; title: string; goal: string; employeeId: string;
  inputs?: string[]; acceptanceCriteria: string[]; dependencyTaskIds?: string[];
  requiredDeliverableIds?: string[]; deliverableTitles?: string[];
}
export interface SaveDeliverableInput {
  projectId: string; id?: string; taskId: string; title: string;
  content?: string; path?: string; mediaType?: string; producerRunId?: string;
}
export interface ReviewWorkInput { projectId: string; id: string; decision: 'accepted' | 'rejected'; note?: string; runId?: string }
export interface WorkControlInput { projectId: string; id?: string; note?: string }
export interface MaterializeWorkflowInput { projectId: string; projectTeamId: string; workflowId: string; workflowVersion: number }
export type WorkAction = 'work.saveBrief' | 'work.saveTask' | 'work.saveDeliverable' | 'work.reviewTask' | 'work.reviewDeliverable' | 'work.startProject' | 'work.pauseProject' | 'work.completeProject' | 'work.startTask' | 'work.retryTask' | 'work.cancelTask' | 'work.materializeWorkflow';
export type WorkCommandResult = ProjectBrief | WorkTask | WorkDeliverable | WorkTask[];
export interface WorkPersistence {
  snapshot(): WorkforceState;
  transaction<T>(operation: (state: WorkforceState) => T, options?: { expectedRevision?: number }, replay?: (state: WorkforceState) => T | undefined): Promise<T>;
  subscribe(listener: () => void): () => void;
}
export interface WorkExecutor { startReserved(runId: string): Promise<WorkforceRun>; cancel(runId: string): Promise<void> }
