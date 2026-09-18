import type { TeamMember } from './types.js';

export interface TeamHierarchyNode {
  member: TeamMember;
  level: number;
  children: TeamHierarchyNode[];
}

function uniqueMembers(members: readonly TeamMember[]): TeamMember[] {
  const seen = new Set<string>();
  return members.filter(member => {
    if (seen.has(member.memberId)) return false;
    seen.add(member.memberId);
    return true;
  });
}

/**
 * Derives display levels from reporting relationships without changing members.
 * Missing managers and self references become roots. A cycle is broken at its
 * first member in input order, so unfinished drafts can still be displayed.
 */
export function buildTeamHierarchy(members: readonly TeamMember[]): TeamHierarchyNode[] {
  const ordered = uniqueMembers(members);
  const positions = new Map(ordered.map((member, index) => [member.memberId, index]));
  const parents = new Map<string, string>();
  for (const member of ordered) {
    if (member.reportsTo && member.reportsTo !== member.memberId && positions.has(member.reportsTo)) {
      parents.set(member.memberId, member.reportsTo);
    }
  }

  const resolved = new Set<string>();
  for (const member of ordered) {
    const path: string[] = [];
    const visiting = new Map<string, number>();
    let current: string | undefined = member.memberId;
    while (current !== undefined && !resolved.has(current)) {
      const cycleStart = visiting.get(current);
      if (cycleStart !== undefined) {
        const cycle = path.slice(cycleStart);
        const root = cycle.reduce((first, id) => positions.get(id)! < positions.get(first)! ? id : first);
        parents.delete(root);
        break;
      }
      visiting.set(current, path.length);
      path.push(current);
      current = parents.get(current);
    }
    for (const id of path) resolved.add(id);
  }

  const nodes = new Map<string, TeamHierarchyNode>(ordered.map(member => [member.memberId, { member, level: 1, children: [] }]));
  const roots: TeamHierarchyNode[] = [];
  for (const member of ordered) {
    const node = nodes.get(member.memberId)!;
    const parentId = parents.get(member.memberId);
    if (parentId !== undefined) nodes.get(parentId)!.children.push(node);
    else roots.push(node);
  }

  const pending = [...roots];
  for (let index = 0; index < pending.length; index++) {
    const node = pending[index]!;
    for (const child of node.children) {
      child.level = node.level + 1;
      pending.push(child);
    }
  }
  return roots;
}

/** Roots are level 1; an unknown member has level 0. */
export function getTeamMemberLevel(members: readonly TeamMember[], memberId: string): number {
  const pending = buildTeamHierarchy(members);
  for (let index = 0; index < pending.length; index++) {
    const node = pending[index]!;
    if (node.member.memberId === memberId) return node.level;
    pending.push(...node.children);
  }
  return 0;
}

function getTeamLevels(members: readonly TeamMember[]): Map<string, number> {
  const levels = new Map<string, number>();
  const pending = buildTeamHierarchy(members);
  for (let index = 0; index < pending.length; index++) {
    const node = pending[index]!;
    levels.set(node.member.memberId, node.level);
    pending.push(...node.children);
  }
  return levels;
}

/** Excludes self and descendants; a selected level limits managers to the preceding level. */
export function getEligibleTeamManagers(members: readonly TeamMember[], memberId: string, selectedLevel?: number): TeamMember[] {
  if (selectedLevel !== undefined && (!Number.isInteger(selectedLevel) || selectedLevel <= 1)) return [];
  const ordered = uniqueMembers(members);
  const reports = new Map<string, string[]>();
  for (const member of ordered) {
    if (!member.reportsTo) continue;
    const children = reports.get(member.reportsTo) ?? [];
    children.push(member.memberId);
    reports.set(member.reportsTo, children);
  }
  const excluded = new Set([memberId]);
  const pending = [memberId];
  for (let index = 0; index < pending.length; index++) {
    for (const id of reports.get(pending[index]!) ?? []) {
      if (excluded.has(id)) continue;
      excluded.add(id);
      pending.push(id);
    }
  }
  const levels = selectedLevel === undefined ? undefined : getTeamLevels(ordered);
  return ordered.filter(member => !excluded.has(member.memberId)
    && (levels === undefined || levels.get(member.memberId) === selectedLevel! - 1));
}

/** Offers every level that can be reached through a valid manager, including the root level. */
export function getSelectableTeamLevels(members: readonly TeamMember[], memberId: string): number[] {
  const levels = getTeamLevels(members);
  let maximum = 1;
  for (const manager of getEligibleTeamManagers(members, memberId)) {
    maximum = Math.max(maximum, (levels.get(manager.memberId) ?? 0) + 1);
  }
  return Array.from({ length: maximum }, (_, index) => index + 1);
}

export type TeamDropPosition = 'before' | 'inside' | 'after';

/** Moves a whole subtree; member array order controls sibling order in both views. */
export function moveTeamMember(members: readonly TeamMember[], memberId: string, targetId: string | undefined, position: TeamDropPosition): TeamMember[] | null {
  const source = members.find(member => member.memberId === memberId);
  const target = members.find(member => member.memberId === targetId);
  if (!source || (targetId !== undefined && !target) || targetId === memberId) return null;
  const subtree = new Set([memberId]);
  let size = 0;
  while (size !== subtree.size) {
    size = subtree.size;
    for (const member of members) if (member.reportsTo && subtree.has(member.reportsTo)) subtree.add(member.memberId);
  }
  if (targetId && subtree.has(targetId)) return null;
  const parent = target ? position === 'inside' ? target.memberId : target.reportsTo : undefined;
  const remaining = members.filter(member => !subtree.has(member.memberId));
  const moving = members.filter(member => subtree.has(member.memberId)).map(member => member.memberId === memberId ? { ...member, reportsTo: parent } : { ...member });
  let index = remaining.length;
  if (target && position !== 'inside') {
    index = remaining.findIndex(member => member.memberId === targetId) + (position === 'after' ? 1 : 0);
  }
  return [...remaining.slice(0, index), ...moving, ...remaining.slice(index)];
}
