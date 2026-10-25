import { useI18n } from './i18n.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkforceState } from '../domain/types.js';
import { validateModules } from '../domain/validation.js';
import type { WorkforceClient } from './client.js';
import { Icon } from './icons.js';
import { TeamEditor } from './TeamEditor.js';
import { TeamSidebar } from './TeamSidebar.js';
import { EmployeeEditor } from './EmployeeEditor.js';
import { discardActiveUiDraft, readUiDraft, removeUiDraft, writeUiDraft } from './drafts.js';
import { mergeVisibleOrder } from '../domain/library-order.js';
import { useLibraryReorder } from './useLibraryReorder.js';

type Selection =
  | { kind: 'team'; id: string }
  | { kind: 'template'; id: string; teamId?: string; memberId?: string }
  | { kind: 'new-template'; teamId?: string; draftId?: string; id?: never }
  | { kind: 'new-team'; id?: never };
type Perform = (operation: () => Promise<unknown>, message: string) => Promise<boolean>;
export interface WorkforcePanelProps { client: WorkforceClient; showHeader?: boolean; templateSection: 'horses' | 'teams'; onDirtyChange?: (dirty: boolean) => void; onStateChange?: (state: WorkforceState) => void }

export function WorkforcePanel({ client, showHeader = true, templateSection, onDirtyChange, onStateChange }: WorkforcePanelProps) {
  const { t, errorMessage } = useI18n();
  const navigationKey = `panel-selection:library:${templateSection}:main`;
  const [state, setState] = useState<WorkforceState | null>(null);
  const [selection, setSelection] = useState<Selection | null>(() => {
    const saved = readUiDraft<Selection>(navigationKey);
    if (templateSection === 'teams' && saved?.kind === 'template') return saved.teamId ? { kind: 'team', id: saved.teamId } : null;
    return saved && ['team', 'template', 'new-template', 'new-team'].includes(saved.kind) ? saved : null;
  });
  const [error, setError] = useState<string | { completed: true; cause: unknown }>('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { onDirtyChange?.(hasUnsaved); }, [hasUnsaved, onDirtyChange]);
  useEffect(() => { if (state) onStateChange?.(state); }, [state, onStateChange]);
  useEffect(() => { if (selection) writeUiDraft(navigationKey, selection); }, [navigationKey, selection]);
  const reload = useCallback(async () => { const next = await client.snapshot(); if (mounted.current) setState(current => current && current.revision > next.revision ? current : next); return next; }, [client]);
  useEffect(() => { mounted.current = true; setLoading(true); void reload().catch(e => setError(e instanceof Error ? e.message : String(e))).finally(() => setLoading(false)); return () => { mounted.current = false; }; }, [reload]);
  useEffect(() => { if (!state || selection) return; setSelection(templateSection === 'teams' && state.teams[0] ? { kind: 'team', id: state.teams[0].id } : templateSection === 'horses' && state.templates.find(t => t.status !== 'archived') ? { kind: 'template', id: state.templates.find(t => t.status !== 'archived')!.id } : templateSection === 'teams' ? { kind: 'new-team' } : { kind: 'new-template' }); }, [state, selection, templateSection]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 5000); return () => window.clearTimeout(timer); }, [notice]);
  const navigate = (next: Selection): boolean => {
    if (busy) return false;
    // Re-selecting the same editor must preserve its draft and dirty guard.
    if (next.kind === 'template' && selection?.kind === 'template' && next.id === selection.id && next.teamId === selection.teamId && next.memberId === selection.memberId) return true;
    if (next.kind === 'team' && selection?.kind === next.kind && next.id === selection.id) return true;
    if (next.kind === 'new-team' && selection?.kind === 'new-team') return true;
    if (hasUnsaved && !window.confirm(t("当前配置尚未保存，确定放弃修改？"))) return false;
    if (hasUnsaved) discardActiveUiDraft();
    setHasUnsaved(false); setError(''); setSelection(next); return true;
  };
  const perform: Perform = async (operation, message) => {
    if (busy) return false;
    setBusy(true); setError('');
    try {
      let result: unknown;
      try { result = await operation(); }
      catch (e) { setError(e instanceof Error ? e.message : String(e)); try { await reload(); } catch { /* Keep the original mutation error and the local draft. */ } return false; }
      // A failed follow-up read must not turn a committed mutation into a retry.
      const committedState = result && typeof result === 'object' && 'state' in result ? (result as { state?: WorkforceState }).state : undefined;
      if (committedState?.schemaVersion === 1 && Array.isArray(committedState.employees)) setState(current => current && current.revision > committedState.revision ? current : committedState);
      else { try { await reload(); } catch (e) { setError({ completed: true, cause: e }); } }
      setNotice(message); return true;
    } finally { setBusy(false); }
  };
  const templates = state?.templates.filter(t => t.status !== 'archived') ?? [];
  const filtered = templates.filter(t => `${t.name} ${t.description}`.toLowerCase().includes(query.toLowerCase()));
  const employeeOrder = useLibraryReorder(filtered.map(row => row.id), busy, async ids => {
    if (!state) return false;
    return perform(() => client.reorderLibrary({ kind: 'employee', orderedIds: mergeVisibleOrder(templates.map(row => row.id), ids) }, { expectedRevision: state.revision }), "人员顺序已保存");
  });
  const activeTemplate = selection?.kind === 'template' ? state?.templates.find(t => t.id === selection.id) : undefined;
  const selectedTeamId = selection?.kind === 'team' ? selection.id : selection?.kind === 'template' || selection?.kind === 'new-template' ? selection.teamId : undefined;
  const activeTeam = state?.teams.find(team => team.id === selectedTeamId);
  const activeMember = selection?.kind === 'template' && selection.memberId ? activeTeam?.members.find(member => member.memberId === selection.memberId && member.templateId === selection.id) : undefined;
  const editorUnavailable = selection?.kind === 'template' && (!activeTemplate || (!!selection.memberId && !activeMember));
  const selectTeamEntry = (teamId: string): boolean => navigate({ kind: 'team', id: teamId });
  const addEmployee = (teamId?: string) => navigate({ kind: 'new-template', teamId, draftId: crypto.randomUUID() });
  const showEditor = selection?.kind === 'template' || selection?.kind === 'new-template';
  const archiveSelectedTemplate = async (): Promise<boolean> => {
    if (busy || templateSection !== 'horses' || !activeTemplate || activeTemplate.status === 'archived') return false;
    if (!window.confirm(t('移除后将从自由职业人库隐藏，配置记录和已创建的项目实例会保留。确定移除？') + (hasUnsaved ? t('\n当前未保存修改不会保存。') : ''))) return false;
    const archived = await perform(() => client.archiveTemplate(activeTemplate.id, { expectedVersion: activeTemplate.version }), "已从自由职业人库移除");
    if (archived) { setHasUnsaved(false); setSelection(null); }
    return archived;
  };

  return <div className="wf-root"><div className="wf-panel" role="region" aria-label={t("员工与团队模板")}>
    {showHeader && <header className="wf-header"><div className="wf-header-title"><h1>{templateSection === 'teams' ? t("团队") : t("自由职业人库")}</h1></div><div className="wf-header-actions"><button className="wf-icon-button" title={t("刷新")} aria-label={t("刷新数据")} disabled={busy || loading} onClick={() => void reload().catch(e => setError(e instanceof Error ? e.message : String(e)))}><Icon name="refresh" size={17} /></button></div></header>}
    {error && <div className="wf-banner wf-banner-error" role="alert"><span>{typeof error === 'string' ? errorMessage(error) : t('操作已完成，但刷新失败。请刷新数据查看结果：{error}', { error: errorMessage(error.cause) })}</span><button className="wf-icon-button" aria-label={t("关闭错误提示")} onClick={() => setError('')}><Icon name="close" size={15} /></button></div>}{notice && <div className="wf-toast" role="status"><Icon name="check" size={16} />{t(notice)}</div>}
    {loading ? <div className="wf-loading"><span className="wf-spinner" />{t("加载数字员工配置…")}</div> : !state ? <div className="wf-loading"><p>{t("无法读取员工配置。")}</p><button className="wf-button" onClick={() => { setLoading(true); void reload().catch(e => setError(e instanceof Error ? e.message : String(e))).finally(() => setLoading(false)); }}>{t("重新加载")}</button></div> : <div className="wf-body">
      <aside aria-busy={busy || undefined} className="wf-sidebar"><span className="wf-library-order-status" role="status">{employeeOrder.announcement}</span><div className="wf-search"><Icon name="search" size={15} /><input aria-label={t("搜索员工")} value={query} onChange={e => setQuery(e.target.value)} placeholder={t("搜索模板")} /></div>
        {templateSection === 'horses' ? <><div className="wf-sidebar-heading"><span>{t("自由职业人库")}</span><span>{templates.length}</span></div>{filtered.map(template => <button {...employeeOrder.rowProps(template.id)} className={`wf-team-nav-member wf-employee-nav-item ${activeTemplate?.id === template.id ? 'is-active' : ''}${employeeOrder.rowProps(template.id).className}`} title={template.name} key={template.id} onClick={() => navigate({ kind: 'template', id: template.id })}><Icon name="person" size={14} /><span>{template.name}</span></button>)}{!filtered.length && <p className="wf-sidebar-empty">{query ? t("没有匹配的自由职业人") : t("尚无自由职业人，创建第一个岗位。")}</p>}<button className="wf-sidebar-add" disabled={busy} onClick={() => addEmployee()}><Icon name="plus" size={15} />{t("新建自由职业人")}</button></> : <><div className="wf-sidebar-heading"><span>{t("团队模板")}</span><button className="wf-icon-button" aria-label={t("新建空白团队模板")} onClick={() => navigate({ kind: 'new-team' })}><Icon name="plus" size={14} /></button></div><TeamSidebar reorderDisabled={busy} onReorder={ids => perform(() => client.reorderLibrary({ kind: 'team', orderedIds: ids }, { expectedRevision: state.revision }), "团队顺序已保存")} teams={state.teams} templates={state.templates} query={query} activeTeamId={activeTeam?.id} onSelect={selectTeamEntry} /></>}
      </aside>
      {showEditor && <EmployeeEditor
        client={client}
        key={selection?.kind === 'new-template' ? `new:${selection.draftId ?? selection.teamId ?? ''}` : selection?.kind === 'template' ? `${selection.id}:${selection.teamId ?? ''}:${selection.memberId ?? ''}` : undefined}
        record={activeTemplate} isProject={false} standalone={templateSection === 'horses'} templates={templates} employees={[]} teams={state.teams}
        draftKey={selection?.kind === 'new-template' ? selection.draftId : undefined}
        teamId={selection?.kind === 'template' || selection?.kind === 'new-template' ? selection.teamId : undefined}
        memberId={selection?.kind === 'template' ? selection.memberId : undefined}
        settingsState={state} busy={busy} unavailable={editorUnavailable} onDirty={setHasUnsaved}
        onArchive={templateSection === 'horses' && activeTemplate && activeTemplate.status !== 'archived' ? archiveSelectedTemplate : undefined}
        onSave={async input => {
          if (editorUnavailable) { setError("员工或团队关系已被移除，请重新选择。"); return false; }
          let status: 'draft' | 'ready' = 'draft';
          try { validateModules(input.modules, true); status = 'ready'; } catch { /* Incomplete configurations remain drafts; the store validates all saved fields. */ }
          const ok = await perform(() => input.settingsBundle ? client.saveSettingsBundle!(input.settingsBundle, activeTemplate ? { expectedVersion: input.baseVersion } : undefined) : client.saveEmployeeConfiguration({
            template: { id: input.templateId, name: input.name, description: input.description, modules: input.modules, status },
            membership: input.membership,
          }, activeTemplate ? { expectedVersion: input.baseVersion } : undefined), "员工配置已保存");
          if (ok) {
            setHasUnsaved(false);
            const target = input.membership?.target;
            setSelection(templateSection === 'teams' && target ? { kind: 'team', id: target.teamId } : { kind: 'template', id: input.templateId, ...(target ? { teamId: target.teamId, memberId: target.memberId } : {}) });
          }
          return ok;
        }}
      />}

      {(selection?.kind === 'team' || selection?.kind === 'new-team') && <TeamEditor key={selection.kind === 'team' ? selection.id : 'new-team'} team={activeTeam} unavailable={selection.kind === 'team' && !activeTeam} templates={state.templates} settingsState={state} busy={busy} onDirty={setHasUnsaved} onSelectMember={() => {}} onAddEmployee={() => addEmployee(activeTeam?.id)} onSave={async (name, description, members, baseVersion, workflows, knowledgeEnabled, settingsBundle) => { if (selection.kind === 'team' && !activeTeam) { setError("此团队已被移除，请选择其他团队。"); return false; } const id = activeTeam?.id ?? settingsBundle?.root.id ?? `team-${crypto.randomUUID()}`; const ok = await perform(() => settingsBundle ? client.saveSettingsBundle!(settingsBundle, activeTeam ? { expectedVersion: baseVersion } : undefined) : client.saveTeam({ id, name, description, members, workflows, knowledgeEnabled }, activeTeam ? { expectedVersion: baseVersion } : undefined), "团队模板已保存"); if (ok) { setHasUnsaved(false); setSelection({ kind: 'team', id }); } return ok; }} onDelete={activeTeam ? async () => { const ok = await perform(() => client.deleteTeam(activeTeam.id, { expectedVersion: activeTeam.version }), "团队模板已移除"); if (ok) { removeUiDraft(`team-draft:${activeTeam.id}`); setHasUnsaved(false); setSelection(null); } } : undefined} />}
    </div>}
  </div></div>;
}

