import { useI18n } from './i18n.js';
import { useEffect, useRef, useState } from 'react';
import type { TeamTemplate, WorkforceState, WorkflowTeamSnapshot } from '../domain/types.js';
import { buildTeamHierarchy } from '../domain/team-hierarchy.js';
import { SelectField } from './fields.js';
import { Icon } from './icons.js';

export function WorkflowTeamPickerDialog({ state, adopted, onClose, onSelect }: {
  state: WorkforceState; adopted?: WorkflowTeamSnapshot; onClose: () => void; onSelect: (team: TeamTemplate) => void;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [teamId, setTeamId] = useState(adopted?.sourceTeamId ?? '');
  const team = state.teams.find(item => item.id === teamId);
  const valid = !!team?.members.length && team.members.length <= 50 && team.members.every(member => state.templates.some(template => template.id === member.templateId && template.status !== 'archived'));
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const element = dialog.current; element?.showModal(); element?.querySelector('select')?.focus();
    return () => { element?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  const flatten = (nodes: ReturnType<typeof buildTeamHierarchy>): Array<{ id: string; name: string; parent?: string; level: number }> => nodes.flatMap(node => [
    { id: node.member.memberId, name: node.member.name || state.templates.find(template => template.id === node.member.templateId)?.name || t("未命名成员"), parent: node.member.reportsTo, level: node.level }, ...flatten(node.children),
  ]);
  const members = team ? flatten(buildTeamHierarchy(team.members)) : [];
  return <dialog ref={dialog} className="wf-workflow-binding-dialog" aria-label={t("引入团队")} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="wf-workflow-binding-heading"><h2>{t("引入团队")}</h2><button type="button" className="wf-icon-button" aria-label={t("关闭引入团队")} onClick={onClose}><Icon name="close" size={18} /></button></header>
    <form onSubmit={event => { event.preventDefault(); if (valid && team) onSelect(team); }}>
      <SelectField label={t("选择团队")} value={state.teams.some(item => item.id === teamId) ? teamId : ''} onChange={setTeamId}><option value="">{t("选择团队")}</option>{state.teams.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</SelectField>
      {team && <ul className="wf-workflow-team-roster" aria-label={t("团队组织结构")}>{members.map(member => <li key={member.id} style={{ paddingLeft: (member.level - 1) * 16 }}><span>{member.name}</span><small>{member.parent ? t('上一级：{name}', { name: members.find(item => item.id === member.parent)?.name ?? t('未配置') }) : t("团队负责人")}</small></li>)}</ul>}
      {team && !valid && <p className="wf-error-box" role="alert">{t("请选择包含 1–50 位有效成员的团队。")}</p>}
      <footer className="wf-workflow-binding-actions"><button type="button" className="wf-button" onClick={onClose}>{t("取消")}</button><button type="submit" className="wf-button wf-primary" disabled={!valid}>{t("确认引入")}</button></footer>
    </form>
  </dialog>;
}
