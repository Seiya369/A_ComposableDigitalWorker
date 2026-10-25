import { randomUUID } from 'node:crypto';
import type { CancelProjectTeamsInput, ConfigureProjectTeamInput, CreateEmployeeInput, ProjectEmployee, ProjectTeam, WorkforceState } from './types.js';
import { invariant, textField, WorkforceError } from './validation.js';
import { cancelWorkflow } from '../workflow/cancel.js';

/** Called inside the store's single transaction, so employees and workflows commit together. */
export function installProjectTeam(
  state: WorkforceState,
  input: ConfigureProjectTeamInput,
  createEmployee: (input: CreateEmployeeInput, teamInstanceId: string) => ProjectEmployee,
): ProjectTeam {
  textField(input.projectId, '项目 ID');
  textField(input.teamId, '团队 ID');
  invariant(state.projects.some(project => project.id === input.projectId), '项目不存在');
  const installed = state.projectTeams?.find(team => team.projectId === input.projectId && team.teamTemplateId === input.teamId);
  // A lost response, repeated click or restart must return the original installation.
  if (installed?.status === 'cancelled') {
    if (input.restoreVersion !== installed.version) throw new WorkforceError('CONFLICT', '此团队已取消，请重新选择团队以恢复配置');
    invariant(!state.runs.some(run => installed.members.some(member => member.employeeId === run.employeeId) && ['queued', 'running', 'blocked'].includes(run.status)), '团队任务正在停止，请稍后恢复');
    const date = new Date().toISOString();
    for (const member of installed.members) {
      const employee = state.employees.find(employee => employee.id === member.employeeId)!;
      employee.status = installed.resumeEmployeeIds?.includes(employee.id) ? 'active' : 'paused';
      employee.version++; employee.updatedAt = date;
    }
    installed.status = 'active'; installed.version = (installed.version ?? 1) + 1; installed.updatedAt = date;
    delete installed.cancelledAt; delete installed.resumeEmployeeIds;
    return installed;
  }
  if (installed) return installed;
  invariant(input.restoreVersion === undefined, '项目团队已不存在，无法恢复旧配置');
  const template = state.teams.find(team => team.id === input.teamId);
  invariant(template, '团队不存在，请刷新后重新选择');
  if (template.version !== input.teamVersion) throw new WorkforceError('CONFLICT', '团队已更新，请刷新后重新选择');
  invariant(template.members.length > 0 && template.members.length <= 50, '团队需要包含 1–50 位员工');
  invariant(input.templateVersions && typeof input.templateVersions === 'object' && !Array.isArray(input.templateVersions), '员工模板版本无效');
  for (const member of template.members) {
    const employeeTemplate = state.templates.find(employee => employee.id === member.templateId);
    invariant(employeeTemplate && employeeTemplate.status !== 'archived', '团队含有已归档或不存在的员工，请先调整团队');
    if (employeeTemplate.version !== input.templateVersions[member.templateId]) throw new WorkforceError('CONFLICT', `“${employeeTemplate.name}”已更新，请刷新后重新选择团队`);
  }

  const date = new Date().toISOString();
  const team: ProjectTeam = {
    id: randomUUID(), projectId: input.projectId, teamTemplateId: template.id,
    teamTemplateVersion: template.version, name: template.name, knowledgeEnabled: template.knowledgeEnabled ?? true, status: 'active', version: 1,
    members: [], workflows: [], createdAt: date, updatedAt: date,
  };
  const assignedIds = new Set(state.projectTeams?.flatMap(team => team.members.map(member => member.employeeId)) ?? []);
  const members = new Map<string, ProjectEmployee>();
  for (const member of template.members) {
    // Adopt an unambiguous legacy employee to preserve their project permissions and memory.
    // Repeated roles or several existing instances are deliberately not guessed at.
    const candidates = state.employees.filter(employee => employee.projectId === input.projectId
      && employee.templateId === member.templateId && !assignedIds.has(employee.id));
    const uniqueRole = template.members.filter(other => other.templateId === member.templateId).length === 1;
    const existing = uniqueRole && candidates.length === 1 ? candidates[0] : undefined;
    if (existing && state.runs.some(run => run.employeeId === existing.id && ['queued', 'running', 'blocked'].includes(run.status))) {
      throw new WorkforceError('CONFLICT', `“${existing.name}”正在执行任务，请完成后再配置团队`);
    }
    const employee = existing ?? createEmployee({ projectId: input.projectId, templateId: member.templateId, ...(member.name ? { name: member.name } : {}) }, team.id);
    if (existing) { employee.teamInstanceId = team.id; employee.version++; employee.updatedAt = date; }
    assignedIds.add(employee.id);
    delete employee.legacyTeamKnowledgeEnabled;
    members.set(member.memberId, employee);
    team.members.push({ memberId: member.memberId, employeeId: employee.id });
  }
  for (const member of template.members) {
    const employee = members.get(member.memberId)!;
    if (member.reportsTo) employee.managerId = members.get(member.reportsTo)!.id;
    else delete employee.managerId;
  }
  team.workflows = (template.workflows ?? []).map(workflow => ({
    id: randomUUID(), templateWorkflowId: workflow.id, ...(workflow.sourceTemplateVersion !== undefined ? { templateWorkflowVersion: workflow.sourceTemplateVersion } : {}), name: workflow.name, version: 1, maxAttempts: workflow.maxAttempts ?? 3,
    steps: workflow.steps.map(({ memberId, ...step }) => ({ ...step, employeeId: members.get(memberId)!.id })),
  }));
  (state.projectTeams ??= []).push(team);
  return team;
}

/** Team-level gate also applies to legacy memory compatibility paths. */
export function projectTeamKnowledgeEnabled(state: WorkforceState, employee: Pick<ProjectEmployee, 'id' | 'projectId'>): boolean {
  const team = state.projectTeams?.find(team => team.projectId === employee.projectId && team.members.some(member => member.employeeId === employee.id));
  if (team) return team.status !== 'cancelled' && team.knowledgeEnabled !== false;
  const current = state.employees.find(member => member.id === employee.id && member.projectId === employee.projectId);
  if (!current?.teamInstanceId) return true;
  return state.employees.filter(member => member.projectId === current.projectId && member.teamInstanceId === current.teamInstanceId).every(member => member.legacyTeamKnowledgeEnabled !== false);
}

/** Cancel only the selected installation versions; preserve all snapshots, memories and history. */
export function cancelProjectTeams(state: WorkforceState, input: CancelProjectTeamsInput): { runIds: string[] } {
  textField(input.projectId, '项目 ID');
  invariant(Array.isArray(input.teams) && input.teams.length > 0, '请选择需要取消的项目团队');
  const ids = new Set<string>();
  const teams = input.teams.map(reference => {
    invariant(reference && typeof reference === 'object', '项目团队引用无效'); textField(reference.id, '项目团队 ID');
    invariant(!ids.has(reference.id), '项目团队重复'); ids.add(reference.id);
    const team = state.projectTeams?.find(team => team.id === reference.id && team.projectId === input.projectId);
    invariant(team, '团队不属于当前项目');
    const current = team.version ?? 1;
    if (!Number.isSafeInteger(reference.version) || (reference.version !== current && !(team.status === 'cancelled' && reference.version === current - 1))) throw new WorkforceError('CONFLICT', '项目团队已更新，请重新打开菜单');
    return team;
  });
  const employees = new Set(teams.flatMap(team => team.members.map(member => member.employeeId)));
  const runIds = state.runs.filter(run => employees.has(run.employeeId) && ['queued', 'running', 'blocked', 'awaiting-review'].includes(run.status)).map(run => run.id);
  const at = new Date().toISOString();
  for (const team of teams) if (team.status !== 'cancelled') {
    team.resumeEmployeeIds = state.employees.filter(employee => employees.has(employee.id) && team.members.some(member => member.employeeId === employee.id) && employee.status === 'active').map(employee => employee.id);
    team.status = 'cancelled'; team.version = (team.version ?? 1) + 1; team.cancelledAt = at; team.updatedAt = at;
    for (const member of team.members) {
      const employee = state.employees.find(employee => employee.id === member.employeeId)!;
      employee.status = 'paused'; employee.version++; employee.updatedAt = at;
    }
    for (const flow of state.workflowRuns ?? []) if (flow.projectTeamId === team.id) cancelWorkflow(state, flow, at, '项目团队已取消，工作流已停止');
  }
  for (const task of state.runs) if (runIds.includes(task.id) && ['queued', 'awaiting-review'].includes(task.status)) {
    task.status = 'cancelled'; task.version++; task.updatedAt = at; task.finishedAt = at;
  }
  return { runIds };
}
