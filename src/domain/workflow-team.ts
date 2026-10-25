import type { EmployeeTemplate, TeamTemplate, WorkflowRole, WorkflowTeamSnapshot, WorkflowTemplate } from './types.js';

type Definition = Pick<WorkflowTemplate, 'roles' | 'steps' | 'team'>;
export function captureWorkflowTeam(team: TeamTemplate, templates: EmployeeTemplate[]): WorkflowTeamSnapshot {
  return { sourceTeamId: team.id, sourceTeamVersion: team.version, name: team.name, knowledgeEnabled: team.knowledgeEnabled ?? true,
    members: team.members.map(member => ({ ...structuredClone(member), name: member.name || templates.find(template => template.id === member.templateId)?.name || '未命名成员' })) };
}

/** Adopt explicitly; ambiguous names never select an arbitrary team member. */
export function adoptWorkflowTeam(workflow: Definition, team: TeamTemplate, templates: EmployeeTemplate[], bindings: Record<string, string> = {}): Definition {
  const snapshot = captureWorkflowTeam(team, templates);
  const mapped = new Map<string, string>();
  for (const role of workflow.roles) {
    let memberId = Object.hasOwn(bindings, role.id) ? bindings[role.id] : undefined;
    const previous = workflow.team?.members.find(member => member.memberId === role.memberId);
    if (!memberId && workflow.team?.sourceTeamId === team.id && snapshot.members.some(member => member.memberId === role.memberId)) memberId = role.memberId;
    if (!memberId && previous) {
      const candidates = snapshot.members.filter(member => member.templateId === previous.templateId);
      if (candidates.length === 1) memberId = candidates[0]!.memberId;
    }
    if (!memberId && !previous) {
      const candidates = snapshot.members.filter(member => member.name === role.name);
      if (candidates.length === 1) memberId = candidates[0]!.memberId;
    }
    if (memberId && snapshot.members.some(member => member.memberId === memberId)) mapped.set(role.id, memberId);
  }
  const roles: WorkflowRole[] = snapshot.members.map(member => {
    const existing = workflow.roles.find(role => mapped.get(role.id) === member.memberId);
    return { ...(existing ?? { id: `role-${globalThis.crypto.randomUUID()}` }), name: member.name!, memberId: member.memberId };
  });
  return { team: snapshot, roles, steps: workflow.steps.map(step => ({ ...structuredClone(step), roleId: roles.find(role => role.memberId === mapped.get(step.roleId))?.id ?? '' })) };
}

/** Only an exact existing hand-off proves legacy assignments; no name-based auto-adoption. */
export function inferWorkflowTeam(workflow: WorkflowTemplate, teams: TeamTemplate[], templates: EmployeeTemplate[]): Definition | undefined {
  if (workflow.team) return { team: structuredClone(workflow.team), roles: structuredClone(workflow.roles), steps: structuredClone(workflow.steps) };
  const candidates: Array<{ team: TeamTemplate; bindings: Record<string, string> }> = [];
  for (const team of teams) for (const flow of team.workflows ?? []) {
    if (flow.sourceTemplateId !== workflow.id || flow.steps.length !== workflow.steps.length) continue;
    const bindings: Record<string, string> = Object.create(null);
    const matches = workflow.steps.every((step, index) => {
      const { id: _stepId, roleId, ...content } = step;
      const { id: _boundId, memberId, ...bound } = flow.steps[index]!;
      const original = { ...content, ...(content.onRejectStepId ? { onRejectStepId: workflow.steps.findIndex(item => item.id === content.onRejectStepId) } : {}) };
      const adopted = { ...bound, ...(bound.onRejectStepId ? { onRejectStepId: flow.steps.findIndex(item => item.id === bound.onRejectStepId) } : {}) };
      if (JSON.stringify(original) !== JSON.stringify(adopted) || !team.members.some(member => member.memberId === memberId)
        || (Object.hasOwn(bindings, roleId) && bindings[roleId] !== memberId)) return false;
      bindings[roleId] = memberId; return true;
    });
    if (matches) candidates.push({ team, bindings });
  }
  const [first] = candidates;
  if (!first || candidates.some(candidate => candidate.team.id !== first.team.id || JSON.stringify(candidate.bindings) !== JSON.stringify(first.bindings))) return undefined;
  return { team: captureWorkflowTeam(first.team, templates),
    roles: workflow.roles.map(role => ({ ...structuredClone(role), ...(Object.hasOwn(first.bindings, role.id) ? { memberId: first.bindings[role.id] } : {}) })),
    steps: structuredClone(workflow.steps) };
}

/** Remap only snapshot-local identities; external source provenance may remain detached. */
export function remapWorkflowTeam(workflow: Pick<WorkflowTemplate, 'team' | 'roles'>, templates: ReadonlyMap<string, string>, teams: ReadonlyMap<string, string>, fresh: () => string): Pick<WorkflowTemplate, 'team' | 'roles'> {
  if (!workflow.team) return { roles: structuredClone(workflow.roles) };
  const members = new Map(workflow.team.members.map(member => [member.memberId, fresh()]));
  return { team: { ...structuredClone(workflow.team), sourceTeamId: teams.get(workflow.team.sourceTeamId) ?? workflow.team.sourceTeamId,
    members: workflow.team.members.map(member => ({ ...structuredClone(member), memberId: members.get(member.memberId)!, templateId: templates.get(member.templateId)!, ...(member.reportsTo ? { reportsTo: members.get(member.reportsTo)! } : {}) })) },
    roles: workflow.roles.map(role => ({ ...structuredClone(role), ...(role.memberId ? { memberId: members.get(role.memberId)! } : {}) })) };
}
