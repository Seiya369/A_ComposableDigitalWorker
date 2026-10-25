import { useEffect, useId, useRef, useState } from 'react';
import type { SaveWorkflowTemplateInput, TeamTemplate, TeamWorkflow, WorkforceState, WorkflowTemplate } from '../domain/types.js';
import type { TransferBundle } from '../domain/transfer-types.js';
import { settingsBundleForSave } from '../domain/settings-transfer.js';
import { ObjectSettingsTransfer } from './ObjectSettingsTransfer.js';
import { WorkflowTeamPickerDialog } from './WorkflowTeamPickerDialog.js';
import { WorkflowDiagram } from './WorkflowDiagram.js';
import { adoptWorkflowTeam, inferWorkflowTeam } from '../domain/workflow-team.js';
import { validateWorkflows } from '../workflow/definition.js';
import type { WorkforceClient } from './client.js';
import { SelectField, TextField } from './fields.js';
import { EmptyState } from './EmptyState.js';
import { Icon } from './icons.js';
import './team-editor.css';
import './workflow-template-editor.css';
import { activateUiDraft, discardActiveUiDraft, readUiDraft, removeUiDraft, writeUiDraft } from './drafts.js';
import { useLibraryReorder } from './useLibraryReorder.js';
import { useI18n } from './i18n.js';

interface Props { client: WorkforceClient; state: WorkforceState; onReload: () => Promise<unknown>; onDirtyChange: (dirty: boolean) => void }
export function WorkflowTemplateLibrary({ client, state, onReload, onDirtyChange }: Props) {
  const { t, errorMessage } = useI18n();
  const workflows = state.workflowTemplates ?? [];
  const previousSelection = readUiDraft<{ selectedId?: string; creating: boolean }>('workflow-library-navigation');
  const [selectedId, setSelectedId] = useState<string | undefined>(previousSelection?.selectedId ?? workflows[0]?.id);
  const [creating, setCreating] = useState(previousSelection?.creating ?? false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ cause: unknown; kind?: 'order' | 'refresh' }>();
  const [editorTransferBusy, setEditorTransferBusy] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const orderingNow = useRef(false);
  const workflowOrder = useLibraryReorder(workflows.map(row => row.id), busy || ordering || editorTransferBusy, async ids => {
    if (orderingNow.current || busy || editorTransferBusy) return false;
    orderingNow.current = true; setOrdering(true); setError(undefined);
    try { await client.reorderLibrary({ kind: 'workflow', orderedIds: ids }, { expectedRevision: state.revision }); await onReload(); return true; }
    catch (cause) { setError({ cause, kind: 'order' }); try { await onReload(); } catch { /* Preserve the ordering error and editor draft. */ } return false; }
    finally { orderingNow.current = false; setOrdering(false); }
  });
  const selected = workflows.find(workflow => workflow.id === selectedId);
  useEffect(() => { writeUiDraft('workflow-library-navigation', { selectedId, creating }); }, [selectedId, creating]);
  function navigate(id?: string) {
    if (busy || ordering || editorTransferBusy || (dirty && !window.confirm(t('工作流尚未保存，确定放弃修改？')))) return;
    if (dirty) discardActiveUiDraft();
    setSelectedId(id); setCreating(!id); setDirty(false); setError(undefined);
  }
  const changeDirty = (value: boolean) => { setDirty(value); onDirtyChange(value); };
  async function perform(operation: () => Promise<unknown>): Promise<boolean> {
    if (busy || ordering) return false;
    setBusy(true); setError(undefined);
    try { await operation(); changeDirty(false); try { await onReload(); } catch (cause) { setError({ cause, kind: 'refresh' }); } return true; }
    catch (cause) { setError({ cause }); return false; }
    finally { setBusy(false); }
  }
  return <div className="wf-library-body">
    <aside className="wf-sidebar" aria-busy={ordering || undefined}><span className="wf-library-order-status" role="status">{workflowOrder.announcement}</span><div className="wf-sidebar-heading"><span>{t('通用工作流')}</span><span>{workflows.length}</span></div>
      {workflows.map(workflow => <button {...workflowOrder.rowProps(workflow.id)} key={workflow.id} className={`wf-team-nav-member wf-workflow-nav-item ${selectedId === workflow.id && !creating ? 'is-active' : ''}${workflowOrder.rowProps(workflow.id).className}`} title={workflow.name} onClick={() => navigate(workflow.id)}><Icon name="network" size={14} /><span>{workflow.name}</span></button>)}
      <button className="wf-sidebar-add" disabled={busy || ordering || editorTransferBusy} onClick={() => navigate()}><Icon name="plus" size={15} />{t('新建工作流')}</button>
    </aside>
    <div className="wf-library-main">
      {error && <p className="wf-banner wf-banner-error" role="alert">{error.kind === 'order' ? t('排序未确认，请刷新后重试：{error}', { error: errorMessage(error.cause) }) : error.kind === 'refresh' ? t('保存已完成，刷新失败。请刷新数据查看结果：{error}', { error: errorMessage(error.cause) }) : errorMessage(error.cause)}</p>}
      {creating || selected ? <WorkflowTemplateEditor key={creating ? 'new' : selectedId} workflow={creating ? undefined : selected} state={state} busy={busy || ordering} onTransferBusy={setEditorTransferBusy} onDirty={changeDirty} onSave={async (input, version, settingsBundle) => {
        const id = input.id ?? `workflow-${crypto.randomUUID()}`;
        const ok = await perform(() => settingsBundle ? client.saveSettingsBundle(settingsBundle, version ? { expectedVersion: version } : undefined) : client.saveWorkflowTemplate({ ...input, id }, version ? { expectedVersion: version } : undefined)); if (ok) { setSelectedId(id); setCreating(false); } return ok;
      }} onDelete={selected && !creating ? async () => { if (window.confirm(t('确定移除这个通用工作流？团队已引入的副本会保留。')) && await perform(() => client.deleteWorkflowTemplate(selected.id, { expectedVersion: selected.version }))) { removeUiDraft(`workflow-template-draft:${selected.id}`); setSelectedId(undefined); setCreating(false); } } : undefined} /> : <EmptyState title={t('尚无通用工作流')} description={t('新建工作流，按顺序添加步骤。')} />}
    </div>
  </div>;
}

function WorkflowTemplateEditor({ workflow, state, busy, onTransferBusy, onDirty, onSave, onDelete }: {
  workflow?: WorkflowTemplate; state: WorkforceState; busy: boolean; onTransferBusy: (busy: boolean) => void; onDirty: (dirty: boolean) => void;
  onSave: (input: SaveWorkflowTemplateInput, version: number, settingsBundle?: TransferBundle) => Promise<boolean>; onDelete?: () => Promise<void>;
}) {
  const { t, errorMessage } = useI18n();
  const cacheKey = `workflow-template-draft:${workflow?.id ?? 'new'}`;
  const defaultStepId = useRef(`step-${crypto.randomUUID()}`);
  const fieldsId = useId();
  const editor = useRef<HTMLElement>(null);
  const initialTeam = workflow ? inferWorkflowTeam(workflow, state.teams, state.templates) : undefined;
  const from = (id: string) => ({ id, baseVersion: workflow?.version ?? 0, settingsBundle: undefined as TransferBundle | undefined, acceptanceText: {} as Record<string, string>, outputsText: {} as Record<string, string>, name: workflow?.name ?? '', description: workflow?.description ?? '', maxAttempts: workflow?.maxAttempts, team: structuredClone(initialTeam?.team), roles: structuredClone(initialTeam?.roles ?? workflow?.roles ?? []), steps: structuredClone(initialTeam?.steps ?? workflow?.steps ?? [{ id: defaultStepId.current, name: '', roleId: '', instruction: '' }]) });
  const restored = readUiDraft<ReturnType<typeof from>>(cacheKey);
  const rootId = useRef(workflow?.id ?? restored?.settingsBundle?.root.id ?? restored?.id ?? '');
  if (!rootId.current) rootId.current = `workflow-${crypto.randomUUID()}`;
  const createdAt = useRef(workflow?.createdAt ?? new Date().toISOString());
  const [draft, setDraft] = useState(() => ({ ...from(rootId.current), ...restored, id: rootId.current, baseVersion: restored?.baseVersion ?? workflow?.version ?? 0 }));
  const [dirty, setDirty] = useState(!!restored);
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferError, setTransferError] = useState('');
  const [teamOpen, setTeamOpen] = useState(false);
  const blocked = busy || transferBusy;
  useEffect(() => { onTransferBusy(transferBusy); return () => onTransferBusy(false); }, [transferBusy, onTransferBusy]);
  useEffect(() => { onDirty(dirty); }, [dirty]);
  useEffect(() => { activateUiDraft(cacheKey); if (dirty) writeUiDraft(cacheKey, draft); else removeUiDraft(cacheKey); }, [cacheKey, dirty, draft]);
  useEffect(() => { if (!dirty) setDraft(from(rootId.current)); }, [workflow, dirty]);
  const change = (patch: Partial<typeof draft>) => { if (!busy) { setDraft(current => ({ ...current, ...patch })); setTransferError(''); setDirty(true); } };
  const stepsForSave = draft.steps.map(step => ({ ...step,
    ...(Object.hasOwn(draft.acceptanceText, step.id) ? { acceptanceCriteria: draft.acceptanceText[step.id]!.split(/\r?\n/).filter(line => line.trim().length > 0) } : {}),
    ...(Object.hasOwn(draft.outputsText, step.id) ? { outputs: draft.outputsText[step.id]!.split(/\r?\n/).filter(line => line.trim().length > 0) } : {}),
  }));
  const form: TeamWorkflow = { id: draft.id ?? 'draft-workflow', name: draft.name, maxAttempts: draft.maxAttempts, steps: stepsForSave.map(({ roleId, ...step }) => ({ ...step, memberId: roleId })) };
  let valid = !!draft.name.trim() && !!draft.team && draft.roles.length > 0 && draft.roles.every(role => !!role.name.trim()) && draft.steps.every(step => draft.roles.some(role => role.id === step.roleId && draft.team?.members.some(member => member.memberId === role.memberId)));
  try { validateWorkflows([form], 'memberId', new Set(draft.roles.map(role => role.id))); } catch { valid = false; }
  function assignOwner(stepId: string, roleId: string) {
    if (!blocked && roleId.startsWith('member:')) {
      const member = draft.team?.members.find(item => item.memberId === roleId.slice(7));
      if (!member) return;
      if (draft.roles.length >= 50) { setTransferError('工作流最多支持 50 位负责人，请重新引入团队整理负责人。'); return; }
      const role = { id: `role-${crypto.randomUUID()}`, name: member.name || '未命名成员', memberId: member.memberId };
      change({ roles: [...draft.roles, role], steps: draft.steps.map(step => step.id === stepId ? { ...step, roleId: role.id } : step) }); return;
    }
    if (!blocked && draft.team && draft.roles.some(role => role.id === roleId && draft.team?.members.some(member => member.memberId === role.memberId))) change({ steps: draft.steps.map(step => step.id === stepId ? { ...step, roleId } : step) });
  }
  const root: WorkflowTemplate = { id: rootId.current, name: draft.name, description: draft.description, team: draft.team, roles: draft.roles, steps: stepsForSave, maxAttempts: draft.maxAttempts, version: draft.baseVersion || 1, createdAt: workflow?.createdAt ?? createdAt.current, updatedAt: workflow?.updatedAt ?? createdAt.current };
  function adoptTeam(team: TeamTemplate) {
    if (blocked) return;
    const adopted = adoptWorkflowTeam(root, team, state.templates);
    const losesOwner = root.steps.some((step, index) => step.roleId && !adopted.steps[index]?.roleId);
    if (losesOwner && !window.confirm(t('部分负责人不在新团队中，需重新选择。确定更换团队？'))) return;
    change(adopted); setTeamOpen(false);
  }
  function moveStep(index: number, direction: number) {
    const steps = [...draft.steps]; [steps[index], steps[index + direction]] = [steps[index + direction]!, steps[index]!];
    if (steps.some((step, position) => step.onRejectStepId && !steps.slice(0, position + 1).some(target => target.id === step.onRejectStepId))) { setTransferError('移动后退回目标将位于判断步骤之后，请先调整“不合格退回到”。'); return; }
    change({ steps });
  }
  function removeStep(step: typeof draft.steps[number], index: number) {
    const referenced = draft.steps.some(item => item.id !== step.id && item.onRejectStepId === step.id);
    const message = t('确定移除步骤“{name}”？{warning}', { name: step.name.trim() || t('步骤 {number}', { number: index + 1 }), warning: referenced ? t('引用此步骤的“不合格退回到”将改为本步骤返工。') : '' });
    if (!window.confirm(message)) return;
    const acceptanceText = { ...draft.acceptanceText }, outputsText = { ...draft.outputsText }; delete acceptanceText[step.id]; delete outputsText[step.id];
    change({ steps: draft.steps.filter(item => item.id !== step.id).map(item => { if (item.onRejectStepId !== step.id) return item; const { onRejectStepId: _target, ...rest } = item; return rest; }), acceptanceText, outputsText });
  }
  async function saveDraft() {
    if (blocked) return;
    setTransferError('');
    try {
      const bundle = draft.settingsBundle ? settingsBundleForSave(state, 'workflow', { ...root, name: draft.name.trim() }, draft.settingsBundle) : undefined;
      const ok = await onSave({ id: root.id, name: draft.name.trim(), description: draft.description, team: draft.team, maxAttempts: draft.maxAttempts, roles: draft.roles, steps: stepsForSave }, draft.baseVersion, bundle);
      if (ok) { removeUiDraft(cacheKey); setDirty(false); }
    } catch (error) { setTransferError(error instanceof Error ? error.message : String(error)); }
  }

  return <main ref={editor} className="wf-team-editor wf-team-editor-compact wf-workflow-template-editor">
    <header className="wf-team-toolbar">
      <div className="wf-team-identity wf-workflow-identity"><h2 aria-label={draft.name || t('新建通用工作流')}><input className="wf-team-name" aria-label={t('工作流名称')} value={draft.name} disabled={blocked} onChange={event => change({ name: event.target.value })} placeholder={t('输入工作流名称')} /></h2><button type="button" className="wf-button wf-workflow-team-button" aria-label={t('引入团队')} disabled={blocked} title={draft.team ? t('{name} · {count} 位成员 · 团队 v{version}', { name: draft.team.name, count: draft.team.members.length, version: draft.team.sourceTeamVersion }) : t('选择工作流团队')} onClick={() => setTeamOpen(true)}><Icon name="people" size={15} /><span>{t('引入团队')}{draft.team ? ` · ${draft.team.name}` : ''}</span></button></div>
      <div className="wf-object-header-actions">
        {dirty && <span className="wf-workflow-save-state" aria-live="polite">{t('未保存')}</span>}
        <button type="button" className="wf-button wf-danger-text" disabled={blocked || !onDelete} aria-label={t('移除工作流')} onClick={() => void onDelete?.()}><Icon name="trash" size={15} />{t('移除')}</button>
        <ObjectSettingsTransfer state={state} kind="workflow" root={root} stagedBundle={draft.settingsBundle} disabled={busy} onBusyChange={setTransferBusy} onImport={bundle => {
          const imported = bundle.data.workflowTemplates.find(item => item.id === bundle.root.id);
          if (!imported) throw new Error('导入文件缺少工作流配置。');
          change({ name: imported.name, description: imported.description, team: structuredClone(imported.team), maxAttempts: imported.maxAttempts, roles: structuredClone(imported.roles), steps: structuredClone(imported.steps), acceptanceText: {}, outputsText: {}, settingsBundle: structuredClone(bundle) });
        }} />
        <button type="button" className="wf-button wf-primary" aria-label={t('保存工作流')} disabled={blocked || !valid || (!!workflow && !dirty)} onClick={() => void saveDraft()}><Icon name="check" size={15} />{t(busy ? '保存中…' : '保存')}</button>
      </div>
    </header>
    <div className="wf-team-content">
      {transferError && <p className="wf-error-box" role="alert">{errorMessage(transferError)}</p>}
      <fieldset className="wf-team-workflow-fields wf-workflow-step-list" disabled={blocked}>
        {draft.steps.map((step, index) => <section className="wf-workflow-step-card" aria-label={t('步骤 {number}', { number: index + 1 })} key={step.id}>
          <div className="wf-field wf-workflow-step-name">
            <label className="wf-field-label" htmlFor={`${fieldsId}-${index}-name`}>{t('步骤名称')}</label>
            <div className="wf-workflow-step-name-control"><span aria-hidden="true">{index + 1}.</span><input id={`${fieldsId}-${index}-name`} value={step.name} onChange={event => change({ steps: draft.steps.map(item => item.id === step.id ? { ...item, name: event.target.value } : item) })} placeholder={t('输入步骤名称')} /></div>
          </div>
          <div className="wf-workflow-step-assignee"><SelectField label={t('负责人')} disabled={!draft.team} value={draft.team && draft.roles.some(role => role.id === step.roleId) ? step.roleId : ''} onChange={roleId => assignOwner(step.id, roleId)}><option value="" disabled>{t(draft.team ? '选择负责人' : '请先引入团队')}</option>{draft.team?.members.map(member => {
            const role = draft.roles.find(item => item.id === step.roleId && item.memberId === member.memberId) ?? draft.roles.find(item => item.memberId === member.memberId);
            const parent = draft.team?.members.find(item => item.memberId === member.reportsTo);
            return <option value={role?.id ?? `member:${member.memberId}`} key={member.memberId}>{member.name || role?.name || t('未命名成员')}{parent ? t('（上一级：{name}）', { name: parent.name ?? t('未命名成员') }) : t('（团队负责人）')}</option>;
          })}</SelectField></div>
          <div className="wf-workflow-step-actions">
            <button type="button" className="wf-icon-button" aria-label={t('上移步骤 {number}', { number: index + 1 })} title={t('上移')} disabled={index === 0} onClick={() => moveStep(index, -1)}><Icon name="chevron" size={15} className="wf-step-move-up" /></button>
            <button type="button" className="wf-icon-button" aria-label={t('下移步骤 {number}', { number: index + 1 })} title={t('下移')} disabled={index === draft.steps.length - 1} onClick={() => moveStep(index, 1)}><Icon name="chevron" size={15} className="wf-step-move-down" /></button>
            <button type="button" className="wf-icon-button wf-danger-text" aria-label={t('移除步骤 {number}', { number: index + 1 })} title={t('移除')} disabled={draft.steps.length <= 1} onClick={() => removeStep(step, index)}><Icon name="trash" size={15} /></button>
          </div>
          <div className="wf-workflow-step-sections">
            <TextField label={t('步骤说明')} value={step.instruction} onChange={instruction => change({ steps: draft.steps.map(item => item.id === step.id ? { ...item, instruction } : item) })} multiline rows={6} />
            <TextField label={t('交付内容')} value={Object.hasOwn(draft.outputsText, step.id) ? draft.outputsText[step.id]! : (step.outputs ?? []).join('\n')} onChange={value => change({ outputsText: { ...draft.outputsText, [step.id]: value } })} multiline rows={6} />
            <TextField label={t('验收标准')} value={Object.hasOwn(draft.acceptanceText, step.id) ? draft.acceptanceText[step.id]! : (step.acceptanceCriteria ?? []).join('\n')} onChange={value => change({ acceptanceText: { ...draft.acceptanceText, [step.id]: value } })} multiline rows={6} />
          </div>
          <div className="wf-workflow-step-outcome"><span>{t('合格后：{action}', { action: t(index === draft.steps.length - 1 ? '完成流程' : '进入下一步') })}</span><SelectField label={t('不合格退回到')} value={step.onRejectStepId === step.id ? '' : step.onRejectStepId ?? ''} onChange={target => change({ steps: draft.steps.map(item => { if (item.id !== step.id) return item; const { onRejectStepId: _previous, ...rest } = item; return { ...rest, ...(target ? { onRejectStepId: target } : {}) }; }) })}><option value="">{t('本步骤返工')}</option>{draft.steps.slice(0, index).map((target, targetIndex) => <option value={target.id} key={target.id}>{t('第 {number} 步 · {name}', { number: targetIndex + 1, name: target.name || t('未命名步骤') })}</option>)}</SelectField></div>
        </section>)}
        <button type="button" className="wf-button wf-workflow-add-step" disabled={draft.steps.length >= 50} onClick={() => change({ steps: [...draft.steps, { id: `step-${crypto.randomUUID()}`, name: '', roleId: '', instruction: '' }] })}><Icon name="plus" size={15} />{t('添加步骤')}</button>
      </fieldset>
      <WorkflowDiagram steps={stepsForSave} roles={draft.team ? draft.roles.map(role => ({ ...role, name: draft.team?.members.find(member => member.memberId === role.memberId)?.name ?? role.name })) : []} onSelect={index => { const section = editor.current?.querySelectorAll<HTMLElement>('.wf-workflow-step-card')[index]; section?.scrollIntoView({ block: 'start' }); section?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true }); }} />
    </div>
    {teamOpen && !blocked && <WorkflowTeamPickerDialog state={state} adopted={draft.team} onClose={() => setTeamOpen(false)} onSelect={adoptTeam} />}
  </main>;
}
