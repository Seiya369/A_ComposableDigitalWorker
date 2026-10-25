import { useI18n } from './i18n.js';
import { useEffect, useRef, useState } from 'react';
import type { EmployeeTemplate, TeamMember, TeamTemplate, TeamWorkflow, WorkforceState } from '../domain/types.js';
import type { TransferBundle } from '../domain/transfer-types.js';
import { settingsBundleForSave } from '../domain/settings-transfer.js';
import { ObjectSettingsTransfer } from './ObjectSettingsTransfer.js';
import { SelectField, TextField } from './fields.js';
import { Icon } from './icons.js';
import { TeamOrgChart } from './TeamOrgChart.js';
import { LibrarianToggle } from './LibrarianToggle.js';
import './team-editor.css';
import { validateWorkflows } from '../domain/validation.js';
import { activateUiDraft, readUiDraft, removeUiDraft, writeUiDraft } from './drafts.js';
import { removeTeamMember } from '../domain/team-member-removal.js';

interface TeamEditorProps {
  team?: TeamTemplate;
  templates: EmployeeTemplate[];
  settingsState?: WorkforceState;
  busy: boolean;
  unavailable?: boolean;
  onDirty: (dirty: boolean) => void;
  onSelectMember: (memberId: string) => void;
  onAddEmployee: () => void;
  onSave: (name: string, description: string, members: TeamMember[], baseVersion: number, workflows: TeamWorkflow[], knowledgeEnabled: boolean, settingsBundle?: TransferBundle) => Promise<boolean>;
  onDelete?: () => Promise<void>;
}

const draftFrom = (team?: TeamTemplate) => ({
  name: team?.name ?? '', description: team?.description ?? '', settingsBundle: undefined as TransferBundle | undefined,
  knowledgeEnabled: team?.knowledgeEnabled ?? true,
  members: structuredClone(team?.members ?? []), workflows: structuredClone(team?.workflows ?? []), baseVersion: team?.version ?? 0,
});

export function TeamEditor({ team, templates, settingsState, busy, unavailable = false, onDirty, onSave, onDelete }: TeamEditorProps) {
  const { t, errorMessage } = useI18n();
  const cacheKey = `team-draft:${team?.id ?? 'new'}`;
  const restored = readUiDraft<ReturnType<typeof draftFrom>>(cacheKey);
  const rootId = useRef(team?.id ?? restored?.settingsBundle?.root.id ?? '');
  if (!rootId.current) rootId.current = `team-${crypto.randomUUID()}`;
  const createdAt = useRef(team?.createdAt ?? new Date().toISOString());
  const [draft, setDraft] = useState(() => ({ ...draftFrom(team), ...restored, knowledgeEnabled: restored?.knowledgeEnabled ?? team?.knowledgeEnabled ?? true }));
  const [dirty, setDirty] = useState(!!restored);
  const [selectedHorse, setSelectedHorse] = useState('');
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferError, setTransferError] = useState('');
  const [removingMemberId, setRemovingMemberId] = useState<string>();
  const blocked = busy || unavailable || transferBusy;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => { activateUiDraft(cacheKey); if (dirty) writeUiDraft(cacheKey, draft); else removeUiDraft(cacheKey); }, [cacheKey, dirty, draft]);
  useEffect(() => { if (!dirty && !unavailable) setDraft(draftFrom(team)); }, [team, dirty, unavailable]);
  const change = (value: Partial<typeof draft>) => { if (!busy && !unavailable) { setDraft(current => ({ ...current, ...value })); setTransferError(''); setDirty(true); } };
  const members = draft.members;
  const allTemplates = [...(draft.settingsBundle?.data.templates ?? []), ...templates.filter(template => !draft.settingsBundle?.data.templates.some(imported => imported.id === template.id))];
  const availableHorses = allTemplates.filter(template => template.status !== 'archived');
  const wouldCycle = (memberId: string, managerId: string): boolean => {
    const seen = new Set([memberId]);
    let next: string | undefined = managerId;
    while (next) { if (seen.has(next)) return true; seen.add(next); next = members.find(member => member.memberId === next)?.reportsTo; }
    return false;
  };
  let workflowsReady = true;
  try { validateWorkflows(draft.workflows, 'memberId', new Set(members.map(member => member.memberId))); } catch { workflowsReady = false; }

  const root: TeamTemplate = { id: rootId.current, name: draft.name, description: draft.description, members: draft.members, workflows: draft.workflows, knowledgeEnabled: draft.knowledgeEnabled, version: draft.baseVersion || 1, createdAt: team?.createdAt ?? createdAt.current, updatedAt: team?.updatedAt ?? createdAt.current };
  async function saveDraft() {
    if (blocked) return;
    setTransferError('');
    try {
      const bundle = draft.settingsBundle && settingsState ? settingsBundleForSave(settingsState, 'team', { ...root, name: draft.name.trim() }, draft.settingsBundle) : undefined;
      if (draft.settingsBundle && !bundle) throw new Error("配置依赖尚未就绪，请重新打开团队后保存。");
      const ok = await onSave(draft.name.trim(), draft.description, draft.members, draft.baseVersion, draft.workflows, draft.knowledgeEnabled, bundle);
      if (ok) { removeUiDraft(cacheKey); setDirty(false); }
    } catch (error) { setTransferError(error instanceof Error ? error.message : String(error)); }
  }
  const removeMember = (memberId: string, replacementMemberId?: string) => {
    if (blocked) return;
    try { change(removeTeamMember(draft.members, draft.workflows, memberId, replacementMemberId)); setRemovingMemberId(undefined); }
    catch (error) { setTransferError(error instanceof Error ? error.message : String(error)); }
  };

  return <main className="wf-team-editor wf-team-editor-compact">
    <header className="wf-team-toolbar">
      <div className="wf-team-identity"><h2 aria-label={draft.name || t("新建团队")}><input className="wf-team-name" aria-label={t("团队名称")} value={draft.name} disabled={blocked} onChange={event => change({ name: event.target.value })} placeholder={t("输入团队名称")} /></h2><span>{t("组织结构")}{dirty && t(" · 未保存")}</span></div>
      <div className="wf-object-header-actions">
        <LibrarianToggle compact enabled={draft.knowledgeEnabled} disabled={blocked} onChange={knowledgeEnabled => change({ knowledgeEnabled })} />
        <button type="button" className="wf-button wf-danger-text" aria-label={t("移除团队")} disabled={blocked || !onDelete} onClick={() => { if (window.confirm(t('确定移除团队“{name}”？已有项目员工不会被修改。', { name: draft.name.trim() || team?.name || t('未命名团队') }))) void onDelete?.(); }}><Icon name="trash" size={15} />{t("移除")}</button>
        {settingsState && <ObjectSettingsTransfer state={settingsState} kind="team" root={root} stagedBundle={draft.settingsBundle} disabled={busy || unavailable} onBusyChange={setTransferBusy} onImport={bundle => {
          const imported = bundle.data.teams.find(item => item.id === bundle.root.id);
          if (!imported) throw new Error("导入文件缺少团队配置。");
          change({ name: imported.name, description: imported.description, members: structuredClone(imported.members), workflows: structuredClone(imported.workflows ?? []), knowledgeEnabled: imported.knowledgeEnabled ?? true, settingsBundle: structuredClone(bundle) });
          setSelectedHorse('');
        }} />}
        <button type="button" className="wf-button wf-primary" aria-label={t("保存团队")} disabled={blocked || !draft.name.trim() || !workflowsReady || (!dirty && !!team) || draft.members.some(member => !member.templateId)} onClick={() => void saveDraft()}><Icon name="check" size={15} />{busy ? t("保存中…") : t("保存")}</button>
      </div>
    </header>
    <div className="wf-team-content">
      {transferError && <p className="wf-error-box" role="alert">{errorMessage(transferError)}</p>}
      {unavailable && <p className="wf-error-box" role="alert">{t("此团队已被移除。当前草稿已保留，请选择其他团队。")}</p>}
      <section className="wf-team-sheet wf-team-chart-pane" aria-label={t("组织结构")}>
        <fieldset className="wf-team-workflow-fields wf-team-members" disabled={blocked}>
          <div className="wf-team-member-add"><select aria-label={t("选择要引进人员")} value={selectedHorse} onChange={event => setSelectedHorse(event.target.value)}><option value="">{t("选择要引进人员")}</option>{availableHorses.map(template => <option key={template.id} value={template.id}>{template.name} · v{template.version}</option>)}</select><button type="button" className="wf-button" disabled={!selectedHorse} onClick={() => { const template = availableHorses.find(item => item.id === selectedHorse); if (template) change({ members: [...members, { memberId: `member-${crypto.randomUUID()}`, templateId: template.id, name: template.name }] }); setSelectedHorse(''); }}><Icon name="plus" size={14} />{t("引入团队")}</button></div>
          {!availableHorses.length && <p className="wf-hint">{t("先在自由职业人库中配置岗位，再将岗位引入团队。")}</p>}
          <div className="wf-team-member-grid">{members.map(member => {
            const memberName = member.name?.trim() || allTemplates.find(template => template.id === member.templateId)?.name || t("未命名岗位");
            const usedByWorkflow = draft.workflows.some(workflow => workflow.steps.some(step => step.memberId === member.memberId));
            return <div className="wf-team-member-row" key={member.memberId}>
              <TextField label={t("团队岗位")} value={member.name ?? allTemplates.find(template => template.id === member.templateId)?.name ?? ''} onChange={name => change({ members: members.map(item => item.memberId === member.memberId ? { ...item, name } : item) })} />
              <SelectField label={t("上一级")} value={member.reportsTo ?? ''} onChange={reportsTo => change({ members: members.map(item => item.memberId === member.memberId ? { ...item, reportsTo: reportsTo || undefined } : item) })}><option value="">{t("团队负责人 / 无上级")}</option>{members.filter(item => !wouldCycle(member.memberId, item.memberId)).map(item => <option key={item.memberId} value={item.memberId}>{item.name || allTemplates.find(template => template.id === item.templateId)?.name}</option>)}</SelectField>
              <button type="button" className="wf-icon-button wf-danger-text" aria-label={t('移除岗位 {name}', { name: memberName })} title={t('移除岗位 {name}', { name: memberName })} onClick={() => { if (usedByWorkflow) setRemovingMemberId(member.memberId); else if (window.confirm(t('确定移除团队岗位“{name}”？', { name: memberName }))) removeMember(member.memberId); }}><Icon name="trash" size={15} /></button>
            </div>;
          })}</div>
        </fieldset>
        <TeamOrgChart members={members} templates={allTemplates} readOnly />
      </section>
    </div>
    {removingMemberId && members.some(member => member.memberId === removingMemberId) && <TeamMemberRemovalDialog memberId={removingMemberId} members={members} templates={allTemplates} workflows={draft.workflows} disabled={blocked} onClose={() => setRemovingMemberId(undefined)} onConfirm={replacement => removeMember(removingMemberId, replacement)} />}
  </main>;
}

function TeamMemberRemovalDialog({ memberId, members, templates, workflows, disabled, onClose, onConfirm }: {
  memberId: string; members: TeamMember[]; templates: EmployeeTemplate[]; workflows: TeamWorkflow[]; disabled: boolean;
  onClose: () => void; onConfirm: (replacementMemberId: string) => void;
}) {
  const { t, errorMessage } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const member = members.find(item => item.memberId === memberId)!;
  const choices = members.filter(item => item.memberId !== memberId);
  const [replacement, setReplacement] = useState(member.reportsTo ?? '');
  const nameOf = (item: TeamMember) => item.name?.trim() || templates.find(template => template.id === item.templateId)?.name || t("未命名岗位");
  const affected = workflows.flatMap(workflow => workflow.steps.filter(step => step.memberId === memberId).map(step => ({ workflow: workflow.name, step: step.name, id: `${workflow.id}/${step.id}` })));
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const element = dialog.current; element?.showModal(); element?.querySelector('select')?.focus();
    return () => { element?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={dialog} className="wf-team-removal-dialog" aria-label={t("移除团队岗位")} onKeyDown={event => { if (event.key === 'Escape' || event.key === 'Tab') event.stopPropagation(); }} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2>{t("移除团队岗位")}</h2><button type="button" className="wf-icon-button" aria-label={t("关闭岗位移除")} onClick={onClose}><Icon name="close" size={18} /></button></header>
    <form onSubmit={event => { event.preventDefault(); if (!disabled && choices.some(item => item.memberId === replacement)) onConfirm(replacement); }}>
      <p>{t('确定移除“{name}”？请为以下 {count} 个步骤选择接手人。', { name: nameOf(member), count: affected.length })}</p>
      <ul aria-label={t("需要交接的步骤")}>{affected.map(item => <li key={item.id}>{item.workflow} · {item.step}</li>)}</ul>
      <SelectField label={t("步骤接手人")} value={replacement} onChange={setReplacement} disabled={disabled}><option value="">{t("选择接手人")}</option>{choices.map(item => <option key={item.memberId} value={item.memberId}>{nameOf(item)}</option>)}</SelectField>
      {!choices.length && <p role="alert">{t("请先引入接手人，再移除此岗位。")}</p>}
      <p className="wf-hint">{t("保存团队后生效。直属下属改为向原上一级汇报，已有项目员工、知识和任务记录保留。")}</p>
      <footer><button type="button" className="wf-button" onClick={onClose}>{t("取消")}</button><button type="submit" className="wf-button wf-danger-text" disabled={disabled || !choices.some(item => item.memberId === replacement)}>{t("确认移除")}</button></footer>
    </form>
  </dialog>;
}
