import type { WorkforceState } from '../domain/types.js';
import { invariant, textField } from '../domain/errors.js';
import { validateWorkflows } from './definition.js';

const integer = (value: unknown, min = 1, max = Number.MAX_SAFE_INTEGER) => invariant(Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max, '工作流整数超出范围');
const date = (value: unknown) => invariant(typeof value === 'string' && Number.isFinite(Date.parse(value)), '工作流时间无效');

/** Validate the complete ledger on load/commit, including both directions of task links. */
export function validateWorkflowRuns(state: WorkforceState): void {
  const workflows = state.workflowRuns ?? [];
  invariant(Array.isArray(workflows), '工作流运行记录必须为数组');
  const ids = new Set<string>();
  const requests = new Set<string>();
  const tasks = new Set<string>();
  const taskById = new Map(state.runs.map(task => [task.id, task]));
  const teamById = new Map((state.projectTeams ?? []).map(team => [team.id, team]));
  for (const flow of workflows) {
    invariant(flow && typeof flow === 'object', '工作流运行记录无效');
    for (const key of ['id', 'projectId', 'projectTeamId', 'workflowId', 'requestId', 'request'] as const) textField(flow[key], key);
    invariant(!ids.has(flow.id), '工作流运行 ID 重复'); ids.add(flow.id);
    const requestKey = `${flow.projectId}/${flow.requestId}`;
    invariant(!requests.has(requestKey), '工作流开始请求重复'); requests.add(requestKey);
    const team = teamById.get(flow.projectTeamId);
    invariant(team && team.projectId === flow.projectId, '工作流运行所属项目团队不存在');
    validateWorkflows([flow.definition], 'employeeId', new Set(team.members.map(member => member.employeeId)));
    invariant(flow.definition.id === flow.workflowId, '工作流快照标识不匹配');
    integer(flow.version); date(flow.createdAt); date(flow.updatedAt);
    if (flow.finishedAt !== undefined) date(flow.finishedAt);
    invariant(['running', 'paused', 'awaiting-review', 'blocked', 'succeeded', 'cancelled'].includes(flow.status), '工作流状态无效');
    invariant(Array.isArray(flow.steps) && flow.steps.length === flow.definition.steps.length, '工作流步骤记录不完整');
    let incomplete = false;
    flow.steps.forEach((step, index) => {
      invariant(step && step.stepId === flow.definition.steps[index]!.id, '工作流步骤顺序不匹配');
      invariant(['pending', 'running', 'awaiting-review', 'accepted', 'blocked', 'cancelled'].includes(step.status), '工作流步骤状态无效');
      if (incomplete) invariant(['pending', 'cancelled'].includes(step.status), '前序步骤未验收，不能执行后续步骤');
      if (step.status !== 'accepted') incomplete = true;
      invariant(Array.isArray(step.attempts) && step.attempts.length <= (flow.definition.maxAttempts ?? 3), '工作流尝试次数无效');
      if (['running', 'awaiting-review', 'accepted'].includes(step.status)) invariant(step.attempts.length > 0, '工作流步骤缺少员工任务');
      if (step.error !== undefined) textField(step.error, '步骤错误');
      step.attempts.forEach((attempt, attemptIndex) => {
        textField(attempt.runId, '步骤任务 ID'); date(attempt.createdAt);
        invariant(attempt.number === attemptIndex + 1 && !tasks.has(attempt.runId), '工作流尝试标识重复'); tasks.add(attempt.runId);
        if (attempt.feedback !== undefined) textField(attempt.feedback, '返工意见');
        const task = taskById.get(attempt.runId);
        invariant(task && task.projectId === flow.projectId && task.employeeId === flow.definition.steps[index]!.employeeId, '工作流任务不能跨项目或更换负责员工');
        invariant(task.workflow?.workflowRunId === flow.id && task.workflow.stepId === step.stepId && task.workflow.attempt === attempt.number && !task.parentRunId, '工作流任务链接不匹配');
        integer(task.workflow.timeoutMs, 100, 3_600_000);
        invariant(task.workflow.timeoutMs === (flow.definition.steps[index]!.timeoutMs ?? 600_000), '工作流任务超时与运行快照不一致');
        if (attemptIndex < step.attempts.length - 1) invariant(['failed', 'cancelled'].includes(task.status), '旧尝试尚未停止，不能创建新尝试');
      });
      const latest = taskById.get(step.attempts.at(-1)?.runId ?? '');
      if (step.status === 'accepted') invariant(latest?.status === 'succeeded' && latest.acceptance?.decision === 'accepted', '工作流步骤尚未验收');
      if (step.status === 'awaiting-review') invariant(latest?.status === 'awaiting-review', '工作流验收状态与员工任务不一致');
      if (['pending', 'blocked'].includes(step.status) && latest) invariant(['failed', 'cancelled'].includes(latest.status), '工作流步骤仍有未结束的尝试');
    });
    const current = flow.steps.find(step => step.status !== 'accepted');
    if (flow.status === 'succeeded') invariant(!current && flow.finishedAt, '工作流尚未全部验收');
    if (flow.status === 'awaiting-review') invariant(current?.status === 'awaiting-review', '工作流没有待验收步骤');
    if (flow.status === 'blocked') invariant(current?.status === 'blocked', '工作流没有待处理步骤');
    if (flow.status === 'running') invariant(current && ['pending', 'running'].includes(current.status), '工作流没有可执行步骤');
    if (flow.status === 'paused') invariant(current && !['accepted', 'cancelled'].includes(current.status), '工作流没有可恢复步骤');
    if (flow.status === 'cancelled') invariant(flow.steps.every(step => ['accepted', 'cancelled'].includes(step.status)) && flow.finishedAt, '取消工作流的步骤未关闭');
    invariant(Array.isArray(flow.commands) && flow.commands.length <= 256, '工作流命令记录无效');
    const commands = new Set<string>();
    for (const command of flow.commands) { textField(command.id, '命令标识'); textField(command.fingerprint, '命令摘要'); invariant(!commands.has(command.id), '工作流命令重复'); commands.add(command.id); }
    invariant(Array.isArray(flow.events) && flow.events.length <= 300, '工作流事件记录无效');
    for (const event of flow.events) { date(event.at); textField(event.kind, '事件类型'); textField(event.message, '事件内容'); }
  }
  for (const task of state.runs) if (task.workflow) invariant(tasks.has(task.id), '员工任务引用了不存在的工作流尝试');
}
