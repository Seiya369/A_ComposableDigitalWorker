import type { InputTriggerSource, PickOutcome, CommandClaim } from '@deepseek-ai/dsh-client-ui-input-trigger/client';
import type { ProjectEmployee, WorkforceRun, WorkforceState } from '../domain/types.js';

export interface MentionDependencies {
  snapshot(): Promise<WorkforceState>;
  projectForSession(sessionId: string): Promise<string | undefined>;
  run(input: {projectId: string; employeeId: string; request: string; sourceSessionId: string}): Promise<WorkforceRun>;
  onStarted(run: WorkforceRun): void;
  translate?(message: string, values?: Record<string, string | number>): string;
  translateError?(error: unknown): string;
}

/** Display aliases are disambiguated; actual dispatch always captures an instance ID. */
export function employeeAliases(employees: readonly ProjectEmployee[]): Map<string, ProjectEmployee> {
  const names = employees.map(e => e.name.replace(/\s+/g, '_'));
  return new Map(employees.map((e, i) => [names.filter(n => n === names[i]).length > 1 ? `${names[i]}·${e.id.slice(-6)}` : names[i]!, e]));
}

/** Native InputTriggerSource: leading @ selects the responsible project instance.
 * Source: packages/client/ui-input-trigger/src/types.ts at the supported Harness revision.
 */
export function createEmployeeMentionSource(deps: MentionDependencies): InputTriggerSource {
  const t=deps.translate ?? ((message: string,values:Record<string,string|number>={})=>message.replace(/\{(\w+)\}/g,(token,name:string)=>Object.hasOwn(values,name)?String(values[name]):token));
  const snapshots = new Map<string, Map<string, ProjectEmployee>>();
  async function roster(sessionId: string) {
    const projectId = await deps.projectForSession(sessionId);
    if (!projectId) return new Map<string, ProjectEmployee>();
    const state = await deps.snapshot();
    const result = employeeAliases(state.employees.filter(e => e.projectId === projectId && e.status === 'active'));
    snapshots.set(sessionId, result);
    return result;
  }
  function claim(alias: string, employee: ProjectEmployee, sessionId: string): PickOutcome {
    const command: CommandClaim = {
      name: employee.name,
      token: `@${alias} `,
      attachments: false,
      get hint(){return t('交给{name}的任务…',{name:employee.name});},
      async submit(args, _ctx, attachments) {
        if (attachments.length > 0) return {kind:'error', text:t('员工任务暂不支持附件，请先提供项目文件路径。')};
        if (!args.trim()) return {kind:'error', text:t('请描述需要员工完成的任务。')};
        try {
          const run = await deps.run({projectId: employee.projectId, employeeId: employee.id, request: args.trim(), sourceSessionId: sessionId});
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
      return [...employees].filter(([alias, e]) => `${alias} ${e.templateName}`.toLowerCase().includes(query.query.toLowerCase())).map(([alias,e])=>({name:alias, description:e.modules.responsibilities.mission, section:t('项目数字员工'), value:e.id, hint:t('主办')}));
    },
    onPick(pick) {
      if(pick.position !== 'leading') return undefined;
      const entry=[...(snapshots.get(pick.session.sessionId) || new Map())].find(([,e])=>e.id === pick.candidate.value);
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
