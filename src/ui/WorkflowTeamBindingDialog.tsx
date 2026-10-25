import { useI18n } from './i18n.js';
import { useEffect, useRef, useState } from 'react';
import type { WorkforceState, WorkflowTemplate } from '../domain/types.js';
import { usedWorkflowRoles } from '../domain/workflow-template.js';
import { SelectField } from './fields.js';
import { Icon } from './icons.js';
import './workflow-template-editor.css';

export function WorkflowTeamBindingDialog({ workflow, state, busy, onClose, onBind }: {
  workflow: WorkflowTemplate;
  state: WorkforceState;
  busy: boolean;
  onClose: () => void;
  onBind: (teamId: string, bindings: Record<string, string>) => Promise<boolean>;
}) {
  const { t, errorMessage } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const [teamId, setTeamId] = useState('');
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const roles = usedWorkflowRoles(workflow);
  const team = state.teams.find(item => item.id === teamId);
  const ready = !!team && roles.length > 0 && roles.every(role => team.members.some(member => member.memberId === bindings[role.id]));
  const close = () => { if (!busy && !pending.current) onClose(); };
  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const element = dialog.current;
    element?.showModal();
    element?.querySelector<HTMLSelectElement>('select')?.focus();
    return () => { mounted.current = false; element?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  async function bind() {
    if (busy || pending.current || !ready) return;
    pending.current = true; setError('');
    try { if (!await onBind(teamId, bindings) && mounted.current) setError("引入失败，请检查团队配置后重试。"); }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { pending.current = false; }
  }
  return <dialog ref={dialog} className="wf-workflow-binding-dialog" aria-label={t("引入团队")} onCancel={event => { event.preventDefault(); close(); }}>
    <header className="wf-workflow-binding-heading"><h2>{t("引入团队")}</h2><button type="button" className="wf-icon-button" aria-label={t("关闭引入团队")} disabled={busy} onClick={close}><Icon name="close" size={18} /></button></header>
    <form onSubmit={event => { event.preventDefault(); void bind(); }}>
      <fieldset disabled={busy} className="wf-workflow-binding-fields">
        <SelectField label={t("目标团队")} value={teamId} onChange={value => { setTeamId(value); setBindings({}); setError(''); }}><option value="">{t("选择团队")}</option>{state.teams.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</SelectField>
        {team && roles.map((role, index) => <div key={role.id} data-role-id={role.id}><SelectField literalLabel label={roles.filter(item => item.name === role.name).length > 1 ? t('{name}（角色 {index}）', { name: role.name, index: index + 1 }) : role.name} value={bindings[role.id] ?? ''} onChange={memberId => setBindings(current => ({ ...current, [role.id]: memberId }))}><option value="">{t("选择负责成员")}</option>{team.members.map(member => <option value={member.memberId} key={member.memberId}>{member.name || state.templates.find(template => template.id === member.templateId)?.name || t("未配置成员")}</option>)}</SelectField></div>)}
      </fieldset>
      {error && <p className="wf-error-box" role="alert">{errorMessage(error)}</p>}
      <footer className="wf-workflow-binding-actions"><button type="button" className="wf-button" disabled={busy} onClick={close}>{t("取消")}</button><button type="submit" className="wf-button wf-primary" disabled={busy || !ready}>{busy ? t("引入中…") : t("确认引入")}</button></footer>
    </form>
  </dialog>;
}
