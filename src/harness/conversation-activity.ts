interface ConversationAgentActivity {
  status?: string;
  inbox?: { nextTurn?: readonly unknown[]; nextStep?: readonly unknown[] };
}

function isPermissionNotice(message: unknown): boolean {
  if (!message || typeof message !== 'object') return false;
  const value = message as { role?: unknown; source?: { kind?: unknown } };
  return value.role === 'user' && value.source?.kind === 'user-approval';
}

/** rc.3 approval.setPolicy injects a non-waking next-step notice, not a task.
 * Keep every input blocking when a retained Agent may need disposal/handoff.
 * Unknown producers and next-turn input always remain pending work.
 */
export function isConversationAgentBusy(agent: ConversationAgentActivity | undefined, allowQueuedPermissionNotice = false): boolean {
  return agent?.status === 'running' || Boolean(agent?.inbox?.nextTurn?.length)
    || Boolean(agent?.inbox?.nextStep?.some(message => !allowQueuedPermissionNotice || !isPermissionNotice(message)));
}
