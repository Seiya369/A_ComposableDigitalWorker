import { invariant, textField } from '../domain/errors.js';

function object(value: unknown, label: string): asserts value is Record<string, unknown> {
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} 必须为对象`);
}
function list(value: unknown, label: string): asserts value is unknown[] { invariant(Array.isArray(value), `${label} 必须为数组`); }
function strings(value: unknown, label: string) { list(value, label); value.forEach(item => textField(item, label)); }
function integer(value: unknown, label: string, min: number, max = Number.MAX_SAFE_INTEGER) { invariant(Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max, `${label} 超出有效整数范围`); }

export function validateWorkflows(value: unknown, assigneeKey: 'memberId' | 'employeeId', assignees: Set<string>): void {
  list(value, '工作流');
  const ids = new Set<string>();
  for (const workflow of value) {
    object(workflow, '工作流'); textField(workflow.id, '工作流 ID'); textField(workflow.name, '工作流名称');
    if (workflow.version !== undefined) integer(workflow.version, '流程版本', 1);
    if (workflow.maxAttempts !== undefined) integer(workflow.maxAttempts, '步骤尝试上限', 1, 10);
    invariant(!ids.has(workflow.id), '工作流 ID 重复'); ids.add(workflow.id);
    list(workflow.steps, '工作流步骤');
    invariant(workflow.steps.length > 0 && workflow.steps.length <= 50, '每个工作流需要 1–50 个步骤');
    const stepIds = new Set<string>();
    for (const step of workflow.steps) {
      object(step, '工作流步骤'); textField(step.id, '步骤 ID'); textField(step.name, '步骤名称'); textField(step.instruction, '步骤任务');
      invariant(!stepIds.has(step.id), '工作流步骤 ID 重复'); stepIds.add(step.id);
      textField(step[assigneeKey], '步骤负责员工');
      invariant(assignees.has(step[assigneeKey]), `工作流“${workflow.name}”的负责员工不在团队中，请先调整工作流`);
      if (step.timeoutMs !== undefined) integer(step.timeoutMs, '步骤超时', 100, 3_600_000);
      for (const key of ['inputs', 'outputs', 'acceptanceCriteria']) if (step[key] !== undefined) { strings(step[key], key); invariant((step[key] as string[]).length <= 20 && (step[key] as string[]).every(item => item.length <= 2000), '步骤要求过长'); }
    }
    for (const [index, step] of workflow.steps.entries()) { object(step, '工作流步骤'); if (step.onRejectStepId !== undefined) {
      textField(step.onRejectStepId, '不合格退回步骤');
      invariant(workflow.steps.slice(0, index + 1).some(target => { object(target, '工作流步骤'); return target.id === step.onRejectStepId; }), '不合格只能退回本步骤或之前的有效步骤');
    } }
    if (assigneeKey === 'employeeId') {
      textField(workflow.templateWorkflowId, '来源工作流');
      if (workflow.templateWorkflowVersion !== undefined) integer(workflow.templateWorkflowVersion, '来源工作流版本', 1);
    }
  }
}

/** Rebuild local step identities and all rejection links together when copying a flow. */
export function remapWorkflowStepIds<T extends { id: string; onRejectStepId?: string }>(steps: T[], fresh: () => string): T[] {
  const ids = new Map(steps.map(step => [step.id, fresh()]));
  return steps.map(step => {
    if (step.onRejectStepId !== undefined) invariant(ids.has(step.onRejectStepId), '退回步骤引用不存在');
    return { ...structuredClone(step), id: ids.get(step.id)!, ...(step.onRejectStepId !== undefined ? { onRejectStepId: ids.get(step.onRejectStepId)! } : {}) };
  });
}
