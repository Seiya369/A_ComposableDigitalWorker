import { useEffect, useState } from 'react';
import type { SaveWorkflowTemplateInput, TeamWorkflow, WorkforceState, WorkflowTemplate } from '../domain/types.js';
import { validateWorkflows } from '../workflow/definition.js';
import type { WorkforceClient } from './client.js';
import { SelectField, TextField } from './fields.js';
import { EmptyState } from './ProjectPanels.js';
import { Icon } from './icons.js';
import { WorkflowForm } from './TeamWorkflows.js';
import './team-editor.css';
import { activateUiDraft, discardActiveUiDraft, readUiDraft, removeUiDraft, writeUiDraft } from './drafts.js';

interface Props { client: WorkforceClient; state: WorkforceState; onReload: () => Promise<unknown>; onDirtyChange: (dirty: boolean) => void }
export function WorkflowTemplateLibrary({ client, state, onReload, onDirtyChange }: Props) {
  const workflows = state.workflowTemplates ?? [];
  const previousSelection = readUiDraft<{ selectedId?: string; creating: boolean }>('workflow-library-navigation');
  const [selectedId, setSelectedId] = useState<string | undefined>(previousSelection?.selectedId ?? workflows[0]?.id);
  const [creating, setCreating] = useState(previousSelection?.creating ?? false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const selected = workflows.find(workflow => workflow.id === selectedId);
  useEffect(() => { writeUiDraft('workflow-library-navigation', { selectedId, creating }); }, [selectedId, creating]);
  function navigate(id?: string) {
    if (busy || (dirty && !window.confirm('工作流尚未保存，确定放弃修改？'))) return;
    if (dirty) discardActiveUiDraft();
    setSelectedId(id); setCreating(!id); setDirty(false); setError(''); setNotice('');
  }
  const changeDirty = (value: boolean) => { setDirty(value); onDirtyChange(value); };
  async function perform(operation: () => Promise<unknown>, message: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true); setError('');
    try { await operation(); changeDirty(false); try { await onReload(); } catch (error) { setError(`保存已完成，刷新失败。请刷新数据查看结果：${error instanceof Error ? error.message : String(error)}`); } setNotice(message); return true; }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); return false; }
    finally { setBusy(false); }
  }
  return <div className="wf-library-body">
    <aside className="wf-sidebar"><div className="wf-sidebar-heading"><span>通用工作流</span><span>{workflows.length}</span></div>
      {workflows.map(workflow => <button key={workflow.id} className={`wf-nav-item ${selectedId === workflow.id && !creating ? 'is-active' : ''}`} onClick={() => navigate(workflow.id)}><Icon name="network" size={16} /><span className="wf-nav-label"><strong>{workflow.name}</strong><small>{workflow.roles.length} 个岗位 · {workflow.steps.length} 步 · v{workflow.version}</small></span></button>)}
      <button className="wf-sidebar-add" disabled={busy} onClick={() => navigate()}><Icon name="plus" size={15} />新建工作流</button>
    </aside>
    <div className="wf-library-main">
      {error && <p className="wf-banner wf-banner-error" role="alert">{error}</p>}{notice && <p className="wf-banner" role="status">{notice}</p>}
      {creating || selected ? <WorkflowTemplateEditor key={creating ? 'new' : selectedId} workflow={creating ? undefined : selected} state={state} busy={busy} onDirty={changeDirty} onSave={async (input, version) => {
        const id = input.id ?? `workflow-${crypto.randomUUID()}`;
        const ok = await perform(() => client.saveWorkflowTemplate({ ...input, id }, version ? { expectedVersion: version } : undefined), '通用工作流已保存'); if (ok) { setSelectedId(id); setCreating(false); } return ok;
      }} onDelete={selected && !creating ? async () => { if (window.confirm('删除这个通用工作流？团队已引入的副本会保留。') && await perform(() => client.deleteWorkflowTemplate(selected.id, { expectedVersion: selected.version }), '通用工作流已删除')) { setSelectedId(undefined); setCreating(false); } } : undefined} onBind={selected && !creating ? (teamId, bindings) => perform(() => client.bindTeamWorkflow(teamId, selected.id, bindings, { expectedVersion: state.teams.find(team => team.id === teamId)?.version }), '工作流副本已引入团队') : undefined} /> : <EmptyState title="尚无通用工作流" description="先定义岗位与步骤，再由团队把岗位绑定到成员。" />}
    </div>
  </div>;
}

function WorkflowTemplateEditor({ workflow, state, busy, onDirty, onSave, onDelete, onBind }: {
  workflow?: WorkflowTemplate; state: WorkforceState; busy: boolean; onDirty: (dirty: boolean) => void;
  onSave: (input: SaveWorkflowTemplateInput, version: number) => Promise<boolean>; onDelete?: () => Promise<void>;
  onBind?: (teamId: string, bindings: Record<string, string>) => Promise<boolean>;
}) {
  const from = () => ({ id: workflow?.id, name: workflow?.name ?? '', description: workflow?.description ?? '', maxAttempts: workflow?.maxAttempts ?? 3, roles: structuredClone(workflow?.roles ?? [{ id: `role-${crypto.randomUUID()}`, name: '负责人' }]), steps: structuredClone(workflow?.steps ?? []) });
  const cacheKey = `workflow-template-draft:${workflow?.id ?? 'new'}`;
  const restored = readUiDraft<ReturnType<typeof from>>(cacheKey);
  const [draft, setDraft] = useState(() => restored ?? from());
  const [dirty, setDirty] = useState(!!restored);
  const [teamId, setTeamId] = useState('');
  const [bindings, setBindings] = useState<Record<string, string>>({});
  useEffect(() => { onDirty(dirty); }, [dirty]);
  useEffect(() => { activateUiDraft(cacheKey); if (dirty) writeUiDraft(cacheKey, draft); else removeUiDraft(cacheKey); }, [cacheKey, dirty, draft]);
  useEffect(() => { if (!dirty) setDraft(from()); }, [workflow]);
  const change = (patch: Partial<typeof draft>) => { setDraft(current => ({ ...current, ...patch })); setDirty(true); };
  const form: TeamWorkflow = { id: draft.id ?? 'draft-workflow', name: draft.name, maxAttempts: draft.maxAttempts, steps: draft.steps.map(({ roleId, ...step }) => ({ ...step, memberId: roleId })) };
  let valid = !!draft.name.trim() && draft.roles.length > 0 && draft.roles.every(role => !!role.name.trim());
  try { validateWorkflows([form], 'memberId', new Set(draft.roles.map(role => role.id))); } catch { valid = false; }
  const team = state.teams.find(team => team.id === teamId);
  return <main className="wf-team-editor">
    <header className="wf-team-toolbar"><div><h2>{workflow?.name ?? '新建通用工作流'}</h2><span>步骤按岗位分工，团队引入时再指定成员。</span></div>{onDelete && <button className="wf-icon-button" disabled={busy} aria-label="删除通用工作流" onClick={() => void onDelete()}><Icon name="trash" size={16} /></button>}</header>
    <div className="wf-team-content"><fieldset className="wf-team-workflow-fields" disabled={busy}>
      <TextField label="工作流说明" value={draft.description} onChange={description => change({ description })} placeholder="适用场景和预期交付" />
      <section className="wf-workflow-roles"><div className="wf-team-section-title"><h3>流程岗位</h3><button className="wf-inline-add" disabled={draft.roles.length >= 50} onClick={() => change({ roles: [...draft.roles, { id: `role-${crypto.randomUUID()}`, name: '' }] })}><Icon name="plus" size={14} />添加岗位</button></div>
        {draft.roles.map(role => <div className="wf-list-row" key={role.id}><input aria-label="流程岗位名称" value={role.name} onChange={event => change({ roles: draft.roles.map(item => item.id === role.id ? { ...item, name: event.target.value } : item) })} placeholder="如：架构负责人" /><button className="wf-icon-button" aria-label={`删除岗位 ${role.name}`} title="请先移除使用此岗位的步骤" disabled={draft.roles.length === 1 || draft.steps.some(step => step.roleId === role.id)} onClick={() => change({ roles: draft.roles.filter(item => item.id !== role.id) })}><Icon name="trash" size={14} /></button></div>)}
      </section>
      <WorkflowForm assigneeLabel="负责岗位" workflow={form} members={draft.roles.map(role => ({ memberId: role.id, templateId: role.id, name: role.name || '未命名岗位' }))} templates={[]} onChange={patch => {
        change({ ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.maxAttempts !== undefined ? { maxAttempts: patch.maxAttempts } : {}), ...(patch.steps ? { steps: patch.steps.map(({ memberId, ...step }) => ({ ...step, roleId: memberId })) } : {}) });
      }} />
      {!draft.steps.length && <p className="wf-hint">请添加至少一个步骤，配置任务、交付和验收条件。</p>}
    </fieldset>
    {onBind && <fieldset className="wf-team-settings wf-workflow-bind" disabled={busy || dirty} aria-label="引入团队"><legend>引入团队</legend><p className="wf-hint">保存后将流程岗位绑定到团队成员。引入后生成独立副本。</p><SelectField label="目标团队" value={teamId} onChange={value => { setTeamId(value); setBindings({}); }}><option value="">选择团队</option>{state.teams.filter(item => item.members.length).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectField>
      {team && draft.roles.map(role => <SelectField key={role.id} label={role.name} value={bindings[role.id] ?? ''} onChange={memberId => setBindings(current => ({ ...current, [role.id]: memberId }))}><option value="">选择负责成员</option>{team.members.map(member => <option key={member.memberId} value={member.memberId}>{member.name || state.templates.find(item => item.id === member.templateId)?.name}</option>)}</SelectField>)}
      <button className="wf-button" disabled={!team || !draft.roles.every(role => !!bindings[role.id])} onClick={() => void onBind(teamId, bindings)}><Icon name="plus" size={14} />引入此团队</button>
    </fieldset>}
    </div>
    <footer className="wf-editor-actions"><span>{dirty ? '未保存' : ''}</span><button className="wf-button" disabled={busy || !dirty} onClick={() => { setDraft(from()); setDirty(false); }}>还原修改</button><button className="wf-button wf-primary" disabled={busy || !valid || (!!workflow && !dirty)} onClick={() => void onSave(draft, workflow?.version ?? 0).then(ok => { if (ok) { removeUiDraft(cacheKey); setDirty(false); } })}><Icon name="check" size={15} />保存工作流</button></footer>
  </main>;
}
