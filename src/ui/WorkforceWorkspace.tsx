import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkforceState } from '../domain/types.js';
import type { WorkforceClient } from './client.js';
import { Icon, type IconName } from './icons.js';
import { WorkforcePanel } from './WorkforcePanel.js';
import { WorkflowTemplateLibrary } from './WorkflowTemplateLibrary.js';
import { TransferPanel } from './TransferPanel.js';
import { ProjectTemplateInstaller } from './ProjectTemplateInstaller.js';
import { ProjectTeamDialog } from './ProjectTeamDialog.js';
import { ProjectWorkbench } from './ProjectWorkbench.js';
import type { ProjectView } from './WorkforcePanel.js';
import './workforce.css';
import './graph-horses.css';
import { discardActiveUiDraft, readUiDraft, writeUiDraft } from './drafts.js';

export interface WorkforceWorkspaceProps { client: WorkforceClient; initialProjectId?: string; onOpenSession?: (sessionId: string) => void }
type WorkspaceProjectView = 'workbench' | ProjectView;
const PROJECT_VIEWS: Array<{ id: WorkspaceProjectView; label: string; icon: IconName }> = [{ id: 'workbench', label: '工作台', icon: 'briefcase' }, { id: 'staffing', label: '团队与人员', icon: 'people' }, { id: 'workflows', label: '工作流', icon: 'network' }, { id: 'memories', label: '资料记忆', icon: 'memory' }, { id: 'runs', label: '执行记录', icon: 'delivery' }];
const SECTIONS: Array<{ id: 'horses' | 'teams' | 'workflows'; label: string; icon: IconName }> = [{ id: 'horses', label: '职业人 Horse', icon: 'person' }, { id: 'teams', label: '团队', icon: 'people' }, { id: 'workflows', label: '工作流', icon: 'network' }];
/** Main-area page mounted only through the public Harness global panel slot. */
export function WorkforceWorkspace({ client, initialProjectId, onOpenSession }: WorkforceWorkspaceProps) {
  const previousNavigation = readUiDraft<{ scope: 'template' | 'project'; section: 'horses' | 'teams' | 'workflows'; projectId: string; projectView?: WorkspaceProjectView }>('workspace-navigation');
  const [state, setState] = useState<WorkforceState>();
  const [scope, setScope] = useState<'template' | 'project'>(initialProjectId ? 'project' : previousNavigation?.scope ?? 'template');
  const [section, setSection] = useState<'horses' | 'teams' | 'workflows'>(previousNavigation?.section ?? 'horses');
  const [projectId, setProjectId] = useState(initialProjectId ?? previousNavigation?.projectId ?? '');
  const [projectView, setProjectView] = useState<WorkspaceProjectView>(previousNavigation?.projectView ?? 'workbench');
  const [transfer, setTransfer] = useState<'import' | 'export'>();
  const [installer, setInstaller] = useState(false);
  const [teamDialog, setTeamDialog] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const dirty = useRef(false);
  const mounted = useRef(true);
  const onDirtyChange = useCallback((value: boolean) => { dirty.current = value; }, []);
  const onStateChange = useCallback((value: WorkforceState) => setState(current => current && current.revision > value.revision ? current : value), []);
  const reload = useCallback(async () => { const next = await client.snapshot(); if (mounted.current) { onStateChange(next); setError(''); } return next; }, [client, onStateChange]);
  useEffect(() => { mounted.current = true; void reload().catch(error => setError(error instanceof Error ? error.message : String(error))).finally(() => setLoading(false)); return () => { mounted.current = false; }; }, [reload]);
  useEffect(() => { if (!projectId && state?.projects.length) setProjectId(state.projects[0]!.id); }, [state, projectId]);
  useEffect(() => { if (initialProjectId) { setScope('project'); setProjectId(initialProjectId); setTransfer(undefined); setInstaller(false); } }, [initialProjectId]);
  useEffect(() => { writeUiDraft('workspace-navigation', { scope, section, projectId, projectView }); }, [scope, section, projectId, projectView]);
  useEffect(() => { const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload); }, []);
  const allowLeave = () => !dirty.current || window.confirm('当前配置尚未保存，确定放弃修改？');
  function navigate(action: () => void) { if (!allowLeave()) return; if (dirty.current) discardActiveUiDraft(); dirty.current = false; setTransfer(undefined); setInstaller(false); action(); }
  async function refreshContent() { await reload(); if (dirty.current) discardActiveUiDraft(); dirty.current = false; setGeneration(value => value + 1); }
  const available = scope === 'template' || !!state?.projects.some(project => project.id === projectId);
  return <div className="wf-root wf-graph-workspace" data-testid="graph-horses-workspace">
    <header className="wf-graph-header"><div><h1>graph_horses</h1></div><div className="wf-graph-tools"><button className="wf-button" disabled={!available || !state} onClick={() => { setTransfer(transfer === 'import' ? undefined : 'import'); setInstaller(false); }}>导入 JSON</button><button className="wf-button" disabled={!available || !state} onClick={() => { setTransfer(transfer === 'export' ? undefined : 'export'); setInstaller(false); }}>导出 JSON</button><button className="wf-icon-button" aria-label="刷新 graph_horses" disabled={loading} onClick={() => { if (allowLeave()) void refreshContent().catch(error => setError(error.message)); }}><Icon name="refresh" size={17} /></button></div></header>
    <div className="wf-graph-scope"><div className="wf-segmented" role="group" aria-label="配置范围"><button aria-pressed={scope === 'template'} className={scope === 'template' ? 'is-active' : ''} onClick={() => { if (scope !== 'template') navigate(() => setScope('template')); }}>通用模板</button><button aria-pressed={scope === 'project'} className={scope === 'project' ? 'is-active' : ''} onClick={() => { if (scope !== 'project') navigate(() => setScope('project')); }}>项目实例</button></div>
      {scope === 'project' && <><select aria-label="选择具体项目" value={projectId} onChange={event => { const value = event.target.value; navigate(() => setProjectId(value)); }}><option value="">选择项目</option>{state?.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select><button className="wf-button" disabled={!available} onClick={() => { if (allowLeave()) { setInstaller(!installer); setTransfer(undefined); } }}><Icon name="plus" size={15} />引入通用模板</button></>}
    </div>
    {scope === 'template' && <nav className="wf-graph-sections" aria-label="通用模板类型">{SECTIONS.map(item => <button className={section === item.id ? 'is-active' : ''} aria-current={section === item.id ? 'page' : undefined} key={item.id} onClick={() => { if (section !== item.id) navigate(() => setSection(item.id)); }}><Icon name={item.icon} size={16} />{item.label}<span>{state ? item.id === 'horses' ? state.templates.filter(item => item.status !== 'archived').length : item.id === 'teams' ? state.teams.length : state.workflowTemplates?.length ?? 0 : '—'}</span></button>)}</nav>}
    {scope === 'project' && available && <nav className="wf-graph-sections wf-project-sections" aria-label="项目工作区">{PROJECT_VIEWS.map(item => <button key={item.id} className={projectView === item.id ? 'is-active' : ''} aria-current={projectView === item.id ? 'page' : undefined} onClick={() => { if (projectView !== item.id) navigate(() => setProjectView(item.id)); }}><Icon name={item.icon} size={16} />{item.label}</button>)}</nav>}
    {error && <div className="wf-banner wf-banner-error" role="alert">{error}<button className="wf-button" onClick={() => void reload().catch(error => setError(error.message))}>重试</button></div>}
    {transfer && state && available && <TransferPanel key={`${scope}/${projectId}/${transfer}`} client={client} state={state} target={{ scope, ...(scope === 'project' ? { projectId } : {}) }} mode={transfer} onClose={() => setTransfer(undefined)} onBeforeImport={allowLeave} onImported={refreshContent} />}
    {installer && state && scope === 'project' && available && <ProjectTemplateInstaller key={projectId} client={client} state={state} projectId={projectId} onClose={() => setInstaller(false)} onInstalled={refreshContent} />}
    <div className="wf-graph-content">{loading ? <div className="wf-loading" role="status">加载 graph_horses…</div> : !state ? <div className="wf-loading"><p>配置读取失败。</p><button className="wf-button" onClick={() => void reload().catch(error => setError(error.message))}>重新加载</button></div> : scope === 'project' && !available ? <div className="wf-empty-state"><Icon name="folder" size={28} /><h2>先选择项目</h2><p>在 Harness 中打开项目后，在此选择项目并引入通用模板。</p></div> : scope === 'project' && projectView === 'workbench' ? <ProjectWorkbench key={`work/${projectId}/${generation}`} client={client} state={state} projectId={projectId} onReload={reload} onDirtyChange={onDirtyChange} onOpenSession={onOpenSession} onLegacyRuns={() => setProjectView('runs')} onConfigureTeam={() => setTeamDialog(true)} /> : scope === 'template' && section === 'workflows' ? <WorkflowTemplateLibrary key={`workflow/${generation}`} client={client} state={state} onReload={reload} onDirtyChange={onDirtyChange} /> : <WorkforcePanel key={`${scope}/${section}/${projectId}/${projectView}/${generation}`} client={client} showHeader={false} projectId={scope === 'project' ? projectId : undefined} initialView={scope === 'project' && projectView !== 'workbench' ? projectView : undefined} navigationScope={scope === 'project' ? projectView : undefined} templateSection={scope === 'template' ? section === 'horses' ? 'horses' : 'teams' : undefined} onDirtyChange={onDirtyChange} onStateChange={onStateChange} onConfigureTeam={() => setTeamDialog(true)} />}</div>
    {teamDialog && scope === 'project' && <ProjectTeamDialog client={client} projectId={projectId} onClose={() => setTeamDialog(false)} onManage={() => { setTeamDialog(false); void refreshContent().catch(error => setError(error.message)); }} />}
  </div>;
}
