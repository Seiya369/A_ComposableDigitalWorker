import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent } from 'react';
import type { ConversationWorkflowController } from '../client/conversation-workflow.js';
import type { ConversationReopenRecovery } from '../client/conversation-workflow-reopen.js';
import type { ConversationWorkflowDetailsClient } from '../client/conversation-workflow-details.js';
import { ConversationWorkflowDetails } from './ConversationWorkflowDetails.js';
import { Icon } from './icons.js';
import { useI18n } from './i18n.js';
import { layoutConversationWorkflow, selectConversationWorkflowWindow } from './conversation-workflow-layout.js';
import './conversation-workflow.css';
import './conversation-workflow-graph.css';

export interface ConversationWorkflowProps { sessionId: string; controller: ConversationWorkflowController; recovery?: ConversationReopenRecovery; detailsClient?: ConversationWorkflowDetailsClient; onOpenSession?: (sessionId: string) => void }

function useWorkflow({ sessionId, controller }: ConversationWorkflowProps) {
  const subscribe = useCallback((listener: () => void) => controller.subscribe(sessionId, listener), [controller, sessionId]);
  const read = useCallback(() => controller.read(sessionId), [controller, sessionId]);
  return useSyncExternalStore(subscribe, read, read);
}

/** Native input.left contribution. Its entire menu is plugin-owned. */
export function ConversationWorkflowPicker(props: ConversationWorkflowProps) {
  const { t, errorMessage } = useI18n();
  const state = useWorkflow(props);
  const subscribeRecovery = useCallback((listener: () => void) => props.recovery?.subscribe(listener) ?? (() => {}), [props.recovery]);
  const readRecovery = useCallback(() => props.recovery?.read(props.sessionId), [props.recovery, props.sessionId]);
  const recoveryNotice = useSyncExternalStore(subscribeRecovery, readRecovery, readRecovery);
  const { snapshot, loading, pending } = state;
  const error = state.error || snapshot?.unavailableReason;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const choices = [{ id: '', name: t('无'), disabled: false, disabledReason: undefined }, ...(snapshot?.choices ?? [])];
  const selected = snapshot?.workflowTemplateId ?? '';
  const workflowLabel = t('工作流：{name}', { name: snapshot?.workflowName ?? t('无') });
  const busy = loading || pending || snapshot?.busy === true;
  const close = (restore = false) => { setOpen(false); if (restore) trigger.current?.focus(); };
  const show = () => {
    if (!snapshot?.projectId || busy) return;
    setActive(Math.max(0, choices.findIndex(choice => choice.id === selected)));
    setOpen(true);
  };

  useEffect(() => { setOpen(false); }, [props.sessionId]);
  useEffect(() => {
    if (!open) return;
    list.current?.focus();
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);
  useEffect(() => {
    if (open) document.getElementById(`${menuId}-option-${active}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active, open, menuId]);
  useEffect(() => { if (active >= choices.length) setActive(Math.max(0, choices.length - 1)); }, [active, choices.length]);

  const choose = async (index: number) => {
    const choice = choices[index];
    if (!choice || choice.disabled || busy) return;
    const changed = await props.controller.selectWorkflow(props.sessionId, choice.id || null);
    if (changed) close(true);
  };
  const onKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.key === 'Tab') {
      close();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void choose(active); return; }
    const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (!delta && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const enabled = choices.map((choice, index) => ({ choice, index })).filter(item => !item.choice.disabled).map(item => item.index);
    if (event.key === 'Home') setActive(enabled[0] ?? 0);
    else if (event.key === 'End') setActive(enabled.at(-1) ?? 0);
    else setActive(enabled[(Math.max(0, enabled.indexOf(active)) + delta + enabled.length) % enabled.length] ?? 0);
  };

  if (!loading && !snapshot?.projectId && !error) return null;
  return <div ref={root} className="wf-conversation-workflow-picker" onKeyDown={event => { if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); } }}>
    <button ref={trigger} type="button" className="wf-native-button wf-conversation-workflow-trigger" aria-label={workflowLabel} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? menuId : undefined} disabled={busy || !snapshot?.projectId} title={workflowLabel} onClick={() => open ? close() : show()} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show(); } }}>
      <Icon name="network" size={16}/><span>{workflowLabel}</span><Icon name="chevron" size={12} className="wf-conversation-workflow-chevron"/>
    </button>
    {recoveryNotice && <span className="wf-conversation-workflow-recovery" role="alert"><span>{errorMessage(recoveryNotice)}</span><button type="button" onClick={() => props.recovery?.retry(props.sessionId)}>{t('刷新继续')}</button></span>}
    {open && <div className="wf-conversation-workflow-menu">
      {error && <div className="wf-conversation-workflow-error" role="alert">{errorMessage(error)}<button type="button" onClick={() => void props.controller.refresh(props.sessionId)}>{t('重试')}</button></div>}
      <div id={menuId} ref={list} className="wf-conversation-workflow-options" role="listbox" aria-label={t('项目工作流')} aria-activedescendant={`${menuId}-option-${active}`} aria-busy={pending} tabIndex={-1} onKeyDown={onKeys}>
        {choices.map((choice, index) => <div id={`${menuId}-option-${index}`} key={choice.id} role="option" aria-selected={choice.id === selected} aria-disabled={choice.disabled || pending} className={`wf-conversation-workflow-option${index === active ? ' is-active' : ''}`} title={choice.disabledReason ? errorMessage(choice.disabledReason) : undefined} onPointerMove={() => { if (!choice.disabled) setActive(index); }} onClick={() => void choose(index)}>
          <span>{choice.name}</span>{choice.id === selected && <Icon name="check" size={16}/>}
        </div>)}
      </div>
    </div>}
    {!open && error && <span className="wf-conversation-workflow-error wf-conversation-workflow-inline-error" role="alert"><span>{errorMessage(error)}</span><button type="button" onClick={() => void props.controller.refresh(props.sessionId)}>{t('重试')}</button></span>}
  </div>;
}

/** Official header.utilities contribution; step state comes only from persisted progress. */
export function ConversationWorkflowSteps(props: ConversationWorkflowProps) {
  const { t, locale } = useI18n();
  const { snapshot, pending } = useWorkflow(props);
  const strip = useRef<HTMLDivElement>(null);
  const alignmentProbe = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(500);
  const [alignment, setAlignment] = useState({ offsetY: 0, aboveSpace: 0, showLabels: false, contactLeft: 0, contactWidth: 0, labelOffsets: {} as Record<string, number> });
  const [detailsOpen, setDetailsOpen] = useState(false);
  const arrowId = useId().replace(/:/g, '');
  useEffect(() => { setDetailsOpen(false); }, [props.sessionId, snapshot?.workflowTemplateId]);
  useEffect(() => {
    if (!strip.current) return;
    const observer = new ResizeObserver(entries => setWidth(entries[0]?.contentRect.width ?? 0));
    observer.observe(strip.current);
    return () => observer.disconnect();
  }, [snapshot?.workflowTemplateId]);
  useLayoutEffect(() => {
    const nav = strip.current;
    const header = nav?.closest('header');
    if (!nav || !header) return;
    const measure = () => {
      const bounds = nav.getBoundingClientRect();
      const bar = nav.closest('.wf-conversation-workflow-bar');
      const headerBounds = header.getBoundingClientRect();
      let aboveSpace = Math.max(0, bounds.top - headerBounds.top - 1);
      let belowSpace = Math.max(0, headerBounds.bottom - bounds.bottom - 2);
      for (const control of header.querySelectorAll('button, a, input, select, textarea, [role="tab"], [contenteditable="true"]')) {
        if (bar?.contains(control)) continue;
        const box = control.getBoundingClientRect();
        if (!box.width || !box.height || box.right <= bounds.left || box.left >= bounds.right) continue;
        if (box.top < bounds.top) aboveSpace = Math.min(aboveSpace, bounds.top - box.bottom - 2);
        if (box.bottom > bounds.bottom) belowSpace = Math.min(belowSpace, box.top - bounds.bottom - 2);
      }
      const glyphBounds = (node: Element) => {
        const range = document.createRange(); range.selectNodeContents(node);
        return range.getBoundingClientRect();
      };
      // The public native tab anchor and this constant-font probe never depend on workflow return lanes.
      const tab = [...header.querySelectorAll('[data-conversation-tabs] [role="tab"]')].reverse().find(node => {
        const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0 && node.textContent?.trim();
      });
      const probe = alignmentProbe.current;
      const target = tab && glyphBounds(tab);
      const currentOffset = Number(nav.dataset.offsetY) || 0;
      const desiredOffset = target && probe ? currentOffset + target.bottom - glyphBounds(probe).bottom : 0;
      const maxOffset = 30 + Math.max(0, belowSpace) - 52;
      const showLabels = !!target && maxOffset >= 0 && desiredOffset >= -.5 && desiredOffset <= maxOffset + .5;
      const round = (value: number) => Math.round(value * 1000) / 1000;
      const offsetY = showLabels ? round(Math.max(0, Math.min(desiredOffset, maxOffset))) : 0;
      const labelOffsets: Record<string, number> = {};
      if (showLabels) for (const label of (bar ?? nav).querySelectorAll<HTMLElement>('.wf-conversation-workflow-step-label, .wf-conversation-workflow-contact')) {
        const previous = Number(label.dataset.offsetY) || 0;
        labelOffsets[label.dataset.stepId!] = round(target!.bottom - (glyphBounds(label).bottom - previous + offsetY - currentOffset));
      }
      // Own read-only text uses the otherwise empty label row beneath native right controls.
      // Do not reserve graph width, move native controls, or write any host element styles.
      const barBounds = bar?.getBoundingClientRect();
      const contentRight = headerBounds.right - Math.max(16, Number.parseFloat(getComputedStyle(header).paddingRight) || 0);
      let contactWidth = 0;
      const details = bar?.querySelector('.wf-conversation-workflow-details-trigger');
      const contactLeft = details ? glyphBounds(details).left : contentRight;
      contactWidth = Math.max(0, Math.min(220, contentRight - contactLeft));
      if (target) for (const control of header.querySelectorAll('button, a, input, select, textarea, [role="tab"]')) {
        if (bar?.contains(control)) continue;
        const box = control.getBoundingClientRect();
        if (box.width && box.height && box.right > contactLeft && box.left < contentRight && box.bottom > target.top && box.top < target.bottom) contactWidth = 0;
      }
      const next = { offsetY, aboveSpace: round(Math.max(0, aboveSpace)), showLabels, contactLeft: round(contactLeft - (barBounds?.left ?? contactLeft)), contactWidth: round(contactWidth), labelOffsets };
      setAlignment(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const resize = new ResizeObserver(measure);
    resize.observe(nav); resize.observe(header);
    if (alignmentProbe.current) resize.observe(alignmentProbe.current);
    const content = new MutationObserver(measure);
    content.observe(header, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'aria-hidden'] });
    measure();
    return () => { resize.disconnect(); content.disconnect(); };
  }, [snapshot?.workflowTemplateId, snapshot?.currentStepId, snapshot?.steps, locale, width]);
  if (!snapshot?.workflowTemplateId || !snapshot.steps.length) return null;
  const total = snapshot.steps.length;
  const currentIndex = Math.max(0, snapshot.steps.findIndex(step => step.id === snapshot.currentStepId));
  const { start, count, beforeWidth, afterWidth } = selectConversationWorkflowWindow(total, width, currentIndex);
  const visible = snapshot.steps.slice(start, start + count);
  const moreBefore = start > 0 && beforeWidth > 0;
  const moreAfter = start + count < total && afterWidth > 0;
  const graph = layoutConversationWorkflow({ steps: snapshot.steps, visibleIds: visible.map(step => step.id), width, beforeWidth, afterWidth, offsetY: alignment.offsetY, aboveSpace: alignment.aboveSpace, showLabels: alignment.showLabels });
  const ownerName = snapshot.ownerName ?? snapshot.steps.find(step => step.id === snapshot.currentStepId)?.employeeName;
  const contactLabel = ownerName ? t('{name}正在对接', { name: ownerName }) : undefined;
  const returnDescription = (stepId: string) => {
    // Geometry exposes cross-step returns only; implicit/explicit self retry has no visual hint.
    const destination = graph.returns.find(edge => edge.sourceId === stepId);
    return destination ? t('；验收不合格退回第{number}步：{name}', { number: destination.targetIndex + 1, name: destination.targetName }) : '';
  };
  return <div className="wf-conversation-workflow-bar">
    <nav ref={strip} className="wf-conversation-workflow-steps" data-graph="true" data-offset-y={graph.offsetY} data-labels-visible={alignment.showLabels} style={{ height: graph.height }} aria-label={t('{name}步骤', { name: snapshot.workflowName ?? t('工作流') })} aria-description={t('实线表示步骤顺序，虚线表示验收不合格时退回。')} aria-busy={pending}>
      <span ref={alignmentProbe} className="wf-conversation-workflow-alignment-probe" aria-hidden="true" style={{ top: graph.offsetY + 33 }}>{'Ag国'}</span>
      <svg className="wf-conversation-workflow-connections" style={{ top: graph.drawingTop }} width="100%" height={graph.drawingHeight} viewBox={`0 ${graph.drawingTop} ${Math.max(1, graph.width)} ${graph.drawingHeight}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <defs><marker id={`${arrowId}-return`} markerWidth="5" markerHeight="5" refX="5" refY="2.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 0 L 5 2.5 L 0 5 Z" fill="currentColor"/></marker></defs>
        {graph.edges.map(edge => <path key={edge.id} data-kind={edge.kind} data-source={edge.sourceId} data-target={edge.targetId} d={edge.path} markerEnd={edge.kind === 'reject' ? `url(#${arrowId}-return)` : undefined}/ >)}
      </svg>
      {moreBefore && <span className="wf-conversation-workflow-more is-before" role="img" aria-label={t('前面省略了{count}个步骤', { count: start })} style={{ top: graph.nodeY - 14, left: Math.max(0, (graph.nodes[0]?.x ?? 42) - 42) }}>…</span>}
      {graph.nodes.map(node => { const step = snapshot.steps[node.index]!; const labelOffset = alignment.labelOffsets[step.id] ?? 0; return <button key={step.id} type="button" className={`wf-conversation-workflow-step is-${step.status}`} style={{ top: graph.offsetY, left: node.left, width: node.width, height: graph.contentHeight, paddingTop: 2 }} aria-current={step.status === 'current' ? 'step' : undefined} aria-label={t('{number}. {name}，{status}{owner}', { number: node.index + 1, name: step.name, status: t(step.status === 'current' ? '当前步骤' : step.status === 'completed' ? '已完成' : '未完成'), owner: step.employeeName ? t('，负责人 {name}', { name: step.employeeName }) : '' }) + returnDescription(step.id)} title={`${node.index + 1}. ${step.name}${step.employeeName ? ` · ${step.employeeName}` : ''}${returnDescription(step.id)}`} aria-disabled={pending || snapshot.busy || !!snapshot.unavailableReason} onClick={() => { if (!pending && !snapshot.busy && !snapshot.unavailableReason) void props.controller.selectStep(props.sessionId, step.id); }}>
        <span className="wf-conversation-workflow-dot" aria-hidden="true"><span className="wf-conversation-workflow-step-number">{node.index + 1}</span></span><span className="wf-conversation-workflow-step-label" data-step-id={step.id} data-offset-y={labelOffset} style={{ transform: `translateY(${labelOffset}px)` }}>{step.name}</span>
      </button>; })}
      {moreAfter && <span className="wf-conversation-workflow-more is-after" role="img" aria-label={t('后面省略了{count}个步骤', { count: total - start - count })} style={{ top: graph.nodeY - 14, left: Math.min(Math.max(0, width - 16), (graph.nodes.at(-1)?.x ?? width - 42) + 26) }}>…</span>}
    </nav>
    <button type="button" className="wf-conversation-workflow-details-trigger" style={{ transform: `translate(min(0px, calc(${(graph.nodes.at(-1)?.x ?? width) + 50 - width}px - var(--wf-workflow-gap))), ${graph.nodeY - graph.height / 2}px)` }} title={graph.overflowReturnCount ? t('还有{count}条退回连线，可在详情查看。', { count: graph.overflowReturnCount }) : undefined} disabled={!props.detailsClient} onClick={() => setDetailsOpen(true)}>{t('详情')}</button>
    {contactLabel && <span className="wf-conversation-workflow-contact" data-step-id="$contact" data-offset-y={alignment.labelOffsets.$contact ?? 0} data-visible={alignment.showLabels && alignment.contactWidth >= 60} style={{ left: alignment.contactLeft, width: alignment.contactWidth, top: graph.offsetY + 33, transform: `translateY(${alignment.labelOffsets.$contact ?? 0}px)` }} title={contactLabel} aria-live="polite">{contactLabel}</span>}
    {detailsOpen && props.detailsClient && <ConversationWorkflowDetails sessionId={props.sessionId} client={props.detailsClient} onClose={() => setDetailsOpen(false)} onChanged={() => props.controller.refresh(props.sessionId)} onActivate={stepId => props.controller.selectStep(props.sessionId, stepId)} onOpenSession={sessionId => { setDetailsOpen(false); props.onOpenSession?.(sessionId); }}/ >}
  </div>;
}
