import { moveTeamMember } from '../domain/team-hierarchy.js';
import { activeProjectTeams, projectEmployees } from '../domain/project-roster.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkforceState } from '../domain/types.js';
import { validateModules } from '../domain/validation.js';
import type { WorkforceClient } from './client.js';
import { Icon } from './icons.js';
import { EmptyState, MemoryPanel, RunsPanel, type Perform } from './ProjectPanels.js';
import { ProjectWorkflows } from './ProjectWorkflows.js';
import { ProjectStaffing } from './ProjectStaffing.js';
import { TeamEditor } from './TeamEditor.js';
import { TeamSidebar } from './TeamSidebar.js';
import { EmployeeEditor } from './EmployeeEditor.js';

type Selection =
  | { kind: 'employee' | 'team'; id: string }
  | { kind: 'template'; id: string; teamId?: string; memberId?: string }
  | { kind: 'new-template'; teamId?: string; draftId?: string; id?: never }
  | { kind: 'new-team' | 'staffing' | 'memories' | 'runs' | 'workflows'; id?: never };
export type ProjectView = 'staffing' | 'runs' | 'memories' | 'workflows';
export interface WorkforcePanelProps { client: WorkforceClient; projectId?: string; initialView?: ProjectView; onClose?: () => void; onConfigureTeam?: () => void }

export function WorkforcePanel({ client, projectId, initialView = 'staffing', onClose, onConfigureTeam }: WorkforcePanelProps) {
  const [state, setState] = useState<WorkforceState | null>(null);
  const [selection, setSelection] = useState<Selection | null>(() => projectId ? { kind: initialView } : null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const reload = useCallback(async () => { const next = await client.snapshot(); if (mounted.current) setState(current => current && current.revision > next.revision ? current : next); return next; }, [client]);
  useEffect(() => { mounted.current = true; setLoading(true); void reload().catch(e => setError(errorMessage(e))).finally(() => setLoading(false)); return () => { mounted.current = false; }; }, [reload]);
  useEffect(() => { setSelection(projectId ? { kind: initialView } : null); setHasUnsaved(false); }, [projectId, initialView]);
  useEffect(() => { if (!state || selection) return; setSelection(projectId ? { kind: initialView } : state.teams[0] ? { kind: 'team', id: state.teams[0].id } : state.templates.find(t => t.status !== 'archived') ? { kind: 'template', id: state.templates.find(t => t.status !== 'archived')!.id } : { kind: 'new-template' }); }, [state, projectId, initialView, selection]);
  useEffect(() => { if (selection?.kind !== 'workflows' && !state?.workflowRuns?.some(flow => flow.projectId === projectId && flow.status === 'running') && !state?.runs.some(r => r.projectId === projectId && ['queued', 'running'].includes(r.status))) return; const timer = window.setInterval(() => { void reload().catch(e => setError(errorMessage(e))); }, 3500); return () => window.clearInterval(timer); }, [state?.runs, state?.workflowRuns, selection?.kind, projectId, reload]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 5000); return () => window.clearTimeout(timer); }, [notice]);
  const navigate = (next: Selection): boolean => {
    if (busy) return false;
    // Re-selecting the same editor must preserve its draft and dirty guard.
    if (next.kind === 'template' && selection?.kind === 'template' && next.id === selection.id && next.teamId === selection.teamId && next.memberId === selection.memberId) return true;
    if ((next.kind === 'team' || next.kind === 'employee') && selection?.kind === next.kind && next.id === selection.id) return true;
    if (next.kind === 'new-team' && selection?.kind === 'new-team') return true;
    if (hasUnsaved && !window.confirm('当前配置尚未保存，确定放弃修改？')) return false;
    setHasUnsaved(false); setError(''); setSelection(next); return true;
  };
  const close = useCallback(() => { if (hasUnsaved && !window.confirm('当前配置尚未保存，确定关闭？')) return; onClose?.(); }, [hasUnsaved, onClose]);
  useEffect(() => { const handler = (event: KeyboardEvent) => { if (event.key === 'Escape' && onClose) { event.preventDefault(); close(); } if (event.key === 'Tab' && onClose && panelRef.current) { const controls = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]')).filter(el => el.offsetParent !== null); if (controls.length && event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls[controls.length - 1]?.focus(); } else if (controls.length && !event.shiftKey && document.activeElement === controls[controls.length - 1]) { event.preventDefault(); controls[0]?.focus(); } } }; document.addEventListener('keydown', handler); return () => document.removeEventListener('keydown', handler); }, [close, onClose]);
  useEffect(() => { if (onClose) panelRef.current?.focus(); }, [onClose]);
  const perform: Perform = async (operation, message) => {
    if (busy) return false;
    setBusy(true); setError('');
    try {
      let result: unknown;
      try { result = await operation(); }
      catch (e) { setError(errorMessage(e)); try { await reload(); } catch { /* Keep the original mutation error and the local draft. */ } return false; }
      // A failed follow-up read must not turn a committed mutation into a retry.
      const committedState = result && typeof result === 'object' && 'state' in result ? (result as { state?: WorkforceState }).state : undefined;
      if (committedState?.schemaVersion === 1 && Array.isArray(committedState.employees)) setState(current => current && current.revision > committedState.revision ? current : committedState);
      else { try { await reload(); } catch (e) { setError(`操作已完成，但刷新失败。请刷新数据查看结果：${errorMessage(e)}`); } }
      setNotice(message); return true;
    } finally { setBusy(false); }
  };
  const project = state?.projects.find(p => p.id === projectId);
  const employees = state && projectId ? projectEmployees(state, projectId) : [];
  const templates = state?.templates.filter(t => t.status !== 'archived') ?? [];
  const assignedTemplateIds = new Set(state?.teams.flatMap(team => team.members.map(member => member.templateId)) ?? []);
  const filtered = templates.filter(t => !assignedTemplateIds.has(t.id)).filter(t => `${t.name} ${t.description}`.toLowerCase().includes(query.toLowerCase()));
  const activeEmployee = selection?.kind === 'employee' ? employees.find(e => e.id === selection.id) : undefined;
  const activeTemplate = selection?.kind === 'template' ? state?.templates.find(t => t.id === selection.id) : undefined;
  const selectedTeamId = selection?.kind === 'team' ? selection.id : selection?.kind === 'template' || selection?.kind === 'new-template' ? selection.teamId : undefined;
  const activeTeam = state?.teams.find(team => team.id === selectedTeamId);
  const activeMember = selection?.kind === 'template' && selection.memberId ? activeTeam?.members.find(member => member.memberId === selection.memberId && member.templateId === selection.id) : undefined;
  const editorUnavailable = selection?.kind === 'template' && (!activeTemplate || (!!selection.memberId && !activeMember));
  const selectTeamEntry = (teamId: string, memberId?: string): boolean => {
    if (!memberId) return navigate({ kind: 'team', id: teamId });
    const member = state?.teams.find(team => team.id === teamId)?.members.find(member => member.memberId === memberId);
    if (!member) { setError('此员工已从团队移除，请刷新后重新选择。'); return false; }
    return navigate({ kind: 'template', id: member.templateId, teamId, memberId });
  };
  const addEmployee = (teamId?: string) => navigate({ kind: 'new-template', teamId, draftId: crypto.randomUUID() });
  useEffect(() => {
    if (!loading && state && projectId && selection?.kind === 'employee' && !activeEmployee) {
      setSelection({ kind: 'staffing' }); setHasUnsaved(false);
      setError('此项目员工已被移除，请从项目团队选择其他员工。');
    }
  }, [loading, state, projectId, selection, activeEmployee]);
  const showEditor = projectId ? selection?.kind === 'employee' && !!activeEmployee : selection?.kind === 'template' || selection?.kind === 'new-template';

  return <div className={`wf-root ${onClose ? 'wf-modal-root' : ''}`}><div ref={panelRef} tabIndex={-1} className={`wf-panel ${expanded ? 'wf-expanded' : ''}`} role={onClose ? 'dialog' : 'region'} aria-modal={onClose ? true : undefined} aria-label={projectId ? '项目团队' : '员工与团队模板'}>
    <header className="wf-header"><div className="wf-header-title"><h1>{projectId ? '项目团队' : '数字员工'}</h1>{projectId && <span>{project?.name ?? '正在加载项目'}</span>}</div><div className="wf-header-actions"><button className="wf-icon-button" title="刷新" aria-label="刷新数据" disabled={busy || loading} onClick={() => void reload().catch(e => setError(errorMessage(e)))}><Icon name="refresh" size={17} /></button>{onClose && <><button className="wf-icon-button" title={expanded ? '恢复窗口' : '展开窗口'} aria-label={expanded ? '恢复窗口' : '展开窗口'} onClick={() => setExpanded(!expanded)}><Icon name="external" size={17} /></button><button className="wf-icon-button" title="关闭" aria-label="关闭数字员工" onClick={close}><Icon name="close" size={19} /></button></>}</div></header>
    {error && <div className="wf-banner wf-banner-error" role="alert"><span>{error}</span><button className="wf-icon-button" aria-label="关闭错误提示" onClick={() => setError('')}><Icon name="close" size={15} /></button></div>}{notice && <div className="wf-toast" role="status"><Icon name="check" size={16} />{notice}</div>}
    {loading ? <div className="wf-loading"><span className="wf-spinner" />加载数字员工配置…</div> : !state ? <div className="wf-loading"><p>无法读取员工配置。</p><button className="wf-button" onClick={() => { setLoading(true); void reload().catch(e => setError(errorMessage(e))).finally(() => setLoading(false)); }}>重新加载</button></div> : projectId && !project ? <EmptyState title="尚未注册这个项目" description="请从 Harness 的项目菜单进入配置，确保项目工作空间已绑定。" /> : <div className="wf-body">
      <aside className={`wf-sidebar ${projectId ? 'wf-project-sidebar' : ''}`}>{!projectId && <div className="wf-search"><Icon name="search" size={15} /><input aria-label="搜索员工" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索模板" /></div>}
        {projectId ? <><button className={`wf-nav-flat ${selection?.kind === 'staffing' ? 'is-active' : ''}`} onClick={() => navigate({ kind: 'staffing' })}><Icon name="people" size={16} />项目团队<span>{employees.length}</span></button><button className="wf-sidebar-add" disabled={busy} onClick={() => { if (!hasUnsaved || window.confirm('当前配置尚未保存，确定放弃修改？')) onConfigureTeam?.(); }}><Icon name="people" size={15} />配置团队</button>{activeEmployee && <div className="wf-project-current-editor"><span>项目员工</span><strong>{activeEmployee.name}</strong></div>}<div className="wf-sidebar-divider" /><button className={`wf-nav-flat ${selection?.kind === 'workflows' ? 'is-active' : ''}`} onClick={() => navigate({ kind: 'workflows' })}><Icon name="network" size={16} />工作流<span>{activeProjectTeams(state, projectId).reduce((total, team) => total + team.workflows.length, 0)}</span></button><button className={`wf-nav-flat ${selection?.kind === 'memories' ? 'is-active' : ''}`} onClick={() => navigate({ kind: 'memories' })}><Icon name="memory" size={16} />项目记忆<span>{state.memories.filter(m => m.projectId === projectId).length}</span></button><button className={`wf-nav-flat ${selection?.kind === 'runs' ? 'is-active' : ''}`} onClick={() => navigate({ kind: 'runs' })}><Icon name="delivery" size={16} />任务与交付<span>{state.runs.filter(r => r.projectId === projectId).length}</span></button></> : <><div className="wf-sidebar-heading"><span>团队模板</span><button className="wf-icon-button" aria-label="新建空白团队模板" onClick={() => navigate({ kind: 'new-team' })}><Icon name="plus" size={14} /></button></div><TeamSidebar teams={state.teams} templates={state.templates} query={query} activeTeamId={activeTeam?.id} selectedMemberId={selection?.kind === 'template' ? selection.memberId : undefined} onSelect={selectTeamEntry} disabled={busy || hasUnsaved} onMove={(teamId, memberId, targetId, position) => {
          if (busy || hasUnsaved) return;
          const team = state.teams.find(team => team.id === teamId);
          if (!team) return;
          const members = moveTeamMember(team.members, memberId, targetId, position);
          if (!members || JSON.stringify(members) === JSON.stringify(team.members)) return;
          void perform(() => client.saveTeam({ ...team, members }, { expectedVersion: team.version }), '团队层级与排序已保存');
        }} /><div className="wf-sidebar-heading wf-spaced-heading"><span>未分组员工</span><span>{templates.filter(template => !assignedTemplateIds.has(template.id)).length}</span></div>{filtered.map(template => <button className={`wf-nav-item ${activeTemplate?.id === template.id ? 'is-active' : ''}`} key={template.id} onClick={() => navigate({ kind: 'template', id: template.id })}><span className="wf-avatar"><Icon name={template.modules.collaboration.canDelegate ? 'network' : 'person'} size={17} /></span><span className="wf-nav-label"><strong>{template.name}</strong><small>{template.status === 'draft' ? '草稿' : `v${template.version}`}</small></span>{template.status === 'ready' && <span className="wf-small-dot is-green" />}</button>)}{!filtered.length && query && <p className="wf-sidebar-empty">没有匹配的未分组员工</p>}<button className={`wf-sidebar-add ${selection?.kind === 'new-template' ? 'is-active' : ''}`} onClick={() => addEmployee(activeTeam?.id)}><Icon name="plus" size={15} />添加员工</button></>}
      </aside>
      {showEditor && <EmployeeEditor
        key={selection?.kind === 'new-template' ? `new:${selection.draftId ?? selection.teamId ?? ''}` : selection?.kind === 'template' ? `${selection.id}:${selection.teamId ?? ''}:${selection.memberId ?? ''}` : activeEmployee?.id}
        record={activeEmployee ?? activeTemplate} isProject={!!projectId} templates={templates} employees={employees} teams={state.teams}
        teamId={selection?.kind === 'template' || selection?.kind === 'new-template' ? selection.teamId : undefined}
        memberId={selection?.kind === 'template' ? selection.memberId : undefined}
        busy={busy} unavailable={editorUnavailable} onDirty={setHasUnsaved}
        onSave={async input => {
          if (projectId) {
            if (!activeEmployee) { setError('此项目员工已被移除，请返回项目团队。'); return false; }
            return perform(() => client.updateEmployee(activeEmployee.id, { name: input.name, modules: input.modules, managerId: input.managerId || null, status: input.active ? 'active' : 'paused' }, { expectedVersion: input.baseVersion }), '项目员工配置已保存');
          }
          if (editorUnavailable) { setError('员工或团队关系已被移除，请重新选择。'); return false; }
          let status: 'draft' | 'ready' = 'draft';
          try { validateModules(input.modules, true); status = 'ready'; } catch { /* Incomplete configurations remain drafts; the store validates all saved fields. */ }
          const ok = await perform(() => client.saveEmployeeConfiguration({
            template: { id: input.templateId, name: input.name, description: input.description, modules: input.modules, status },
            membership: input.membership,
          }, activeTemplate ? { expectedVersion: input.baseVersion } : undefined), '员工配置已保存');
          if (ok) {
            setHasUnsaved(false);
            const target = input.membership?.target;
            setSelection({ kind: 'template', id: input.templateId, ...(target ? { teamId: target.teamId, memberId: target.memberId } : {}) });
          }
          return ok;
        }}
      />}

      {(selection?.kind === 'team' || selection?.kind === 'new-team') && <TeamEditor key={selection.kind === 'team' ? selection.id : 'new-team'} team={activeTeam} unavailable={selection.kind === 'team' && !activeTeam} templates={state.templates} busy={busy} onDirty={setHasUnsaved} onSelectMember={memberId => { if (activeTeam) selectTeamEntry(activeTeam.id, memberId); }} onAddEmployee={() => addEmployee(activeTeam?.id)} onSave={async (name, description, members, baseVersion, workflows) => { if (selection.kind === 'team' && !activeTeam) { setError('此团队已被删除，请选择其他团队。'); return false; } const id = activeTeam?.id ?? `team-${crypto.randomUUID()}`; const ok = await perform(() => client.saveTeam({ id, name, description, members, workflows }, activeTeam ? { expectedVersion: baseVersion } : undefined), '团队模板已保存'); if (ok) { setHasUnsaved(false); setSelection({ kind: 'team', id }); } return ok; }} onDelete={activeTeam ? async () => { const ok = await perform(() => client.deleteTeam(activeTeam.id, { expectedVersion: activeTeam.version }), '团队模板已删除'); if (ok) { setHasUnsaved(false); setSelection(null); } } : undefined} />}
      {selection?.kind === 'staffing' && project && <ProjectStaffing state={state} project={project} busy={busy} onConfigureTeam={() => onConfigureTeam?.()} onEdit={id => navigate({ kind: 'employee', id })} />}
      {selection?.kind === 'workflows' && projectId && <ProjectWorkflows state={state} projectId={projectId} client={client} perform={perform} busy={busy} onDirty={setHasUnsaved} />}
      {selection?.kind === 'memories' && projectId && <MemoryPanel state={state} projectId={projectId} client={client} perform={perform} busy={busy} />}
      {selection?.kind === 'runs' && projectId && <RunsPanel state={state} projectId={projectId} client={client} perform={perform} busy={busy} onWorkflow={() => navigate({ kind: 'workflows' })} />}
    </div>}
  </div></div>;
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
