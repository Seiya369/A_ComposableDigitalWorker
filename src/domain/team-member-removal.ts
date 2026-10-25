import type { TeamMember, TeamWorkflow } from './types.js';
import { invariant } from './errors.js';

/** Edit only a team draft; installed project snapshots and global workflows are independent. */
export function removeTeamMember(
  members: readonly TeamMember[], workflows: readonly TeamWorkflow[], memberId: string, replacementMemberId?: string,
): { members: TeamMember[]; workflows: TeamWorkflow[] } {
  const departing = members.find(member => member.memberId === memberId);
  invariant(departing, '此团队岗位已不存在，请重新选择');
  const affected = workflows.some(workflow => workflow.steps.some(step => step.memberId === memberId));
  if (affected) invariant(replacementMemberId !== memberId && members.some(member => member.memberId === replacementMemberId), '请选择有效的步骤接手人后再移除岗位');
  return {
    members: members.filter(member => member.memberId !== memberId).map(member => {
      if (member.reportsTo !== memberId) return structuredClone(member);
      const next = { ...member };
      if (departing.reportsTo) next.reportsTo = departing.reportsTo;
      else delete next.reportsTo;
      return next;
    }),
    workflows: workflows.map(workflow => ({ ...structuredClone(workflow), steps: workflow.steps.map(step => ({ ...structuredClone(step), ...(step.memberId === memberId ? { memberId: replacementMemberId! } : {}) })) })),
  };
}
