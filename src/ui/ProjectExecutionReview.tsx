import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkforceRun, WorkforceState } from '../domain/types.js';
import { workflowRetryPlan } from '../workflow/rework.js';
import type { WorkforceClient } from './client.js';
import { executionReviewContext, reviewExecution } from './execution-review.js';
import { Icon } from './icons.js';
import { TextField } from './fields.js';
import { useI18n } from './i18n.js';
import './execution-review.css';

export interface ProjectExecutionReviewProps { client: WorkforceClient; projectId: string; initialRunId: string; onClose: () => void; onOpenSession?: (sessionId: string) => void }
const STATUS: Record<WorkforceRun['status'], string> = { queued: '排队中', running: '执行中', blocked: '等待处理', 'awaiting-review': '待验收', succeeded: '已完成', failed: '失败', cancelled: '已取消' };
const timeLabel = (iso: string, locale: 'zh' | 'en') => new Date(iso).toLocaleString(locale === 'en' ? 'en-US' : 'zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

/** A delivery entry opens one attempt, never the removed project workspace. */
export function ProjectExecutionReview({ client, projectId, initialRunId, onClose, onOpenSession }: ProjectExecutionReviewProps) {
  const { t, locale, errorMessage } = useI18n();
  const [state, setState] = useState<WorkforceState>();
  const [error, setError] = useState<{ cause: unknown; completed?: boolean }>();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const mounted = useRef(true);
  const reload = useCallback(async () => { const next = await client.snapshot(); if (mounted.current) setState(current => current && current.revision > next.revision ? current : next); }, [client]);
  useEffect(() => { mounted.current = true; void reload().catch(cause => setError({ cause })); return () => { mounted.current = false; }; }, [reload]);
  useEffect(() => { setNote(''); }, [initialRunId]);
  useEffect(() => { const timer = window.setInterval(() => { void reload().catch(cause => setError({ cause })); }, 3500); return () => window.clearInterval(timer); }, [reload]);
  const run = state?.runs.find(item => item.id === initialRunId && item.projectId === projectId);
  const context = state && run ? executionReviewContext(state, run) : undefined;
  const perform = async (operation: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError(undefined);
    try { await operation(); setNote(''); try { await reload(); } catch (cause) { setError({ cause, completed: true }); } }
    catch (cause) { setError({ cause }); try { await reload(); } catch { /* Retain the failed command and the local review note. */ } }
    finally { if (mounted.current) setBusy(false); }
  };
  const task = context?.task;
  const flow = context?.flow;
  let ownerRun = run;
  const ownerChain = new Set<string>();
  while (ownerRun?.parentRunId && !ownerChain.has(ownerRun.id)) {
    ownerChain.add(ownerRun.id);
    const parent = state?.runs.find(item => item.id === ownerRun!.parentRunId && item.projectId === projectId);
    if (!parent) break;
    ownerRun = parent;
  }
  const deliverables = task ? state?.workState?.deliverables.filter(item => item.projectId === projectId && item.taskId === task.id) ?? [] : [];
  const retry = flow && context?.step ? workflowRetryPlan(flow, state?.runs.find(item => item.id === context.step!.attempts.at(-1)?.runId)) : undefined;
  const controlFlow = (action: 'pause' | 'resume' | 'cancel' | 'retry') => client.controlWorkflow({ projectId, id: flow!.id, commandId: crypto.randomUUID(), expectedVersion: flow!.version, action, runId: run!.id, note: note.trim() });
  const controlTask = (action: 'work.retryTask' | 'work.cancelTask') => client.workCommand(action, { projectId, id: task!.id, note: note.trim() }, { expectedVersion: task!.version, requestId: crypto.randomUUID() });
  return <main className="wf-root wf-execution-review" aria-label={t('交付验收')}>
    <header><div><h2>{t('交付验收')}</h2>{run && <p>{run.employeeSnapshot.name} · {t(STATUS[run.status])} · {timeLabel(run.createdAt, locale)}</p>}</div><button className="wf-button" onClick={onClose}>{t('返回')}</button></header>
    <div className="wf-execution-content">
      {error && <div className="wf-error-box" role="alert">{error.completed ? t('操作已完成，请刷新查看：{error}', { error: errorMessage(error.cause) }) : errorMessage(error.cause)}</div>}
      {!state ? <p role="status">{t('正在读取交付…')}</p> : !run ? <p role="status">{t('这条执行记录不存在或不属于当前项目。')}</p> : <>
        <section><h3>{t('任务')}</h3><p>{run.request}</p>{task && <><h4>{task.title}</h4><p>{task.goal}</p><Requirement title={t('验收标准')} items={task.acceptanceCriteria} /></>}{flow && <p className="wf-hint">{flow.definition.name} · {flow.definition.steps.find(item => item.id === run.workflow?.stepId)?.name}</p>}{run.error && <p className="wf-error-box">{errorMessage(run.error)}</p>}{run.sessionId && onOpenSession && <button className="wf-button" onClick={() => onOpenSession(run.sessionId!)}>{t('打开执行对话')}</button>}</section>
        {run.output && <section><h3>{t('交付回复')}</h3><pre>{run.output}</pre></section>}
        {run.artifacts.length > 0 && <section><h3>{t('交付内容')}</h3>{run.artifacts.map(artifact => <article className="wf-artifact" key={artifact.id}><strong>{artifact.title}</strong>{artifact.path && <code>{artifact.path}</code>}{artifact.content && <pre>{artifact.content}</pre>}</article>)}</section>}
        {deliverables.length > 0 && <section><h3>{t('任务成果')}</h3>{deliverables.map(item => <article className="wf-artifact" key={item.id}><strong>{item.title}</strong>{item.revisions.length ? item.revisions.map(revision => <details key={revision.version} open={revision === item.revisions.at(-1)}><summary>v{revision.version} · {t(revision.invalidatedAt ? '需重新验证' : revision.review ? revision.review.decision === 'accepted' ? '已验收' : '已退回' : '待验收')}</summary>{revision.path && <code>{revision.path}</code>}{revision.content && <pre>{revision.content}</pre>}{revision.review && <p>{revision.review.reviewer} · {revision.review.note}</p>}{revision.invalidationReason && <p>{errorMessage(revision.invalidationReason)}</p>}</details>) : <p className="wf-hint">{t('尚未提交成果。')}</p>}</article>)}</section>}
        {run.acceptance && <p className="wf-callout">{t(run.acceptance.decision === 'accepted' ? '验收通过' : '已退回')} · {run.acceptance.reviewer}{run.acceptance.note && ` · ${run.acceptance.note}`}</p>}
        {!context?.current && <p className="wf-hint">{t('这是历史执行，当前版本已变化。')}</p>}
        {run.conversationWorkflow && <section><p className="wf-hint">{t('请返回负责人对话的工作流详情验收。')}</p>{ownerRun?.sessionId && onOpenSession && <button className="wf-button" onClick={() => onOpenSession(ownerRun!.sessionId!)}>{t('返回负责人对话')}</button>}</section>}
        {context?.reviewable && <section><TextField label={t('验收意见')} value={note} onChange={setNote} multiline rows={2} /><div className="wf-form-actions"><button className="wf-button" disabled={busy || !note.trim()} onClick={() => void perform(() => reviewExecution(client, state, run, 'rejected', note, crypto.randomUUID()))}>{t('退回修改')}</button><button className="wf-button wf-primary" disabled={busy} onClick={() => void perform(() => reviewExecution(client, state, run, 'accepted', note, crypto.randomUUID()))}><Icon name="check" size={14} />{t('验收通过')}</button></div></section>}
        {context?.current && !run.conversationWorkflow && <div className="wf-form-actions">
          {flow && <><button className="wf-button" disabled={busy} onClick={() => void perform(() => controlFlow(flow.status === 'paused' ? 'resume' : 'pause'))}>{t(flow.status === 'paused' ? '恢复执行' : '暂停后续步骤')}</button>{context.step?.status === 'blocked' && <button className="wf-button" disabled={busy || (retry?.exhaustedIndex ?? -1) >= 0} onClick={() => void perform(() => controlFlow('retry'))}>{retry && retry.targetIndex < retry.currentIndex ? t('退回第 {number} 步返工', { number: retry.targetIndex + 1 }) : t('重试当前步骤')}</button>}<button className="wf-button wf-danger-text" disabled={busy} onClick={() => void perform(() => controlFlow('cancel'))}>{t('取消流程')}</button></>}
          {task && <>{['blocked', 'needs-revalidation', 'cancelled'].includes(task.status) && <button className="wf-button" disabled={busy} onClick={() => void perform(() => controlTask('work.retryTask'))}>{t('重新执行')}</button>}{!['accepted', 'cancelled'].includes(task.status) && <button className="wf-button wf-danger-text" disabled={busy} onClick={() => void perform(() => controlTask('work.cancelTask'))}>{t('取消任务')}</button>}</>}
          {!run.workTaskId && !run.workflow && ['queued', 'running', 'blocked'].includes(run.status) && <button className="wf-button wf-danger-text" disabled={busy} onClick={() => void perform(() => client.cancelRun(run.id))}>{t('取消任务')}</button>}
        </div>}
      </>}
    </div>
  </main>;
}

function Requirement({ title, items }: { title: string; items: string[] }) { return items.length ? <><h4>{title}</h4><ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul></> : null; }
