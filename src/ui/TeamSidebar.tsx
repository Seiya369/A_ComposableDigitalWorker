import { useI18n } from './i18n.js';
import { useState } from 'react';
import type { EmployeeTemplate, TeamTemplate } from '../domain/types.js';
import { buildTeamHierarchy, type TeamHierarchyNode } from '../domain/team-hierarchy.js';
import { Icon } from './icons.js';
import { mergeVisibleOrder } from '../domain/library-order.js';
import { useLibraryReorder } from './useLibraryReorder.js';

interface TeamSidebarProps {
  teams: TeamTemplate[];
  templates: EmployeeTemplate[];
  query: string;
  activeTeamId?: string;
  reorderDisabled?: boolean;
  onReorder?: (ids: string[]) => Promise<unknown>;
  onSelect: (teamId: string) => boolean;
}

export function TeamSidebar({ teams, templates, query, activeTeamId, onSelect, reorderDisabled = false, onReorder }: TeamSidebarProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(activeTeamId ? [activeTeamId] : teams[0] ? [teams[0].id] : []));
  const search = query.trim().toLocaleLowerCase();
  const nameOf = (node: TeamHierarchyNode) => node.member.name || templates.find(template => template.id === node.member.templateId)?.name || t("未配置员工");
  const matches = (node: TeamHierarchyNode): boolean => nameOf(node).toLocaleLowerCase().includes(search) || node.children.some(matches);
  const visibleTeams = teams.filter(team => !search || team.name.toLocaleLowerCase().includes(search) || buildTeamHierarchy(team.members).some(matches));
  const teamOrder = useLibraryReorder(visibleTeams.map(team => team.id), reorderDisabled || !onReorder, ids => onReorder?.(mergeVisibleOrder(teams.map(team => team.id), ids)) ?? Promise.resolve());
  function members(nodes: TeamHierarchyNode[], teamId: string, filter: boolean) {
    return <ul className="wf-team-nav-members">{nodes.filter(node => !filter || matches(node)).map(node => <li key={node.member.memberId}>
      <div className="wf-team-nav-member is-read-only" title={t('{name} · 第 {level} 级', { name: nameOf(node), level: node.level })}><Icon name="person" size={14} /><span>{nameOf(node)}</span></div>
      {node.children.length > 0 && members(node.children, teamId, filter)}
    </li>)}</ul>;
  }
  return <div className="wf-team-nav"><span className="wf-library-order-status" role="status">{teamOrder.announcement}</span>{visibleTeams.map(team => {
    const roots = buildTeamHierarchy(team.members);
    const teamMatches = team.name.toLocaleLowerCase().includes(search);
    if (search && !teamMatches && !roots.some(matches)) return null;
    const open = expanded.has(team.id) || !!search;
    const contentId = `wf-team-members-${team.id}`;
    return <div key={team.id}>
      <button {...teamOrder.rowProps(team.id)} className={`wf-nav-flat wf-team-nav-heading ${activeTeamId === team.id ? 'is-active' : ''}${teamOrder.rowProps(team.id).className}`} aria-label={team.name} aria-expanded={open} aria-controls={contentId} onClick={() => {
        if (!onSelect(team.id)) return;
        setExpanded(current => { const next = new Set(current); if (current.has(team.id)) next.delete(team.id); else next.add(team.id); return next; });
      }}><Icon name="chevron" className={open ? 'is-open' : ''} size={13} /><Icon name="people" size={15} /><span className="wf-ellipsis">{team.name}</span><small>{team.members.length}</small></button>
      <div id={contentId} hidden={!open}>{team.members.length ? members(roots, team.id, !!search && !teamMatches) : <p className="wf-team-nav-empty">{t("暂无员工")}</p>}</div>
    </div>;
  })}</div>;
}
