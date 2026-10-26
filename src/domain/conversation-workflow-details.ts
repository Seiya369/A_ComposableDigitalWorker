import { resolveConversationWorkflow } from './conversation-workflow.js';
import { isLegacyStandaloneRun } from './conversation-session.js';
import { invariant, textField, WorkforceError } from './errors.js';
import type { RunAcceptance, RunStatus, RunUsage, WorkforceRun, WorkforceState } from './types.js';
import type { WorkTaskStatus } from '../work/types.js';
import { CONFIRMED_ITEMS_LIMITS, parseConfirmedItemDeclarations, type ConfirmedItemDeclaration } from './confirmed-items.js';

export interface ConversationWorkflowPerson { id: string; name: string }
export interface ConversationWorkflowDeliverySummary {
  id: string; version: number; title: string; status: RunStatus; employeeName: string;
  legacy: boolean; stepId?: string; stepName?: string; sessionId?: string;
  createdAt: string; updatedAt: string;
}
export interface ConversationWorkflowDelivery extends ConversationWorkflowDeliverySummary {
  output?: string; outputLength?: number; outputTruncated?: boolean;
  artifacts: Array<{ id: string; title: string; path?: string; mediaType?: string; content?: string; contentLength?: number; contentTruncated?: boolean }>;
  acceptance?: RunAcceptance; error?: string;
  usage?: RunUsage;
  reviewable: boolean; reviewBlockedReason?: string;
}
export interface ConversationWorkflowConfirmedItem extends ConfirmedItemDeclaration {
  sourceArtifactId: string; runId: string; runVersion: number; reviewer: string; acceptedAt: string;
}
export interface ConversationWorkflowDetails {
  projectId: string | null; projectName?: string; sessionId: string; revision: number;
  instanceId: string | null; instanceVersion?: number; name?: string; currentStepId?: string;
  /** Reuses this frozen workflow's project-team library; never a template library. */
  projectWiki?: { employeeId: string; teamId: string };
  steps: Array<{ id: string; name: string; status: 'pending' | 'current' | 'completed'; employeeName?: string; onRejectStepId?: string }>;
  selectedStep?: {
    id: string; name: string; status: 'pending' | 'current' | 'completed'; instruction: string;
    outputs: string[]; acceptanceCriteria: string[]; onRejectStepId: string; onRejectStepName: string;
    owner?: ConversationWorkflowPerson;
    roster: Array<ConversationWorkflowPerson & { managerId?: string; status: string }>;
    latestDelivery?: ConversationWorkflowDelivery;
    /** Effective acceptance evidence, distinct from a newer failed or pending attempt. */
    acceptedDelivery?: ConversationWorkflowDelivery;
    /** Only responsible-owner roots from this frozen step; reading never activates it. */
    history?: ConversationWorkflowDeliverySummary[]; historyTotal?: number;
    /** Declarations from the effective accepted delivery, not evidence of individual user confirmation. */
    confirmedItems?: ConversationWorkflowConfirmedItem[];
  };
  /** A legacy delivery may be opened even after this conversation explicitly selects “无”. */
  legacyDelivery?: ConversationWorkflowDelivery;
  history: ConversationWorkflowDeliverySummary[]; historyTotal: number;
  tasks: Array<{ id: string; title: string; status: WorkTaskStatus; employeeId: string; employeeName: string; stepId: string }>;
  tasksTotal: number; busy?: boolean; unavailableReason?: string;
}
export interface ConversationWorkflowReviewInput {
  projectId: string; sessionId: string; instanceId: string | null; instanceVersion?: number;
  stepId?: string; runId: string; runVersion: number; decision: 'accepted' | 'rejected';
  note?: string; expectedRevision: number;
}
export interface ConversationWorkflowDetailsSelection { stepId?: string; runId?: string; runVersion?: number }

const BODY_CHARACTERS = 200_000;
const ARTIFACT_CHARACTERS = 100_000;
const ARTIFACT_TOTAL_CHARACTERS = 500_000;
const MAX_SUMMARIES = 100;
const running = (run: WorkforceRun) => ['queued', 'running', 'blocked'].includes(run.status);

function permittedRuns(state: WorkforceState, projectId: string, sessionId: string, instanceId: string | null) {
  return state.runs.filter(run => run.projectId === projectId && !run.parentRunId && !run.workflow && !run.workTaskId
    && ((instanceId && run.conversationWorkflow?.instanceId === instanceId)
      || (isLegacyStandaloneRun(run) && run.sessionId === sessionId)));
}
function summary(run: WorkforceRun, steps: ConversationWorkflowDetails['steps']): ConversationWorkflowDeliverySummary {
  const step = steps.find(entry => entry.id === run.conversationWorkflow?.stepId);
  return { id: run.id, version: run.version, title: run.request.slice(0, 240), status: run.status,
    employeeName: run.employeeSnapshot.name, legacy: !run.conversationWorkflow,
    ...(step ? { stepId: step.id, stepName: step.name } : {}),
    ...(run.sessionId ? { sessionId: run.sessionId } : {}), createdAt: run.createdAt, updatedAt: run.updatedAt };
}
function reviewBlockedReason(state: WorkforceState, run: WorkforceRun, currentStepId?: string, unavailableReason?: string, busy = false): string | undefined {
  if (run.status !== 'awaiting-review') return '此交付当前不处于待验收状态';
  if (busy) return '当前对话或工作流仍在执行，请等待本轮及委派结束后再验收';
  if (run.conversationWorkflow) {
    if (unavailableReason) return unavailableReason;
    if (run.conversationWorkflow.stepId !== currentStepId) return '请先切换到此交付所属步骤再验收';
    if (state.runs.some(other => other.id !== run.id && other.conversationWorkflow?.instanceId === run.conversationWorkflow!.instanceId && running(other))) return '工作流还有执行中的任务，请等待本轮及委派结束后再验收';
  }
  return undefined;
}
function delivery(state: WorkforceState, run: WorkforceRun, steps: ConversationWorkflowDetails['steps'], currentStepId?: string, unavailableReason?: string, busy = false): ConversationWorkflowDelivery {
  const blocked = reviewBlockedReason(state, run, currentStepId, unavailableReason, busy);
  let remaining = ARTIFACT_TOTAL_CHARACTERS;
  return { ...summary(run, steps),
    ...(run.output !== undefined ? { output: run.output.slice(0, BODY_CHARACTERS), outputLength: run.output.length,
      ...(run.output.length > BODY_CHARACTERS ? { outputTruncated: true } : {}) } : {}),
    artifacts: run.artifacts.map(artifact => {
      const length = Math.min(ARTIFACT_CHARACTERS, remaining); const content = artifact.content?.slice(0, length);
      remaining -= content?.length ?? 0;
      return { id: artifact.id, title: artifact.title,
        ...(artifact.path !== undefined ? { path: artifact.path } : {}), ...(artifact.mediaType !== undefined ? { mediaType: artifact.mediaType } : {}),
        ...(content !== undefined ? { content, contentLength: artifact.content!.length,
          ...(content.length < artifact.content!.length ? { contentTruncated: true } : {}) } : {}) };
    }),
    ...(run.acceptance ? { acceptance: { decision: run.acceptance.decision, reviewer: run.acceptance.reviewer, note: run.acceptance.note, at: run.acceptance.at } } : {}),
    ...(run.error ? { error: run.error } : {}), ...(run.usage ? { usage: usageProjection(run.usage) } : {}),
    reviewable: !blocked, ...(blocked ? { reviewBlockedReason: blocked } : {}) };
}

function usageProjection(usage: RunUsage): RunUsage {
  const result: RunUsage = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
  for (const key of ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens', 'modelCalls', 'reportedCalls'] as const)
    if (usage[key] !== undefined) result[key] = usage[key];
  return result;
}

function confirmedItems(run: WorkforceRun): ConversationWorkflowConfirmedItem[] {
  const items = run.artifacts.flatMap(artifact => (parseConfirmedItemDeclarations(artifact) ?? []).map(item => ({ ...item,
    sourceArtifactId: artifact.id, runId: run.id, runVersion: run.version, reviewer: run.acceptance!.reviewer, acceptedAt: run.acceptance!.at })));
  return items.length <= CONFIRMED_ITEMS_LIMITS.items ? items : [];
}

/** Only presentation fields from one frozen workflow and this native conversation's legacy roots. */
export function resolveConversationWorkflowDetails(state: WorkforceState, projectId: string, sessionId: string,
  options: ConversationWorkflowDetailsSelection & { busy?: boolean } = {}): ConversationWorkflowDetails {
  const view = resolveConversationWorkflow(state, projectId, sessionId);
  const result: ConversationWorkflowDetails = { projectId, sessionId, revision: state.revision, instanceId: view.instanceId,
    ...(state.projects.find(project => project.id === projectId)?.name ? { projectName: state.projects.find(project => project.id === projectId)!.name } : {}),
    ...(view.instanceVersion !== undefined ? { instanceVersion: view.instanceVersion } : {}), ...(view.name ? { name: view.name } : {}),
    ...(view.currentStepId ? { currentStepId: view.currentStepId } : {}), ...(options.busy !== undefined ? { busy: options.busy } : {}),
    ...(view.unavailableReason ? { unavailableReason: view.unavailableReason } : {}),
    steps: view.steps.map(step => ({ id: step.id, name: step.name, status: step.status,
      ...(step.onRejectStepId ? { onRejectStepId: step.onRejectStepId } : {}),
      ...(state.employees.find(employee => employee.projectId === projectId && employee.id === step.employeeId)?.name
        ? { employeeName: state.employees.find(employee => employee.projectId === projectId && employee.id === step.employeeId)!.name } : {}) })),
    history: [], historyTotal: 0, tasks: [], tasksTotal: 0 };
  const runs = permittedRuns(state, projectId, sessionId, view.instanceId).reverse();
  const selectedRun = options.runId ? runs.find(run => run.id === options.runId) : undefined;
  if (options.runVersion !== undefined) invariant(!!options.runId && Number.isSafeInteger(options.runVersion) && options.runVersion > 0, '读取交付版本必须提供交付 ID 和有效版本');
  if (options.runId && !selectedRun) {
    const own = state.runs.find(run => run.id === options.runId && run.projectId === projectId && run.sessionId === sessionId
      && run.conversationWorkflow && !run.parentRunId && !run.workflow && !run.workTaskId);
    if (own) {
      const installation = state.conversationWorkflows?.instances.find(instance => instance.projectId === projectId && instance.id === own.conversationWorkflow!.instanceId);
      const workflow = state.projectTeams?.find(team => team.id === installation?.projectTeamId && team.projectId === projectId)?.workflows.find(flow => flow.id === installation?.workflowId);
      const previousStep = workflow?.steps.find(entry => entry.id === own.conversationWorkflow!.stepId);
      if (workflow && previousStep) throw new WorkforceError('VALIDATION', `请先在此对话选择“${workflow.name}”工作流，再切换到“${previousStep.name}”步骤查看或验收这条交付`);
    }
    invariant(selectedRun, '交付不属于当前对话或工作流');
  }
  if (selectedRun && options.runVersion !== undefined && selectedRun.version !== options.runVersion) throw new WorkforceError('CONFLICT', '交付版本已更新，请刷新记录后重新查看');
  result.historyTotal = runs.length; result.history = runs.slice(0, MAX_SUMMARIES).map(run => summary(run, result.steps));
  const selectedId = options.stepId ?? selectedRun?.conversationWorkflow?.stepId ?? view.currentStepId ?? view.steps.at(-1)?.id;
  const step = view.steps.find(entry => entry.id === selectedId);
  if (options.stepId) invariant(step, '步骤不属于当前工作流');
  if (selectedRun?.conversationWorkflow && step) invariant(selectedRun.conversationWorkflow.stepId === step.id, '交付不属于所选步骤');
  if (selectedRun && !selectedRun.conversationWorkflow) result.legacyDelivery = delivery(state, selectedRun, result.steps, view.currentStepId, view.unavailableReason, options.busy);
  if (!step || !view.projectTeamId) return result;
  const team = state.projectTeams?.find(entry => entry.id === view.projectTeamId && entry.projectId === projectId);
  invariant(team, '项目工作流团队已不存在');
  const members = state.employees.filter(employee => employee.projectId === projectId && team.members.some(member => member.employeeId === employee.id));
  const wikiMember = members.find(employee => employee.status === 'active') ?? members[0];
  if (wikiMember) result.projectWiki = { employeeId: wikiMember.id, teamId: team.id };
  const included = new Set([step.employeeId]);
  for (let changed = true; changed;) {
    changed = false;
    for (const employee of members) if (employee.managerId && included.has(employee.managerId) && !included.has(employee.id)) { included.add(employee.id); changed = true; }
  }
  const owner = members.find(employee => employee.id === step.employeeId);
  const stepRuns = runs.filter(run => run.conversationWorkflow?.stepId === step.id && run.employeeId === step.employeeId);
  const latest = selectedRun?.conversationWorkflow ? selectedRun : runs.find(run => run.conversationWorkflow?.stepId === step.id && run.employeeId === step.employeeId);
  const instance = state.conversationWorkflows?.instances.find(entry => entry.projectId === projectId && entry.id === view.instanceId
    && entry.projectTeamId === team.id && entry.workflowId === view.workflowId);
  const completion = instance?.completions.findLast(entry => entry.stepId === step.id && !entry.invalidatedAt);
  const accepted = completion && runs.find(run => run.id === completion.runId && run.projectId === projectId
    && run.conversationWorkflow?.instanceId === instance!.id && run.conversationWorkflow.stepId === step.id
    && run.employeeId === step.employeeId && run.status === 'succeeded'
    && run.acceptance?.decision === 'accepted' && run.acceptance.at === completion.acceptedAt);
  const destination = view.steps.find(entry => entry.id === (step.onRejectStepId ?? step.id))!;
  result.selectedStep = { id: step.id, name: step.name, status: step.status, instruction: step.instruction,
    outputs: [...(step.outputs ?? [])], acceptanceCriteria: [...(step.acceptanceCriteria ?? [])],
    onRejectStepId: destination.id, onRejectStepName: destination.name,
    ...(owner ? { owner: { id: owner.id, name: owner.name } } : {}),
    roster: members.filter(employee => included.has(employee.id)).map(employee => ({ id: employee.id, name: employee.name, status: employee.status,
      ...(employee.managerId && included.has(employee.managerId) ? { managerId: employee.managerId } : {}) })),
    history: stepRuns.slice(0, MAX_SUMMARIES).map(run => summary(run, result.steps)), historyTotal: stepRuns.length,
    confirmedItems: accepted ? confirmedItems(accepted) : [],
    ...(latest ? { latestDelivery: delivery(state, latest, result.steps, view.currentStepId, view.unavailableReason, options.busy) } : {}),
    ...(accepted ? { acceptedDelivery: delivery(state, accepted, result.steps, view.currentStepId, view.unavailableReason, options.busy) } : {}) };
  const tasks = (state.workState?.tasks ?? []).filter(task => task.projectId === projectId
    && task.sourceWorkflow?.projectTeamId === view.projectTeamId && task.sourceWorkflow?.workflowId === view.workflowId
    && task.sourceWorkflow?.stepId === step.id && included.has(task.employeeId));
  result.tasksTotal = tasks.length; result.tasks = tasks.slice(-MAX_SUMMARIES).reverse().map(task => ({ id: task.id, title: task.title, status: task.status,
    employeeId: task.employeeId, employeeName: members.find(employee => employee.id === task.employeeId)!.name, stepId: step.id }));
  return result;
}

/** Call immediately before store.reviewRun with the same mandatory revision/version CAS. */
export function requireConversationWorkflowReview(state: WorkforceState, input: ConversationWorkflowReviewInput, busy = false): WorkforceRun {
  textField(input.projectId, '项目 ID'); textField(input.sessionId, '对话 ID'); textField(input.runId, '交付 ID');
  invariant(Number.isSafeInteger(input.expectedRevision) && input.expectedRevision >= 0, '验收必须提供当前工作区版本');
  invariant(Number.isSafeInteger(input.runVersion) && input.runVersion > 0, '验收必须提供交付版本');
  if (state.revision !== input.expectedRevision) throw new WorkforceError('CONFLICT', '工作区已更新，请刷新后再验收');
  const view = resolveConversationWorkflow(state, input.projectId, input.sessionId);
  if (view.instanceId !== input.instanceId || view.instanceVersion !== input.instanceVersion) throw new WorkforceError('CONFLICT', '工作流进度已更新，请刷新后再验收');
  const run = permittedRuns(state, input.projectId, input.sessionId, view.instanceId).find(entry => entry.id === input.runId);
  invariant(run, '交付不属于当前对话或工作流');
  if (run.version !== input.runVersion) throw new WorkforceError('CONFLICT', '交付已更新，请刷新后再验收');
  if (run.conversationWorkflow) {
    invariant(run.conversationWorkflow.stepId === input.stepId && view.currentStepId === input.stepId, '请先切换到此交付所属步骤再验收');
    invariant(view.steps.find(step => step.id === input.stepId)?.employeeId === run.employeeId, '只有步骤负责人交付可以验收');
  }
  const blocked = reviewBlockedReason(state, run, view.currentStepId, view.unavailableReason, busy);
  invariant(!blocked, blocked ?? '当前交付不能验收');
  invariant(input.decision === 'accepted' || input.decision === 'rejected', '验收决定无效');
  if (input.note !== undefined) textField(input.note, '验收说明', true);
  return run;
}
