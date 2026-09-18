import { useEffect, useRef, useState } from 'react';
import type { EmployeeModules, EmployeeTemplate, ProjectEmployee, SaveEmployeeConfigurationInput, TeamTemplate } from '../domain/types.js';
import { createBlankModules } from '../domain/seed.js';
import { getEligibleTeamManagers, getSelectableTeamLevels, getTeamMemberLevel } from '../domain/team-hierarchy.js';
import { Field, SelectField, TextField } from './fields.js';
import { Icon } from './icons.js';
import { MODULES, ModuleEditor, moduleReady, type ModuleKey } from './ModuleEditor.js';
import './employee-editor.css';

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
  record?: EmployeeTemplate | ProjectEmployee;
  isProject: boolean;
  templates: EmployeeTemplate[];
  employees: ProjectEmployee[];
  teams: TeamTemplate[];
  teamId?: string;
  memberId?: string;
  busy: boolean;
  unavailable?: boolean;
  onDirty: (dirty: boolean) => void;
  onSave: (input: EmployeeSave) => Promise<boolean>;
}

export function EmployeeEditor({ record, isProject, templates, employees, teams, teamId, memberId, busy, unavailable = false, onDirty, onSave }: EmployeeEditorProps) {
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
      ...(!isProject ? { membership: {
        ...(memberId && teamId ? { source: { teamId, memberId, teamVersion: team?.version ?? 0 } } : {}),
        ...(teamId ? { target: { teamId, memberId: memberId ?? newMemberId.current, teamVersion: team?.version ?? 0, ...(member?.reportsTo ? { reportsTo: member.reportsTo } : {}) } } : {}),
      } } : {}),
    };
  };
  const [draft, setDraft] = useState(() => draftFrom());
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<ModuleKey>('responsibilities');
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => { if (!dirty && !unavailable) setDraft(draftFrom()); }, [record, teams, teamId, memberId, dirty, unavailable]);
  const change = (values: Partial<EmployeeSave>) => { if (!busy && !unavailable) { setDraft(value => ({ ...value, ...values })); setDirty(true); } };
  const projectRecord = record && 'projectId' in record ? record : undefined;
  const target = draft.membership?.target;
  const targetTeam = teams.find(team => team.id === target?.teamId);
  const targetMissing = !!target && !targetTeam;
  const level = draft.teamLevel;
  const managers = targetTeam && target ? getEligibleTeamManagers(targetTeam.members, target.memberId, level) : [];
  const levels = targetTeam && target ? [...new Set([...getSelectableTeamLevels(targetTeam.members, target.memberId), level])].filter(value => value > 0).sort((a, b) => a - b) : [];
  const invalidOrganization = !!target && (level < 1 || (level === 1 ? !!target.reportsTo : !managers.some(member => member.memberId === target.reportsTo)));
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

  return <main className="wf-editor">
      {unavailable && <div className="wf-banner wf-banner-error" role="alert">员工或团队关系已被移除，当前草稿已保留。请重新选择员工。</div>}
      <fieldset className="wf-employee-fields" disabled={busy || unavailable}>
        <div className="wf-editor-hero">
          <div className="wf-title-row"><div><h2>{draft.name || '添加员工'}</h2></div>{isProject ? <button type="button" className={`wf-pill ${draft.active ? 'wf-pill-green' : ''}`} aria-label="启用项目员工" aria-pressed={draft.active} onClick={() => change({ active: !draft.active })}>{draft.active ? '已启用' : '已停用'}</button> : <span className={`wf-pill ${draft.ready ? 'wf-pill-green' : ''}`}>{draft.ready ? '已发布' : '草稿'}</span>}</div>
          <div className={`wf-basic-fields${isProject ? '' : ' wf-employee-summary'}`}>
            <TextField label="员工名称" value={draft.name} onChange={name => change({ name })} placeholder="如：技术负责人 / 架构师" />
            {isProject ? <SelectField label="汇报对象" value={draft.managerId} onChange={managerId => change({ managerId })}><option value="">真人项目负责人</option>{employees.filter(employee => employee.id !== record?.id).map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</SelectField> : <>
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
          </div>
        </div>
        <div className="wf-module-tabs" role="tablist" aria-label="员工配置模块">{MODULES.map((module, index) => <button key={module.key} id={`wf-tab-${module.key}`} role="tab" aria-selected={tab === module.key} aria-controls="wf-module-content" tabIndex={tab === module.key ? 0 : -1} className={tab === module.key ? 'is-active' : ''} onClick={() => setTab(module.key)} onKeyDown={event => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); const next = MODULES[(index + (event.key === 'ArrowRight' ? 1 : MODULES.length - 1)) % MODULES.length]!; setTab(next.key); document.getElementById(`wf-tab-${next.key}`)?.focus(); } }}><Icon name={module.icon} size={15} /><span>{module.label}</span><span className={`wf-tab-dot ${moduleReady(module.key, draft.modules) ? 'is-done' : ''}`} /></button>)}</div>
        <div className="wf-module-content" id="wf-module-content" role="tabpanel" aria-labelledby={`wf-tab-${tab}`}><ModuleEditor activeModule={tab} modules={draft.modules} onChange={modules => change({ modules })} templates={templates} currentTemplateId={projectRecord?.templateId ?? record?.id} /></div>
      </fieldset>
      <div className="wf-editor-actions">
        <span>{dirty ? '未保存' : ''}</span>
        <button className="wf-button" disabled={busy || unavailable || !dirty} onClick={() => { setDraft(draftFrom()); setDirty(false); }}>还原修改</button>
        <button className="wf-button wf-primary" disabled={busy || unavailable || targetMissing || invalidOrganization || !draft.name.trim() || (!dirty && !!record)} onClick={() => void onSave({ ...draft, name: draft.name.trim() }).then(ok => { if (ok) setDirty(false); })}><Icon name="check" size={16} />{busy ? '保存中…' : '保存配置'}</button>
      </div>
    </main>;
}
