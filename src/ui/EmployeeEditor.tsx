import { useEffect, useMemo, useRef, useState } from 'react';
import type { EmployeeModules, EmployeeTemplate, ProjectEmployee, ProjectTeam, SaveEmployeeConfigurationInput, TeamTemplate } from '../domain/types.js';
import { createBlankModules } from '../domain/seed.js';
import { getEligibleTeamManagers, getSelectableTeamLevels, getTeamMemberLevel } from '../domain/team-hierarchy.js';
import { Field, SelectField } from './fields.js';
import { Icon } from './icons.js';
import { MODULES, ModuleEditor, moduleReady, type ModuleKey } from './ModuleEditor.js';
import './employee-editor.css';
import { activateUiDraft, readUiDraft, removeUiDraft, writeUiDraft } from './drafts.js';
import type { WorkforceClient } from './client.js';
import { KNOWLEDGE_UPLOAD_ACCEPT } from '../knowledge/upload-limits.js';
import { knowledgeUploadFailureMessage, resolveKnowledgeUploadContext, uploadKnowledgeFiles } from './knowledge-upload.js';
import { KnowledgeUploadedSources } from './KnowledgeUploadedSources.js';

const NO_PROJECT_TEAMS: ProjectTeam[] = [];

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
}

interface EmployeeEditorProps {
  client: WorkforceClient;
  record?: EmployeeTemplate | ProjectEmployee;
  isProject: boolean;
  templates: EmployeeTemplate[];
  employees: ProjectEmployee[];
  teams: TeamTemplate[];
  projectTeams?: ProjectTeam[];
  teamId?: string;
  memberId?: string;
  /** The reusable Horse library does not assign a Horse to a single team. */
  standalone?: boolean;
  draftKey?: string;
  busy: boolean;
  unavailable?: boolean;
  onDirty: (dirty: boolean) => void;
  onSave: (input: EmployeeSave) => Promise<boolean>;
}

export function EmployeeEditor({ client, record, isProject, templates, employees, teams, projectTeams = NO_PROJECT_TEAMS, teamId, memberId, standalone = false, draftKey, busy, unavailable = false, onDirty, onSave }: EmployeeEditorProps) {
  const newTemplateId = useRef(`employee-${crypto.randomUUID()}`);
  const newMemberId = useRef(`member-${crypto.randomUUID()}`);
  const draftFrom = (value = record): EmployeeSave => {
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
  const [tab, setTab] = useState<ModuleKey>('responsibilities');
  const [knowledgeUploading, setKnowledgeUploading] = useState(false);
  const [knowledgeUploadRevision, setKnowledgeUploadRevision] = useState(0);
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => { activateUiDraft(cacheKey); if (dirty) writeUiDraft(cacheKey, draft); else removeUiDraft(cacheKey); }, [cacheKey, dirty, draft]);
  useEffect(() => { if (!dirty && !unavailable) setDraft(draftFrom()); }, [record, teams, teamId, memberId, dirty, unavailable]);
  const change = (values: Partial<EmployeeSave>) => { if (!busy && !unavailable && !knowledgeUploading) { setDraft(value => ({ ...value, ...values })); setDirty(true); } };
  const projectRecord = record && 'projectId' in record ? record : undefined;
  const knowledgeUploadContext = useMemo(() => resolveKnowledgeUploadContext({ record, isProject, teams, projectTeams, employees, teamId, memberId }), [record, isProject, teams, projectTeams, employees, teamId, memberId]);
  const knowledgeUploadTargetKey = JSON.stringify(knowledgeUploadContext.target ?? null);
  const currentKnowledgeUpload = useRef({ key: knowledgeUploadTargetKey, allowed: false });
  currentKnowledgeUpload.current = { key: knowledgeUploadTargetKey, allowed: !!knowledgeUploadContext.target && !knowledgeUploadContext.disabledReason && !unavailable && !busy };
  const uploadKnowledge = async (files: File[]) => {
    if (!files.length) return;
    const target = knowledgeUploadContext.target;
    if (busy || unavailable || knowledgeUploading || !target || knowledgeUploadContext.disabledReason) throw new Error(knowledgeUploadContext.disabledReason || '当前无法上传资料。');
    setKnowledgeUploading(true);
    try {
      const outcome = await uploadKnowledgeFiles(client, target, files, () => alive.current && currentKnowledgeUpload.current.key === knowledgeUploadTargetKey && currentKnowledgeUpload.current.allowed);
      if (alive.current && currentKnowledgeUpload.current.key === knowledgeUploadTargetKey) setKnowledgeUploadRevision(value => value + 1);
      if (outcome.failed.length) throw new Error(knowledgeUploadFailureMessage(outcome));
    } finally {
      if (alive.current) setKnowledgeUploading(false);
    }
  };
  const target = draft.membership?.target;
  const targetTeam = teams.find(team => team.id === target?.teamId);
  const targetMissing = !!target && !targetTeam;
  const level = draft.teamLevel;
  const managers = targetTeam && target ? getEligibleTeamManagers(targetTeam.members, target.memberId, level) : [];
  const levels = targetTeam && target ? [...new Set([...getSelectableTeamLevels(targetTeam.members, target.memberId), level])].filter(value => value > 0).sort((a, b) => a - b) : [];
  const invalidOrganization = !!target && (level < 1 || (level === 1 ? !!target.reportsTo : !managers.some(member => member.memberId === target.reportsTo)));
  const missingModelSelection = draft.modules.model.mode === 'override' && (!draft.modules.model.provider || !draft.modules.model.model);
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
    const modules = { ...draft.modules, responsibilities: {
      ...draft.modules.responsibilities,
      duties: draft.modules.responsibilities.duties.filter(value => value.trim()),
      boundaries: draft.modules.responsibilities.boundaries.filter(value => value.trim()),
    } };
    if (await onSave({ ...draft, name: draft.name.trim(), modules })) {
      removeUiDraft(cacheKey);
      setDirty(false);
    }
  };

  return <main className="wf-editor">
      {unavailable && <div className="wf-banner wf-banner-error" role="alert">员工或团队关系已被移除，当前草稿已保留。请重新选择员工。</div>}
      <fieldset className="wf-employee-fields" disabled={busy || unavailable || knowledgeUploading}>
        <div className="wf-editor-hero">
          <div className="wf-title-row"><div><h2 aria-label={draft.name || '添加员工'}><input className="wf-employee-name" aria-label="员工名称" value={draft.name} onChange={event => change({ name: event.target.value })} placeholder="输入员工名称" /></h2></div>{isProject && <button type="button" className={`wf-pill ${draft.active ? 'wf-pill-green' : ''}`} aria-label="启用项目员工" aria-pressed={draft.active} onClick={() => change({ active: !draft.active })}>{draft.active ? '已启用' : '已停用'}</button>}</div>
          {projectRecord?.importReview && <details className="wf-import-permission-review"><summary>导入权限待人工复核</summary><p className="wf-hint">这是导入文件中的原始权限请求。导入时员工停用、有效权限清空；请核对后保存权限，并自行选择启用。Shell 和网络当前不支持。</p><pre>{JSON.stringify(projectRecord.importReview.requestedPermissions, null, 2)}</pre><button type="button" className="wf-button" onClick={() => { change({ modules: { ...draft.modules, permissions: { ...structuredClone(projectRecord.importReview!.requestedPermissions), allowShell: false, allowNetwork: false } } }); setTab('permissions'); }}>复制支持的权限到草稿</button></details>}
          {!standalone && <div className={`wf-basic-fields${isProject ? ' wf-employee-reporting' : ' wf-employee-summary'}`}>
            {isProject ? <SelectField label="汇报对象" value={draft.managerId} onChange={managerId => change({ managerId })}><option value="">真人项目负责人</option>{employees.filter(employee => employee.id !== record?.id).map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</SelectField> : !standalone && <>
            <SelectField label="所属团队" value={target?.teamId ?? ''} onChange={setTeam}>
              <option value="">未分团</option>
              {targetMissing && <option value={target!.teamId} disabled>团队已删除</option>}
              {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
            </SelectField>
            <Field label="所属层级">
              <select disabled={!targetTeam} value={level || ''} onChange={event => setLevel(Number(event.target.value))}>
                {!targetTeam && <option value="">未分团</option>}
                {levels.map(value => <option key={value} value={value}>第 {value} 级</option>)}
              </select>
            </Field>
            <Field label="所属上级">
              <select disabled={!targetTeam || level === 1 || !managers.length} value={managers.some(member => member.memberId === target?.reportsTo) ? target!.reportsTo : ''} onChange={event => { if (target) change({ membership: { ...draft.membership, target: { ...target, reportsTo: event.target.value || undefined } } }); }}>
                <option value="" disabled={level > 1}>{!targetTeam ? '未分团' : level === 1 ? '无（顶层员工）' : managers.length ? `请选择第 ${level - 1} 级员工` : `暂无第 ${level - 1} 级员工`}</option>
                {managers.map(member => <option key={member.memberId} value={member.memberId}>{member.name || templates.find(template => template.id === member.templateId)?.name || '未配置员工'}</option>)}
              </select>
            </Field>
            </>}
          </div>}
        </div>
        <div className="wf-module-tabs" role="tablist" aria-label="员工配置模块">{MODULES.map((module, index) => <button key={module.key} id={`wf-tab-${module.key}`} role="tab" aria-selected={tab === module.key} aria-controls="wf-module-content" tabIndex={tab === module.key ? 0 : -1} className={tab === module.key ? 'is-active' : ''} onClick={() => setTab(module.key)} onKeyDown={event => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); const next = MODULES[(index + (event.key === 'ArrowRight' ? 1 : MODULES.length - 1)) % MODULES.length]!; setTab(next.key); document.getElementById(`wf-tab-${next.key}`)?.focus(); } }}><Icon name={module.icon} size={15} /><span>{module.label}</span><span className={`wf-tab-dot ${moduleReady(module.key, draft.modules) ? 'is-done' : ''}`} /></button>)}</div>
        <div className="wf-module-content" id="wf-module-content" role="tabpanel" aria-labelledby={`wf-tab-${tab}`}><ModuleEditor projectId={projectRecord?.projectId} client={client} activeModule={tab} modules={draft.modules} onChange={modules => change({ modules })} templates={templates} currentTemplateId={projectRecord?.templateId ?? record?.id}
          onUploadKnowledge={knowledgeUploadContext.target && !knowledgeUploadContext.disabledReason ? uploadKnowledge : undefined}
          knowledgeUploadDisabled={busy || unavailable || knowledgeUploading} knowledgeUploadAccept={KNOWLEDGE_UPLOAD_ACCEPT}
          knowledgeUploadTargetLabel={knowledgeUploadContext.label} knowledgeUploadDisabledReason={knowledgeUploadContext.disabledReason}
          knowledgeUploadKey={`${knowledgeUploadTargetKey}:${knowledgeUploadContext.disabledReason ?? ''}`}
          knowledgeUploadedSources={knowledgeUploadContext.target && !knowledgeUploadContext.disabledReason ? <KnowledgeUploadedSources key={knowledgeUploadTargetKey} client={client} target={knowledgeUploadContext.target} revision={knowledgeUploadRevision} /> : undefined}
        /></div>
      </fieldset>
      <div className="wf-editor-actions">
        <span>{missingModelSelection ? '请在“模型选择”中选择岗位模型' : dirty ? restored.current ? '已恢复草稿 · 未保存' : '未保存' : ''}</span>
        <button className="wf-button" disabled={busy || unavailable || knowledgeUploading || !dirty} onClick={() => { setDraft(draftFrom()); setDirty(false); }}>还原修改</button>
        <button className="wf-button wf-primary" disabled={busy || unavailable || knowledgeUploading || targetMissing || invalidOrganization || missingModelSelection || !draft.name.trim() || (!dirty && !!record)} onClick={() => void save()}><Icon name="check" size={16} />{busy ? '保存中…' : '保存配置'}</button>
      </div>
    </main>;
}
