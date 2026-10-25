import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ConversationWorkflowDetailsClient } from '../client/conversation-workflow-details.js';
import type { ConversationWorkflowDelivery, ConversationWorkflowDeliverySummary, ConversationWorkflowDetails as Details, ConversationWorkflowDetailsSelection } from '../domain/conversation-workflow-details.js';
import { Icon } from './icons.js';
import { useI18n } from './i18n.js';
import { ConversationWorkflowWiki } from './ConversationWorkflowWiki.js';
import './conversation-workflow.css';
import './conversation-workflow-details.css';

const statusLabel = { pending: '未完成', current: '当前步骤', completed: '已验收' };
const runLabel = { queued: '排队中', running: '执行中', blocked: '已退回', 'awaiting-review': '待验收', succeeded: '已验收', failed: '执行失败', cancelled: '已取消' };
const taskLabel = { draft: '草稿', ready: '待开始', running: '执行中', 'awaiting-review': '待验收', accepted: '已验收', blocked: '等待处理', 'needs-revalidation': '需重新验证', cancelled: '已取消' };
const date = (at: string, locale: 'zh' | 'en') => { const parsed = new Date(at); return Number.isNaN(parsed.getTime()) ? at : parsed.toLocaleString(locale === 'en' ? 'en-US' : 'zh-CN'); };

interface Props {
  sessionId: string; client: ConversationWorkflowDetailsClient; onClose(): void;
  initialRunId?: string;
  onChanged(): Promise<void>; onActivate(stepId: string): Promise<boolean>;
  onOpenSession?(sessionId: string): void;
}

/** Inspecting a step or a delivery never changes the workflow's active owner or progress. */
export function ConversationWorkflowDetails(props: Props) {
  const { t, locale, errorMessage } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const tabId = useId();
  const [loaded, setLoaded] = useState<{ details: Details; selection: ConversationWorkflowDetailsSelection }>();
  const details = loaded?.details;
  const [selection, setSelection] = useState<ConversationWorkflowDetailsSelection>(() => props.initialRunId ? { runId: props.initialRunId } : {});
  const [wikiOpen, setWikiOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    const node = dialog.current; const opener = document.activeElement;
    node?.showModal();
    return () => { node?.close(); if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => { setNote(''); }, [props.sessionId, loaded?.selection.stepId, loaded?.selection.runId, loaded?.selection.runVersion]);
  useEffect(() => {
    const controller = new AbortController(); const own = ++generation.current;
    setLoading(true); setError('');
    props.client.load(props.sessionId, selection, controller.signal).then(value => {
      if (!controller.signal.aborted && own === generation.current) setLoaded({ details: value, selection: { ...selection } });
    }).catch(cause => { if (!controller.signal.aborted && own === generation.current) setError(String(cause instanceof Error ? cause.message : cause)); })
      .finally(() => { if (!controller.signal.aborted && own === generation.current) setLoading(false); });
    return () => { controller.abort(); generation.current++; };
  }, [props.client, props.sessionId, selection, refreshVersion]);
  const step = details?.selectedStep;
  const acceptedDelivery = !loaded?.selection.runId && step?.status === 'completed' ? step.acceptedDelivery : undefined;
  const delivery = details?.legacyDelivery ?? acceptedDelivery ?? step?.latestDelivery;
  const history = details?.legacyDelivery ? details.history.filter(item => item.legacy)
    : step ? step.history ?? details?.history.filter(item => item.stepId === step.id) ?? [] : [];
  const historyTotal = details?.legacyDelivery ? history.length : step?.historyTotal ?? history.length;
  const confirmedItems = !details?.legacyDelivery && delivery ? step?.confirmedItems?.filter(item => item.runId === delivery.id && item.runVersion === delivery.version) ?? [] : [];
  useEffect(() => { if (content.current) content.current.scrollTop = 0; }, [step?.id, delivery?.id]);
  const wikiTarget = details?.projectId && details.projectWiki ? {
    scope: 'project' as const, library: 'team' as const, projectId: details.projectId, ...details.projectWiki,
  } : undefined;
  const canOpenWiki = !!wikiTarget && !!props.client.projectWikiClient;
  useEffect(() => { if (details && !canOpenWiki) setWikiOpen(false); }, [details, canOpenWiki]);
  async function activate() {
    if (!step || pending || loading) return;
    setPending(true); setError('');
    try { if (await props.onActivate(step.id)) setSelection({ stepId: step.id }); else setError('步骤未切换，请刷新后重试'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPending(false); }
  }
  async function review(decision: 'accepted' | 'rejected') {
    if (!details?.projectId || !delivery?.reviewable || pending || loading) return;
    if (decision === 'rejected' && !note.trim()) { setError('请填写退回原因'); return; }
    setPending(true); setError('');
    try {
      const next = await props.client.review({ projectId: details.projectId, sessionId: props.sessionId,
        instanceId: details.instanceId, instanceVersion: details.instanceVersion, stepId: delivery.stepId,
        runId: delivery.id, runVersion: delivery.version, decision, note: note.trim(), expectedRevision: details.revision });
      setLoaded({ details: next, selection: {} }); setSelection({}); setNote(''); await props.onChanged();
    } catch (cause) {
      // Refresh a stale preview, but never replay a review against a newer delivery.
      const message = cause instanceof Error ? cause.message : String(cause);
      try { setLoaded({ details: await props.client.load(props.sessionId, selection), selection: { ...selection } }); } catch { /* Keep the original failed review visible. */ }
      setError(message);
    } finally { setPending(false); }
  }
  const inspect = (stepId: string, runId?: string, runVersion?: number) => setSelection({ stepId, ...(runId ? { runId, runVersion } : {}) });
  return <dialog ref={dialog} className="wf-conversation-details" aria-label={t('工作流详情')} onCancel={event => { event.preventDefault(); props.onClose(); }}>
    <header><div><h2>{details?.projectName ?? t('项目详情')}</h2></div><div className="wf-conversation-details-actions"><button type="button" aria-label={t('关闭详情')} onClick={props.onClose}><Icon name="close" size={18}/></button></div></header>
    <div ref={tabs} className="wf-conversation-details-tabs" role="tablist" aria-label={t('项目详情视图')} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      if (pending) return;
      event.preventDefault();
      const next = event.key === 'Home' ? false : event.key === 'End' ? canOpenWiki : canOpenWiki && !wikiOpen;
      setWikiOpen(next); tabs.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next ? 1 : 0]?.focus();
    }}>
      <button id={`${tabId}-workflow`} type="button" role="tab" aria-selected={!wikiOpen} aria-controls={`${tabId}-workflow-panel`} tabIndex={!wikiOpen ? 0 : -1} className={!wikiOpen ? 'is-active' : ''} onClick={() => setWikiOpen(false)}>{t('工作流')}</button>
      <button id={`${tabId}-wiki`} type="button" role="tab" aria-selected={wikiOpen} aria-controls={`${tabId}-wiki-panel`} tabIndex={wikiOpen ? 0 : -1} className={wikiOpen ? 'is-active' : ''} disabled={!canOpenWiki || pending} onClick={() => setWikiOpen(true)}>{t('项目知识库')}</button>
    </div>
    {wikiOpen && wikiTarget && props.client.projectWikiClient ? <div id={`${tabId}-wiki-panel`} role="tabpanel" aria-labelledby={`${tabId}-wiki`}><ConversationWorkflowWiki client={props.client.projectWikiClient} target={wikiTarget}/></div>
      : <div id={`${tabId}-workflow-panel`} role="tabpanel" aria-labelledby={`${tabId}-workflow`} className="wf-conversation-details-body" aria-busy={loading || pending}>
        {error && <p className="wf-conversation-details-error" role="alert"><span>{errorMessage(error)}</span>{!pending && <button type="button" onClick={() => { if (selection.runId) { const stepId = selection.stepId ?? step?.id; setSelection(stepId ? { stepId } : {}); } else setRefreshVersion(value => value + 1); }}>{t('重试')}</button>}</p>}
        {!details && loading ? <p role="status">{t('加载详情…')}</p> : details && <>
          {details.unavailableReason && <p role="status">{errorMessage(details.unavailableReason)}</p>}
          <div className="wf-conversation-details-layout">
            {details.steps.length > 0 && <WorkflowSteps steps={details.steps} selectedStepId={!details.legacyDelivery ? step?.id : undefined} disabled={pending} workflowName={details.name} onInspect={id => inspect(id)}/>}
            <div ref={content} className="wf-conversation-details-content">
              <section className="wf-conversation-details-section" aria-label={t('步骤内容')}>
                {step && !details.legacyDelivery ? <>
                  <div className="wf-conversation-details-step-heading"><div><h4>{step.name}<span>{t(statusLabel[step.status])}</span></h4>{step.owner && <p>{t('负责人：{name}', { name: step.owner.name })}{step.roster.length > 1 && <> · {t('下级：{names}', { names: step.roster.filter(person => person.id !== step.owner!.id).map(person => person.name).join(locale === 'en' ? ', ' : '、') })}</>}</p>}</div>{step.status !== 'current' && <button type="button" disabled={pending || loading || details.busy || !!details.unavailableReason} onClick={() => void activate()}>{t('设为当前')}</button>}</div>
                  <details key={`${props.sessionId}:${details.instanceId}:${step.id}`} className="wf-conversation-details-instruction">
                    <summary><h3>{t('步骤内容')}</h3></summary>
                    <dl className="wf-conversation-details-requirements"><div><dt>{t('步骤说明')}</dt><dd>{step.instruction || t('未设置')}</dd></div></dl>
                  </details>
                  <div key={`${props.sessionId}:${details.instanceId}:${step.id}:requirements`} className="wf-conversation-details-requirement-folds">
                    <details className="wf-conversation-details-instruction" data-requirement="outputs"><summary><h3>{t('交付内容')}</h3></summary><Requirements values={step.outputs}/></details>
                    <details className="wf-conversation-details-instruction" data-requirement="acceptance"><summary><h3>{t('验收标准')}</h3></summary><Requirements values={step.acceptanceCriteria}/></details>
                  </div>
                  {details.steps.find(item => item.id === step.id)?.onRejectStepId && <dl className="wf-conversation-details-requirements"><div><dt>{t('退回目标')}</dt><dd><button type="button" className="wf-conversation-text-button" disabled={pending} onClick={() => inspect(step.onRejectStepId)}>{step.onRejectStepName}</button></dd></div></dl>}
                  {!!details.tasksTotal && <details className="wf-conversation-details-tasks"><summary>{t('已规划任务 · {count}', { count: details.tasksTotal })}</summary><ul>{details.tasks.map(task => <li key={task.id}><span>{task.title}</span><small>{task.employeeName} · {t(taskLabel[task.status])}</small></li>)}</ul>{details.tasksTotal > details.tasks.length && <p>{t('显示最近 {count} 项', { count: details.tasks.length })}</p>}</details>}
                </> : <><h3>{t('步骤内容')}</h3><p className="wf-conversation-details-muted">{t(details.legacyDelivery ? '历史独立交付' : '暂无可查看的步骤')}</p></>}
              </section>
              <section className="wf-conversation-details-section" aria-label={t('交付记录')}>
                <h3>{t('交付记录')}<span>{historyTotal}</span></h3>
                <DeliveryHistory values={history} total={historyTotal} selectedRunId={delivery?.id} disabled={pending || loading} onInspect={item => item.stepId ? inspect(item.stepId, item.id, item.version) : setSelection({ runId: item.id, runVersion: item.version })}/>
                {delivery ? <div className="wf-conversation-delivery" data-delivery-id={delivery.id}><DeliveryRecord value={delivery} onOpenSession={props.onOpenSession}/>
                  {delivery.status === 'awaiting-review' && <div className="wf-conversation-review"><textarea aria-label={t('验收说明')} placeholder={t('验收说明（退回时必填）')} rows={2} value={note} disabled={pending} onChange={event => setNote(event.target.value)}/><div>{delivery.reviewBlockedReason && <span>{errorMessage(delivery.reviewBlockedReason)}</span>}<button type="button" className="is-destructive" disabled={!delivery.reviewable || loading || pending} onClick={() => void review('rejected')}>{t('退回')}</button><button type="button" disabled={!delivery.reviewable || loading || pending} onClick={() => void review('accepted')}>{t('验收通过')}</button></div></div>}
                </div> : <p className="wf-conversation-details-empty" role="status">{t('此步骤尚无交付记录')}</p>}
              </section>
              <section className="wf-conversation-details-section" aria-label={t('交付成果')}>
                <h3>{t('交付成果')}</h3><h4 className="wf-conversation-results-label">{t('文档')}<span>{delivery?.artifacts.length ?? 0}</span></h4>
                <DeliveryArtifacts value={delivery}/>
                <h4 className="wf-conversation-results-label">{t('确定事项')}<span>{confirmedItems.length}</span></h4>
                {confirmedItems.length ? <><p className="wf-conversation-results-provenance">{t('来自已验收交付的事项声明')}</p><div className="wf-conversation-confirmed-items">{confirmedItems.map(item => <details key={`${item.sourceArtifactId}:${item.id}`} data-confirmed-item-id={item.id} data-source-artifact-id={item.sourceArtifactId}><summary>{item.title}</summary><pre>{item.content}</pre><p>{t('验收人：{name}', { name: item.reviewer })} · <time dateTime={item.acceptedAt}>{date(item.acceptedAt, locale)}</time></p><button type="button" disabled={pending || loading} onClick={() => inspect(step!.id, item.runId, item.runVersion)}>{t('查看对应交付')}</button></details>)}</div></> : <p className="wf-conversation-details-empty">{t('暂无已验收的事项声明')}</p>}
              </section>
            </div>
          </div>
        </>}
      </div>}
  </dialog>;
}

type WorkflowStep = Details['steps'][number];
interface ReturnRoute { from: string; to: string; lane: number; start: number; end: number }
/** Every line belongs to an explicit frozen-workflow return rule; coordinates stay inside this scrollable list. */
function WorkflowSteps({ steps, selectedStepId, disabled, workflowName, onInspect }: { steps: WorkflowStep[]; selectedStepId?: string; disabled: boolean; workflowName?: string; onInspect(id: string): void }) {
  const { t, locale } = useI18n();
  const canvas = useRef<HTMLDivElement>(null);
  const markerId = useId().replaceAll(':', '');
  const routes = useMemo(() => {
    const indices = new Map(steps.map((step, index) => [step.id, index]));
    const result: ReturnRoute[] = [];
    for (const [index, step] of steps.entries()) {
      const target = step.onRejectStepId ? indices.get(step.onRejectStepId) : undefined;
      if (target === undefined) continue;
      const start = Math.min(index, target); const end = Math.max(index, target);
      let lane = 0;
      while (result.some(route => route.lane === lane && start <= route.end && end >= route.start)) lane++;
      result.push({ from: step.id, to: steps[target]!.id, lane, start, end });
    }
    return result;
  }, [steps]);
  const gutter = routes.length ? 14 + (Math.max(...routes.map(route => route.lane)) + 1) * 8 : 0;
  const [geometry, setGeometry] = useState<{ height: number; nodes: Record<string, { left: number; y: number }> }>({ height: 0, nodes: {} });
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const measure = () => {
      const bounds = element.getBoundingClientRect(); const nodes: typeof geometry.nodes = {};
      for (const node of element.querySelectorAll<HTMLElement>('[data-flow-node]')) {
        const point = node.getBoundingClientRect();
        nodes[node.dataset.flowNode!] = { left: point.left - bounds.left, y: point.top - bounds.top + point.height / 2 };
      }
      // The absolute SVG must never feed its previous drawing height back into the scroll extent.
      const next = { height: Math.ceil(bounds.height), nodes };
      setGeometry(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    for (const button of element.querySelectorAll('button')) observer.observe(button);
    return () => observer.disconnect();
  }, [steps, locale, gutter]);
  return <nav className="wf-conversation-details-flow" aria-label={t('工作流程')} data-return-count={routes.length}>
    {workflowName && <div className="wf-conversation-details-flow-title">{workflowName}</div>}
    <div ref={canvas} className="wf-conversation-details-flow-canvas" style={{ minWidth: gutter + 160 }}>
      {geometry.height > 0 && routes.length > 0 && <svg className="wf-conversation-details-return-lines" height={geometry.height} aria-hidden="true"><defs><marker id={markerId} markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0L5 2.5L0 5Z"/></marker></defs>{routes.map(route => {
        const source = geometry.nodes[route.from]; const target = geometry.nodes[route.to];
        if (!source || !target) return null;
        const self = route.from === route.to; const x = gutter - 8 - route.lane * 8;
        const y1 = source.y + (self ? 8 : 0); const y2 = target.y - (self ? 8 : 0);
        return <path key={route.from} data-reject-from={route.from} data-reject-to={route.to} d={`M ${source.left - 2} ${y1} H ${x} V ${y2} H ${target.left - 2}`} markerEnd={`url(#${markerId})`}/>;
      })}</svg>}
      <ol style={{ paddingInlineStart: gutter }}>{steps.map((item, index) => {
        const target = steps.find(candidate => candidate.id === item.onRejectStepId);
        return <li key={item.id} className={`is-${item.status}`}><button type="button" data-step-id={item.id} aria-label={t('{number}. {name}，{status}{owner}', { number: index + 1, name: item.name, status: t(statusLabel[item.status]), owner: item.employeeName ? t('，负责人 {name}', { name: item.employeeName }) : '' }) + (target ? t('；验收不合格退回第{number}步：{name}', { number: steps.indexOf(target) + 1, name: target.name }) : '')} aria-current={selectedStepId === item.id ? 'true' : undefined} disabled={disabled} onClick={() => onInspect(item.id)}><span className={`wf-conversation-details-node wf-conversation-workflow-dot is-${item.status}`} data-flow-node={item.id} aria-hidden="true"><span className="wf-conversation-workflow-step-number">{index + 1}</span></span><span className="wf-conversation-details-step-copy"><span>{item.name}</span><small>{t(statusLabel[item.status])}{item.employeeName && ` · ${item.employeeName}`}</small></span></button></li>;
      })}</ol>
    </div>
  </nav>;
}

function Requirements({ values }: { values: string[] }) { const { t } = useI18n(); return values.length ? <ul>{values.map((value, index) => <li key={index}>{value}</li>)}</ul> : <span>{t('未设置')}</span>; }
function DeliveryHistory({ values, total, selectedRunId, disabled, onInspect }: { values: ConversationWorkflowDeliverySummary[]; total: number; selectedRunId?: string; disabled: boolean; onInspect(item: ConversationWorkflowDeliverySummary): void }) {
  const { t, locale } = useI18n();
  return values.length > 0 && <><div className="wf-conversation-delivery-history">{values.map(item => <button key={item.id} type="button" data-run-id={item.id} aria-pressed={item.id === selectedRunId} disabled={disabled} onClick={() => onInspect(item)}><span>{item.title}</span><small><time dateTime={item.updatedAt}>{date(item.updatedAt, locale)}</time><span>{t(runLabel[item.status])}</span></small></button>)}</div>{total > values.length && <p className="wf-conversation-details-muted">{t('显示最近 {count} 项', { count: values.length })}</p>}</>;
}
function DeliveryRecord({ value, onOpenSession }: { value: ConversationWorkflowDelivery; onOpenSession?: (id: string) => void }) {
  const { t, locale, errorMessage } = useI18n();
  return <>
    <p className="wf-conversation-delivery-meta"><span>{value.employeeName} · {t(runLabel[value.status])}</span><time dateTime={value.updatedAt}>{date(value.updatedAt, locale)}</time></p>
    {value.error && <p role="status">{errorMessage(value.error)}</p>}
    {value.output && <details className="wf-conversation-delivery-response"><summary>{t('交付回复')}</summary><pre>{value.output}</pre>{value.outputTruncated && <p>{t('当前显示部分内容，原交付共 {count} 字符。', { count: value.outputLength ?? value.output.length })}</p>}</details>}
    {value.acceptance && <p className="wf-conversation-acceptance">{t(value.acceptance.decision === 'accepted' ? '验收通过' : '已退回')} · {value.acceptance.reviewer} · <time dateTime={value.acceptance.at}>{date(value.acceptance.at, locale)}</time>{value.acceptance.note && <span>{value.acceptance.note}</span>}</p>}
    {value.sessionId && onOpenSession && <button type="button" onClick={() => onOpenSession(value.sessionId!)}>{t('打开原对话')}</button>}
  </>;
}
function DeliveryArtifacts({ value }: { value?: ConversationWorkflowDelivery }) {
  const { t } = useI18n();
  return value?.artifacts.length ? <div className="wf-conversation-artifacts">{value.artifacts.map(item => <details key={item.id} data-artifact-id={item.id}><summary><span>{item.title}</span>{item.path && <code>{item.path}</code>}</summary>{item.content !== undefined ? <pre>{item.content}</pre> : <p>{t('此文件暂无文本预览，请到原对话查看。')}</p>}{item.contentTruncated && <p>{t('当前显示部分内容，原内容共 {count} 字符。', { count: item.contentLength ?? item.content?.length ?? 0 })}</p>}</details>)}</div> : <p className="wf-conversation-details-empty">{t('本次交付未附阶段文件。')}</p>;
}
