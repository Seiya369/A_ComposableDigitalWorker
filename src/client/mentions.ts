import type { InputTriggerSource, PickOutcome, CommandClaim } from '@deepseek-ai/dsh-client-ui-input-trigger/client';
import type { EmployeeTemplate, ProjectEmployee, WorkforceRun, WorkforceState } from '../domain/types.js';

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
  translate?(message: string, values?: Record<string, string | number>): string;
  translateError?(error: unknown): string;
}

type MentionTarget =
  | { kind: 'employee'; value: string; employee: ProjectEmployee; standaloneOnly?: true }
  | { kind: 'template'; value: string; projectId: string; template: EmployeeTemplate };
const targetRole = (target: MentionTarget) => target.kind === 'employee' ? target.employee : target.template;

/** Display aliases are disambiguated; actual dispatch always captures an instance ID. */
export function employeeAliases(employees: readonly ProjectEmployee[]): Map<string, ProjectEmployee> {
  const names = employees.map(e => e.name.replace(/\s+/g, '_'));
  return new Map(employees.map((e, i) => [names.filter(n => n === names[i]).length > 1 ? `${names[i]}·${e.id.slice(-6)}` : names[i]!, e]));
}

function standaloneAliases(targets: MentionTarget[]): Map<string, MentionTarget> {
  const names = targets.map(target => targetRole(target).name.replace(/\s+/g, '_'));
  const aliases = new Map<string, MentionTarget>();
  targets.forEach((target, index) => {
    const name = names[index]!;
    let alias = names.filter(value => value === name).length > 1
      ? `${name}·${target.kind === 'employee' ? '实例' : '岗位'}-${targetRole(target).id.slice(-6)}` : name;
    if (aliases.has(alias)) alias += `-${targetRole(target).id}`;
    aliases.set(alias, target);
  });
  return aliases;
}

/** Native InputTriggerSource: leading @ dispatches a project employee, or a
 * standalone Chat library role only after its command is explicitly submitted.
 * Source: packages/client/ui-input-trigger/src/types.ts at the supported Harness revision.
 */
export function createEmployeeMentionSource(deps: MentionDependencies): InputTriggerSource {
  const t=deps.translate ?? ((message: string,values:Record<string,string|number>={})=>message.replace(/\{(\w+)\}/g,(token,name:string)=>Object.hasOwn(values,name)?String(values[name]):token));
  const snapshots = new Map<string, Map<string, MentionTarget>>();
  async function roster(sessionId: string) {
    const context = await deps.projectForSession(sessionId);
    if (!context) { snapshots.delete(sessionId); return new Map<string, MentionTarget>(); }
    const projectId = typeof context === 'string' ? context : context.projectId;
    const state = await deps.snapshot();
    let result: Map<string, MentionTarget>;
    if (typeof context !== 'string' && context.standaloneOnly) {
      const standalone = state.employees.filter(employee => employee.projectId === projectId && !employee.teamInstanceId && !employee.managerId);
      // A paused local instance must not be silently bypassed with another copy.
      const instantiated = new Set(standalone.map(employee => employee.templateId));
      const targets: MentionTarget[] = standalone.filter(employee => employee.status === 'active')
        .map(employee => ({ kind: 'employee', value: `employee:${employee.id}`, employee, standaloneOnly: true }));
      for (const template of state.templates.filter(template => template.status === 'ready' && !instantiated.has(template.id))) {
        targets.push({ kind: 'template', value: `template:${template.id}`, projectId, template });
      }
      result = standaloneAliases(targets);
    } else {
      result = new Map([...employeeAliases(state.employees.filter(employee => employee.projectId === projectId && employee.status === 'active'))]
        .map(([alias, employee]) => [alias, { kind: 'employee' as const, value: employee.id, employee }]));
    }
    snapshots.set(sessionId, result);
    return result;
  }
  function claim(alias: string, target: MentionTarget, sessionId: string): PickOutcome {
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
          hint:t(target.kind === 'template' || target.standaloneOnly ? '单次委派' : '主办')}));
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
      if(envelope.attachments>0) throw new Error(t('员工任务暂不支持附件，请先提供项目文件路径。'));
      return claim(entry[0],entry[1],session.sessionId);
    },
    lexicon(session) { return [...(snapshots.get(session.sessionId)?.keys() || [])]; },
  };
}
