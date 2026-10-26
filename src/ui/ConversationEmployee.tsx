import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import type { ConversationEmployeeController, ConversationEmployeeSnapshot } from '../client/conversation-employee.js';
import type { ConversationEmployeeMode, EmployeeInfoCard } from '../domain/conversation-employee.js';
import { Icon } from './icons.js';
import { useI18n } from './i18n.js';
import './conversation-employee.css';

export interface ConversationEmployeeProps { sessionId: string; controller: ConversationEmployeeController }

/** This card is a saved configuration projection. Expanding it performs no request. */
export function EmployeeInformationCard({ card }: { card: EmployeeInfoCard }) {
  const { t } = useI18n();
  const capabilities = [...card.capabilities.skills.map(skill => skill.name), ...card.capabilities.tools, ...card.capabilities.plugins, ...card.capabilities.mcps];
  return <details className="wf-conversation-employee-card">
    <summary>{t('查看员工资料（无需模型）')}</summary>
    <h3>{card.name}</h3><p>{card.mission}</p>
    {card.duties.length > 0 && <><h4>{t('岗位职责')}</h4><ul>{card.duties.map((duty, index) => <li key={index}>{duty}</li>)}</ul></>}
    {card.boundaries.length > 0 && <><h4>{t('工作边界')}</h4><ul>{card.boundaries.map((boundary, index) => <li key={index}>{boundary}</li>)}</ul></>}
    {capabilities.length > 0 && <><h4>{t('专业能力')}</h4><ul>{capabilities.map((name, index) => <li key={index}>{name}</li>)}</ul></>}
  </details>;
}

interface MenuProps {
  snapshot: ConversationEmployeeSnapshot; mode: ConversationEmployeeMode; active: number; pending: boolean;
  menuId: string; error?: string; listRef?: React.Ref<HTMLDivElement>;
  onActive(index: number): void; onChoose(index: number): void; onMode(mode: ConversationEmployeeMode): void; onKeys(event: KeyboardEvent<HTMLDivElement>): void; onRefresh(): void;
}
/** All employee entries, mode controls and information remain plugin-owned. */
export function ConversationEmployeeMenu({ snapshot, mode, active, pending, menuId, error, listRef, onActive, onChoose, onMode, onKeys, onRefresh }: MenuProps) {
  const { t, errorMessage } = useI18n();
  const disabled = pending || snapshot.busy;
  const selected = snapshot.conversationEmployee?.employeeId;
  const preview = active > 0 ? snapshot.choices[active - 1]?.card : snapshot.employee;
  const modeLabel = mode === 'consult' ? t('轻咨询：提供岗位建议，不调用工具或自动加载技能，不自动整理知识。') : t('执行任务：按员工能力调用获准工具和技能，执行结果留在当前对话。');
  return <div className="wf-conversation-employee-menu" role="dialog" aria-label={t('常驻此对话')}>
    <p className="wf-conversation-employee-note">{t('仅在此对话生效；@ 员工仍是单次委派。')}</p>
    <fieldset className="wf-conversation-employee-modes" disabled={disabled || !!snapshot.unavailableReason}>
      <legend>{t('处理方式')}</legend>
      {(['consult', 'execute'] as const).map(value => <label key={value}><input type="radio" name={`${menuId}-mode`} value={value} checked={mode === value} onChange={() => onMode(value)}/>{t(value === 'consult' ? '轻咨询' : '执行任务')}</label>)}
    </fieldset>
    <p id={`${menuId}-mode-description`} className="wf-conversation-employee-note">{modeLabel}</p>
    <p className="wf-conversation-employee-note">{t('模型与推理沿用员工配置；简单问题可选较快模型或较低推理档位。')}</p>
    {snapshot.busy && <p className="wf-conversation-employee-note" role="status">{t('当前对话正在执行，请等待本轮结束再切换常驻员工')}</p>}
    {snapshot.unavailableReason && <p className="wf-conversation-employee-error" role="alert">{errorMessage(snapshot.unavailableReason)}</p>}
    <div id={menuId} ref={listRef} className="wf-conversation-employee-options" role="listbox" aria-label={t('常驻员工')} aria-describedby={`${menuId}-mode-description`} aria-activedescendant={`${menuId}-option-${active}`} aria-busy={pending} tabIndex={0} onKeyDown={onKeys}>
      <div id={`${menuId}-option-0`} role="option" aria-selected={!snapshot.conversationEmployee} aria-disabled={disabled} className={`wf-conversation-employee-option${active === 0 ? ' is-active' : ''}`} onPointerMove={() => onActive(0)} onClick={() => onChoose(0)}><span>{t(snapshot.conversationEmployee ? '退出常驻，使用原生助手' : '不常驻 · 原生助手')}</span>{!snapshot.conversationEmployee && <Icon name="check" size={14}/>}</div>
      {snapshot.choices.map((choice, index) => <div key={`${choice.kind}:${choice.id}`} id={`${menuId}-option-${index + 1}`} role="option" aria-selected={choice.kind === 'employee' && choice.id === selected} aria-disabled={disabled} className={`wf-conversation-employee-option${active === index + 1 ? ' is-active' : ''}`} onPointerMove={() => onActive(index + 1)} onClick={() => onChoose(index + 1)}>
        <span><strong>{choice.name}</strong><small>{choice.description}</small></span>{choice.kind === 'employee' && choice.id === selected && <Icon name="check" size={14}/>}
      </div>)}
    </div>
    {preview && <EmployeeInformationCard key={preview.name} card={preview}/>}
    {error && <div className="wf-conversation-employee-error" role="alert"><span>{errorMessage(error)}</span><button type="button" onClick={onRefresh}>{t('重试')}</button></div>}
  </div>;
}

/** Public header.utilities slot, aligned with the project contact row using read-only geometry. */
export function ConversationEmployee({ sessionId, controller }: ConversationEmployeeProps) {
  const { t, locale } = useI18n();
  const subscribe = useCallback((listener: () => void) => controller.subscribe(sessionId, listener), [controller, sessionId]);
  const read = useCallback(() => controller.read(sessionId), [controller, sessionId]);
  const { snapshot, loading, pending, error } = useSyncExternalStore(subscribe, read, read);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), label = useRef<HTMLSpanElement>(null), list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [active, setActive] = useState(0), [mode, setMode] = useState<ConversationEmployeeMode>('consult');
  const [placement, setPlacement] = useState({ top: 0, left: 0, width: 220, popupLeft: -120, aligned: false });
  const menuId = useId();
  const busy = loading || pending || snapshot?.busy === true;
  const close = (restore = false) => { setOpen(false); if (restore) trigger.current?.focus(); };
  const show = () => {
    if (!snapshot?.enabled) return;
    setMode(snapshot.conversationEmployee?.mode ?? 'consult');
    setActive(Math.max(0, snapshot.choices.findIndex(choice => choice.kind === 'employee' && choice.id === snapshot.conversationEmployee?.employeeId) + 1));
    setOpen(true);
  };
  useEffect(() => { setOpen(false); }, [sessionId, snapshot?.enabled]);
  useEffect(() => { if (!pending && snapshot?.conversationEmployee) setMode(snapshot.conversationEmployee.mode); }, [pending, snapshot?.conversationEmployee?.mode]);
  useEffect(() => {
    if (!open) return;
    list.current?.focus();
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);
  useEffect(() => { if (open) document.getElementById(`${menuId}-option-${active}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [active, open, menuId]);
  useEffect(() => { if (snapshot && active > snapshot.choices.length) setActive(0); }, [active, snapshot?.choices.length]);
  useLayoutEffect(() => {
    const anchor = root.current, header = anchor?.closest('header');
    if (!anchor || !header) return;
    const glyph = (node: Element) => { const range = document.createRange(); range.selectNodeContents(node); return range.getBoundingClientRect(); };
    const measure = () => {
      const bounds = anchor.getBoundingClientRect(), headerBounds = header.getBoundingClientRect();
      const tab = [...header.querySelectorAll('[data-conversation-tabs] [role="tab"]')].reverse().find(node => { const rect = node.getBoundingClientRect(); return rect.width && rect.height && node.textContent?.trim(); });
      const contentRight = headerBounds.right - Math.max(16, Number.parseFloat(getComputedStyle(header).paddingRight) || 0);
      // Matches the project Details/contact anchor immediately before native right controls.
      let left = 4, width = Math.min(220, contentRight - bounds.left - left), top = 0, aligned = false;
      if (tab && label.current && trigger.current) {
        const target = glyph(tab), current = glyph(label.current), previous = Number(trigger.current.dataset.top) || 0;
        top = previous + target.bottom - current.bottom;
        aligned = top >= 0 && bounds.top + top + trigger.current.offsetHeight <= headerBounds.bottom - 1;
        if (aligned) for (const control of header.querySelectorAll('button, a, input, select, textarea, [role="tab"]')) {
          if (anchor.contains(control)) continue;
          const box = control.getBoundingClientRect();
          if (box.width && box.height && box.right > bounds.left + left && box.left < contentRight && box.bottom > target.top && box.top < target.bottom) width = 0;
        }
      }
      // Where the native tab row is unavailable or crowded, remain inside our own slot.
      if (!aligned || width < 80) { top = 0; left = 0; width = 220; aligned = false; }
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const popupWidth = Math.min(viewportWidth - 32, viewportWidth <= 720 ? 300 : 340);
      const triggerWidth = aligned ? width : Math.min(width, bounds.width);
      const popupLeft = Math.max(16, Math.min(viewportWidth - popupWidth - 16, bounds.left + left + triggerWidth - popupWidth)) - bounds.left;
      const next = { top: Math.round(top * 1000) / 1000, left, width: Math.max(80, width), popupLeft: Math.round(popupLeft * 1000) / 1000, aligned };
      setPlacement(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const resize = new ResizeObserver(measure); resize.observe(anchor); resize.observe(header);
    const content = new MutationObserver(measure); content.observe(header, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'aria-hidden'] });
    measure(); return () => { resize.disconnect(); content.disconnect(); };
  }, [snapshot?.enabled, snapshot?.conversationEmployee?.employeeId, snapshot?.employee?.name, locale]);
  if (!snapshot?.enabled) return null;
  const binding = snapshot.conversationEmployee;
  const name = snapshot.employee?.name;
  const text = binding ? name ? t('{name}正在对接', { name }) : t('常驻员工不可用') : t('常驻此对话 · 原生助手');
  const choose = async (index: number) => {
    if (busy) return;
    const choice = snapshot.choices[index - 1];
    if (choice?.kind === 'employee' && binding?.employeeId === choice.id && binding.mode === mode) { close(true); return; }
    const changed = index === 0 ? !binding || await controller.clear(sessionId) : choice && await controller.select(sessionId, choice, mode);
    if (changed) close(true);
  };
  const changeMode = async (value: ConversationEmployeeMode) => {
    if (busy || snapshot.unavailableReason) return;
    setMode(value);
    if (binding && binding.mode !== value) {
      const changed = await controller.select(sessionId, { kind: 'employee', id: binding.employeeId }, value);
      if (!changed) setMode(binding.mode);
    }
  };
  const onKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void choose(active); return; }
    const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (!delta && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault(); const count = snapshot.choices.length + 1;
    setActive(event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : (active + delta + count) % count);
  };
  return <div ref={root} className="wf-conversation-employee" data-contact-aligned={placement.aligned} style={{ width: placement.aligned ? 32 : 220 }} onKeyDown={event => { if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(true); } }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} type="button" className="wf-conversation-employee-trigger" data-top={placement.top} style={{ top: placement.top, left: placement.left, width: placement.width }} aria-label={text} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? `${menuId}-dialog` : undefined} aria-busy={pending} title={`${text} · ${t(binding?.mode === 'execute' ? '执行任务' : '轻咨询')}`} onClick={() => open ? close() : show()} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show(); } }}><span ref={label}>{text}</span><Icon name="chevron" size={12}/></button>
    {open && <div id={`${menuId}-dialog`} className="wf-conversation-employee-popup" style={{ top: placement.top + 28, left: placement.popupLeft }}><ConversationEmployeeMenu snapshot={snapshot} mode={mode} active={active} pending={pending} menuId={menuId} error={error} listRef={list} onActive={setActive} onChoose={index => void choose(index)} onMode={value => void changeMode(value)} onKeys={onKeys} onRefresh={() => void controller.refresh(sessionId)}/></div>}
  </div>;
}
