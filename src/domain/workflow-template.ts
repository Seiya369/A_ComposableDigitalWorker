import type { TeamTemplate, WorkflowRole, WorkflowTemplate } from './types.js';
import { invariant, textField } from './errors.js';
import { remapWorkflowStepIds, validateWorkflows } from '../workflow/definition.js';

/** Unused historical roles remain stored but do not require an execution binding. */
export function usedWorkflowRoles(workflow: Pick<WorkflowTemplate, 'roles' | 'steps'>): WorkflowRole[] {
  const used = new Set(workflow.steps.map(step => step.roleId));
  return workflow.roles.filter(role => used.has(role.id));
}

export function validateWorkflowTemplates(templates: unknown): asserts templates is WorkflowTemplate[] {
  invariant(Array.isArray(templates), '通用工作流必须为数组');
  const ids = new Set<string>();
  for (const template of templates as WorkflowTemplate[]) {
    invariant(template !== null && typeof template === 'object', '通用工作流必须为对象');
    textField(template.id, '工作流 ID'); invariant(!ids.has(template.id), '通用工作流 ID 重复'); ids.add(template.id);
    textField(template.name, '工作流名称'); textField(template.description, '工作流描述', true);
    invariant(Number.isSafeInteger(template.version) && template.version > 0, '工作流版本无效');
    for (const field of ['createdAt', 'updatedAt'] as const) invariant(typeof template[field] === 'string' && Number.isFinite(Date.parse(template[field])), '工作流时间无效');
    invariant(Array.isArray(template.roles) && template.roles.length > 0 && template.roles.length <= 50, '工作流需要 1–50 个岗位');
    const roles = new Set<string>();
    const members = new Map<string, string | undefined>();
    if (template.team !== undefined) {
      const team = template.team;
      invariant(team !== null && typeof team === 'object' && !Array.isArray(team), '工作流团队必须为对象');
      textField(team.sourceTeamId, '来源团队'); textField(team.name, '工作流团队名称');
      invariant(Number.isSafeInteger(team.sourceTeamVersion) && team.sourceTeamVersion > 0, '来源团队版本无效');
      if (team.knowledgeEnabled !== undefined) invariant(typeof team.knowledgeEnabled === 'boolean', '工作流团队资料管理员开关必须为布尔值');
      invariant(Array.isArray(team.members) && team.members.length > 0 && team.members.length <= 50, '工作流团队需要 1–50 位成员');
      for (const member of team.members) {
        invariant(member !== null && typeof member === 'object' && !Array.isArray(member), '工作流团队成员无效');
        textField(member.memberId, '团队成员 ID'); textField(member.templateId, '团队成员模板');
        if (member.name !== undefined) textField(member.name, '团队成员名称');
        if (member.reportsTo !== undefined) textField(member.reportsTo, '团队上一级');
        invariant(!members.has(member.memberId), '工作流团队成员 ID 重复'); members.set(member.memberId, member.reportsTo);
      }
      for (const id of members.keys()) {
        const seen = new Set<string>(); let cursor: string | undefined = id;
        while (cursor !== undefined) { invariant(members.has(cursor) && !seen.has(cursor), '工作流团队上级不存在或组织关系有循环'); seen.add(cursor); cursor = members.get(cursor); }
      }
    }
    for (const role of template.roles) {
      invariant(role !== null && typeof role === 'object', '工作流岗位必须为对象');
      textField(role.id, '岗位 ID'); textField(role.name, '岗位名称');
      if (role.description !== undefined) textField(role.description, '岗位说明', true);
      if (role.memberId !== undefined) { textField(role.memberId, '负责人团队成员'); invariant(members.has(role.memberId), '负责人不在引入的团队中'); }
      invariant(!roles.has(role.id), '工作流岗位 ID 重复'); roles.add(role.id);
    }
    invariant(Array.isArray(template.steps), '工作流步骤必须为数组');
    for (const step of template.steps) {
      invariant(roles.has(step.roleId), '工作流引用的岗位不存在');
      if (template.team) invariant(template.roles.some(role => role.id === step.roleId && role.memberId && members.has(role.memberId)), '步骤负责人不在引入的团队中');
    }
    validateWorkflows([{ ...template, steps: template.steps.map(step => ({ ...step, memberId: step.roleId })) }], 'memberId', roles);
  }
}

export function bindWorkflow(team: TeamTemplate, workflow: WorkflowTemplate, bindings: Record<string, string>): void {
  invariant(bindings !== null && typeof bindings === 'object' && !Array.isArray(bindings), '工作流岗位映射必须为对象');
  const roles = new Set(workflow.roles.map(role => role.id));
  invariant(Object.keys(bindings).every(key => roles.has(key)), '工作流岗位映射包含未知岗位');
  for (const role of usedWorkflowRoles(workflow)) invariant(team.members.some(member => member.memberId === bindings[role.id]), '工作流岗位必须绑定本团队成员');
  (team.workflows ??= []).push({
    id: globalThis.crypto.randomUUID(), name: workflow.name, sourceTemplateId: workflow.id, sourceTemplateVersion: workflow.version,
    ...(workflow.maxAttempts !== undefined ? { maxAttempts: workflow.maxAttempts } : {}),
    steps: remapWorkflowStepIds(workflow.steps.map(({ roleId, ...step }) => ({ ...step, memberId: bindings[roleId]! })), () => globalThis.crypto.randomUUID()),
  });
}
