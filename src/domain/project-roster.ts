import type { WorkforceState } from './types.js';

export const activeProjectTeams = (state: WorkforceState, projectId: string) =>
  (state.projectTeams ?? []).filter(team => team.projectId === projectId && team.status !== 'cancelled');

/** History stays addressable while cancelled installations leave the working roster. */
export function projectEmployees(state: WorkforceState, projectId: string) {
  const cancelled = new Set((state.projectTeams ?? []).filter(team => team.projectId === projectId && team.status === 'cancelled').flatMap(team => team.members.map(member => member.employeeId)));
  return state.employees.filter(employee => employee.projectId === projectId && !cancelled.has(employee.id));
}
