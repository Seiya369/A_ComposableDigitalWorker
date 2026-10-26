import { createHash } from 'node:crypto';
import type { RunAcceptance, WorkforceRun, WorkforceState } from '../domain/types.js';
import type { DeliverableRevision, WorkTask } from '../work/types.js';
import { knowledgeCategoryForInput } from './categories.js';
import type { KnowledgeInput, KnowledgeSpace } from './types.js';

const taskStages = new Set(['accepted', 'blocked', 'cancelled', 'needs-revalidation']);
const workflowStages = new Set(['accepted', 'blocked', 'cancelled']);
const rootStages = new Set(['succeeded', 'failed', 'cancelled']);
const childStages = new Set(['awaiting-review', 'succeeded', 'failed', 'cancelled']);
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const order = (left: { id: string }, right: { id: string }): number => left.id.localeCompare(right.id, 'en');
const review = (value?: Pick<RunAcceptance, 'decision' | 'reviewer' | 'note'>) => value
  ? { decision: value.decision, reviewer: value.reviewer, note: value.note }
  : undefined;
const runVerdict = (run?: WorkforceRun) => run ? { id: run.id, status: run.status, acceptance: review(run.acceptance), error: run.error } : undefined;
const revision = (value?: DeliverableRevision) => value ? {
  version: value.version,
  producerRunId: value.producerRunId,
  inputVersions: [...value.inputVersions].sort((left, right) => left.deliverableId.localeCompare(right.deliverableId, 'en')),
  review: review(value.review),
  invalidated: !!value.invalidatedAt,
  invalidationReason: value.invalidationReason,
} : undefined;

/** A checkpoint is a business stage, independent of native Session/Turn activity. */
export function knowledgeArchiveCheckpointEntries(state: WorkforceState, space: KnowledgeSpace, memberIds: string[]): Array<[string, string]> {
  return checkpointEntries(state, space, memberIds, false);
}

/** Paid synthesis follows explicit acceptance, not each failed/cancelled chat turn. */
export function knowledgeCompilationCheckpointEntries(state: WorkforceState, space: KnowledgeSpace, memberIds: string[]): Array<[string, string]> {
  return checkpointEntries(state, space, memberIds, true);
}

function checkpointEntries(state: WorkforceState, space: KnowledgeSpace, memberIds: string[], compilation: boolean): Array<[string, string]> {
  if (space.kind !== 'project' || !space.projectId) return [];
  const projectId = space.projectId;
  const members = new Set(space.memberId ? memberIds.filter(id => id === space.memberId) : memberIds);
  const runs = new Map(state.runs.filter(run => run.projectId === projectId).map(run => [run.id, run]));
  const records = new Map<string, { stage: unknown; children: ReturnType<typeof childRecord>[] }>();
  const tasks = (state.workState?.tasks ?? []).filter(task => task.projectId === projectId);
  const taskById = new Map(tasks.map(task => [task.id, task]));
  const workflows = (state.workflowRuns ?? []).filter(flow => flow.projectId === projectId);
  const workflowById = new Map(workflows.map(flow => [flow.id, flow]));
  const latestTaskRun = (task: WorkTask) => runs.get(task.attemptRunIds.at(-1) ?? '');
  const taskReady = (task: WorkTask): boolean => {
    if (!taskStages.has(task.status)) return false;
    if (!task.attemptRunIds.length) return true;
    const run = latestTaskRun(task);
    if (!run || run.workTaskId !== task.id || run.employeeId !== task.employeeId) return false;
    if (task.status === 'accepted') return run.status === 'succeeded' && run.acceptance?.decision === 'accepted';
    return rootStages.has(run.status) || (task.status === 'needs-revalidation' && run.status === 'awaiting-review');
  };
  const workflowReady = (status: string, attemptId: string | undefined, flowId: string, stepId: string, owner?: string): boolean => {
    if (!workflowStages.has(status)) return false;
    if (!attemptId) return status !== 'accepted';
    const run = runs.get(attemptId);
    return !!run && run.employeeId === owner && run.workflow?.workflowRunId === flowId && run.workflow.stepId === stepId
      && (status === 'accepted' ? run.status === 'succeeded' && run.acceptance?.decision === 'accepted' : rootStages.has(run.status));
  };
  const taskStage = (task: WorkTask, includeDetails: boolean): unknown => ({
    kind: 'task', id: task.id, status: task.status, latestAttempt: task.attemptRunIds.at(-1),
    ...(includeDetails ? {
      result: runVerdict(latestTaskRun(task)), error: task.error, feedback: task.feedback,
      deliverables: (state.workState?.deliverables ?? [])
        .filter(item => item.projectId === projectId && item.taskId === task.id)
        .sort(order).map(item => ({ id: item.id, revision: revision(item.revisions.at(-1)) })),
    } : {}),
  });
  for (const task of tasks) {
    if (compilation && task.status !== 'accepted' && task.status !== 'needs-revalidation') continue;
    if (!members.has(task.employeeId) || !taskReady(task)) continue;
    records.set(`task:${task.id}`, { stage: taskStage(task, true), children: [] });
  }
  for (const flow of workflows) {
    if (flow.projectTeamId !== space.teamId) continue;
    for (const step of flow.steps) {
      if (compilation && step.status !== 'accepted') continue;
      const owner = flow.definition.steps.find(item => item.id === step.stepId)?.employeeId;
      if (!owner || !members.has(owner) || !workflowReady(step.status, step.attempts.at(-1)?.runId, flow.id, step.stepId, owner)) continue;
      records.set(`workflow:${flow.id}:${step.stepId}`, { stage: {
        kind: 'workflow-step', flowId: flow.id, stepId: step.stepId, status: step.status,
        latestAttempt: step.attempts.at(-1)?.runId, result: runVerdict(runs.get(step.attempts.at(-1)?.runId ?? '')), error: step.error,
      }, children: [] });
    }
  }
  for (const run of runs.values()) {
    if (run.parentRunId || run.workTaskId || run.workflow || !members.has(run.employeeId) || !rootStages.has(run.status)) continue;
    if (compilation && (run.status !== 'succeeded' || run.acceptance?.decision !== 'accepted')) continue;
    records.set(`run:${run.id}`, { stage: { kind: 'run', result: runVerdict(run) }, children: [] });
  }
  for (const run of runs.values()) {
    if (!run.parentRunId || !members.has(run.employeeId) || !childStages.has(run.status)) continue;
    const root = delegationRoot(run, runs);
    if (!root) continue;
    if (compilation && (root.status !== 'succeeded' || root.acceptance?.decision !== 'accepted')) continue;
    let phase: { key: string; stage: unknown } | undefined;
    if (root.workTaskId) {
      const task = taskById.get(root.workTaskId);
      if (task && taskReady(task) && task.attemptRunIds.at(-1) === root.id) phase = { key: `task:${task.id}`, stage: taskStage(task, false) };
    } else if (root.workflow) {
      const flow = workflowById.get(root.workflow.workflowRunId);
      const step = flow?.steps.find(item => item.stepId === root.workflow!.stepId);
      const owner = flow?.definition.steps.find(item => item.id === step?.stepId)?.employeeId;
      if (step && workflowReady(step.status, step.attempts.at(-1)?.runId, flow!.id, step.stepId, owner) && step.attempts.at(-1)?.runId === root.id) phase = {
        key: `workflow:${flow!.id}:${step.stepId}`,
        stage: { kind: 'workflow-step', flowId: flow!.id, stepId: step.stepId, status: step.status, latestAttempt: root.id },
      };
    } else if (rootStages.has(root.status)) {
      phase = { key: `run:${root.id}`, stage: { kind: 'run', rootId: root.id, status: root.status } };
    }
    if (!phase) continue;
    const record = records.get(phase.key) ?? { stage: phase.stage, children: [] };
    record.children.push(childRecord(run)); records.set(phase.key, record);
  }
  // Missing entries mean an in-progress stage. Callers retain its last stable
  // value instead of treating a retry's transient disappearance as a new stage.
  return [...records].sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([id, record]) => [id, hash({ ...record, children: record.children.sort(order) })]);
}

function childRecord(run: WorkforceRun) {
  return { id: run.id, employeeId: run.employeeId, status: run.status, acceptance: review(run.acceptance), error: run.error };
}

function delegationRoot(run: WorkforceRun, runs: Map<string, WorkforceRun>): WorkforceRun | undefined {
  const visited = new Set<string>(); let current = run;
  while (current.parentRunId) {
    if (visited.has(current.id)) return undefined;
    visited.add(current.id);
    const parent = runs.get(current.parentRunId);
    if (!parent) return undefined;
    current = parent;
  }
  return current;
}

export function knowledgeArchiveCheckpoint(state: WorkforceState, space: KnowledgeSpace, memberIds: string[]): string {
  return hash(knowledgeArchiveCheckpointEntries(state, space, memberIds));
}

/** Explicit admissions bypass automatic archive scheduling, never authorization. */
export function isExplicitKnowledgeInput(input: KnowledgeInput): boolean {
  if (input.id === 'team-description') return false;
  if (input.id.startsWith('memory:')) {
    try {
      const provenance = JSON.parse(input.provenance);
      if (provenance?.kind !== 'confirmed-memory' || `memory:${provenance.id}` !== input.id) return false;
      return provenance.source?.kind === 'user-confirmed'
        || (provenance.source?.kind === 'project-file' && knowledgeCategoryForInput(input) === 'reference');
    } catch { return false; }
  }
  return knowledgeCategoryForInput(input) === 'reference';
}
