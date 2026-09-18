import { useState, useRef, type PointerEvent } from 'react';
import type { EmployeeTemplate, TeamTemplate } from '../domain/types.js';
import { buildTeamHierarchy, moveTeamMember, type TeamDropPosition, type TeamHierarchyNode } from '../domain/team-hierarchy.js';
import { Icon } from './icons.js';

interface TeamSidebarProps {
  teams: TeamTemplate[];
  templates: EmployeeTemplate[];
  query: string;
  activeTeamId?: string;
  selectedMemberId?: string;
  disabled?: boolean;
  onMove: (teamId: string, memberId: string, targetId: string | undefined, position: TeamDropPosition) => void;
  onSelect: (teamId: string, memberId?: string) => boolean;
}

export function TeamSidebar({ teams, templates, query, activeTeamId, selectedMemberId, onSelect, onMove, disabled = false }: TeamSidebarProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(activeTeamId ? [activeTeamId] : teams[0] ? [teams[0].id] : []));
  const [drag, setDrag] = useState<{ teamId: string; memberId: string } | null>(null);
  const [drop, setDrop] = useState<{ teamId: string; targetId?: string; position: TeamDropPosition } | null>(null);
  const pointer = useRef<{ teamId: string; memberId: string; x: number; y: number; moving: boolean } | null>(null);
  const suppressClick = useRef(false);
  const clearDrag = () => { pointer.current = null; setDrag(null); setDrop(null); };
  const destination = (x: number, y: number) => {
    const source = pointer.current;
    if (disabled || !source) return null;
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-team-drop]');
    if (!element || element.dataset.teamDrop !== source.teamId) return null;
    const targetId = element.dataset.memberDrop;
    const bounds = element.getBoundingClientRect();
    const ratio = (y - bounds.top) / bounds.height;
    const position: TeamDropPosition = !targetId ? 'inside' : ratio < .25 ? 'before' : ratio > .75 ? 'after' : 'inside';
    const team = teams.find(team => team.id === source.teamId);
    if (!team || !moveTeamMember(team.members, source.memberId, targetId, position)) return null;
    return { teamId: source.teamId, targetId, position };
  };
  const pointerDown = (event: PointerEvent<HTMLButtonElement>, teamId: string, memberId: string) => {
    suppressClick.current = false;
    if (disabled || search || event.button !== 0) return;
    pointer.current = { teamId, memberId, x: event.clientX, y: event.clientY, moving: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const source = pointer.current;
    if (!source || disabled) return;
    if (!source.moving && Math.hypot(event.clientX - source.x, event.clientY - source.y) < 5) return;
    source.moving = true;
    suppressClick.current = true;
    setDrag({ teamId: source.teamId, memberId: source.memberId });
    const sidebar = event.currentTarget.closest<HTMLElement>('.wf-sidebar');
    if (sidebar) {
      const bounds = sidebar.getBoundingClientRect();
      if (event.clientY < bounds.top + 30) sidebar.scrollTop -= 12;
      else if (event.clientY > bounds.bottom - 30) sidebar.scrollTop += 12;
    }
    setDrop(destination(event.clientX, event.clientY));
  };
  const pointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    const source = pointer.current;
    const next = source?.moving ? destination(event.clientX, event.clientY) : null;
    if (next && source) onMove(next.teamId, source.memberId, next.targetId, next.position);
    clearDrag();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const dropClass = (teamId: string, targetId?: string) => drop?.teamId === teamId && drop.targetId === targetId ? ` wf-drop-${drop.position}` : '';
  const search = query.trim().toLocaleLowerCase();
  const nameOf = (node: TeamHierarchyNode) => node.member.name || templates.find(template => template.id === node.member.templateId)?.name || '未配置员工';
  const matches = (node: TeamHierarchyNode): boolean => nameOf(node).toLocaleLowerCase().includes(search) || node.children.some(matches);
  function members(nodes: TeamHierarchyNode[], teamId: string, filter: boolean) {
    return <ul className="wf-team-nav-members">{nodes.filter(node => !filter || matches(node)).map(node => <li key={node.member.memberId}>
      <button className={`wf-team-nav-member ${activeTeamId === teamId && selectedMemberId === node.member.memberId ? 'is-active' : ''}${dropClass(teamId, node.member.memberId)}${drag?.memberId === node.member.memberId ? ' is-dragging' : ''}`} data-team-drop={teamId} data-member-drop={node.member.memberId} data-movable={!disabled && !search} onPointerDown={event => pointerDown(event, teamId, node.member.memberId)} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={clearDrag} onLostPointerCapture={clearDrag} onKeyDown={event => { if (event.key === 'Escape') clearDrag(); }} aria-label={`配置团队成员 ${nameOf(node)}，第 ${node.level} 级`} title={`${nameOf(node)} · 拖到前后排序，拖到中间设为下级，拖到团队设为顶层`} onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onSelect(teamId, node.member.memberId); }}><Icon name="person" size={14} /><span>{nameOf(node)}</span></button>
      {node.children.length > 0 && members(node.children, teamId, filter)}
    </li>)}</ul>;
  }
  return <div className="wf-team-nav">{teams.map(team => {
    const roots = buildTeamHierarchy(team.members);
    const teamMatches = team.name.toLocaleLowerCase().includes(search);
    if (search && !teamMatches && !roots.some(matches)) return null;
    const open = expanded.has(team.id) || !!search;
    const contentId = `wf-team-members-${team.id}`;
    return <div key={team.id}>
      <button className={`wf-nav-flat wf-team-nav-heading ${activeTeamId === team.id ? 'is-active' : ''}${dropClass(team.id)}`} data-team-drop={team.id} aria-label={team.name} aria-expanded={open} aria-controls={contentId} onClick={() => {
        if (!onSelect(team.id)) return;
        setExpanded(current => { const next = new Set(current); if (current.has(team.id)) next.delete(team.id); else next.add(team.id); return next; });
      }}><Icon name="chevron" className={open ? 'is-open' : ''} size={13} /><Icon name="people" size={15} /><span className="wf-ellipsis">{team.name}</span><small>{team.members.length}</small></button>
      <div id={contentId} hidden={!open}>{team.members.length ? members(roots, team.id, !!search && !teamMatches) : <p className="wf-team-nav-empty">暂无员工</p>}</div>
    </div>;
  })}</div>;
}
