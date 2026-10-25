import { useI18n } from './i18n.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkforceState } from '../domain/types.js';
import type { WorkforceClient } from './client.js';
import { Icon, type IconName } from './icons.js';
import { WorkforcePanel } from './WorkforcePanel.js';
import { WorkflowTemplateLibrary } from './WorkflowTemplateLibrary.js';
import './workforce.css';
import './graph-horses.css';
import { discardActiveUiDraft, readUiDraft, writeUiDraft } from './drafts.js';

export interface WorkforceWorkspaceProps { client: WorkforceClient }
const SECTIONS: Array<{ id: 'horses' | 'teams' | 'workflows'; label: string; icon: IconName }> = [{ id: 'horses', label: '自由职业人库', icon: 'person' }, { id: 'teams', label: '团队', icon: 'people' }, { id: 'workflows', label: '工作流', icon: 'network' }];
/** Main-area page mounted only through the public Harness global panel slot. */
export function WorkforceWorkspace({ client }: WorkforceWorkspaceProps) {
  const { t, errorMessage } = useI18n();
  const previousNavigation = readUiDraft<{ section: 'horses' | 'teams' | 'workflows' }>('workspace-navigation');
  const [state, setState] = useState<WorkforceState>();
  const [section, setSection] = useState<'horses' | 'teams' | 'workflows'>(previousNavigation?.section ?? 'horses');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const dirty = useRef(false);
  const mounted = useRef(true);
  const onDirtyChange = useCallback((value: boolean) => { dirty.current = value; }, []);
  const onStateChange = useCallback((value: WorkforceState) => setState(current => current && current.revision > value.revision ? current : value), []);
  const reload = useCallback(async () => { const next = await client.snapshot(); if (mounted.current) { onStateChange(next); setError(''); } return next; }, [client, onStateChange]);
  useEffect(() => { mounted.current = true; void reload().catch(error => setError(error instanceof Error ? error.message : String(error))).finally(() => setLoading(false)); return () => { mounted.current = false; }; }, [reload]);
  useEffect(() => { writeUiDraft('workspace-navigation', { section }); }, [section]);
  useEffect(() => { const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload); }, []);
  const allowLeave = () => !dirty.current || window.confirm(t("当前配置尚未保存，确定放弃修改？"));
  function navigate(action: () => void) { if (!allowLeave()) return; if (dirty.current) discardActiveUiDraft(); dirty.current = false; action(); }
  return <div className="wf-root wf-graph-workspace" data-testid="graph-horses-workspace">
    <header className="wf-graph-header"><div className="wf-graph-brand"><h1>graph_horses</h1></div></header>
    <nav className="wf-graph-sections" aria-label={t("资源库")}>{SECTIONS.map(item => <button className={section === item.id ? 'is-active' : ''} aria-current={section === item.id ? 'page' : undefined} key={item.id} onClick={() => { if (section !== item.id) navigate(() => setSection(item.id)); }}><Icon name={item.icon} size={16} />{t(item.label)}<span>{state ? item.id === 'horses' ? state.templates.filter(item => item.status !== 'archived').length : item.id === 'teams' ? state.teams.length : state.workflowTemplates?.length ?? 0 : '—'}</span></button>)}</nav>
    {error && <div className="wf-banner wf-banner-error" role="alert">{errorMessage(error)}<button className="wf-button" onClick={() => void reload().catch(error => setError(error instanceof Error ? error.message : String(error)))}>{t("重试")}</button></div>}
    <div className="wf-graph-content">{loading ? <div className="wf-loading" role="status">{t("加载 graph_horses…")}</div> : !state ? <div className="wf-loading"><p>{t("配置读取失败。")}</p><button className="wf-button" onClick={() => void reload().catch(error => setError(error instanceof Error ? error.message : String(error)))}>{t("重新加载")}</button></div> : section === 'workflows' ? <WorkflowTemplateLibrary client={client} state={state} onReload={reload} onDirtyChange={onDirtyChange} /> : <WorkforcePanel key={section} client={client} showHeader={false} templateSection={section} onDirtyChange={onDirtyChange} onStateChange={onStateChange} />}</div>
  </div>;
}
