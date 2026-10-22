import type { TeamTemplate, WorkflowTemplate } from './types.js';
import { invariant, textField } from './errors.js';
import { validateWorkflows } from '../workflow/definition.js';

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
    for (const role of template.roles) {
      invariant(role !== null && typeof role === 'object', '工作流岗位必须为对象');
      textField(role.id, '岗位 ID'); textField(role.name, '岗位名称');
      if (role.description !== undefined) textField(role.description, '岗位说明', true);
      invariant(!roles.has(role.id), '工作流岗位 ID 重复'); roles.add(role.id);
    }
    invariant(Array.isArray(template.steps), '工作流步骤必须为数组');
    for (const step of template.steps) invariant(roles.has(step.roleId), '工作流引用的岗位不存在');
    validateWorkflows([{ ...template, steps: template.steps.map(step => ({ ...step, memberId: step.roleId })) }], 'memberId', roles);
  }
}

export function bindWorkflow(team: TeamTemplate, workflow: WorkflowTemplate, bindings: Record<string, string>): void {
  invariant(bindings !== null && typeof bindings === 'object' && !Array.isArray(bindings), '工作流岗位映射必须为对象');
  const roles = new Set(workflow.roles.map(role => role.id));
  invariant(Object.keys(bindings).every(key => roles.has(key)), '工作流岗位映射包含未知岗位');
  for (const role of workflow.roles) invariant(team.members.some(member => member.memberId === bindings[role.id]), '工作流岗位必须绑定本团队成员');
  (team.workflows ??= []).push({
    id: globalThis.crypto.randomUUID(), name: workflow.name, sourceTemplateId: workflow.id, sourceTemplateVersion: workflow.version,
    ...(workflow.maxAttempts !== undefined ? { maxAttempts: workflow.maxAttempts } : {}),
    steps: workflow.steps.map(({ roleId, ...step }) => ({ ...structuredClone(step), id: globalThis.crypto.randomUUID(), memberId: bindings[roleId]! })),
  });
}
