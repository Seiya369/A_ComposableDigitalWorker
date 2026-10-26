import { createHash } from 'node:crypto';
import { createUserMessage, type ContextSnapshotSection, type UserMessage } from '@deepseek-ai/dsh-llm';
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
import type {} from '@deepseek-ai/dsh-compaction';
import { joinContextSections } from '@deepseek-ai/dsh-system-prompt';
import { estimateMessage } from '@deepseek-ai/dsh-token-meter/estimate';

export const WORKFLOW_ROLE_CONTEXT = 'composable-workforce:conversation-workflow';
export const WORKFLOW_TASK_SOURCE = 'composable-workforce-task-context';
const LEGACY_TASK_CONTEXT = 'composable-workforce:task-context';
const LEGACY_EMPLOYEE_CONTEXT = 'digital-worker:identity';

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'composable-workforce-task-context': {
      kind: 'composable-workforce-task-context';
      form: 'snapshot';
      sections: readonly ContextSnapshotSection[];
      roleVersion: string;
      version: string;
    };
  }
}

export interface WorkflowContextDefinition { version: string; text: string }

/** Content identity has no turn id, timestamp, user question or other volatile field. */
export function workflowContextDefinition(text: string, scope = ''): WorkflowContextDefinition | undefined {
  if (!text.trim()) return undefined;
  return { version: createHash('sha256').update(JSON.stringify([scope, text])).digest('hex').slice(0, 24), text };
}

function roleText(definition: WorkflowContextDefinition): string {
  return `<workforce_role_definition version="${definition.version}">\n${definition.text}\n</workforce_role_definition>`;
}
function roleReference(definition: WorkflowContextDefinition): string {
  return `[Workforce role ${definition.version}: keep using the retained definition of this version; its full text is not repeated.]`;
}
function taskText(definition: WorkflowContextDefinition): string {
  return `<workforce_task_context version="${definition.version}">\n${definition.text}\n</workforce_task_context>`;
}
function matchesTask(message: UserMessage, role: WorkflowContextDefinition | undefined, definition: WorkflowContextDefinition): boolean {
  return message.source.kind === WORKFLOW_TASK_SOURCE && message.source.roleVersion === (role?.version ?? '')
    && message.source.version === definition.version && message.content.length === 1
    && message.content[0]?.type === 'text' && message.content[0].text === taskText(definition);
}
function sections(message: UserMessage): readonly ContextSnapshotSection[] | undefined {
  // Restored producers need not have their type augmentation imported here.
  // Validate their recorded attribution rather than widening a host-owned kind.
  const source = message.source as unknown as Record<string, unknown>;
  if (source.kind !== 'runtime-context' || source.form !== 'snapshot' || !Array.isArray(source.sections)
    || !source.sections.every(section => section && typeof section === 'object'
      && typeof section.name === 'string' && typeof section.text === 'string')) return undefined;
  return source.sections as readonly ContextSnapshotSection[];
}
const retainedUserMessages = (session: Session): UserMessage[] => session.deriveMessages().filter(message => message.role === 'user');

/**
 * DSH retains prior snapshots to preserve its append-only cached prefix. Keep a
 * full stable definition once, then reference it; rehydrate after native compaction.
 */
export function retainedWorkflowRole(session: Session, definition?: WorkflowContextDefinition): string {
  if (!definition) return '';
  const full = roleText(definition);
  return retainedUserMessages(session).some(message => sections(message)?.some(section => section.name === WORKFLOW_ROLE_CONTEXT && section.text === full)
    && message.content.some(block => block.type === 'text' && block.text.includes(full)))
    ? roleReference(definition) : full;
}

/** Variable task/C knowledge is a separate native user snapshot, never a rewritten system prompt. */
export function pendingWorkflowTask(session: Session, role: WorkflowContextDefinition | undefined, definition?: WorkflowContextDefinition): UserMessage | undefined {
  if (!definition) return undefined;
  const roleVersion = role?.version ?? '';
  if (retainedUserMessages(session).some(message => matchesTask(message, role, definition))) return undefined;
  return createUserMessage({
    source: { kind: WORKFLOW_TASK_SOURCE, form: 'snapshot', roleVersion, version: definition.version,
      sections: [{ name: 'composable-workforce:task', text: definition.text }] },
    content: [{ type: 'text', text: taskText(definition) }],
  });
}

/**
 * Retire only attributed plugin contributions through the public Session surface
 * replacement protocol. Originals remain in the audit log. Role/knowledge changes
 * can invalidate the old prefix; unchanged turns do not rewrite any retained node.
 * Native policy, other producers, user text and answers are preserved. Only this
 * plugin's paired memory-tool results retire with their employee/knowledge scope.
 */
export function retireWorkflowContexts(session: Session, events: readonly SessionEvent[], role?: WorkflowContextDefinition, task?: WorkflowContextDefinition): number {
  let replaced = 0;
  const keepRole = role ? new Set([roleText(role), roleReference(role)]) : new Set<string>();
  const observed = new Map(events.map(event => [event.seq, event]));
  const memoryCalls = new Map<string, { roleVersion?: string; taskVersion?: string }>();
  let roleVersion: string | undefined; let taskVersion: string | undefined;
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (event.type === 'user/message') {
      const message = event.data;
      if (message.source.kind === WORKFLOW_TASK_SOURCE && message.content.length) {
        roleVersion = message.source.roleVersion || undefined; taskVersion = message.source.version;
      } else {
        const own = sections(message)?.find(section => section.name === WORKFLOW_ROLE_CONTEXT || section.name === LEGACY_EMPLOYEE_CONTEXT);
        if (own) {
          const nextVersion = own.name === WORKFLOW_ROLE_CONTEXT
            ? /^(?:<workforce_role_definition version="|\[Workforce role )([a-f0-9]{24})/.exec(own.text)?.[1] : undefined;
          if (nextVersion !== roleVersion) { roleVersion = nextVersion; taskVersion = undefined; }
        }
      }
    } else if (event.type === 'tool/call' && ['worker_memory_search', 'worker_memory_write'].includes(event.data.name)) {
      // Provider call IDs may repeat across native turns and steps.
      memoryCalls.set(`${event.data.turn}:${event.data.step}:${event.data.callId}`, { roleVersion, taskVersion });
    }
  }
  const retiredMemory = [{ type: 'text' as const, text: JSON.stringify({ kind: 'workforce-retired-memory-result', contentOmitted: true, reason: 'employee-or-knowledge-context-changed' }) }];
  for (const seq of [...session.surface.nodes]) {
    const event = observed.get(seq);
    if (event?.type === 'tool/result') {
      const scope = memoryCalls.get(`${event.data.turn}:${event.data.step}:${event.data.message.source.callId}`);
      if (!scope || (role && scope.roleVersion === role.version && scope.taskVersion === task?.version)) continue;
      const message = session.deriveEventMessage(event);
      if (!message || message.role !== 'tool' || JSON.stringify(message.content) === JSON.stringify(retiredMemory)) continue;
      session.append('compaction/prune', { shadowedRange: { start: seq, end: seq }, shadowedSeqs: [seq], shadowedTokenCount: estimateMessage(message) });
      session.append('tool/result', { ...event.data, message: { ...message, content: retiredMemory } }, {
        surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq],
      });
      replaced++; continue;
    }
    if (event?.type !== 'user/message') continue;
    const projected = session.deriveEventMessage(event);
    if (!projected || projected.role !== 'user') continue;
    const message = projected;
    let replacement: UserMessage | undefined;
    const existing = sections(message);
    if (existing) {
      const remaining = existing.filter(section => section.name === WORKFLOW_ROLE_CONTEXT ? keepRole.has(section.text)
        : section.name !== LEGACY_TASK_CONTEXT && section.name !== LEGACY_EMPLOYEE_CONTEXT);
      if (remaining.length !== existing.length) replacement = { ...message,
        source: Object.assign({}, message.source, { form: 'snapshot' as const, sections: remaining }),
        content: remaining.length ? [{ type: 'text', text: joinContextSections(remaining) }] : [],
      };
    } else if (message.source.kind === WORKFLOW_TASK_SOURCE && message.content.length
      && (!task || !matchesTask(message, role, task))) {
      replacement = { ...message, source: { ...message.source, sections: [] }, content: [] };
    }
    if (!replacement) continue;
    // The metering event must be immediately adjacent to its surface replacement.
    session.append('compaction/prune', { shadowedRange: { start: event.seq, end: event.seq }, shadowedSeqs: [event.seq], shadowedTokenCount: estimateMessage(message) });
    session.append('user/message', replacement, {
      surfaceOp: { op: 'replace', startSeq: event.seq, endSeq: event.seq }, sourceEventSeqs: [event.seq],
    });
    replaced++;
  }
  return replaced;
}
