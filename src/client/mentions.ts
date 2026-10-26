import type { InputTriggerSource, PickOutcome, CommandClaim } from '@deepseek-ai/dsh-client-ui-input-trigger/client';
import type { ReferenceInsert, UserTextRule } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { EmployeeTemplate, ProjectEmployee, WorkforceRun, WorkforceState } from '../domain/types.js';
import { temporaryEmployeeMentionAliases } from '../domain/conversation-employee.js';

export type EmployeeMentionProject = string | { projectId: string; standaloneOnly: true };
export type EmployeeMentionRunInput = { projectId: string; request: string; sourceSessionId: string } & (
  | { employeeId: string; templateId?: never }
  | { templateId: string; employeeId?: never }
);
export interface MentionDependencies {
  snapshot(): Promise<WorkforceState>;
  projectForSession(sessionId: string): Promise<EmployeeMentionProject | undefined>;
  run(input: EmployeeMentionRunInput): Promise<WorkforceRun>;
  onStarted(run: WorkforceRun): void;
  issueMentionTicket?(input: EmployeeMentionTicketInput, signal: AbortSignal): Promise<{ marker: string }>;
  translate?(message: string, values?: Record<string, string | number>): string;
  translateError?(error: unknown): string;
}
export type EmployeeMentionTicketInput = { sessionId: string } & (
  | { employeeId: string; templateId?: never }
  | { templateId: string; employeeId?: never }
);
type MentionReference = EmployeeMentionTicketInput & { alias: string };
const referencePrefix = 'graph-horses-employee:';
function parseReference(ref: string): MentionReference {
  if (!ref.startsWith(referencePrefix)) throw new Error('员工引用无效，请重新选择员工');
  let value: unknown;
  try { value = JSON.parse(decodeURIComponent(ref.slice(referencePrefix.length))); } catch { throw new Error('员工引用无效，请重新选择员工'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('员工引用无效，请重新选择员工');
  const input = value as Record<string, unknown>;
  if (typeof input.sessionId !== 'string' || !input.sessionId || typeof input.alias !== 'string' || !input.alias
    || (typeof input.employeeId === 'string') === (typeof input.templateId === 'string')
    || !Object.keys(input).every(key => ['sessionId', 'alias', 'employeeId', 'templateId'].includes(key))) throw new Error('员工引用无效，请重新选择员工');
  return input as MentionReference;
}

/** Official display-only user-text transform; original durable messages are preserved. */
export const employeeMentionMarkerDisplayRule: UserTextRule = {
  id: 'graph-horses-employee-marker', order: -100,
  match(text, from) {
    const pattern = /<graph-horses-employee:[a-f0-9]{32}>[ ]?/g; pattern.lastIndex = from;
    const match = pattern.exec(text);
    return match ? { id: 'text', start: match.index, end: match.index + match[0].length, data: { text: match[0], display: '' } } : undefined;
  },
};

type MentionTarget =
  | { kind: 'employee'; value: string; employee: ProjectEmployee; standaloneOnly?: true }
  | { kind: 'template'; value: string; projectId: string; template: EmployeeTemplate };
const targetRole = (target: MentionTarget) => target.kind === 'employee' ? target.employee : target.template;

/** Display aliases are disambiguated; actual dispatch always captures an instance ID. */
export function employeeAliases(employees: readonly ProjectEmployee[]): Map<string, ProjectEmployee> {
  const names = employees.map(e => e.name.replace(/\s+/g, '_'));
  return new Map(employees.map((e, i) => [names.filter(n => n === names[i]).length > 1 ? `${names[i]}·${e.id.slice(-6)}` : names[i]!, e]));
}

/** Native InputTriggerSource: leading @ dispatches a project employee, or a
 * standalone Chat library role only after its command is explicitly submitted.
 * Source: packages/client/ui-input-trigger/src/types.ts at the supported Harness revision.
 */
export function createEmployeeMentionSource(deps: MentionDependencies): InputTriggerSource {
  const t=deps.translate ?? ((message: string,values:Record<string,string|number>={})=>message.replace(/\{(\w+)\}/g,(token,name:string)=>Object.hasOwn(values,name)?String(values[name]):token));
  const snapshots = new Map<string, Map<string, MentionTarget>>();
  const isChatTarget = (target: MentionTarget) => target.kind === 'template' || target.standaloneOnly === true;
  const ticketInput = (target: MentionTarget, sessionId: string): EmployeeMentionTicketInput => target.kind === 'employee'
    ? { sessionId, employeeId: target.employee.id } : { sessionId, templateId: target.template.id };
  const issue = async (input: EmployeeMentionTicketInput, signal: AbortSignal) => {
    signal.throwIfAborted();
    if (!deps.issueMentionTicket) throw new Error(t('当前暂不支持对话内临时员工，请稍后重试'));
    try { const result = await deps.issueMentionTicket(input, signal); signal.throwIfAborted(); return result; }
    catch (error) { throw new Error(deps.translateError?.(error) ?? (error instanceof Error ? error.message : String(error))); }
  };
  const reference = (alias: string, target: MentionTarget, sessionId: string): ReferenceInsert => ({
    source: 'graph_horses', ref: referencePrefix + encodeURIComponent(JSON.stringify({ ...ticketInput(target, sessionId), alias })),
    label: targetRole(target).name, clipboardText: `@${alias}`,
  });
  async function roster(sessionId: string) {
    const context = await deps.projectForSession(sessionId);
    if (!context) { snapshots.delete(sessionId); return new Map<string, MentionTarget>(); }
    const projectId = typeof context === 'string' ? context : context.projectId;
    const state = await deps.snapshot();
    let result: Map<string, MentionTarget>;
    if (typeof context !== 'string' && context.standaloneOnly) {
      result = new Map([...temporaryEmployeeMentionAliases(state, projectId)].map(([alias, target]) => [alias, target.kind === 'employee'
        ? { kind: 'employee' as const, value: `employee:${target.id}`, employee: state.employees.find(employee => employee.id === target.id)!, standaloneOnly: true as const }
        : { kind: 'template' as const, value: `template:${target.id}`, projectId, template: state.templates.find(template => template.id === target.id)! }]));
    } else {
      result = new Map([...employeeAliases(state.employees.filter(employee => employee.projectId === projectId && employee.status === 'active'))]
        .map(([alias, employee]) => [alias, { kind: 'employee' as const, value: employee.id, employee }]));
    }
    snapshots.set(sessionId, result);
    return result;
  }
  function claim(alias: string, target: MentionTarget, sessionId: string): PickOutcome {
    if (isChatTarget(target)) return { insert: reference(alias, target, sessionId) };
    const role = targetRole(target);
    const standalone = target.kind === 'template' || target.standaloneOnly === true;
    const command: CommandClaim = {
      name: role.name,
      token: `@${alias} `,
      attachments: false,
      get hint(){return t(standalone ? '交给{name}的任务（将打开独立工作单）…' : '交给{name}的任务…',{name:role.name});},
      async submit(args, _ctx, attachments) {
        if (attachments.length > 0) return {kind:'error', text:t('员工任务暂不支持附件，请先提供项目文件路径。')};
        if (!args.trim()) return {kind:'error', text:t('请描述需要员工完成的任务。')};
        try {
          const input: EmployeeMentionRunInput = target.kind === 'employee'
            ? { projectId: target.employee.projectId, employeeId: target.employee.id, request: args.trim(), sourceSessionId: sessionId }
            : { projectId: target.projectId, templateId: target.template.id, request: args.trim(), sourceSessionId: sessionId };
          const run = await deps.run(input);
          deps.onStarted(run);
          return {kind:'success'};
        } catch (error) {
          return {kind:'error', text:deps.translateError?.(error) ?? (error instanceof Error ? error.message : String(error))};
        }
      },
    };
    return {claim: command};
  }
  return {
    trigger:'@', name:'graph_horses', order:-20, showGroupTitle:false,
    async candidates(session, query) {
      if(query.position !== 'leading') return [];
      const employees=await roster(session.sessionId);
      if(query.signal.aborted) return [];
      return [...employees].filter(([alias, target]) => `${alias} ${target.kind === 'employee' ? target.employee.templateName : target.template.name}`.toLowerCase().includes(query.query.toLowerCase()))
        .map(([alias,target])=>({name:alias, description:targetRole(target).modules.responsibilities.mission,
          section:t(target.kind === 'template' ? '自由职业人模板' : target.standaloneOnly ? '本工作区已启用员工' : '项目数字员工'), value:target.value,
          hint:t(isChatTarget(target) ? '仅本轮' : '主办')}));
    },
    onPick(pick) {
      if(pick.position !== 'leading') return undefined;
      const entry=[...(snapshots.get(pick.session.sessionId) || new Map())].find(([,target])=>target.value === pick.candidate.value);
      return entry ? claim(entry[0],entry[1],pick.session.sessionId) : undefined;
    },
    async matchEnter(session,line,signal,envelope) {
      if(!line.startsWith('@')) return undefined;
      const employees=await roster(session.sessionId);
      if(signal.aborted) return undefined;
      const entries=[...employees].sort(([a],[b])=>b.length-a.length);
      const entry=entries.find(([alias])=>line===`@${alias}`||line.startsWith(`@${alias} `));
      if(!entry) return undefined;
      if (isChatTarget(entry[1])) {
        // This official input machine sends plain @ text through its native
        // sink. The Host resolves a current, explicit user-source alias there.
        return undefined;
      }
      if(envelope.attachments>0) throw new Error(t('员工任务暂不支持附件，请先提供项目文件路径。'));
      return claim(entry[0],entry[1],session.sessionId);
    },
    matchSpace(session, token) {
      const target = snapshots.get(session.sessionId)?.get(token.startsWith('@') ? token.slice(1) : '');
      return target && isChatTarget(target) ? { insert: reference(token.slice(1), target, session.sessionId) } : undefined;
    },
    codec: {
      clipboardText: ref => `@${parseReference(ref).alias}`,
      async serialize(ref, signal) {
        const { alias, ...input } = parseReference(ref);
        const { marker } = await issue(input, signal);
        if (!/^<graph-horses-employee:[a-f0-9]{32}>$/.test(marker)) throw new Error(t('员工引用无效，请重新选择员工'));
        return `${marker} @${alias}`;
      },
    },
    lexicon(session) { return [...(snapshots.get(session.sessionId)?.keys() || [])]; },
  };
}
