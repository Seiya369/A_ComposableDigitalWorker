import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import type { ConversationEmployeeController, ConversationEmployeeSnapshot } from '../client/conversation-employee.js';
import { createPortal } from 'react-dom';
import { Icon } from './icons.js';
import { useI18n } from './i18n.js';
import './conversation-employee.css';

export interface ConversationEmployeeProps { sessionId: string; controller: ConversationEmployeeController }

interface MenuProps {
  snapshot: ConversationEmployeeSnapshot; active: number; pending: boolean;
  menuId: string; error?: string; listRef?: React.Ref<HTMLDivElement>;
  onActive(index: number): void; onChoose(index: number): void;
  onKeys(event: KeyboardEvent<HTMLDivElement>): void; onRefresh(): void;
}
/** A compact list: choosing an employee establishes explicit conversation residency. */
export function ConversationEmployeeMenu({ snapshot, active, pending, menuId, error, listRef, onActive, onChoose, onKeys, onRefresh }: MenuProps) {
  const { t, errorMessage } = useI18n();
  const disabled = pending || snapshot.busy;
  const selected = snapshot.conversationEmployee?.employeeId;
  return <div className="wf-conversation-employee-menu">
    <div id={menuId} ref={listRef} className="wf-conversation-employee-options" role="listbox" aria-label={t('选择对话员工')} aria-activedescendant={`${menuId}-option-${active}`} aria-busy={pending} tabIndex={0} onKeyDown={onKeys}>
      <div id={`${menuId}-option-0`} role="option" aria-selected={!snapshot.conversationEmployee} aria-disabled={disabled} className={`wf-conversation-employee-option${active === 0 ? ' is-active' : ''}`} onPointerMove={() => onActive(0)} onClick={() => onChoose(0)}><span>{t('无')}</span>{!snapshot.conversationEmployee && <Icon name="check" size={14}/>}</div>
      {snapshot.choices.map((choice, index) => <div key={`${choice.kind}:${choice.id}`} id={`${menuId}-option-${index + 1}`} role="option" aria-selected={choice.kind === 'employee' && choice.id === selected} aria-disabled={disabled} className={`wf-conversation-employee-option${active === index + 1 ? ' is-active' : ''}`} onPointerMove={() => onActive(index + 1)} onClick={() => onChoose(index + 1)}>
        <span>{choice.name}</span>{choice.kind === 'employee' && choice.id === selected && <Icon name="check" size={14}/>}
      </div>)}
    </div>
    {(error || snapshot.unavailableReason) && <div className="wf-conversation-employee-error" role="alert"><span>{errorMessage(error || snapshot.unavailableReason)}</span>{error && <button type="button" onClick={onRefresh}>{t('重试')}</button>}</div>}
  </div>;
}

/** Public header.utilities slot, aligned with the project contact row using read-only geometry. */
export function ConversationEmployee({ sessionId, controller }: ConversationEmployeeProps) {
  const { t, locale } = useI18n();
  const subscribe = useCallback((listener: () => void) => controller.subscribe(sessionId, listener), [controller, sessionId]);
  const read = useCallback(() => controller.read(sessionId), [controller, sessionId]);
  const { snapshot, loading, pending, error } = useSyncExternalStore(subscribe, read, read);
  const seat = useRef<HTMLDivElement>(null), popup = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), label = useRef<HTMLSpanElement>(null), list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const [placement, setPlacement] = useState({ top: 0, left: 0, width: 220, popupLeft: 0, popupTop: 28, aligned: false, ready: false });
  const menuId = useId();
  const busy = loading || pending || snapshot?.busy === true;
  const contains = (node: EventTarget | null) => node instanceof Node && Boolean(root.current?.contains(node) || popup.current?.contains(node));
  const reveal = (index: number) => {
    const container = list.current, option = container?.children.item(index);
    if (!container || !option) return;
    const viewport = container.getBoundingClientRect(), row = option.getBoundingClientRect();
    if (row.top < viewport.top) container.scrollTop += row.top - viewport.top;
    else if (row.bottom > viewport.bottom) container.scrollTop += row.bottom - viewport.bottom;
  };
  const close = (restore = false) => { setOpen(false); if (restore) trigger.current?.focus(); };
  const show = () => {
    if (!snapshot?.enabled) return;
    setActive(Math.max(0, snapshot.choices.findIndex(choice => choice.kind === 'employee' && choice.id === snapshot.conversationEmployee?.employeeId) + 1));
    setOpen(true);
  };
  useEffect(() => { setOpen(false); }, [sessionId, snapshot?.enabled]);
  useEffect(() => {
    if (!open) return;
    list.current?.focus({ preventScroll: true });
    reveal(active);
    const outside = (event: PointerEvent) => { if (!contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);
  useEffect(() => { if (snapshot && active > snapshot.choices.length) setActive(0); }, [active, snapshot?.choices.length]);
  useLayoutEffect(() => {
    const anchor = seat.current, header = anchor?.closest('header');
    if (!anchor || !header) return;
    const glyph = (node: Element) => { const range = document.createRange(); range.selectNodeContents(node); return range.getBoundingClientRect(); };
    const measure = () => {
      if (!root.current || !label.current || !trigger.current) return;
      const bounds = anchor.getBoundingClientRect(), headerBounds = header.getBoundingClientRect();
      // Native panels may retain a hidden conversation instead of unmounting
      // its slot. A portal must follow that seat's visibility too.
      if (!bounds.width || !bounds.height || !headerBounds.width || !headerBounds.height
        || anchor.closest('[hidden], [aria-hidden="true"], [inert]') || getComputedStyle(anchor).visibility !== 'visible') {
        setOpen(false);
        setPlacement(previous => previous.ready ? { ...previous, ready: false } : previous);
        return;
      }
      const tab = [...header.querySelectorAll('[data-conversation-tabs] [role="tab"]')].reverse().find(node => { const rect = node.getBoundingClientRect(); return rect.width && rect.height && node.textContent?.trim(); });
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const contentRight = Math.min(viewportWidth - 16, headerBounds.right - Math.max(16, Number.parseFloat(getComputedStyle(header).paddingRight) || 0));
      let left = bounds.left + 4, width = Math.min(220, contentRight - left), top = bounds.top, aligned = false;
      if (tab) {
        const target = glyph(tab), textOffset = glyph(label.current).bottom - trigger.current.getBoundingClientRect().top;
        top = target.bottom - textOffset;
        aligned = top >= headerBounds.top && top + trigger.current.offsetHeight <= headerBounds.bottom - 1;
        if (aligned) for (const control of header.querySelectorAll('button, a, input, select, textarea, [role="tab"]')) {
          const box = control.getBoundingClientRect();
          if (box.width && box.height && box.right > left && box.left < contentRight && box.bottom > target.top && box.top < target.bottom) width = 0;
        }
      }
      if (!aligned || width < 80) { top = bounds.top; left = bounds.left; width = Math.min(220, bounds.width); aligned = false; }
      width = Math.max(1, Math.min(width, viewportWidth - 16));
      left = Math.max(8, Math.min(left, viewportWidth - width - 8));
      const popupWidth = Math.min(viewportWidth - 32, viewportWidth <= 720 ? 220 : 240);
      const popupLeft = Math.max(16, Math.min(viewportWidth - popupWidth - 16, left + width - popupWidth));
      const next = { top, left, width, popupLeft, popupTop: Math.max(top + 28, headerBounds.bottom + 4), aligned, ready: true };
      setPlacement(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const resize = new ResizeObserver(measure); resize.observe(anchor); resize.observe(header);
    const content = new MutationObserver(measure); content.observe(header, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'aria-hidden'] });
    const visibility = new MutationObserver(measure);
    for (let parent = anchor.parentElement; parent; parent = parent.parentElement) visibility.observe(parent, { attributes: true, attributeFilter: ['hidden', 'aria-hidden', 'inert', 'class', 'style'] });
    window.addEventListener('resize', measure);
    document.addEventListener('scroll', measure, true);
    measure(); return () => { resize.disconnect(); content.disconnect(); visibility.disconnect(); window.removeEventListener('resize', measure); document.removeEventListener('scroll', measure, true); };
  }, [snapshot?.enabled, snapshot?.conversationEmployee?.employeeId, snapshot?.employee?.name, locale]);
  if (!snapshot?.enabled) return null;
  const binding = snapshot.conversationEmployee;
  const name = snapshot.employee?.name;
  const text = binding ? name || t('常驻员工不可用') : t('选择对话员工');
  const choose = async (index: number) => {
    if (busy) return;
    const choice = snapshot.choices[index - 1];
    if (choice?.kind === 'employee' && binding?.employeeId === choice.id && binding.mode === 'execute') { close(true); return; }
    const changed = index === 0 ? !binding || await controller.clear(sessionId) : choice && await controller.select(sessionId, choice, 'execute');
    if (changed) close(true);
  };
  const onKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void choose(active); return; }
    const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (!delta && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault(); const count = snapshot.choices.length + 1;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : (active + delta + count) % count;
    setActive(next); reveal(next);
  };
  const onEscape = (event: KeyboardEvent<HTMLDivElement>) => { if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(true); } };
  const onBlur = (event: React.FocusEvent<HTMLDivElement>) => { if (!contains(event.relatedTarget)) setOpen(false); };
  // Own fixed nodes escape native title-row clipping and drag-region geometry.
  // Their real boxes cover only the visible controls, never the whole viewport.
  const controls = <>
    <div ref={root} className="wf-conversation-employee" data-contact-aligned={placement.aligned} style={{ top: placement.top, left: placement.left, width: placement.width, visibility: placement.ready ? 'visible' : 'hidden' }} onKeyDown={onEscape} onBlur={onBlur}>
      <button ref={trigger} type="button" className="wf-conversation-employee-trigger" aria-label={text} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? menuId : undefined} aria-busy={pending} title={text} onClick={() => open ? close() : show()} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show(); } }}><span ref={label}>{text}</span><Icon name="chevron" size={12}/></button>
    </div>
    {open && <div ref={popup} id={`${menuId}-dialog`} className="wf-conversation-employee-popup" style={{ top: placement.popupTop, left: placement.popupLeft }} onKeyDown={onEscape} onBlur={onBlur}><ConversationEmployeeMenu snapshot={snapshot} active={active} pending={pending} menuId={menuId} error={error} listRef={list} onActive={setActive} onChoose={index => void choose(index)} onKeys={onKeys} onRefresh={() => void controller.refresh(sessionId)}/></div>}
  </>;
  return <><div ref={seat} className="wf-conversation-employee-seat" style={{ width: placement.aligned ? 32 : 220 }}/>{typeof document === 'undefined' ? controls : createPortal(controls, document.body)}</>;
}
