import { useEffect, useId, useState } from 'react';
import type { EmployeeTemplate, TeamMember, TeamTemplate, TeamWorkflow } from '../domain/types.js';
import { SelectField, TextField } from './fields.js';
import { Icon } from './icons.js';
import { TeamOrgChart } from './TeamOrgChart.js';
import { TeamWorkflows } from './TeamWorkflows.js';
import { LibrarianToggle } from './LibrarianToggle.js';
import './team-editor.css';
import { validateWorkflows } from '../domain/validation.js';
import { activateUiDraft, readUiDraft, removeUiDraft, writeUiDraft } from './drafts.js';

interface TeamEditorProps {
  team?: TeamTemplate;
  templates: EmployeeTemplate[];
  busy: boolean;
  unavailable?: boolean;
  onDirty: (dirty: boolean) => void;
  onSelectMember: (memberId: string) => void;
  onAddEmployee: () => void;
  onSave: (name: string, description: string, members: TeamMember[], baseVersion: number, workflows: TeamWorkflow[], knowledgeEnabled: boolean) => Promise<boolean>;
  onDelete?: () => Promise<void>;
}

const draftFrom = (team?: TeamTemplate) => ({
  name: team?.name ?? '', description: team?.description ?? '',
  knowledgeEnabled: team?.knowledgeEnabled ?? true,
  members: structuredClone(team?.members ?? []), workflows: structuredClone(team?.workflows ?? []), baseVersion: team?.version ?? 0,
});
const SHEETS = [{ key: 'organization', label: '组织架构' }, { key: 'workflows', label: '工作流' }] as const;

export function TeamEditor({ team, templates, busy, unavailable = false, onDirty, onSelectMember, onAddEmployee, onSave, onDelete }: TeamEditorProps) {
  const cacheKey = `team-draft:${team?.id ?? 'new'}`;
  const restored = readUiDraft<ReturnType<typeof draftFrom>>(cacheKey);
  const [draft, setDraft] = useState(() => ({ ...draftFrom(team), ...restored, knowledgeEnabled: restored?.knowledgeEnabled ?? team?.knowledgeEnabled ?? true }));
  const [dirty, setDirty] = useState(!!restored);
  const [settingsOpen, setSettingsOpen] = useState(!team);
  const [sheet, setSheet] = useState<(typeof SHEETS)[number]['key']>('organization');
  const [selectedHorse, setSelectedHorse] = useState('');
  const sheetId = useId();
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => { activateUiDraft(cacheKey); if (dirty) writeUiDraft(cacheKey, draft); else removeUiDraft(cacheKey); }, [cacheKey, dirty, draft]);
  useEffect(() => { if (!dirty && !unavailable) setDraft(draftFrom(team)); }, [team, dirty, unavailable]);
  const change = (value: Partial<typeof draft>) => { if (!busy && !unavailable) { setDraft(current => ({ ...current, ...value })); setDirty(true); } };
  const members = draft.members;
  const availableHorses = templates.filter(template => template.status !== 'archived');
  const wouldCycle = (memberId: string, managerId: string): boolean => {
    const seen = new Set([memberId]);
    let next: string | undefined = managerId;
    while (next) { if (seen.has(next)) return true; seen.add(next); next = members.find(member => member.memberId === next)?.reportsTo; }
    return false;
  };
  let workflowsReady = true;
  try { validateWorkflows(draft.workflows, 'memberId', new Set(members.map(member => member.memberId))); } catch { workflowsReady = false; }

  return <main className="wf-team-editor">
    <header className="wf-team-toolbar">
      <div><h2>{draft.name || '新建团队'}</h2><span>{members.length} 位员工</span></div>
      <button className="wf-icon-button" aria-label="团队设置" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)}><Icon name="settings" size={17} /></button>
      <button className="wf-button" disabled={busy || unavailable || !team} title={!team ? '先保存团队' : undefined} onClick={onAddEmployee}><Icon name="plus" size={15} />添加员工</button>
    </header>
    <div className="wf-module-tabs wf-team-tabs" role="tablist" aria-label="团队视图">
      {SHEETS.map((item, index) => <button key={item.key} id={`${sheetId}-tab-${item.key}`} role="tab" aria-selected={sheet === item.key} aria-controls={`${sheetId}-panel-${item.key}`} tabIndex={sheet === item.key ? 0 : -1} className={sheet === item.key ? 'is-active' : ''} onClick={() => setSheet(item.key)} onKeyDown={event => {
        const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? SHEETS.length - 1 : event.key === 'ArrowRight' ? (index + 1) % SHEETS.length : event.key === 'ArrowLeft' ? (index + SHEETS.length - 1) % SHEETS.length : undefined;
        if (nextIndex === undefined) return;
        event.preventDefault();
        const next = SHEETS[nextIndex]!;
        setSheet(next.key);
        document.getElementById(`${sheetId}-tab-${next.key}`)?.focus();
      }}>{item.label}</button>)}
    </div>
    <div className="wf-team-content">
      {unavailable && <p className="wf-error-box" role="alert">此团队已被删除。当前草稿已保留，请选择其他团队。</p>}
      {settingsOpen && <fieldset disabled={busy || unavailable} className="wf-team-settings" aria-label="团队设置">
        <div className="wf-grid-two">
          <TextField label="团队名称" value={draft.name} onChange={name => change({ name })} placeholder="如：软件开发团 / AI 视频团" />
          <TextField label="团队简介" value={draft.description} onChange={description => change({ description })} placeholder="团队负责的工作" />
        </div>
        {onDelete && <button className="wf-inline-add wf-danger-text" disabled={busy} onClick={() => { if (window.confirm('删除此团队模板？已有项目员工不会被修改。')) void onDelete(); }}><Icon name="trash" size={14} />删除团队</button>}
      </fieldset>}
      <section className="wf-team-sheet wf-team-chart-pane" role="tabpanel" id={`${sheetId}-panel-organization`} aria-labelledby={`${sheetId}-tab-organization`} tabIndex={0} hidden={sheet !== 'organization'}>
        <LibrarianToggle enabled={draft.knowledgeEnabled} disabled={busy || unavailable} onChange={knowledgeEnabled => change({ knowledgeEnabled })} />
        <fieldset className="wf-team-workflow-fields wf-team-members" disabled={busy || unavailable}>
          <div className="wf-team-member-add"><SelectField label="引入职业人 Horse" value={selectedHorse} onChange={setSelectedHorse}><option value="">选择可复用职业人</option>{availableHorses.map(template => <option key={template.id} value={template.id}>{template.name} · v{template.version}</option>)}</SelectField><button type="button" className="wf-button" disabled={!selectedHorse} onClick={() => { const template = availableHorses.find(item => item.id === selectedHorse); if (template) change({ members: [...members, { memberId: `member-${crypto.randomUUID()}`, templateId: template.id, name: template.name }] }); setSelectedHorse(''); }}><Icon name="plus" size={14} />引入团队</button></div>
          {!availableHorses.length && <p className="wf-hint">先在“职业人 Horse”中配置岗位，再将岗位引入团队。</p>}
          {members.map(member => <div className="wf-team-member-row" key={member.memberId}>
            <TextField label="团队岗位名称" value={member.name ?? templates.find(template => template.id === member.templateId)?.name ?? ''} onChange={name => change({ members: members.map(item => item.memberId === member.memberId ? { ...item, name } : item) })} />
            <SelectField label="汇报对象" value={member.reportsTo ?? ''} onChange={reportsTo => change({ members: members.map(item => item.memberId === member.memberId ? { ...item, reportsTo: reportsTo || undefined } : item) })}><option value="">团队负责人 / 无上级</option>{members.filter(item => !wouldCycle(member.memberId, item.memberId)).map(item => <option key={item.memberId} value={item.memberId}>{item.name || templates.find(template => template.id === item.templateId)?.name}</option>)}</SelectField>
            <button type="button" className="wf-icon-button" aria-label={`移除岗位 ${member.name ?? ''}`} disabled={draft.workflows.some(workflow => workflow.steps.some(step => step.memberId === member.memberId))} title="工作流正在使用此岗位时，请先调整工作流" onClick={() => change({ members: members.filter(item => item.memberId !== member.memberId).map(item => item.reportsTo === member.memberId ? { ...item, reportsTo: undefined } : item) })}><Icon name="trash" size={15} /></button>
          </div>)}
        </fieldset>
        <TeamOrgChart members={members} templates={templates} onSelect={memberId => { if (!busy && !unavailable) onSelectMember(memberId); }} />
      </section>
      <section className="wf-team-sheet" role="tabpanel" id={`${sheetId}-panel-workflows`} aria-labelledby={`${sheetId}-tab-workflows`} tabIndex={0} hidden={sheet !== 'workflows'}>
        <fieldset className="wf-team-workflow-fields" disabled={busy || unavailable} aria-label="工作流配置">
          <TeamWorkflows workflows={draft.workflows} members={members} templates={templates} onChange={workflows => change({ workflows })} />
        </fieldset>
      </section>
    </div>
    <footer className="wf-editor-actions">
      <span>{dirty ? '未保存' : ''}</span>
      <button className="wf-button" disabled={busy || unavailable || !dirty} onClick={() => { setDraft(draftFrom(team)); setDirty(false); }}>还原修改</button>
      <button className="wf-button wf-primary" disabled={busy || unavailable || !draft.name.trim() || !workflowsReady || (!dirty && !!team) || draft.members.some(member => !member.templateId)} onClick={() => void onSave(draft.name.trim(), draft.description, draft.members, draft.baseVersion, draft.workflows, draft.knowledgeEnabled).then(ok => { if (ok) { removeUiDraft(cacheKey); setDirty(false); } })}><Icon name="check" size={16} />{busy ? '保存中…' : '保存团队'}</button>
    </footer>
  </main>;
}
