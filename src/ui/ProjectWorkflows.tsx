import { activeProjectTeams } from '../domain/project-roster.js';
import { useEffect, useRef, useState } from 'react';
import type { ProjectTeam, ProjectWorkflow, TeamWorkflow, WorkforceState } from '../domain/types.js';
import type { WorkflowCommandInput, WorkflowRun, WorkflowStatus, WorkflowStepStatus } from '../workflow/types.js';
import { validateWorkflows } from '../workflow/definition.js';
import type { WorkforceClient } from './client.js';
import { EmptyState, timeLabel, type Perform } from './ProjectPanels.js';
import { SelectField, TextField } from './fields.js';
import { Icon } from './icons.js';
import { WorkflowForm } from './TeamWorkflows.js';
import './project-workflows.css';

const STATUS: Record<WorkflowStatus, string> = { running: '执行中', paused: '已暂停', 'awaiting-review': '待验收', blocked: '待处理', succeeded: '已完成', cancelled: '已取消' };
const STEP_STATUS: Record<WorkflowStepStatus, string> = { pending: '待执行', running: '执行中', 'awaiting-review': '待验收', accepted: '已验收', blocked: '待处理', cancelled: '已取消' };
type Props = { state: WorkforceState; projectId: string; client: WorkforceClient; perform: Perform; busy: boolean; onDirty: (dirty: boolean) => void };

export function ProjectWorkflows({ state, projectId, client, perform, busy, onDirty }: Props) {
  const teams = activeProjectTeams(state, projectId);
  const [editing, setEditing] = useState<{ teamId: string; workflow?: ProjectWorkflow }>();
  const [starting, setStarting] = useState<{ teamId: string; workflow: ProjectWorkflow }>();
  const [selectedId, setSelectedId] = useState<string>();
  const [page, setPage] = useState(0);
  const runs = (state.workflowRuns ?? []).filter(flow => flow.projectId === projectId).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const selected = runs.find(flow => flow.id === selectedId);
  const stopEditing = () => { setEditing(undefined); onDirty(false); };
  const stopStarting = () => { setStarting(undefined); onDirty(false); };
  return <main className="wf-aux-panel wf-project-workflows">
    <div className="wf-content-heading"><h2>项目工作流</h2><button className="wf-button" disabled={busy || !teams.length || !!editing || !!starting} onClick={() => setEditing({ teamId: teams[0]!.id })}><Icon name="plus" size={15} />添加工作流</button></div>
    {editing && <ProjectWorkflowEditor key={`${editing.teamId}/${editing.workflow?.id ?? 'new'}`} state={state} teams={teams} initialTeamId={editing.teamId} workflow={editing.workflow} busy={busy} onDirty={onDirty} onCancel={stopEditing} onSave={async (teamId, workflow, expectedVersion) => { const ok = await perform(() => client.saveProjectWorkflow({ projectId, projectTeamId: teamId, workflow, expectedVersion }), '项目工作流已保存'); if (ok) stopEditing(); }} />}
    {starting && <WorkflowStartForm key={starting.workflow.id} teamId={starting.teamId} workflow={starting.workflow} projectId={projectId} busy={busy} onDirty={onDirty} onCancel={stopStarting} onStart={async input => { let id: string | undefined; const ok = await perform(async () => { const flow = await client.startWorkflow(input); id = flow.id; }, '工作流已发起'); if (ok) { stopStarting(); setPage(0); setSelectedId(id); } }} />}
    {!editing && !starting && <>
      {teams.map(team => <section className="wf-project-team-section" key={team.id}><h3>{team.name}</h3>
        {team.workflows.map(workflow => <article className="wf-project-flow-definition" key={workflow.id}><div><strong>{workflow.name}</strong><span>{workflow.steps.length} 个步骤 · v{workflow.version ?? 1}</span></div><button className="wf-icon-button" aria-label={`编辑工作流 ${workflow.name}`} disabled={busy} onClick={() => setEditing({ teamId: team.id, workflow })}><Icon name="edit" size={15} /></button><button className="wf-button wf-primary" disabled={busy} onClick={() => setStarting({ teamId: team.id, workflow })}><Icon name="play" size={15} />发起</button></article>)}
        {!team.workflows.length && <p className="wf-hint">暂无工作流</p>}
      </section>)}
      {!teams.length && <EmptyState title="请先配置项目团队" />}
      <div className="wf-content-heading"><h3>运行记录</h3><span className="wf-hint">{runs.length} 次</span></div>
      <div className="wf-runs-list">{runs.slice(page * 20, page * 20 + 20).map(flow => <button className={`wf-run-row ${flow.id === selectedId ? 'is-selected' : ''}`} key={flow.id} onClick={() => setSelectedId(flow.id === selectedId ? undefined : flow.id)}><div><strong>{flow.definition.name}</strong><span>{flow.request}</span><span>{timeLabel(flow.createdAt)} · {flow.steps.filter(step => step.status === 'accepted').length}/{flow.steps.length} 已验收</span></div><span className="wf-tag">{STATUS[flow.status]}</span></button>)}</div>
      {runs.length > 20 && <div className="wf-form-actions"><button className="wf-button" disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</button><button className="wf-button" disabled={(page + 1) * 20 >= runs.length} onClick={() => setPage(page + 1)}>下一页</button></div>}
      {selected && <WorkflowRunDetail key={selected.id} flow={selected} state={state} busy={busy} onControl={input => perform(() => client.controlWorkflow(input), input.action === 'review' ? '验收结果已保存' : '流程状态已更新')} />}
    </>}
  </main>;
}

function ProjectWorkflowEditor({ state, teams, initialTeamId, workflow, busy, onDirty, onSave, onCancel }: {
  state: WorkforceState; teams: ProjectTeam[]; initialTeamId: string; workflow?: ProjectWorkflow; busy: boolean; onDirty: (dirty: boolean) => void;
  onSave: (teamId: string, workflow: ProjectWorkflow, expectedVersion: number) => Promise<void>; onCancel: () => void;
}) {
  const [teamId, setTeamId] = useState(initialTeamId);
  const [dirty, setDirty] = useState(false);
  const [draft, setDraft] = useState<TeamWorkflow>(() => workflow ? { ...workflow, steps: workflow.steps.map(({ employeeId, ...step }) => ({ ...step, memberId: employeeId })) } : { id: crypto.randomUUID(), name: '', maxAttempts: 3, steps: [] });
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  const team = teams.find(team => team.id === teamId);
  const members = team?.members.map(member => ({ memberId: member.employeeId, templateId: '', name: state.employees.find(employee => employee.id === member.employeeId)?.name ?? '员工已移除' })) ?? [];
  let valid = true;
  try { validateWorkflows([draft], 'memberId', new Set(members.map(member => member.memberId))); } catch { valid = false; }
  return <fieldset className="wf-editor-card wf-project-flow-editor" disabled={busy}>
    <SelectField label="所属项目团队" value={teamId} onChange={id => { setTeamId(id); setDraft(value => ({ ...value, steps: value.steps.map(step => ({ ...step, memberId: '' })) })); setDirty(true); }}>{teams.filter(team => !workflow || team.id === initialTeamId).map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</SelectField>
    <WorkflowForm workflow={draft} members={members} templates={[]} onChange={patch => { setDraft(value => ({ ...value, ...patch })); setDirty(true); }} />
    <div className="wf-form-actions"><button className="wf-button" onClick={onCancel}>取消</button><button className="wf-button wf-primary" disabled={!team || !valid || (!dirty && !!workflow)} onClick={() => void onSave(teamId, { id: draft.id, name: draft.name.trim(), templateWorkflowId: workflow?.templateWorkflowId ?? 'project-custom', maxAttempts: draft.maxAttempts, steps: draft.steps.map(({ memberId, ...step }) => ({ ...step, employeeId: memberId })) }, workflow ? workflow.version ?? 1 : 0)}>保存工作流</button></div>
  </fieldset>;
}

function WorkflowStartForm({ teamId, workflow, projectId, busy, onDirty, onCancel, onStart }: {
  teamId: string; workflow: ProjectWorkflow; projectId: string; busy: boolean; onDirty: (dirty: boolean) => void; onCancel: () => void;
  onStart: (input: Parameters<WorkforceClient['startWorkflow']>[0]) => Promise<void>;
}) {
  const [request, setRequest] = useState('');
  const receipt = useRef({ request: '', id: crypto.randomUUID() });
  useEffect(() => onDirty(!!request), [request, onDirty]);
  return <form className="wf-editor-card" onSubmit={event => { event.preventDefault(); const goal = request.trim(); if (receipt.current.request !== goal) receipt.current = { request: goal, id: crypto.randomUUID() }; void onStart({ projectId, projectTeamId: teamId, workflowId: workflow.id, workflowVersion: workflow.version ?? 1, request: goal, requestId: receipt.current.id }); }}>
    <h3>{workflow.name}</h3><fieldset className="wf-flow-start-fields" disabled={busy}><TextField label="本次目标" value={request} onChange={setRequest} multiline rows={3} /></fieldset>
    <div className="wf-form-actions"><button type="button" className="wf-button" disabled={busy} onClick={onCancel}>取消</button><button type="submit" className="wf-button wf-primary" disabled={busy || !request.trim()}>开始执行</button></div>
  </form>;
}

function WorkflowRunDetail({ flow, state, busy, onControl }: { flow: WorkflowRun; state: WorkforceState; busy: boolean; onControl: (input: WorkflowCommandInput) => Promise<boolean> }) {
  const [note, setNote] = useState('');
  const current = flow.steps.find(step => step.status !== 'accepted');
  const taskId = current?.attempts.at(-1)?.runId;
  useEffect(() => setNote(''), [taskId]);
  const control = (action: WorkflowCommandInput['action'], decision?: WorkflowCommandInput['decision']) => onControl({ projectId: flow.projectId, id: flow.id, commandId: crypto.randomUUID(), expectedVersion: flow.version, action, runId: taskId, decision, note: note.trim() });
  return <section className="wf-run-detail wf-flow-detail" aria-label="工作流运行详情">
    <div className="wf-record-title"><strong>{flow.definition.name}</strong><span className="wf-tag">{STATUS[flow.status]}</span></div><p>{flow.request}</p>
    {!['succeeded', 'cancelled'].includes(flow.status) && <div className="wf-form-actions"><button className="wf-button" disabled={busy} onClick={() => void control(flow.status === 'paused' ? 'resume' : 'pause')}>{flow.status === 'paused' ? '恢复执行' : '暂停后续步骤'}</button><button className="wf-button wf-danger-text" disabled={busy} onClick={() => void control('cancel')}>取消流程</button></div>}
    <ol className="wf-flow-steps">{flow.steps.map((step, index) => {
      const definition = flow.definition.steps[index]!;
      return <li key={step.stepId}><div className="wf-record-title"><strong>{definition.name}</strong><span>{state.employees.find(employee => employee.id === definition.employeeId)?.name}</span><span className="wf-tag">{STEP_STATUS[step.status]}</span></div>
        <details className="wf-workflow-requirements" open={step === current && step.status === 'awaiting-review'}><summary>步骤要求</summary><p>{definition.instruction}</p>{(['inputs', 'outputs', 'acceptanceCriteria'] as const).map((key, index) => !!definition[key]?.length && <div key={key}><strong>{['输入要求', '交付要求', '验收条件'][index]}</strong><ul>{definition[key]!.map((text, i) => <li key={i}>{text}</li>)}</ul></div>)}</details>
        {step.error && <p className="wf-error-box">{step.error}</p>}
        {step.attempts.map(attempt => { const task = state.runs.find(task => task.id === attempt.runId)!; return <details key={attempt.runId} className="wf-flow-attempt" open={step === current && attempt === step.attempts.at(-1)}><summary>第 {attempt.number} 次尝试 · {timeLabel(attempt.createdAt)}</summary>
          {task?.error && <p className="wf-error-box">{task.error}</p>}{task?.output && <pre>{task.output}</pre>}
          {task?.artifacts.map(artifact => <article className="wf-artifact" key={artifact.id}><strong>{artifact.title}</strong>{artifact.path && <code>{artifact.path}</code>}{artifact.content && <pre>{artifact.content}</pre>}</article>)}
          {task?.acceptance && <p>{task.acceptance.decision === 'accepted' ? '验收通过' : '已退回'} · {task.acceptance.reviewer} {task.acceptance.note}</p>}
          {task?.usage && <p className="wf-hint">Token：{task.usage.inputTokens + task.usage.outputTokens}</p>}
        </details>; })}
      </li>;
    })}</ol>
    {current && ['awaiting-review', 'blocked'].includes(current.status) && !['succeeded', 'cancelled'].includes(flow.status) && <div className="wf-review-form"><TextField label={current.status === 'awaiting-review' ? '验收意见' : '重试说明'} value={note} onChange={setNote} multiline rows={2} />
      <div className="wf-form-actions">{current.status === 'awaiting-review' ? <><button className="wf-button" disabled={busy || !note.trim()} onClick={() => void control('review', 'rejected')}>退回修改</button><button className="wf-button wf-primary" disabled={busy} onClick={() => void control('review', 'accepted')}>验收通过</button></> : <button className="wf-button wf-primary" disabled={busy || current.attempts.length >= (flow.definition.maxAttempts ?? 3)} onClick={() => void control('retry')}>重试当前步骤</button>}</div>
      {current.status === 'blocked' && current.attempts.length >= (flow.definition.maxAttempts ?? 3) && <p className="wf-hint">已达到尝试上限</p>}
    </div>}
    <details className="wf-flow-events"><summary>运行日志</summary>{flow.events.map((event, index) => <p key={index}><time>{timeLabel(event.at)}</time> {event.message}</p>)}</details>
  </section>;
}
