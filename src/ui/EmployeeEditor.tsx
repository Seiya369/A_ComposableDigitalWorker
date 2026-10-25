import { useI18n } from './i18n.js';
import { useEffect, useRef, useState } from 'react';
import type { EmployeeModules, EmployeeTemplate, ProjectEmployee, SaveEmployeeConfigurationInput, TeamTemplate, WorkforceState } from '../domain/types.js';
import type { TransferBundle } from '../domain/transfer-types.js';
import { createBlankModules } from '../domain/seed.js';
import { getEligibleTeamManagers, getSelectableTeamLevels, getTeamMemberLevel } from '../domain/team-hierarchy.js';
import { Field, SelectField } from './fields.js';
import { Icon } from './icons.js';
import { MODULES, ModuleEditor, moduleReady, type ModuleKey } from './ModuleEditor.js';
import './employee-editor.css';
import { activateUiDraft, readUiDraft, removeUiDraft, writeUiDraft } from './drafts.js';
import type { WorkforceClient } from './client.js';
import type { KnowledgeRemoveResult } from '../knowledge/library-api.js';
import { mergeKnowledgeSourceRemoval } from './knowledge-draft.js';
import { settingsBundleForSave } from '../domain/settings-transfer.js';
import { validateModules } from '../domain/validation.js';
import { ObjectSettingsTransfer } from './ObjectSettingsTransfer.js';

export interface EmployeeSave {
  templateId: string;
  name: string;
  description: string;
  modules: EmployeeModules;
  ready: boolean;
  active: boolean;
  managerId: string;
  teamLevel: number;
  baseVersion: number;
  membership?: SaveEmployeeConfigurationInput['membership'];
  settingsBundle?: TransferBundle;
}

interface EmployeeEditorProps {
  client: WorkforceClient;
  record?: EmployeeTemplate | ProjectEmployee;
  isProject: boolean;
  templates: EmployeeTemplate[];
  employees: ProjectEmployee[];
  teams: TeamTemplate[];
  settingsState?: WorkforceState;
  teamId?: string;
  memberId?: string;
  /** The reusable Horse library does not assign a Horse to a single team. */
  standalone?: boolean;
  draftKey?: string;
  busy: boolean;
  unavailable?: boolean;
  onDirty: (dirty: boolean) => void;
  onSave: (input: EmployeeSave) => Promise<boolean>;
  onArchive?: () => Promise<boolean>;
}

function roleDraftFingerprint(draft: EmployeeSave): string {
  return JSON.stringify([draft.name, draft.modules.model, draft.modules.responsibilities]);
}

export function EmployeeEditor({ client, record, isProject, templates, employees, teams, settingsState, teamId, memberId, standalone = false, draftKey, busy, unavailable = false, onDirty, onSave, onArchive }: EmployeeEditorProps) {
  const { t, errorMessage } = useI18n();
  const newTemplateId = useRef(`employee-${crypto.randomUUID()}`);
  const newMemberId = useRef(`member-${crypto.randomUUID()}`);
  const settingsTimestamp = useRef(new Date().toISOString());
  const persistedRecord = useRef(record);
  if (record && (record.id !== persistedRecord.current?.id || record.version > persistedRecord.current.version)) persistedRecord.current = record;
  const draftFrom = (value = persistedRecord.current): EmployeeSave => {
    const team = teams.find(team => team.id === teamId);
    const member = team?.members.find(member => member.memberId === memberId);
    return {
      templateId: value?.id ?? newTemplateId.current,
      name: value?.name ?? '',
      description: value && 'description' in value ? value.description : '',
      modules: structuredClone(value?.modules ?? createBlankModules()),
      ready: value?.status === 'ready', active: value?.status === 'active',
      managerId: value && 'managerId' in value ? value.managerId ?? '' : '',
      teamLevel: team ? member ? getTeamMemberLevel(team.members, member.memberId) : 1 : 0,
      baseVersion: value?.version ?? 0,
      ...(!isProject && !standalone ? { membership: {
        ...(memberId && teamId ? { source: { teamId, memberId, teamVersion: team?.version ?? 0 } } : {}),
        ...(teamId ? { target: { teamId, memberId: memberId ?? newMemberId.current, teamVersion: team?.version ?? 0, ...(member?.reportsTo ? { reportsTo: member.reportsTo } : {}) } } : {}),
      } } : {}),
    };
  };
  const cacheKey = `employee-draft:${isProject ? 'project' : 'template'}:${record?.id ?? draftKey ?? 'new'}:${teamId ?? ''}:${memberId ?? ''}:${standalone}`;
  const restored = useRef(readUiDraft<EmployeeSave>(cacheKey));
  const [draft, setDraft] = useState(() => restored.current ?? draftFrom());
  const [dirty, setDirty] = useState(!!restored.current);
  const [tab, setTab] = useState<ModuleKey>('model');
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState<string>();
  const editorBusy = busy || settingsBusy;
  const [roleGenerating, setRoleGenerating] = useState(false);
  const [roleError, setRoleError] = useState<string>();
  const roleRequest = useRef<{ controller: AbortController; cacheKey: string; fingerprint: string }>();
  const roleContext = useRef({ draft, cacheKey, client, busy: editorBusy, hostBusy: busy, unavailable });
  roleContext.current = { draft, cacheKey, client, busy: editorBusy, hostBusy: busy, unavailable };
  const roleFingerprint = roleDraftFingerprint(draft);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; roleRequest.current?.controller.abort(); roleRequest.current = undefined; }; }, []);
  const cancelRoleGeneration = () => {
    roleRequest.current?.controller.abort();
    roleRequest.current = undefined;
    setRoleGenerating(false);
  };
  useEffect(() => { cancelRoleGeneration(); setRoleError(undefined); }, [cacheKey, roleFingerprint, client, editorBusy, unavailable]);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => { activateUiDraft(cacheKey); if (dirty) writeUiDraft(cacheKey, draft); else removeUiDraft(cacheKey); }, [cacheKey, dirty, draft]);
  useEffect(() => { if (!dirty && !unavailable) setDraft(draftFrom()); }, [record, teams, teamId, memberId, dirty, unavailable]);
  const change = (values: Partial<EmployeeSave>) => {
    if (!mounted.current || roleContext.current.hostBusy || roleContext.current.unavailable) return;
    const current = roleContext.current.draft;
    const next = { ...current, ...values };
    if (roleDraftFingerprint(current) !== roleDraftFingerprint(next)) { cancelRoleGeneration(); setRoleError(undefined); }
    roleContext.current.draft = next;
    setDraft(next);
    setDirty(true);
    setSettingsError(undefined);
  };
  // Keep the baseline from the render that initiated deletion: a state event can
  // deliver the saved record before the HTTP response invokes this callback.
  const removalBaseline = persistedRecord.current;
  const sourceRemoved = (result: KnowledgeRemoveResult) => {
    const previous = removalBaseline;
    const employee = result.employee;
    if (!previous || !employee || employee.id !== previous.id) return;
    if (!mounted.current) {
      const cached = readUiDraft<EmployeeSave>(cacheKey);
      if (cached) writeUiDraft(cacheKey, { ...cached, baseVersion: employee.version, modules: mergeKnowledgeSourceRemoval(cached.modules, previous.modules, employee.modules) });
      return;
    }
    persistedRecord.current = structuredClone(employee);
    setDraft(value => ({ ...value, baseVersion: employee.version, modules: mergeKnowledgeSourceRemoval(value.modules, previous.modules, employee.modules) }));
  };
  const projectRecord = record && 'projectId' in record ? record : undefined;
  const target = draft.membership?.target;
  const targetTeam = teams.find(team => team.id === target?.teamId);
  const targetMissing = !!target && !targetTeam;
  const level = draft.teamLevel;
  const managers = targetTeam && target ? getEligibleTeamManagers(targetTeam.members, target.memberId, level) : [];
  const levels = targetTeam && target ? [...new Set([...getSelectableTeamLevels(targetTeam.members, target.memberId), level])].filter(value => value > 0).sort((a, b) => a - b) : [];
  const invalidOrganization = !!target && (level < 1 || (level === 1 ? !!target.reportsTo : !managers.some(member => member.memberId === target.reportsTo)));
  const missingModelSelection = draft.modules.model.mode === 'override' && (!draft.modules.model.provider || !draft.modules.model.model);
  const modulesForSave = { ...draft.modules, responsibilities: {
    ...draft.modules.responsibilities,
    duties: draft.modules.responsibilities.duties.filter(value => value.trim()),
    boundaries: draft.modules.responsibilities.boundaries.filter(value => value.trim()),
  } };
  let settingsReady = false;
  try { validateModules(modulesForSave, true); settingsReady = true; } catch { /* Incomplete roles remain drafts. */ }
  const settingsRoot: EmployeeTemplate = {
    id: draft.templateId, name: draft.name.trim(), description: draft.description, modules: modulesForSave,
    status: settingsReady ? 'ready' : 'draft', version: draft.baseVersion || 1,
    createdAt: record?.createdAt ?? settingsTimestamp.current, updatedAt: record?.updatedAt ?? settingsTimestamp.current,
  };
  const importSettings = (bundle: TransferBundle) => {
    const imported = bundle.data.templates.find(template => template.id === bundle.root.id);
    if (!imported) throw new Error("配置文件缺少自由职业人设置。");
    change({ name: imported.name, description: imported.description, modules: structuredClone(imported.modules), settingsBundle: bundle });
  };
  const roleGenerationUnavailable = !draft.name.trim() ? t("请先填写员工名称") : missingModelSelection ? t("请先在模型配置中选择岗位模型") : !client.generateEmployeeRole ? t("当前环境暂不支持 AI 智填") : '';
  const generateRole = async () => {
    const initial = roleContext.current;
    const model = initial.draft.modules.model;
    if (initial.busy || initial.unavailable || roleRequest.current) return;
    if (!initial.draft.name.trim() || model.mode === 'override' && (!model.provider || !model.model) || !initial.client.generateEmployeeRole) return;
    const request = { controller: new AbortController(), cacheKey: initial.cacheKey, fingerprint: roleDraftFingerprint(initial.draft) };
    roleRequest.current = request;
    setRoleGenerating(true);
    setRoleError(undefined);
    const isCurrent = () => {
      const current = roleContext.current;
      return mounted.current && roleRequest.current === request && !request.controller.signal.aborted
        && current.cacheKey === request.cacheKey && current.client === initial.client && !current.busy && !current.unavailable
        && roleDraftFingerprint(current.draft) === request.fingerprint;
    };
    try {
      const result = await initial.client.generateEmployeeRole({ name: initial.draft.name.trim(), model: structuredClone(model) }, request.controller.signal);
      if (!isCurrent()) return;
      const current = roleContext.current.draft;
      const next = { ...current, modules: { ...current.modules, responsibilities: structuredClone(result.responsibilities) } };
      roleContext.current.draft = next;
      setDraft(next);
      setDirty(true);
    } catch (error) {
      if (isCurrent()) setRoleError(error instanceof Error ? error.message : "AI 智填失败，请重试。");
    } finally {
      if (roleRequest.current === request) {
        roleRequest.current = undefined;
        if (mounted.current) setRoleGenerating(false);
      }
    }
  };
  const setLevel = (nextLevel: number) => {
    if (!targetTeam || !target) return;
    const keepManager = getEligibleTeamManagers(targetTeam.members, target.memberId, nextLevel).some(member => member.memberId === target.reportsTo);
    change({ teamLevel: nextLevel, membership: { ...draft.membership, target: { ...target, reportsTo: keepManager ? target.reportsTo : undefined } } });
  };
  const setTeam = (nextTeamId: string) => {
    const team = teams.find(team => team.id === nextTeamId);
    const source = draft.membership?.source;
    const original = team?.members.find(member => member.memberId === source?.memberId && team.id === source?.teamId);
    change({ teamLevel: team ? original ? getTeamMemberLevel(team.members, original.memberId) : 1 : 0, membership: {
      ...(source ? { source } : {}),
      ...(team ? { target: { teamId: team.id, memberId: original?.memberId ?? newMemberId.current, teamVersion: team.version, ...(original?.reportsTo ? { reportsTo: original.reportsTo } : {}) } } : {}),
    } });
  };
  const save = async () => {
    if (editorBusy || unavailable) return;
    cancelRoleGeneration();
    setSettingsError(undefined);
    try {
      if (draft.settingsBundle && !settingsState) throw new Error("配置依赖尚未载入，请稍后重试。");
      const settingsBundle = draft.settingsBundle && settingsState ? settingsBundleForSave(settingsState, 'employee', settingsRoot, draft.settingsBundle) : undefined;
      if (await onSave({ ...draft, name: draft.name.trim(), modules: modulesForSave, ...(settingsBundle ? { settingsBundle } : {}) })) {
        removeUiDraft(cacheKey);
        setDirty(false);
      }
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "保存配置失败，请重试。");
    }
  };

  return <main className="wf-editor wf-employee-editor">
      {unavailable && <div className="wf-banner wf-banner-error" role="alert">{t("员工或团队关系已被移除，当前草稿已保留。请重新选择员工。")}</div>}
      {settingsError && <div className="wf-error-box wf-employee-settings-error" role="alert">{errorMessage(settingsError)}</div>}
      <fieldset className="wf-employee-fields" disabled={editorBusy || unavailable}>
        <div className="wf-editor-hero">
          <div className="wf-title-row wf-employee-title-row">
            <div className="wf-employee-identity"><h2 aria-label={draft.name || t("添加员工")}><input className="wf-employee-name" aria-label={t("员工名称")} value={draft.name} onChange={event => change({ name: event.target.value })} placeholder={t("输入员工名称")} /></h2></div>
            {isProject && <button type="button" className={`wf-pill ${draft.active ? 'wf-pill-green' : ''}`} aria-label={t("启用项目员工")} aria-pressed={draft.active} onClick={() => change({ active: !draft.active })}>{draft.active ? t("已启用") : t("已停用")}</button>}
            <div className="wf-employee-actions">
              <span className="wf-employee-save-state" aria-live="polite">{missingModelSelection ? t("请选择岗位模型") : dirty ? restored.current ? t("已恢复草稿 · 未保存") : t("未保存") : ''}</span>
              {(onArchive || (!isProject && standalone)) && <button type="button" className="wf-button wf-danger-text" aria-label={t("移除自由职业人")} disabled={editorBusy || unavailable || !onArchive} title={t("从自由职业人库移除，保留配置记录和已有项目实例")} onClick={() => { if (onArchive) void onArchive().then(archived => { if (archived) removeUiDraft(cacheKey); }); }}><Icon name="trash" size={14} />{t("移除")}</button>}
              {!isProject && standalone && settingsState && <ObjectSettingsTransfer state={settingsState} kind="employee" root={settingsRoot} stagedBundle={draft.settingsBundle} disabled={busy || unavailable} onImport={importSettings} onBusyChange={setSettingsBusy} />}
              <button type="button" className="wf-button wf-primary" aria-label={t("保存配置")} disabled={editorBusy || unavailable || targetMissing || invalidOrganization || missingModelSelection || !draft.name.trim() || (!dirty && !!record)} onClick={() => void save()}><Icon name="check" size={16} />{busy ? t("保存中…") : t("保存")}</button>
            </div>
          </div>
          {!standalone && <div className={`wf-basic-fields${isProject ? ' wf-employee-reporting' : ' wf-employee-summary'}`}>
            {isProject ? <SelectField label={t("汇报对象")} value={draft.managerId} onChange={managerId => change({ managerId })}><option value="">{t("真人项目负责人")}</option>{employees.filter(employee => employee.id !== record?.id).map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</SelectField> : !standalone && <>
            <SelectField label={t("所属团队")} value={target?.teamId ?? ''} onChange={setTeam}>
              <option value="">{t("未分团")}</option>
              {targetMissing && <option value={target!.teamId} disabled>{t("团队已删除")}</option>}
              {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
            </SelectField>
            <Field label={t("所属层级")}>
              <select disabled={!targetTeam} value={level || ''} onChange={event => setLevel(Number(event.target.value))}>
                {!targetTeam && <option value="">{t("未分团")}</option>}
                {levels.map(value => <option key={value} value={value}>{t('第 {level} 级', { level: value })}</option>)}
              </select>
            </Field>
            <Field label={t("所属上级")}>
              <select disabled={!targetTeam || level === 1 || !managers.length} value={managers.some(member => member.memberId === target?.reportsTo) ? target!.reportsTo : ''} onChange={event => { if (target) change({ membership: { ...draft.membership, target: { ...target, reportsTo: event.target.value || undefined } } }); }}>
                <option value="" disabled={level > 1}>{!targetTeam ? t("未分团") : level === 1 ? t("无（顶层员工）") : managers.length ? t('请选择第 {level} 级员工', { level: level - 1 }) : t('暂无第 {level} 级员工', { level: level - 1 })}</option>
                {managers.map(member => <option key={member.memberId} value={member.memberId}>{member.name || templates.find(template => template.id === member.templateId)?.name || t("未配置员工")}</option>)}
              </select>
            </Field>
            </>}
          </div>}
        </div>
        <div className="wf-module-tabs" role="tablist" aria-label={t("员工配置模块")}>{MODULES.map((module, index) => <button key={module.key} id={`wf-tab-${module.key}`} role="tab" aria-selected={tab === module.key} aria-controls="wf-module-content" tabIndex={tab === module.key ? 0 : -1} className={tab === module.key ? 'is-active' : ''} onClick={() => setTab(module.key)} onKeyDown={event => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); const next = MODULES[(index + (event.key === 'ArrowRight' ? 1 : MODULES.length - 1)) % MODULES.length]!; setTab(next.key); document.getElementById(`wf-tab-${next.key}`)?.focus(); } }}><Icon name={module.icon} size={15} /><span>{t(module.label)}</span><span className={`wf-tab-dot ${moduleReady(module.key, draft.modules) ? 'is-done' : ''}`} /></button>)}</div>
        <div className="wf-module-content" data-module={tab} id="wf-module-content" role="tabpanel" aria-labelledby={`wf-tab-${tab}`}><ModuleEditor projectId={projectRecord?.projectId} client={client} activeModule={tab} modules={draft.modules} onChange={modules => change({ modules })} employeeVersion={draft.baseVersion} onSourceRemoved={sourceRemoved} responsibilitiesAction={<div className="wf-role-autofill-actions">{roleError && <span className="wf-role-autofill-error" role="alert" title={errorMessage(roleError)}>{errorMessage(roleError)}</span>}<button type="button" className="wf-button wf-role-autofill" aria-label={t("AI智填")} aria-busy={roleGenerating || undefined} disabled={editorBusy || unavailable || roleGenerating || !!roleGenerationUnavailable} title={roleGenerationUnavailable || t("根据员工名称，使用当前模型填写岗位内容")} onClick={() => void generateRole()}>{roleGenerating ? t("填充中…") : t("AI智填")}</button></div>} knowledgeTarget={record ? { scope: isProject ? 'project' : 'template', employeeId: record.id, ...(projectRecord ? { projectId: projectRecord.projectId, ...(projectRecord.teamInstanceId ? { teamId: projectRecord.teamInstanceId } : {}) } : teamId ? { teamId } : {}), library: 'employee' } : undefined} /></div>
      </fieldset>
    </main>;
}
