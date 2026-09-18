import { useEffect, useState } from 'react';
import type { ProjectEmployee } from '../domain/types.js';
import type { WorkforceClient } from './client.js';
import { Icon } from './icons.js';

export interface EmployeePickerProps {
  client: WorkforceClient;
  projectId: string;
  onSelect: (employee: ProjectEmployee) => void;
  onClose?: () => void;
  query?: string;
  selectedEmployeeId?: string;
}

/** Selects by stable instance ID. Host inserts a mention and routes the next task. */
export function EmployeePicker({ client, projectId, onSelect, onClose, query: externalQuery, selectedEmployeeId }: EmployeePickerProps) {
  const [employees, setEmployees] = useState<ProjectEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(0);
  useEffect(() => { let alive = true; setLoading(true); void client.snapshot().then(state => { if (alive) { setEmployees(state.employees.filter(e => e.projectId === projectId && e.status === 'active')); setError(''); } }).catch(e => { if (alive) setError(e instanceof Error ? e.message : String(e)); }).finally(() => { if (alive) setLoading(false); }); return () => { alive = false; }; }, [client, projectId]);
  const search = externalQuery ?? query;
  const matches = employees.filter(e => `${e.name} ${e.templateName}`.toLowerCase().includes(search.toLowerCase()));
  useEffect(() => setFocused(0), [search]);
  return <div className="wf-root wf-picker-root"><div className="wf-employee-picker" onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setFocused(n => Math.min(matches.length - 1, n + 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setFocused(n => Math.max(0, n - 1)); } if (e.key === 'Enter' && matches[focused]) { e.preventDefault(); onSelect(matches[focused]!); } if (e.key === 'Escape') { e.preventDefault(); onClose?.(); } }}><div className="wf-picker-heading"><span><Icon name="people" size={15} />项目员工</span>{onClose && <button className="wf-icon-button" aria-label="关闭员工选择器" onClick={onClose}><Icon name="close" size={15} /></button>}</div>{externalQuery === undefined && <div className="wf-search"><span className="wf-at-sign">@</span><input autoFocus aria-label="搜索项目员工" placeholder="选择任务主办员工" value={query} onChange={e => setQuery(e.target.value)} /></div>}<div role="listbox" aria-label="项目员工">{loading ? <p className="wf-picker-empty">正在读取员工…</p> : error ? <p role="alert" className="wf-picker-empty wf-danger-text">{error}</p> : matches.length ? matches.map((employee, i) => <button role="option" aria-selected={employee.id === selectedEmployeeId} className={`wf-picker-option ${i === focused ? 'is-focused' : ''}`} key={employee.id} onMouseEnter={() => setFocused(i)} onClick={() => onSelect(employee)}><span className="wf-avatar"><Icon name={employee.modules.collaboration.canDelegate ? 'network' : 'person'} size={17} /></span><span><strong>{employee.name}</strong><small>{employee.templateName}</small></span>{employee.id === selectedEmployeeId ? <Icon name="check" size={15} /> : <span className="wf-small-dot is-green" />}</button>) : <p className="wf-picker-empty">{search ? '没有匹配的员工。' : '尚无已启用的项目员工，请先配置团队。'}</p>}</div><div className="wf-picker-footer">↑ ↓ 选择 · Enter 确认<span>仅当前项目</span></div></div></div>;
}

export function EmployeeMention({ employee, onRemove }: { employee: Pick<ProjectEmployee, 'id' | 'name'>; onRemove?: () => void }) {
  return <span className="wf-root wf-mention" data-employee-id={employee.id}><span>@</span>{employee.name}{onRemove && <button aria-label={`移除员工 ${employee.name}`} className="wf-icon-button" onClick={onRemove}><Icon name="close" size={12} /></button>}</span>;
}
