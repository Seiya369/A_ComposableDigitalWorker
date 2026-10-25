import { createHash, randomUUID } from 'node:crypto';
import type { ProjectWorkflow, WorkforceRun, WorkforceState } from '../domain/types.js';
import { invariant, textField, WorkforceError } from '../domain/errors.js';
import { validateModules } from '../domain/validation.js';
import { validateWorkflows } from './definition.js';
import { buildStepRequest } from './handoff.js';
import { cancelWorkflow } from './cancel.js';
import { workflowRetryPlan } from './rework.js';
import type { SaveProjectWorkflowInput, StartWorkflowInput, WorkflowCommandInput, WorkflowPersistence, WorkflowRun, WorkflowStepRun } from './types.js';

type WorkflowAction = { kind: 'advance' | 'start' | 'cancel'; id: string };

const currentStep = (flow: WorkflowRun) => flow.steps.find(step => step.status !== 'accepted');
const lastTask = (state: WorkforceState, step?: WorkflowStepRun) => state.runs.find(task => task.id === step?.attempts.at(-1)?.runId);
const version = (actual: number, expected: number) => { if (!Number.isSafeInteger(expected) || expected !== actual) throw new WorkforceError('CONFLICT', '工作流已更新，请刷新后重试'); };
const boundedText = (value: unknown, label: string, max = 20_000) => { textField(value, label); invariant(value.length <= max, `${label}过长`); };

export class WorkflowRepository {
  constructor(readonly persistence: WorkflowPersistence, private readonly now = () => new Date().toISOString(), private readonly id = randomUUID as () => string) {}
  private event(flow: WorkflowRun, kind: string, message: string, step?: WorkflowStepRun) {
    const at = this.now();
    flow.version++; flow.updatedAt = at;
    flow.events.push({ at, kind, message, ...(step ? { stepId: step.stepId, runId: step.attempts.at(-1)?.runId } : {}) });
    flow.events = flow.events.slice(-300);
  }
  private get(state: WorkforceState, id: string, projectId?: string): WorkflowRun {
    const flow = state.workflowRuns?.find(flow => flow.id === id && (!projectId || flow.projectId === projectId));
    if (!flow) throw new WorkforceError('NOT_FOUND', '当前项目中没有这个工作流运行记录');
    return flow;
  }
  start(input: StartWorkflowInput): Promise<WorkflowRun> {
    input = structuredClone(input);
    for (const key of ['projectId', 'projectTeamId', 'workflowId', 'requestId'] as const) boundedText(input[key], key, 200);
    boundedText(input.request, '流程目标');
    return this.persistence.transaction(state => {
      const previous = state.workflowRuns?.find(flow => flow.projectId === input.projectId && flow.requestId === input.requestId);
      if (previous) {
        if (previous.projectTeamId !== input.projectTeamId || previous.workflowId !== input.workflowId || previous.request !== input.request || (previous.definition.version ?? 1) !== input.workflowVersion) throw new WorkforceError('CONFLICT', '此发起请求已用于另一个工作流目标');
        return previous;
      }
      const team = state.projectTeams?.find(team => team.id === input.projectTeamId && team.projectId === input.projectId);
      invariant(team && team.status !== 'cancelled', '团队不属于当前项目或已取消');
      const definition = team.workflows.find(flow => flow.id === input.workflowId);
      invariant(definition, '项目工作流不存在'); version(definition.version ?? 1, input.workflowVersion);
      for (const step of definition.steps) {
        const employee = state.employees.find(employee => employee.id === step.employeeId && employee.projectId === input.projectId);
        invariant(employee?.status === 'active', `“${step.name}”的负责员工尚未启用`);
        validateModules(employee.modules, true);
      }
      const at = this.now();
      const flow: WorkflowRun = { id: this.id(), projectId: input.projectId, projectTeamId: team.id, workflowId: definition.id, requestId: input.requestId, definition: structuredClone(definition), request: input.request, status: 'running', steps: definition.steps.map(step => ({ stepId: step.id, status: 'pending', attempts: [] })), commands: [], events: [], version: 0, createdAt: at, updatedAt: at };
      this.event(flow, 'started', '工作流已发起');
      (state.workflowRuns ??= []).push(flow);
      return flow;
    });
  }
  saveDefinition(input: SaveProjectWorkflowInput): Promise<ProjectWorkflow> {
    input = structuredClone(input);
    boundedText(input.projectId, '项目 ID', 200); boundedText(input.projectTeamId, '项目团队 ID', 200);
    invariant(input.workflow && typeof input.workflow === 'object', '工作流配置必须为对象');
    boundedText(input.workflow.id, '工作流 ID', 200);
    return this.persistence.transaction(state => {
      const team = state.projectTeams?.find(team => team.id === input.projectTeamId && team.projectId === input.projectId);
      invariant(team && team.status !== 'cancelled', '团队不属于当前项目或已取消');
      const previous = team.workflows.find(flow => flow.id === input.workflow.id);
      version(previous ? previous.version ?? 1 : 0, input.expectedVersion);
      validateWorkflows([input.workflow], 'employeeId', new Set(team.members.map(member => member.employeeId)));
      const next = { ...input.workflow, version: input.expectedVersion + 1 };
      if (previous) team.workflows[team.workflows.indexOf(previous)] = next;
      else team.workflows.push(next);
      team.updatedAt = this.now();
      return next;
    });
  }
  /** Return work implied by durable state, without emitting writes for idle workflows. */
  actions(): WorkflowAction[] {
    const state = this.persistence.snapshot();
    return (state.workflowRuns ?? []).flatMap<WorkflowAction>(flow => {
      if (flow.status === 'cancelled') return flow.steps.flatMap<WorkflowAction>(step => {
        const task = lastTask(state, step);
        if (task?.status === 'awaiting-review' && step.status !== 'accepted') return [{ kind: 'advance' as const, id: flow.id }];
        return task && ['queued', 'running', 'blocked'].includes(task.status) ? [{ kind: 'cancel' as const, id: task.id }] : [];
      });
      if (flow.status === 'succeeded') return [];
      const step = currentStep(flow);
      const task = lastTask(state, step);
      if (step?.status === 'running' && task?.status === 'queued') return [{ kind: 'start' as const, id: task.id }];
      if ((flow.status === 'running' && (!step || step.status === 'pending')) || (step?.status === 'running' && task && ['awaiting-review', 'failed', 'cancelled'].includes(task.status))) return [{ kind: 'advance' as const, id: flow.id }];
      return [];
    });
  }
  advance(id: string): Promise<void> {
    return this.persistence.transaction(state => {
      const flow = this.get(state, id);
      if (flow.status === 'cancelled') {
        // A provider may finish between the cancel commit and its abort signal.
        for (const step of flow.steps) {
          const task = lastTask(state, step);
          if (step.status !== 'accepted' && task?.status === 'awaiting-review') {
            task.status = 'cancelled'; task.version++; task.updatedAt = this.now(); task.finishedAt = this.now();
          }
        }
        return;
      }
      if (flow.status === 'succeeded') return;
      const step = currentStep(flow);
      if (!step) { flow.status = 'succeeded'; flow.finishedAt = this.now(); this.event(flow, 'completed', '全部步骤已验收'); return; }
      const task = lastTask(state, step);
      if (step.status === 'running' && task && ['awaiting-review', 'failed', 'cancelled'].includes(task.status)) {
        step.status = task.status === 'awaiting-review' ? 'awaiting-review' : 'blocked';
        if (step.status === 'blocked') step.error = task.error || '员工任务未完成，请检查产物后重试';
        if (flow.status !== 'paused') flow.status = step.status;
        this.event(flow, step.status, step.error || '员工已提交交付，等待验收', step);
        return;
      }
      if (flow.status !== 'running' || step.status !== 'pending') return;
      const index = flow.steps.indexOf(step);
      const definition = flow.definition.steps[index]!;
      const employee = state.employees.find(employee => employee.id === definition.employeeId && employee.projectId === flow.projectId);
      if (!employee || employee.status !== 'active') {
        step.status = 'blocked'; step.error = '负责员工已停用或移除，请处理后重试'; flow.status = 'blocked';
        this.event(flow, 'blocked', step.error, step); return;
      }
      const feedback = step.error;
      const at = this.now();
      const taskId = this.id();
      const number = step.attempts.length + 1;
      invariant(number <= (flow.definition.maxAttempts ?? 3), '已达到步骤尝试次数上限');
      const next: WorkforceRun = { id: taskId, projectId: flow.projectId, employeeId: employee.id, request: buildStepRequest(flow, index, employee, state, feedback), employeeSnapshot: structuredClone(employee), status: 'queued', artifacts: [], version: 1, createdAt: at, updatedAt: at, workflow: { workflowRunId: flow.id, stepId: step.stepId, attempt: number, timeoutMs: definition.timeoutMs ?? 600_000 } };
      state.runs.push(next);
      step.status = 'running'; step.attempts.push({ runId: taskId, number, createdAt: at, ...(feedback ? { feedback } : {}) }); delete step.error;
      this.event(flow, 'dispatched', `已分配给 ${employee.name}（第 ${number} 次尝试）`, step);
    });
  }
  control(input: WorkflowCommandInput): Promise<WorkflowRun> {
    input = structuredClone(input);
    boundedText(input.projectId, '项目 ID', 200); boundedText(input.id, '流程运行 ID', 200); boundedText(input.commandId, '命令 ID', 200);
    invariant(['pause', 'resume', 'cancel', 'retry', 'review'].includes(input.action), '工作流控制操作无效');
    if (input.note !== undefined) { textField(input.note, '处理意见', true); invariant(input.note.length <= 20_000, '处理意见过长'); }
    const fingerprint = createHash('sha256').update(JSON.stringify([input.action, input.expectedVersion, input.runId, input.decision, input.note])).digest('hex');
    return this.persistence.transaction(state => {
      const flow = this.get(state, input.id, input.projectId);
      const receipt = flow.commands.find(command => command.id === input.commandId);
      if (receipt) { if (receipt.fingerprint !== fingerprint) throw new WorkforceError('CONFLICT', '该命令标识已用于不同操作'); return flow; }
      version(flow.version, input.expectedVersion);
      invariant(!['succeeded', 'cancelled'].includes(flow.status), '工作流已结束');
      const step = currentStep(flow);
      const task = lastTask(state, step);
      if (input.action === 'pause') {
        invariant(flow.status !== 'paused', '工作流已暂停'); flow.status = 'paused'; this.event(flow, 'paused', '已暂停后续步骤，当前任务可完成');
      } else if (input.action === 'resume') {
        invariant(flow.status === 'paused', '工作流未暂停');
        flow.status = step?.status === 'blocked' ? 'blocked' : step?.status === 'awaiting-review' ? 'awaiting-review' : 'running'; this.event(flow, 'resumed', '工作流已恢复');
      } else if (input.action === 'cancel') {
        cancelWorkflow(state, flow, this.now());
      } else if (input.action === 'retry') {
        invariant(step?.status === 'blocked', '当前步骤不需要重试');
        invariant(input.runId === task?.id, '重试目标已改变，请刷新');
        invariant(!task || !['queued', 'running', 'blocked'].includes(task.status), '旧任务尚未停止，不能重试');
        const plan = workflowRetryPlan(flow, task);
        invariant(plan.exhaustedIndex < 0, `第 ${plan.exhaustedIndex + 1} 步已达到尝试次数上限，请处理后重新发起工作流`);
        const employee = state.employees.find(employee => employee.id === flow.definition.steps[plan.targetIndex]!.employeeId);
        invariant(employee?.status === 'active', '请先启用本步骤员工');
        const feedback = input.note?.trim() || step.error || '验收未通过，请检查并修正交付';
        const message = plan.targetIndex < plan.currentIndex ? `第 ${plan.currentIndex + 1} 步验收不合格，退回第 ${plan.targetIndex + 1} 步。${feedback}` : feedback;
        const at = this.now();
        for (let index = plan.targetIndex; index <= plan.currentIndex; index++) {
          const affected = flow.steps[index]!;
          if (affected.status === 'accepted') {
            const attempt = affected.attempts.at(-1)!;
            attempt.invalidatedAt = at; attempt.invalidationReason = message;
          }
          affected.status = 'pending'; affected.error = message;
        }
        if (flow.status !== 'paused') flow.status = 'running';
        this.event(flow, plan.targetIndex < plan.currentIndex ? 'returned' : 'retry', plan.targetIndex < plan.currentIndex ? `已退回第 ${plan.targetIndex + 1} 步；到第 ${plan.currentIndex + 1} 步均需重新执行并验收` : '已请求重新执行当前步骤', step);
      } else {
        invariant(step?.status === 'awaiting-review' && task?.status === 'awaiting-review' && input.runId === task.id, '验收任务已改变或尚未完成');
        invariant(input.decision === 'accepted' || input.decision === 'rejected', '验收决定无效');
        if (input.decision === 'rejected') boundedText(input.note, '退回意见');
        else invariant(task.output?.trim() || task.artifacts.length, '缺少可验收的交付内容');
        task.acceptance = { decision: input.decision, reviewer: '项目负责人', note: input.note?.trim() ?? '', at: this.now() };
        task.status = input.decision === 'accepted' ? 'succeeded' : 'failed'; task.finishedAt = this.now(); task.updatedAt = this.now(); task.version++;
        step.status = input.decision === 'accepted' ? 'accepted' : 'blocked';
        if (step.status === 'blocked') step.error = input.note!;
        if (flow.steps.every(step => step.status === 'accepted')) { flow.status = 'succeeded'; flow.finishedAt = this.now(); }
        else if (flow.status !== 'paused') flow.status = step.status === 'blocked' ? 'blocked' : 'running';
        this.event(flow, 'reviewed', input.decision === 'accepted' ? '验收通过' : `已退回：${input.note}`, step);
      }
      flow.commands.push({ id: input.commandId, fingerprint }); flow.commands = flow.commands.slice(-256);
      return flow;
    });
  }
  /** Called before scheduling after startup. Ambiguous in-flight work is never replayed. */
  recover(): Promise<void> {
    if (!this.persistence.snapshot().runs.some(task => task.workflow && ['running', 'blocked'].includes(task.status))) return Promise.resolve();
    return this.persistence.transaction(state => {
      for (const task of state.runs) if (task.workflow && ['running', 'blocked'].includes(task.status)) {
        const flow = this.get(state, task.workflow.workflowRunId);
        task.status = flow.status === 'cancelled' ? 'cancelled' : 'failed'; task.error = '宿主运行中断，请检查已有产物后重试'; task.finishedAt = this.now(); task.updatedAt = this.now(); task.version++;
      }
    });
  }
}
