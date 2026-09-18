import { cloneElement, isValidElement, useId } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Icon } from './icons.js';

export function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  const id = useId();
  const isControl = isValidElement(children) && typeof children.type === 'string' && ['input', 'select', 'textarea'].includes(children.type);
  return <div className={`wf-field ${className}`}><label className="wf-field-label" htmlFor={isControl ? id : undefined}>{label}</label>{isControl ? cloneElement(children as ReactElement<{ id: string; 'aria-describedby'?: string }>, { id, 'aria-describedby': hint ? `${id}-hint` : undefined }) : children}{hint && <span className="wf-hint" id={`${id}-hint`}>{hint}</span>}</div>;
}

export function TextField({ label, value, onChange, hint, placeholder, multiline = false, rows = 3 }: { label: string; value: string; onChange: (value: string) => void; hint?: string; placeholder?: string; multiline?: boolean; rows?: number }) {
  return <Field label={label} hint={hint}>{multiline ? <textarea rows={rows} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} /> : <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />}</Field>;
}

export function StringList({ label, values, onChange, hint, placeholder = '输入一项内容', addLabel = '添加一项' }: { label: string; values: string[]; onChange: (values: string[]) => void; hint?: string; placeholder?: string; addLabel?: string }) {
  const base = useId();
  return <div className="wf-field"><div className="wf-field-label">{label}<span className="wf-count">{values.length}</span></div>{values.length > 0 && <div className="wf-string-list">{values.map((value, i) => <div className="wf-list-row" key={i}><span className="wf-line-no">{String(i + 1).padStart(2, '0')}</span><input id={`${base}-${i}`} aria-label={`${label} ${i + 1}`} value={value} placeholder={placeholder} onChange={e => onChange(values.map((v, n) => n === i ? e.target.value : v))} /><button type="button" className="wf-icon-button" aria-label={`删除${label}第 ${i + 1} 项`} onClick={() => onChange(values.filter((_, n) => n !== i))}><Icon name="close" size={14} /></button></div>)}</div>}<button type="button" className="wf-inline-add" onClick={() => onChange([...values, ''])}><Icon name="plus" size={14} />{addLabel}</button>{hint && <span className="wf-hint">{hint}</span>}</div>;
}

export function Toggle({ label, checked, onChange, hint, disabled = false }: { label: string; checked: boolean; onChange: (checked: boolean) => void; hint?: string; disabled?: boolean }) {
  return <label className="wf-toggle-row"><span><span className="wf-toggle-label">{label}</span>{hint && <span className="wf-hint">{hint}</span>}</span><input type="checkbox" className="wf-switch" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} /></label>;
}

export function SelectField({ label, value, onChange, children, hint }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode; hint?: string }) {
  return <Field label={label} hint={hint}><select value={value} onChange={e => onChange(e.target.value)}>{children}</select></Field>;
}

export function NumberField({ label, value, onChange, min = 0, max = 20, hint }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; hint?: string }) {
  return <Field label={label} hint={hint}><input type="number" min={min} max={max} value={value} onChange={e => { const number = Number(e.target.value); if (Number.isFinite(number)) onChange(Math.max(min, Math.min(max, number))); }} /></Field>;
}
