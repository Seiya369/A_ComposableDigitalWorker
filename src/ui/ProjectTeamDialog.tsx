import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { WorkforceState } from '../domain/types.js';
import type { WorkforceClient } from './client.js';
import { Icon } from './icons.js';
import './project-team.css';

interface Props {
  client: WorkforceClient;
  projectId: string;
  onClose: () => void;
  onManage: () => void;
  onOpenWorkspace?: (projectId: string) => void;
}

export function ProjectTeamDialog({ client, projectId, onClose, onManage, onOpenWorkspace }: Props) {
  const [state, setState] = useState<WorkforceState>();
  const [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const pending = useRef(false);
  const mounted = useRef(true);
  const panel = useRef<HTMLDivElement>(null);
  const group = useId();
  const reload = useCallback(async () => {
    const next = await client.snapshot();
    if (mounted.current) setState(next);
    return next;
  }, [client]);
  useEffect(() => {
    mounted.current = true;
    void reload().catch(error => setError(String(error.message ?? error))).finally(() => setLoading(false));
    return () => { mounted.current = false; };
  }, [reload]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  const project = state?.projects.find(project => project.id === projectId);
  const selected = state?.teams.find(team => team.id === selectedId);
  const existing = state?.projectTeams?.find(team => team.projectId === projectId && team.teamTemplateId === selectedId);
  const installed = existing && existing.status !== 'cancelled';
  const unavailable = (team: NonNullable<typeof selected>) => !team.members.length || team.members.some(member => !state?.templates.some(template => template.id === member.templateId && template.status !== 'archived'));
  const close = () => { if (!pending.current) onClose(); };

  async function configure() {
    if (pending.current || !selected || !project || !state) return;
    if (installed) { onManage(); return; }
    pending.current = true; setBusy(true); setError('');
    try {
      await client.configureProjectTeam({ projectId, teamId: selected.id, teamVersion: selected.version,
        templateVersions: Object.fromEntries(selected.members.flatMap(member => { const template = state.templates.find(template => template.id === member.templateId); return template ? [[member.templateId, template.version]] : []; })),
        ...(existing?.status === 'cancelled' ? { restoreVersion: existing.version } : {}),
      });
      if (mounted.current) onManage();
    } catch (error) {
      if (mounted.current) setError(error instanceof Error ? error.message : String(error));
      try { await reload(); } catch { /* The original mutation error remains actionable. */ }
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  }

  return <div className="wf-root wf-modal-root" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <div ref={panel} className="wf-panel wf-team-dialog" tabIndex={-1} role="dialog" aria-modal="true" aria-label="配置团队" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === 'Tab') {
        const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? []).filter(control => control.offsetParent !== null);
        if (event.shiftKey && (document.activeElement === controls[0] || document.activeElement === panel.current)) { event.preventDefault(); controls.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
      }
    }}>
      <header className="wf-header"><div className="wf-header-title"><h1>配置团队</h1></div><button className="wf-icon-button" aria-label="关闭配置团队" disabled={busy} onClick={close}><Icon name="close" size={19} /></button></header>
      <div className="wf-team-dialog-content">
        {project && <p className="wf-team-dialog-project" title={project.rootPath}><Icon name="folder" size={16} />{project.name}</p>}
        {error && <p className="wf-error-box" role="alert">{error}</p>}
        {loading ? <p className="wf-hint">加载团队…</p> : !state ? <button className="wf-button" onClick={() => { setLoading(true); void reload().catch(error => setError(error.message)).finally(() => setLoading(false)); }}>重新加载</button> : !project ? <p role="alert">此项目已不可用，请从项目菜单重新进入。</p> : <>
          <fieldset className="wf-team-options" disabled={busy}><legend>团队名称</legend>
            {state.teams.map(team => {
              const previous = state.projectTeams?.find(item => item.projectId === projectId && item.teamTemplateId === team.id);
              const isInstalled = previous && previous.status !== 'cancelled';
              const disabled = !previous && unavailable(team);
              return <label className={`wf-team-option ${selectedId === team.id ? 'is-selected' : ''}`} key={team.id}>
                <input type="radio" name={group} aria-label={team.name} checked={selectedId === team.id} disabled={disabled} onChange={() => setSelectedId(team.id)} />
                <span><strong>{team.name}</strong><small>{(previous ?? team).members.length} 位员工 · {(previous ?? team).workflows?.length ?? 0} 个工作流{disabled ? ' · 团队待完善' : ''}</small></span>
                {isInstalled && <span className="wf-tag">已配置</span>}
              </label>;
            })}
          </fieldset>
          {!state.teams.length && <p className="wf-hint">暂无团队，请先在数字员工模板中创建团队。</p>}
        </>}
      </div>
      <footer className="wf-team-dialog-actions">
        {onOpenWorkspace && <button className="wf-button" disabled={busy} onClick={() => onOpenWorkspace(projectId)}><Icon name="external" size={15} />在 graph_horses 中管理</button>}
        <button className="wf-button wf-primary" disabled={busy || !project || !selected || (!existing && unavailable(selected))} onClick={() => void configure()}>{busy ? '配置中…' : installed ? '查看团队' : '确认配置'}</button>
      </footer>
    </div>
  </div>;
}
