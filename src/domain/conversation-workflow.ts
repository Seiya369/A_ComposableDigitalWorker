import type { CreateEmployeeInput, ProjectEmployee, ProjectTeam, ProjectWorkflow, WorkforceRun, WorkforceState, WorkflowTemplate } from './types.js';
import { invariant, textField, WorkforceError } from './errors.js';
const randomUUID = () => globalThis.crypto.randomUUID();

export interface ConversationWorkflowRunLink { instanceId: string; stepId: string }
export interface ConversationWorkflowCompletion {
  stepId: string; runId: string; acceptedAt: string;
  invalidatedAt?: string; invalidationReason?: string;
}
export interface ConversationWorkflowInstance {
  id: string; projectId: string; workflowTemplateId: string; workflowTemplateVersion: number;
  sourceTeamId: string; sourceTeamVersion: number; projectTeamId: string; workflowId: string;
  currentStepId?: string; completions: ConversationWorkflowCompletion[];
  version: number; createdAt: string; updatedAt: string;
  /** Library definition is canonical; project records retain only bindings, progress and history. */
  definitionSource?: 'library';
}
export interface ConversationWorkflowState {
  instances: ConversationWorkflowInstance[];
  /** Set only by the first non-null choice in a project. Later choices are local overrides. */
  defaults: Array<{ projectId: string; instanceId: string }>;
  /** A null instance is explicit “无”; choices made before the first project default are unified on that first choice. */
  selections: Array<{ projectId: string; sessionId: string; instanceId: string | null }>;
}
export interface SelectConversationWorkflowInput {
  projectId: string; sessionId: string; workflowTemplateId: string | null;
  workflowTemplateVersion?: number; templateVersions?: Record<string, number>;
}
export interface SelectConversationWorkflowStepInput {
  projectId: string; sessionId: string; stepId: string; instanceVersion: number;
}
export interface ConversationWorkflowChoice {
  id: string; name: string; version: number; installed: boolean; available: boolean; unavailableReason?: string;
  templateVersions: Record<string, number>;
}
export interface ConversationWorkflowView {
  projectId: string; sessionId: string; selection: 'inherit' | 'override';
  instanceId: string | null; instanceVersion?: number;
  workflowTemplateId?: string; workflowTemplateVersion?: number; name?: string;
  projectTeamId?: string; workflowId?: string; currentStepId?: string;
  steps: Array<ProjectWorkflow['steps'][number] & { status: 'pending' | 'current' | 'completed' }>;
  owner?: ProjectEmployee; activeEmployeeIds: string[]; relatedOwnerIds: string[];
  choices: ConversationWorkflowChoice[];
  unavailableReason?: string;
}

function installationDefinition(state: WorkforceState, instance: ConversationWorkflowInstance): { team: ProjectTeam; workflow: ProjectWorkflow } {
  const team = state.projectTeams?.find(entry => entry.id === instance.projectTeamId && entry.projectId === instance.projectId);
  const workflow = team?.workflows.find(entry => entry.id === instance.workflowId);
  invariant(team && workflow, '项目工作流副本已不存在，请检查项目配置');
  return { team, workflow };
}
function currentInstance(state: WorkforceState, projectId: string, sessionId: string) {
  const configuration = state.conversationWorkflows;
  const selection = configuration?.selections.find(entry => entry.projectId === projectId && entry.sessionId === sessionId);
  const instanceId = selection ? selection.instanceId : configuration?.defaults.find(entry => entry.projectId === projectId)?.instanceId ?? null;
  return { selection, instance: configuration?.instances.find(entry => entry.projectId === projectId && entry.id === instanceId) };
}
function descendants(state: WorkforceState, projectId: string, ownerId: string, team: ProjectTeam): string[] {
  const members = new Set(team.members.map(entry => entry.employeeId));
  const included = new Set([ownerId]);
  // A validated hierarchy is acyclic; the fixed point also bounds corrupt in-memory inputs.
  for (let changed = true; changed;) {
    changed = false;
    for (const employee of state.employees) if (employee.projectId === projectId && members.has(employee.id)
      && employee.status === 'active' && employee.managerId && included.has(employee.managerId) && !included.has(employee.id)) {
      included.add(employee.id); changed = true;
    }
  }
  return [...included];
}
function unavailableSource(state: WorkforceState, template: WorkflowTemplate): string | undefined {
  if (!template.team) return '请先为工作流引入团队并设置步骤负责人';
  if (!template.steps.length) return '工作流没有步骤';
  for (const member of template.team.members) {
    const employee = state.templates.find(entry => entry.id === member.templateId);
    if (!employee || employee.status === 'archived') return '工作流含已移除的自由职业人';
    if (!employee.modules.responsibilities.mission.trim() || !employee.modules.responsibilities.duties.length) return `请先完善“${employee.name}”的岗位职责`;
  }
  return undefined;
}
export function conversationWorkflowChoices(state: WorkforceState, projectId: string): ConversationWorkflowChoice[] {
  const installed = (state.conversationWorkflows?.instances ?? []).filter(entry => entry.projectId === projectId);
  const choices: ConversationWorkflowChoice[] = (state.workflowTemplates ?? []).map(template => {
    const previous = installed.find(entry => entry.workflowTemplateId === template.id);
    const unavailableReason = previous ? (installationDefinition(state, previous).team.status === 'cancelled' ? '此工作流的项目团队已停用' : undefined) : unavailableSource(state, template);
    return { id: template.id, name: template.name,
      version: template.version, installed: Boolean(previous), available: !unavailableReason,
      ...(unavailableReason ? { unavailableReason } : {}),
      templateVersions: Object.fromEntries((template.team?.members ?? []).map(member => [member.templateId, state.templates.find(entry => entry.id === member.templateId)?.version ?? 0])) };
  });
  return choices;
}

export function conversationWorkflowLibraryNeedsSync(state: WorkforceState): boolean {
  return (state.conversationWorkflows?.instances ?? []).some(instance => !instance.definitionSource
    || state.workflowTemplates?.some(template => template.id === instance.workflowTemplateId && template.version !== instance.workflowTemplateVersion));
}

/** One atomic definition update serves the library and all project references. Never replays work. */
export function synchronizeConversationWorkflowLibrary(state: WorkforceState,
  createEmployee: (input: CreateEmployeeInput, teamId: string) => ProjectEmployee): void {
  const templates = state.workflowTemplates ??= [];
  for (const instance of state.conversationWorkflows?.instances ?? []) {
    const { team, workflow } = installationDefinition(state, instance);
    let template = templates.find(entry => entry.id === instance.workflowTemplateId);
    // One-time adoption of pre-library project definitions; intentional removals are never resurrected.
    if (!instance.definitionSource && !template) {
      const members = team.members.map(member => {
        const employee = state.employees.find(entry => entry.id === member.employeeId && entry.projectId === instance.projectId)!;
        invariant(employee, '旧工作流的项目员工不存在');
        if (!state.templates.some(entry => entry.id === employee.templateId)) state.templates.push({
          id: employee.templateId, name: employee.templateName, description: '', version: employee.templateVersion,
          status: 'ready', modules: structuredClone(employee.modules), createdAt: employee.createdAt, updatedAt: employee.updatedAt,
        });
        const manager = team.members.find(entry => entry.employeeId === employee.managerId);
        return { memberId: member.memberId, templateId: employee.templateId, name: employee.name, ...(manager ? { reportsTo: manager.memberId } : {}) };
      });
      template = { id: instance.workflowTemplateId, name: workflow.name, description: '', version: instance.workflowTemplateVersion,
        roles: members.map(member => ({ id: member.memberId, memberId: member.memberId, name: member.name })),
        team: { sourceTeamId: instance.sourceTeamId, sourceTeamVersion: instance.sourceTeamVersion, name: team.name, knowledgeEnabled: team.knowledgeEnabled ?? true, members },
        steps: workflow.steps.map(({ employeeId, ...step }) => {
          const member = team.members.find(entry => entry.employeeId === employeeId); invariant(member, '旧工作流负责人不属于团队');
          return { ...structuredClone(step), roleId: member.memberId };
        }), ...(workflow.maxAttempts !== undefined ? { maxAttempts: workflow.maxAttempts } : {}),
        createdAt: instance.createdAt, updatedAt: instance.updatedAt };
      templates.push(template);
    }
    instance.definitionSource = 'library';
    if (!template || template.version !== instance.workflowTemplateVersion) {
      invariant(!state.runs.some(run => run.conversationWorkflow?.instanceId === instance.id && ['queued', 'running', 'blocked'].includes(run.status)), '此工作流正在执行，请结束本轮后再修改或移除定义');
      invariant(!state.workflowRuns?.some(run => run.projectTeamId === team.id && !['succeeded', 'cancelled'].includes(run.status)), '此工作流正在执行，请结束本轮后再修改或移除定义');
    }
    if (!template || template.version === instance.workflowTemplateVersion) continue;
    invariant(template.team && template.steps.length, '引用中的工作流必须保留团队和至少一个步骤');
    const at = new Date().toISOString();
    const bindings = new Map(team.members.map(member => [member.memberId, member.employeeId]));
    const members = template.team.members.map(member => {
      let employee = state.employees.find(entry => entry.id === bindings.get(member.memberId));
      if (employee && employee.templateId !== member.templateId) {
        invariant(!state.runs.some(run => run.conversationWorkflow?.instanceId === instance.id && run.employeeId === employee!.id), '已有交付的团队成员不能替换，请新增成员');
        employee = undefined;
      }
      if (!employee) { employee = createEmployee({ projectId: instance.projectId, templateId: member.templateId, ...(member.name ? { name: member.name } : {}) }, team.id); employee.status = team.status === 'cancelled' ? 'paused' : 'active'; }
      bindings.set(member.memberId, employee.id);
      return { memberId: member.memberId, employeeId: employee.id };
    });
    for (const old of team.members) if (!members.some(member => member.employeeId === old.employeeId)) invariant(!state.runs.some(run => run.conversationWorkflow?.instanceId === instance.id && run.employeeId === old.employeeId), '已有交付的团队成员不能移除，请保留历史成员');
    const steps = template.steps.map(({ roleId, ...step }) => {
      const member = template.roles.find(role => role.id === roleId)?.memberId;
      invariant(member && bindings.has(member), '步骤负责人不属于工作流团队');
      return { ...structuredClone(step), employeeId: bindings.get(member)! };
    });
    for (const run of state.runs.filter(run => run.conversationWorkflow?.instanceId === instance.id)) {
      const next = steps.find(step => step.id === run.conversationWorkflow!.stepId);
      invariant(next && (run.parentRunId || next.employeeId === run.employeeId), '已有交付的步骤不能移除或更换负责人，请新增步骤');
    }
    const contract = (step: ProjectWorkflow['steps'][number]) => JSON.stringify([step.instruction, step.inputs ?? [], step.outputs ?? [], step.acceptanceCriteria ?? [], step.timeoutMs, step.onRejectStepId, step.employeeId]);
    const changedAt = steps.findIndex((step, index) => { const old = workflow.steps.find(entry => entry.id === step.id); return !old || workflow.steps[index]?.id !== step.id || contract(old) !== contract(step); });
    if (changedAt >= 0) for (const completion of instance.completions) if (!completion.invalidatedAt && steps.findIndex(step => step.id === completion.stepId) >= changedAt) {
      completion.invalidatedAt = at; completion.invalidationReason = '工作流定义已更新，需要重新验证';
    }
    for (const member of template.team.members) {
      const employee = state.employees.find(entry => entry.id === bindings.get(member.memberId))!;
      const managerId = member.reportsTo ? bindings.get(member.reportsTo) : undefined;
      if (employee.managerId !== managerId) { if (managerId) employee.managerId = managerId; else delete employee.managerId; employee.version++; employee.updatedAt = at; }
    }
    team.members = members; team.name = template.team.name; team.teamTemplateVersion = template.team.sourceTeamVersion;
    team.version = (team.version ?? 1) + 1; team.updatedAt = at;
    workflow.name = template.name; workflow.steps = steps; workflow.version = (workflow.version ?? 1) + 1;
    if (template.maxAttempts !== undefined) workflow.maxAttempts = template.maxAttempts; else delete workflow.maxAttempts;
    workflow.templateWorkflowVersion = template.version;
    instance.workflowTemplateVersion = template.version; instance.sourceTeamId = template.team.sourceTeamId; instance.sourceTeamVersion = template.team.sourceTeamVersion;
    if (!instance.currentStepId || !steps.some(step => step.id === instance.currentStepId)) instance.currentStepId = steps.find(step => !instance.completions.some(item => item.stepId === step.id && !item.invalidatedAt))?.id;
    instance.version++; instance.updatedAt = at;
  }
}

/** Projection is the only source of chat routing and of the gray/white/blue step strip. */
export function resolveConversationWorkflow(state: WorkforceState, projectId: string, sessionId: string): ConversationWorkflowView {
  const { selection, instance } = currentInstance(state, projectId, sessionId);
  const base: ConversationWorkflowView = { projectId, sessionId, selection: selection ? 'override' : 'inherit',
    instanceId: instance?.id ?? null, steps: [], activeEmployeeIds: [], relatedOwnerIds: [], choices: conversationWorkflowChoices(state, projectId) };
  if (!instance) return base;
  const { team, workflow } = installationDefinition(state, instance);
  const completed = new Set(instance.completions.filter(entry => !entry.invalidatedAt).map(entry => entry.stepId));
  const step = workflow.steps.find(entry => entry.id === instance.currentStepId);
  const owner = step ? state.employees.find(entry => entry.projectId === projectId && entry.id === step.employeeId && entry.status === 'active') : undefined;
  const unavailableReason = instance.definitionSource && !state.workflowTemplates?.some(template => template.id === instance.workflowTemplateId) ? '工作流定义已从库中移除，请选择其他工作流或无'
    : team.status === 'cancelled' ? '此工作流的项目团队已停用' : step && !owner ? '当前步骤负责人已暂停' : undefined;
  return { ...base, instanceId: instance.id, instanceVersion: instance.version, workflowTemplateId: instance.workflowTemplateId,
    workflowTemplateVersion: instance.workflowTemplateVersion, name: workflow.name, projectTeamId: team.id, workflowId: workflow.id,
    ...(instance.currentStepId ? { currentStepId: instance.currentStepId } : {}),
    steps: workflow.steps.map(entry => ({ ...structuredClone(entry), status: entry.id === instance.currentStepId ? 'current' : completed.has(entry.id) ? 'completed' : 'pending' })),
    ...(!unavailableReason && owner ? { owner: structuredClone(owner), activeEmployeeIds: descendants(state, projectId, owner.id, team) } : {}),
    relatedOwnerIds: [...new Set(workflow.steps.map(entry => entry.employeeId))].filter(id => id !== owner?.id && state.employees.some(entry => entry.id === id && entry.projectId === projectId && entry.status === 'active')),
    ...(unavailableReason ? { unavailableReason } : {}) };
}

/** Install a detached workflow roster atomically, without adopting or altering an older project team. */
function install(state: WorkforceState, input: SelectConversationWorkflowInput,
  createEmployee: (input: CreateEmployeeInput, teamId: string) => ProjectEmployee): ConversationWorkflowInstance {
  invariant(state.workflowTemplates?.some(template => template.id === input.workflowTemplateId), '工作流不存在，请刷新后重新选择');
  const existing = state.conversationWorkflows?.instances.find(entry => entry.projectId === input.projectId && entry.workflowTemplateId === input.workflowTemplateId);
  if (existing) { invariant(installationDefinition(state, existing).team.status !== 'cancelled', '此工作流的项目团队已停用'); return existing; }
  const template = state.workflowTemplates?.find(entry => entry.id === input.workflowTemplateId);
  invariant(template, '工作流不存在，请刷新后重新选择');
  if (template.version !== input.workflowTemplateVersion) throw new WorkforceError('CONFLICT', '工作流已更新，请刷新后重新选择');
  const unavailable = unavailableSource(state, template); invariant(!unavailable, unavailable ?? '工作流不可用');
  const snapshot = template.team!;
  invariant(input.templateVersions && typeof input.templateVersions === 'object' && !Array.isArray(input.templateVersions), '请选择当前版本的工作流人员');
  for (const member of snapshot.members) {
    const employee = state.templates.find(entry => entry.id === member.templateId)!;
    if (input.templateVersions[employee.id] !== employee.version) throw new WorkforceError('CONFLICT', `“${employee.name}”已更新，请刷新后重新选择工作流`);
  }
  const at = new Date().toISOString();
  const originalTeam = state.teams.find(team => team.id === snapshot.sourceTeamId && team.version === snapshot.sourceTeamVersion);
  const knowledgeEnabled = snapshot.knowledgeEnabled ?? (originalTeam ? originalTeam.knowledgeEnabled ?? true : false);
  const team: ProjectTeam = { id: randomUUID(), projectId: input.projectId, teamTemplateId: `conversation-workflow:${template.id}`,
    teamTemplateVersion: snapshot.sourceTeamVersion, name: snapshot.name, knowledgeEnabled, status: 'active', version: 1,
    members: [], workflows: [], createdAt: at, updatedAt: at };
  const members = new Map<string, ProjectEmployee>();
  for (const member of snapshot.members) {
    const employee = createEmployee({ projectId: input.projectId, templateId: member.templateId, ...(member.name ? { name: member.name } : {}) }, team.id);
    // Selection explicitly enables the installed roster; the active step still limits delegation.
    employee.status = 'active'; members.set(member.memberId, employee);
    team.members.push({ memberId: member.memberId, employeeId: employee.id });
  }
  for (const member of snapshot.members) if (member.reportsTo) members.get(member.memberId)!.managerId = members.get(member.reportsTo)!.id;
  const workflow: ProjectWorkflow = { id: randomUUID(), templateWorkflowId: template.id, templateWorkflowVersion: template.version,
    name: template.name, version: 1, ...(template.maxAttempts !== undefined ? { maxAttempts: template.maxAttempts } : {}),
    steps: template.steps.map(({ roleId, ...step }) => {
      const memberId = template.roles.find(role => role.id === roleId)?.memberId;
      invariant(memberId && members.has(memberId), '步骤负责人不属于工作流团队');
      return { ...structuredClone(step), employeeId: members.get(memberId)!.id };
    }) };
  team.workflows.push(workflow); (state.projectTeams ??= []).push(team);
  const instance: ConversationWorkflowInstance = { id: randomUUID(), projectId: input.projectId, workflowTemplateId: template.id,
    workflowTemplateVersion: template.version, sourceTeamId: snapshot.sourceTeamId, sourceTeamVersion: snapshot.sourceTeamVersion,
    projectTeamId: team.id, workflowId: workflow.id, currentStepId: workflow.steps[0]!.id, completions: [], definitionSource: 'library', version: 1, createdAt: at, updatedAt: at };
  state.conversationWorkflows!.instances.push(instance); return instance;
}
export function selectConversationWorkflow(state: WorkforceState, input: SelectConversationWorkflowInput,
  createEmployee: (input: CreateEmployeeInput, teamId: string) => ProjectEmployee): ConversationWorkflowView {
  textField(input.projectId, '项目 ID'); textField(input.sessionId, '对话 ID');
  invariant(state.projects.some(entry => entry.id === input.projectId), '项目不存在');
  invariant(input.workflowTemplateId === null || (typeof input.workflowTemplateId === 'string' && input.workflowTemplateId.trim()), '工作流选择无效');
  const configuration = state.conversationWorkflows ??= { instances: [], defaults: [], selections: [] };
  // A native conversation must never acquire two project identities in plugin persistence.
  invariant(!configuration.selections.some(entry => entry.sessionId === input.sessionId && entry.projectId !== input.projectId), '对话属于其他项目');
  const instance = input.workflowTemplateId === null ? undefined : install(state, input, createEmployee);
  if (instance && !configuration.defaults.some(entry => entry.projectId === input.projectId)) {
    configuration.defaults.push({ projectId: input.projectId, instanceId: instance.id });
    // The first workflow choice unifies this project, including earlier explicit “无” chats.
    // Once a default exists, later choices remain per-conversation overrides.
    configuration.selections = configuration.selections.filter(entry => entry.projectId !== input.projectId);
  }
  const previous = configuration.selections.find(entry => entry.projectId === input.projectId && entry.sessionId === input.sessionId);
  const selected = { projectId: input.projectId, sessionId: input.sessionId, instanceId: instance?.id ?? null };
  if (previous) configuration.selections[configuration.selections.indexOf(previous)] = selected; else configuration.selections.push(selected);
  return resolveConversationWorkflow(state, input.projectId, input.sessionId);
}
export function selectConversationWorkflowStep(state: WorkforceState, input: SelectConversationWorkflowStepInput): ConversationWorkflowView {
  textField(input.projectId, '项目 ID'); textField(input.sessionId, '对话 ID'); textField(input.stepId, '步骤 ID');
  invariant(state.projects.some(entry => entry.id === input.projectId), '项目不存在');
  invariant(!state.conversationWorkflows?.selections.some(entry => entry.sessionId === input.sessionId && entry.projectId !== input.projectId), '对话属于其他项目');
  const { instance } = currentInstance(state, input.projectId, input.sessionId); invariant(instance, '当前对话没有选择工作流');
  invariant(!instance.definitionSource || state.workflowTemplates?.some(template => template.id === instance.workflowTemplateId), '工作流定义已从库中移除，请选择其他工作流或无');
  if (instance.version !== input.instanceVersion) throw new WorkforceError('CONFLICT', '工作流进度已更新，请刷新后重试');
  const { team, workflow } = installationDefinition(state, instance);
  invariant(team.status !== 'cancelled', '此工作流的项目团队已停用');
  invariant(!state.runs.some(run => run.conversationWorkflow?.instanceId === instance.id && ['queued', 'running', 'blocked'].includes(run.status)), '当前工作流仍在执行，请等待本轮结束再切换步骤');
  invariant(workflow.steps.some(step => step.id === input.stepId), '步骤不属于当前工作流');
  instance.currentStepId = input.stepId; instance.version++; instance.updatedAt = new Date().toISOString();
  return resolveConversationWorkflow(state, input.projectId, input.sessionId);
}

/** Validate before reserving a model run; link identity cannot be supplied as a grant. */
export function validateConversationWorkflowRun(state: WorkforceState, input: { projectId: string; employeeId: string; parentRunId?: string; conversationWorkflow?: ConversationWorkflowRunLink }): void {
  const link = input.conversationWorkflow; if (!link) return;
  textField(link.instanceId, '对话工作流实例'); textField(link.stepId, '对话工作流步骤');
  const instance = state.conversationWorkflows?.instances.find(entry => entry.id === link.instanceId && entry.projectId === input.projectId);
  invariant(instance, '对话工作流不属于当前项目');
  invariant(!instance.definitionSource || state.workflowTemplates?.some(template => template.id === instance.workflowTemplateId), '工作流定义已从库中移除，请选择其他工作流或无');
  const { team, workflow } = installationDefinition(state, instance); invariant(team.status !== 'cancelled', '此工作流的项目团队已停用');
  const step = workflow.steps.find(entry => entry.id === link.stepId); invariant(step, '对话工作流步骤不存在');
  if (input.parentRunId) {
    const parent = state.runs.find(entry => entry.id === input.parentRunId && entry.projectId === input.projectId);
    invariant(parent?.conversationWorkflow?.instanceId === link.instanceId && parent.conversationWorkflow.stepId === link.stepId, '子任务必须保留原对话工作流步骤');
    invariant(team.members.some(entry => entry.employeeId === input.employeeId), '不能委派工作流团队以外的人员');
  } else {
    invariant(instance.currentStepId === link.stepId, '当前步骤已经切换，请重新发送消息');
    invariant(step.employeeId === input.employeeId, '消息必须交给当前步骤负责人');
  }
}
/** Only a trusted accepted owner delivery can whiten a step. Selecting a step never does. */
export function reviewConversationWorkflowRun(state: WorkforceState, run: WorkforceRun): void {
  const link = run.conversationWorkflow; if (!link || run.parentRunId || !run.acceptance) return;
  const instance = state.conversationWorkflows?.instances.find(entry => entry.id === link.instanceId && entry.projectId === run.projectId);
  invariant(instance, '对话工作流实例不存在');
  const { workflow } = installationDefinition(state, instance);
  const index = workflow.steps.findIndex(entry => entry.id === link.stepId); const step = workflow.steps[index]!;
  invariant(step && step.employeeId === run.employeeId, '只有步骤负责人交付可以更新工作流进度');
  invariant(instance.currentStepId === step.id, '当前步骤已切换，请先返回该步骤再验收交付');
  invariant(!state.runs.some(other => other.id !== run.id && other.conversationWorkflow?.instanceId === instance.id && ['queued', 'running', 'blocked'].includes(other.status)), '工作流还有执行中的任务，请等待本轮及委派结束后再验收');
  const at = run.acceptance.at;
  if (run.acceptance.decision === 'accepted') {
    if (!instance.completions.some(entry => entry.runId === run.id)) instance.completions.push({ stepId: step.id, runId: run.id, acceptedAt: at });
    if (instance.currentStepId === step.id) {
      const completed = new Set(instance.completions.filter(entry => !entry.invalidatedAt).map(entry => entry.stepId));
      const next = workflow.steps.slice(index + 1).find(entry => !completed.has(entry.id)) ?? workflow.steps.find(entry => !completed.has(entry.id));
      if (next) instance.currentStepId = next.id; else delete instance.currentStepId;
    }
  } else {
    const destination = step.onRejectStepId ?? step.id;
    const returnIndex = workflow.steps.findIndex(entry => entry.id === destination);
    const invalidated = new Set(workflow.steps.slice(returnIndex).map(entry => entry.id));
    for (const completion of instance.completions) if (!completion.invalidatedAt && invalidated.has(completion.stepId)) {
      completion.invalidatedAt = at; completion.invalidationReason = `步骤“${step.name}”验收未通过：${run.id}`;
    }
    if (instance.currentStepId === step.id) instance.currentStepId = destination;
  }
  instance.version++; instance.updatedAt = at;
}

export function validateConversationWorkflows(state: WorkforceState): void {
  const configuration = state.conversationWorkflows; if (configuration === undefined) {
    invariant(!state.runs.some(run => run.conversationWorkflow), '对话工作流运行缺少配置'); return;
  }
  invariant(configuration !== null && typeof configuration === 'object' && !Array.isArray(configuration), '对话工作流配置无效');
  for (const key of ['instances', 'defaults', 'selections'] as const) invariant(Array.isArray(configuration[key]), '对话工作流配置列表无效');
  const ids = new Set<string>(); const pairs = new Set<string>();
  for (const instance of configuration.instances) {
    invariant(instance !== null && typeof instance === 'object', '对话工作流实例无效');
    invariant(instance.definitionSource === undefined || instance.definitionSource === 'library', '工作流定义来源无效');
    for (const key of ['id', 'projectId', 'workflowTemplateId', 'sourceTeamId', 'projectTeamId', 'workflowId', 'createdAt', 'updatedAt'] as const) textField(instance[key], `对话工作流 ${key}`);
    invariant(!ids.has(instance.id), '对话工作流实例重复'); ids.add(instance.id);
    const pair = JSON.stringify([instance.projectId, instance.workflowTemplateId]); invariant(!pairs.has(pair), '同项目工作流重复安装'); pairs.add(pair);
    invariant(state.projects.some(project => project.id === instance.projectId), '对话工作流项目不存在');
    for (const key of ['version', 'workflowTemplateVersion', 'sourceTeamVersion'] as const) invariant(Number.isSafeInteger(instance[key]) && instance[key] > 0, '对话工作流版本无效');
    invariant(Number.isFinite(Date.parse(instance.createdAt)) && Number.isFinite(Date.parse(instance.updatedAt)), '对话工作流时间无效');
    const { team, workflow } = installationDefinition(state, instance);
    invariant(team.teamTemplateId === `conversation-workflow:${instance.workflowTemplateId}` && workflow.templateWorkflowId === instance.workflowTemplateId
      && workflow.templateWorkflowVersion === instance.workflowTemplateVersion, '对话工作流冻结副本不匹配');
    if (instance.currentStepId !== undefined) invariant(workflow.steps.some(step => step.id === instance.currentStepId), '对话工作流当前步骤不存在');
    invariant(Array.isArray(instance.completions), '对话工作流完成记录无效');
    const runs = new Set<string>();
    for (const completion of instance.completions) {
      invariant(completion !== null && typeof completion === 'object' && !runs.has(completion.runId), '对话工作流完成记录重复'); runs.add(completion.runId);
      invariant(workflow.steps.some(step => step.id === completion.stepId), '完成记录步骤不存在');
      const run = state.runs.find(entry => entry.id === completion.runId);
      invariant(run?.projectId === instance.projectId && !run.parentRunId && run.status === 'succeeded' && run.acceptance?.decision === 'accepted'
        && run.conversationWorkflow?.instanceId === instance.id && run.conversationWorkflow.stepId === completion.stepId
        && run.employeeId === workflow.steps.find(step => step.id === completion.stepId)?.employeeId && completion.acceptedAt === run.acceptance.at
        && (run.artifacts.length > 0 || Boolean(run.output?.trim())), '完成记录必须引用负责人已验收交付');
      invariant(Number.isFinite(Date.parse(completion.acceptedAt)), '步骤验收时间无效');
      if (completion.invalidatedAt !== undefined) { invariant(Number.isFinite(Date.parse(completion.invalidatedAt)), '步骤失效时间无效'); textField(completion.invalidationReason, '步骤失效原因'); }
      else invariant(completion.invalidationReason === undefined, '步骤失效原因缺少时间');
    }
  }
  const projects = new Set<string>();
  for (const entry of configuration.defaults) {
    invariant(entry !== null && typeof entry === 'object', '项目默认工作流无效'); textField(entry.projectId, '默认工作流项目');
    invariant(!projects.has(entry.projectId) && configuration.instances.some(instance => instance.id === entry.instanceId && instance.projectId === entry.projectId), '项目默认工作流重复或归属无效'); projects.add(entry.projectId);
  }
  const sessions = new Set<string>();
  for (const entry of configuration.selections) {
    invariant(entry !== null && typeof entry === 'object', '对话工作流选择无效'); textField(entry.projectId, '对话项目'); textField(entry.sessionId, '对话 ID');
    invariant(!sessions.has(entry.sessionId) && state.projects.some(project => project.id === entry.projectId), '对话选择重复或项目不存在'); sessions.add(entry.sessionId);
    invariant(entry.instanceId === null || configuration.instances.some(instance => instance.id === entry.instanceId && instance.projectId === entry.projectId), '对话工作流选择不能跨项目');
  }
  for (const run of state.runs) if (run.conversationWorkflow) {
    invariant(!run.workflow && !run.workTaskId, '对话工作流不能混用其他执行器');
    const instance = configuration.instances.find(entry => entry.id === run.conversationWorkflow!.instanceId && entry.projectId === run.projectId);
    invariant(instance, '运行的对话工作流归属无效');
    const { team, workflow } = installationDefinition(state, instance);
    invariant(team.members.some(member => member.employeeId === run.employeeId) && workflow.steps.some(step => step.id === run.conversationWorkflow!.stepId), '运行的对话工作流步骤或人员无效');
    if (!run.parentRunId) invariant(workflow.steps.find(step => step.id === run.conversationWorkflow!.stepId)?.employeeId === run.employeeId, '对话工作流运行负责人不匹配');
    else {
      const parent = state.runs.find(entry => entry.id === run.parentRunId);
      invariant(parent?.conversationWorkflow?.instanceId === instance.id && parent.conversationWorkflow.stepId === run.conversationWorkflow.stepId, '对话工作流子任务链接不匹配');
    }
  }
}
