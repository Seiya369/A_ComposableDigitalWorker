import { useI18n } from './i18n.js';
import { cloneElement, isValidElement, useId } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Icon } from './icons.js';

export function Field({ label, labelAction, hint, children, className = '', literalLabel = false }: { label: string; labelAction?: ReactNode; hint?: string; children: ReactNode; className?: string; literalLabel?: boolean }) {
  const { t } = useI18n();
  const id = useId();
  const isControl = isValidElement(children) && typeof children.type === 'string' && ['input', 'select', 'textarea'].includes(children.type);
  const heading = <label className="wf-field-label" htmlFor={isControl ? id : undefined}>{literalLabel ? label : t(label)}</label>;
  return <div className={`wf-field ${className}`}>{labelAction ? <div className="wf-field-heading">{heading}{labelAction}</div> : heading}{isControl ? cloneElement(children as ReactElement<{ id: string; 'aria-describedby'?: string }>, { id, 'aria-describedby': hint ? `${id}-hint` : undefined }) : children}{hint && <span className="wf-hint" id={`${id}-hint`}>{t(hint)}</span>}</div>;
}

export function TextField({ label, labelAction, value, onChange, hint, placeholder, multiline = false, rows = 3 }: { label: string; labelAction?: ReactNode; value: string; onChange: (value: string) => void; hint?: string; placeholder?: string; multiline?: boolean; rows?: number }) {
  const { t } = useI18n();
  return <Field label={t(label)} labelAction={labelAction} hint={hint ? t(hint) : undefined}>{multiline ? <textarea rows={rows} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder ? t(placeholder) : undefined} /> : <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder ? t(placeholder) : undefined} />}</Field>;
}

export function StringList({ label, values, onChange, hint, placeholder = '输入一项内容', addLabel = '添加一项' }: { label: string; values: string[]; onChange: (values: string[]) => void; hint?: string; placeholder?: string; addLabel?: string }) {
  const { t } = useI18n();
  const base = useId();
  return <div className="wf-field"><div className="wf-field-label">{t(label)}<span className="wf-count">{values.length}</span></div>{values.length > 0 && <div className="wf-string-list">{values.map((value, i) => <div className="wf-list-row" key={i}><span className="wf-line-no">{String(i + 1).padStart(2, '0')}</span><input id={`${base}-${i}`} aria-label={`${t(label)} ${i + 1}`} value={value} placeholder={placeholder ? t(placeholder) : undefined} onChange={e => onChange(values.map((v, n) => n === i ? e.target.value : v))} /><button type="button" className="wf-icon-button wf-danger-text" aria-label={t('删除{label}第 {index} 项', { label: t(label), index: i + 1 })} onClick={() => onChange(values.filter((_, n) => n !== i))}><Icon name="close" size={14} /></button></div>)}</div>}<button type="button" className="wf-inline-add" onClick={() => onChange([...values, ''])}><Icon name="plus" size={14} />{t(addLabel)}</button>{hint && <span className="wf-hint">{t(hint)}</span>}</div>;
}

export function Toggle({ label, checked, onChange, hint, disabled = false }: { label: string; checked: boolean; onChange: (checked: boolean) => void; hint?: string; disabled?: boolean }) {
  const { t } = useI18n();
  return <label className="wf-toggle-row"><span><span className="wf-toggle-label">{t(label)}</span>{hint && <span className="wf-hint">{t(hint)}</span>}</span><input type="checkbox" className="wf-switch" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} /></label>;
}

export function SelectField({ label, value, onChange, children, hint, disabled, literalLabel = false }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode; hint?: string; disabled?: boolean; literalLabel?: boolean }) {
  const { t } = useI18n();
  return <Field label={literalLabel ? label : t(label)} literalLabel={literalLabel} hint={hint ? t(hint) : undefined}><select value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>{children}</select></Field>;
}

export function NumberField({ label, value, onChange, min = 0, max = 20, hint }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; hint?: string }) {
  const { t } = useI18n();
  return <Field label={t(label)} hint={hint ? t(hint) : undefined}><input type="number" min={min} max={max} value={value} onChange={e => { const number = Number(e.target.value); if (Number.isFinite(number)) onChange(Math.max(min, Math.min(max, number))); }} /></Field>;
}
