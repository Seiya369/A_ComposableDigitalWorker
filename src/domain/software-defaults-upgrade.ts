import { createHash } from 'node:crypto';
import presets from '../../skills/software-development-presets.json' with { type: 'json' };
import { softwareKnowledgeSources } from '../knowledge/software-knowledge.js';
import { createSeedState, SOFTWARE_TEAM_ID } from './seed.js';
import type { EmployeeTemplate, TeamTemplate, WorkflowTemplate, WorkforceState } from './types.js';

/** Exact content signatures of package-owned 0.27/0.28 definitions, excluding top-level metadata. */
const legacySignatures: Record<string, string> = {
  'team-template-software': '5357a0b091c193c47f1e56202e3670a6053eb710cff12c81182cc984f6faf279',
  'workflow-template-software': 'efcc468ae5f19dc65857aaa8705998e01aae4133911ee30890b3a9eb2e15ef9f',
  'workflow-template-defect-repair': 'fbecbd5f85ff62106204f904ea3dd125ccd3e5d04ca2b0abe097a7373bea5004',
};
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}
function content(value: TeamTemplate | WorkflowTemplate): Record<string, unknown> {
  const { version, createdAt, updatedAt, ...body } = value;
  return body;
}
function untouchedLegacy(value: TeamTemplate | WorkflowTemplate | undefined): boolean {
  return !!value && value.version === 1 && createHash('sha256').update(JSON.stringify(canonical(content(value)))).digest('hex') === legacySignatures[value.id];
}
function definition(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(definition);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['version', 'sourceTeamVersion', 'sourceTemplateVersion', 'createdAt', 'updatedAt'].includes(key)).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, definition(entry)]));
}
function sameDefinition(left: unknown, right: unknown): boolean { return JSON.stringify(definition(left)) === JSON.stringify(definition(right)); }

/** Library synchronization is shared: refuse a global default change if it would alter an adopted custom or executed roster. */
function adoptedMainIsUntouched(state: WorkforceState, template: WorkflowTemplate): boolean {
  const snapshot = template.team;
  if (!snapshot) return false;
  for (const instance of state.conversationWorkflows?.instances.filter(value => value.workflowTemplateId === template.id) ?? []) {
    const team = state.projectTeams?.find(value => value.id === instance.projectTeamId && value.projectId === instance.projectId);
    const workflow = team?.workflows.find(value => value.id === instance.workflowId);
    if (!team || !workflow || instance.definitionSource !== 'library' || instance.workflowTemplateVersion !== template.version
      || instance.sourceTeamId !== snapshot.sourceTeamId || instance.sourceTeamVersion !== snapshot.sourceTeamVersion
      || instance.completions.length || team.status !== 'active' || (team.version ?? 1) !== 1
      || team.name !== snapshot.name || team.knowledgeEnabled !== snapshot.knowledgeEnabled
      || team.teamTemplateVersion !== snapshot.sourceTeamVersion || team.workflows.length !== 1
      || workflow.name !== template.name || (workflow.version ?? 1) !== 1 || workflow.maxAttempts !== template.maxAttempts
      || workflow.templateWorkflowVersion !== template.version || team.members.length !== snapshot.members.length) return false;
    const bindings = new Map(team.members.map(member => [member.memberId, member.employeeId]));
    const employeeIds = new Set(bindings.values());
    if (new Set(bindings.values()).size !== snapshot.members.length) return false;
    for (const member of snapshot.members) {
      const employee = state.employees.find(value => value.id === bindings.get(member.memberId));
      const source = state.templates.find(value => value.id === member.templateId);
      if (!employee || !source || employee.templateId !== member.templateId || employee.projectId !== instance.projectId
        || employee.teamInstanceId !== team.id || employee.status !== 'active' || employee.version !== 1
        || employee.templateVersion !== source.version || employee.name !== (member.name ?? source.name)
        || employee.managerId !== (member.reportsTo ? bindings.get(member.reportsTo) : undefined)
        || JSON.stringify(canonical(employee.modules)) !== JSON.stringify(canonical(source.modules))) return false;
    }
    if (state.runs.some(run => run.conversationWorkflow?.instanceId === instance.id || employeeIds.has(run.employeeId))
      || state.workflowRuns?.some(run => run.projectTeamId === team.id)
      || state.workState?.tasks.some(task => !!task.employeeId && employeeIds.has(task.employeeId))) return false;
    const expectedSteps = template.steps.map(({ roleId, ...step }) => {
      const memberId = template.roles.find(role => role.id === roleId)?.memberId;
      return { ...step, employeeId: memberId ? bindings.get(memberId) : undefined };
    });
    if (!sameDefinition(workflow.steps, expectedSteps)) return false;
  }
  return true;
}

export interface SoftwareDefaultsUpgradePlan {
  templateUpdates: EmployeeTemplate[];
  teamUpdate?: TeamTemplate;
  workflowUpdate?: WorkflowTemplate;
  removeWorkflowIds: string[];
  skipped: string[];
}

/**
 * Plan an explicit upgrade, never reseed on ordinary state opening. Custom library
 * definitions, existing sources and all adopted project instances/history are retained.
 * The caller owns the single durable transaction and any busy-workflow fences.
 */
export function planSoftwareDefaultsUpgrade(state: WorkforceState, now: string): SoftwareDefaultsUpgradePlan {
  const target = createSeedState(now);
  const plan: SoftwareDefaultsUpgradePlan = { templateUpdates: [], removeWorkflowIds: [], skipped: [] };
  for (const role of presets.roles) {
    const id = `employee-template-${role.role}`;
    const existing = state.templates.find(template => template.id === id);
    if (!existing || existing.status !== 'ready' || !existing.modules.capabilities.skills.some(skill => skill.id === role.required)) continue;
    const additions = softwareKnowledgeSources(role.role).filter(source => !existing.modules.knowledge.sources.some(saved => saved.id === source.id));
    if (!additions.length) continue;
    const update = structuredClone(existing);
    update.modules.knowledge.sources.push(...additions);
    update.version++; update.updatedAt = now;
    plan.templateUpdates.push(update);
  }

  const existingTeam = state.teams.find(team => team.id === SOFTWARE_TEAM_ID);
  const existingWorkflow = state.workflowTemplates?.find(flow => flow.id === 'workflow-template-software');
  const targetTeam = target.teams[0]!;
  const targetWorkflow = target.workflowTemplates![0]!;
  // A linked library pair changes together: do not replace a customized team or flow through the other half.
  if (untouchedLegacy(existingTeam) && untouchedLegacy(existingWorkflow) && adoptedMainIsUntouched(state, existingWorkflow!)) {
    const teamUpdate = { ...structuredClone(targetTeam), version: existingTeam!.version + 1, createdAt: existingTeam!.createdAt };
    const workflowUpdate = { ...structuredClone(targetWorkflow), version: existingWorkflow!.version + 1, createdAt: existingWorkflow!.createdAt };
    workflowUpdate.team!.sourceTeamVersion = teamUpdate.version;
    teamUpdate.workflows!.forEach(flow => { flow.sourceTemplateVersion = workflowUpdate.version; });
    plan.teamUpdate = teamUpdate;
    plan.workflowUpdate = workflowUpdate;
  } else {
    if (existingTeam && !sameDefinition(existingTeam, targetTeam)) plan.skipped.push('软件开发团已修改或不再是已知原始默认定义，保留现有团队。');
    if (existingWorkflow && !sameDefinition(existingWorkflow, targetWorkflow)) plan.skipped.push('软件工程工作流已修改或其团队不是已知原始默认定义，保留现有流程。');
    if (untouchedLegacy(existingWorkflow) && !adoptedMainIsUntouched(state, existingWorkflow!)) plan.skipped.push('软件工程已有执行记录或采用后的人员、层级或流程已修改，保留现有项目定义与历史。');
  }

  const defect = state.workflowTemplates?.find(flow => flow.id === 'workflow-template-defect-repair');
  if (defect) {
    const adopted = state.conversationWorkflows?.instances.some(instance => instance.workflowTemplateId === defect.id)
      || state.teams.some(team => (team.id !== SOFTWARE_TEAM_ID || !plan.teamUpdate) && team.workflows?.some(flow => flow.sourceTemplateId === defect.id));
    if (untouchedLegacy(defect) && !adopted) plan.removeWorkflowIds.push(defect.id);
    else plan.skipped.push('缺陷修复流程已修改或已被采用，保留其定义与历史。');
  }
  return plan;
}

/** Apply inside WorkforceStore.transaction: its normal library synchronizer updates eligible
 * adopted managerId/bindings to the new team, preserving employee IDs/modules and history.
 * Validate all versions before editing so a stale plan cannot partially apply in memory.
 */
export function applySoftwareDefaultsUpgrade(state: WorkforceState, plan: SoftwareDefaultsUpgradePlan): void {
  for (const update of plan.templateUpdates) if (state.templates.find(value => value.id === update.id)?.version !== update.version - 1) throw new Error('员工配置已变化，请重新规划默认内容更新。');
  if (plan.teamUpdate && !untouchedLegacy(state.teams.find(value => value.id === plan.teamUpdate!.id))) throw new Error('团队配置已变化，请重新规划默认内容更新。');
  if (plan.workflowUpdate) {
    const existing = state.workflowTemplates?.find(value => value.id === plan.workflowUpdate!.id);
    if (!untouchedLegacy(existing) || !adoptedMainIsUntouched(state, existing!)) throw new Error('工作流或项目采用状态已变化，请重新规划默认内容更新。');
  }
  for (const id of plan.removeWorkflowIds) if (!untouchedLegacy(state.workflowTemplates?.find(value => value.id === id))) throw new Error('待移除工作流已变化，请重新规划默认内容更新。');
  for (const update of plan.templateUpdates) state.templates[state.templates.findIndex(value => value.id === update.id)] = structuredClone(update);
  if (plan.teamUpdate) state.teams[state.teams.findIndex(value => value.id === plan.teamUpdate!.id)] = structuredClone(plan.teamUpdate);
  if (plan.workflowUpdate) state.workflowTemplates![state.workflowTemplates!.findIndex(value => value.id === plan.workflowUpdate!.id)] = structuredClone(plan.workflowUpdate);
  state.workflowTemplates = state.workflowTemplates?.filter(flow => !plan.removeWorkflowIds.includes(flow.id));
}
