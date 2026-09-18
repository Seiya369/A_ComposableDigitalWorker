import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-host-webserver';
import { SessionId } from '@deepseek-ai/dsh-session';
import { WorkforceStore } from '../domain/store.js';
import { ARCHITECT_TEMPLATE_ID, SOFTWARE_TEAM_ID } from '../domain/seed.js';
import type { CreateEmployeeInput, CreateProjectEmployeesInput, MutationOptions, ReviewRunInput, SaveEmployeeConfigurationInput, SaveMemoryInput, SaveTeamInput, SaveTemplateInput, UpdateEmployeeInput } from '../domain/types.js';
import { WorkforceRuntime, type RunRequest, type RuntimeConfig } from './runtime.js';
import { loadEmployeeSkills, registerEmployeeSkills } from './skills.js';
import type { CancelProjectTeamsInput, ConfigureProjectTeamInput } from '../domain/types.js';
import { WorkflowRepository } from '../workflow/repository.js';
import { WorkflowEngine } from '../workflow/engine.js';
import type { SaveProjectWorkflowInput, StartWorkflowInput, WorkflowCommandInput } from '../workflow/types.js';

export const name = 'composable-workforce';
export const inject = ['webServer', 'agents', 'tools', 'systemPrompt', 'skills', 'workspaceRegistry', 'agentDefaultModel'];
export interface Config extends Partial<RuntimeConfig> {
  statePath?: string;
  skillsDirectory?: string;
  apiPrefix?: string;
  bootstrapProjectPath?: string;
  /** Additional explicit browser origins for a reverse proxy; no wildcard is supported. */
  allowedOrigins?: string[];
  maxBodyBytes?: number;
}

/** Parse only JSON objects at the HTTP boundary; domain methods validate their fields. */
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求必须是 JSON 对象');
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}不能为空`);
  return value;
}

function json(res: ServerResponse, code: number, value: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}

/** Exact origin and Host validation prevents cross-site mutation and DNS rebinding. */
export function assertRequestOrigin(req: Pick<IncomingMessage, 'headers' | 'method'>, allowedOrigins: readonly string[]): void {
  const host = req.headers.host;
  if (!host || !allowedOrigins.some(origin => new URL(origin).host === host)) throw new Error('不允许的请求主机');
  const origin = req.headers.origin;
  if (origin && (!allowedOrigins.includes(origin) || new URL(origin).host !== host)) throw new Error('只允许同源请求');
  if (req.method !== 'GET' && req.method !== 'HEAD' && !origin) throw new Error('写操作必须携带同源 Origin');
  if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(String(req.headers['sec-fetch-site']))) throw new Error('不允许跨站请求');
}

async function readBody(req: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new Error('只接受 application/json');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) throw new Error('请求超过大小限制');
    chunks.push(bytes);
  }
  return record(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}

/** Host routes deliberately reuse the existing Harness web server and credentials/model services. */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const prefix = config.apiPrefix ?? '/digital-workers/api';
  if (!/^\/[a-zA-Z0-9/_-]+$/.test(prefix) || prefix.endsWith('/')) throw new Error('apiPrefix 必须是不带末尾斜杠的绝对 URL 路径');
  const origins = [`http://127.0.0.1:${ctx.webServer.port}`, `http://localhost:${ctx.webServer.port}`, ...(config.allowedOrigins ?? [])];
  for (const origin of origins) if (new URL(origin).origin !== origin || !['http:', 'https:'].includes(new URL(origin).protocol)) throw new Error('allowedOrigins 必须是完整 HTTP(S) origin');
  const bodyLimit = config.maxBodyBytes ?? 1_048_576;
  if (!Number.isSafeInteger(bodyLimit) || bodyLimit <= 0) throw new Error('maxBodyBytes 必须是正整数');
  const store = await WorkforceStore.open(config.statePath ?? resolve(process.env.DSH_HOME || resolve(homedir(), '.dsh'), 'composable-workforce', 'state.json'));
  const skills = await loadEmployeeSkills(config.skillsDirectory ?? fileURLToPath(new URL('../skills/', import.meta.url)));
  registerEmployeeSkills(ctx, skills);
  const runtime = new WorkforceRuntime(ctx, store, skills, Object.fromEntries(Object.entries(config).filter(([key]) => ['maxSteps', 'maxRunMs', 'maxTreeRuns', 'maxTreeTokens', 'maxFileBytes'].includes(key))));
  const workflows = new WorkflowRepository(store);
  const workflowEngine = new WorkflowEngine(workflows, runtime, error => ctx.logger.error(error));
  ctx.effect(() => async () => { await workflowEngine.dispose(); await runtime.dispose(); }, 'digital-workers.runtime');

  // An interrupted external write is not replayed automatically after a process restart.
  for (const run of store.snapshot().runs) if (!run.workflow && (run.status === 'queued' || run.status === 'running')) await store.updateRun(run.id, { status: 'failed', error: '上次宿主运行中断；请检查交付文件后重新提交任务', finishedAt: new Date().toISOString() });

  const syncProjects = async (): Promise<void> => {
    for (const workspace of ctx.workspaceRegistry.list()) {
      const project = store.snapshot().projects.find(item => item.id === workspace.id);
      if (!project || project.name !== workspace.title || project.rootPath !== workspace.path) await store.saveProject({ id: workspace.id, name: workspace.title, rootPath: workspace.path });
    }
  };
  if (config.bootstrapProjectPath) {
    const workspace = await ctx.workspaceRegistry.create(resolve(config.bootstrapProjectPath));
    const firstSetup = !store.snapshot().projects.some(project => project.id === workspace.id);
    await syncProjects();
    // Seed the requested first architect once. Removing an employee is a project choice,
    // and restarting the local service must not silently add that employee back.
    if (firstSetup && !store.snapshot().employees.some(employee => employee.projectId === workspace.id && employee.templateId === ARCHITECT_TEMPLATE_ID)) await store.instantiateTeam(workspace.id, SOFTWARE_TEAM_ID);
  } else await syncProjects();
  await workflowEngine.start();

  const requireProject = async (projectId: string) => {
    await syncProjects();
    if (!ctx.workspaceRegistry.list().some(workspace => workspace.id === projectId)) throw new Error('项目文件夹已被移除');
  };
  const requireStandaloneRun = (id: string) => {
    if (store.snapshot().runs.find(run => run.id === id)?.workflow) throw new Error('请在项目工作流中验收或取消此步骤');
    return id;
  };

  // Native chat can inspect a completed employee session, but every further employee job
  // must be admitted through @ so configuration, budget and result tracking are restored.
  ctx.on('agent/created', ({ agent }) => {
    if (runtime.ownsSession(agent.id) || !store.snapshot().runs.some(run => run.sessionId === agent.id)) return;
    agent.ctx.tools.restrict({ allow: [] });
    agent.ctx.tools.guard(() => '请通过 @ 员工创建新的工作单');
    agent.ctx.on('agent/pre-step', async () => { throw new Error('这是数字员工交付记录，请通过 @ 员工创建新的工作单以继续工作'); });
  });

  const command = async (body: Record<string, unknown>): Promise<unknown> => {
    const action = string(body.action, '操作');
    const payload = record(body.payload ?? {});
    const options = record(body.options ?? {}) as MutationOptions;
    switch (action) {
      case 'template.save': return store.saveTemplate(payload as unknown as SaveTemplateInput, options);
      case 'employee.configuration.save': return store.saveEmployeeConfiguration(payload as unknown as SaveEmployeeConfigurationInput, options);
      case 'template.archive': return store.archiveTemplate(string(payload.id, '模板 ID'), options);
      case 'team.save': return store.saveTeam(payload as unknown as SaveTeamInput, options);
      case 'team.delete': return store.deleteTeam(string(payload.id, '团队 ID'), options);
      case 'team.instantiate': return store.instantiateTeam(string(payload.projectId, '项目 ID'), string(payload.teamId, '团队 ID'), options);
      case 'employee.create': return store.createEmployee(payload as unknown as CreateEmployeeInput, options);
      case 'project.team.cancel': {
        await requireProject(string(payload.projectId, '项目 ID'));
        const result = await store.cancelProjectTeams(payload as unknown as CancelProjectTeamsInput);
        await Promise.all(result.runIds.map(id => runtime.cancel(id)));
        return { cancelled: true };
      }
      case 'project.team.configure': {
        await syncProjects();
        const projectId = string(payload.projectId, '项目 ID');
        if (!ctx.workspaceRegistry.list().some(workspace => workspace.id === projectId)) throw new Error('该项目文件夹已被移除，请从当前项目菜单重新进入');
        return store.configureProjectTeam(payload as unknown as ConfigureProjectTeamInput);
      }
      case 'project.employees.create': {
        await syncProjects();
        const projectId = string(payload.projectId, '项目 ID');
        if (!ctx.workspaceRegistry.list().some(workspace => workspace.id === projectId)) throw new Error('该项目文件夹尚未注册或已被移除，请从当前项目菜单重新进入');
        return store.createProjectEmployees(payload as unknown as CreateProjectEmployeesInput, options);
      }
      case 'employee.update': return store.updateEmployee(string(payload.id, '员工 ID'), record(payload.input) as UpdateEmployeeInput, options);
      case 'employee.delete': return store.deleteEmployee(string(payload.id, '员工 ID'), options);
      case 'memory.save': return store.saveMemory(payload as unknown as SaveMemoryInput, options);
      case 'memory.delete': return store.deleteMemory(string(payload.id, '记忆 ID'), options);
      case 'workflow.save': await requireProject(string(payload.projectId, '项目 ID')); return workflows.saveDefinition(payload as unknown as SaveProjectWorkflowInput);
      case 'workflow.start': await requireProject(string(payload.projectId, '项目 ID')); return workflows.start(payload as unknown as StartWorkflowInput);
      case 'workflow.control': await requireProject(string(payload.projectId, '项目 ID')); return workflows.control(payload as unknown as WorkflowCommandInput);
      case 'run.review': return store.reviewRun(requireStandaloneRun(string(payload.id, '工作单 ID')), record(payload.input) as unknown as ReviewRunInput, options);
      case 'run.cancel': await runtime.cancel(requireStandaloneRun(string(payload.id, '工作单 ID'))); return { cancelled: true };
      default: throw new Error(`未知操作：${action}`);
    }
  };

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: prefix, handler: async (req, res) => {
    try { assertRequestOrigin(req, origins); } catch (error) { json(res, 403, { error: (error as Error).message }); return; }
    try {
      const url = new URL(req.url!, origins[0]);
      const route = url.pathname.slice(prefix.length);
      if (req.method === 'GET' && route === '/state') { await syncProjects(); json(res, 200, store.snapshot()); return; }
      if (req.method === 'GET' && route === '/session-project') {
        await syncProjects();
        const sessionId = SessionId(string(url.searchParams.get('sessionId'), '会话 ID'));
        const workspace = ctx.workspaceRegistry.list().find(item => item.sessionIds.includes(sessionId));
        json(res, 200, { projectId: workspace?.id ?? null }); return;
      }
      if (req.method === 'POST' && route === '/command') {
        const result = await command(await readBody(req, bodyLimit));
        json(res, 200, { result: result ?? null, state: store.snapshot() }); return;
      }
      if (req.method === 'POST' && route === '/run') {
        const body = await readBody(req, bodyLimit);
        await syncProjects();
        const input: RunRequest = { projectId: string(body.projectId, '项目 ID'), employeeId: string(body.employeeId, '员工 ID'), request: string(body.request, '任务') };
        if (body.parentRunId !== undefined) throw new Error('用户入口不能指定父工作单');
        if (body.sourceSessionId !== undefined) input.sourceSessionId = string(body.sourceSessionId, '来源会话 ID');
        const run = await runtime.start(input);
        json(res, 202, { run }); return;
      }
      json(res, 404, { error: '接口不存在' });
    } catch (error) {
      const code = (error as { code?: string }).code;
      json(res, code === 'CONFLICT' || code === 'STORE_BUSY' ? 409 : 400, { error: error instanceof Error ? error.message : String(error), ...(code ? { code } : {}) });
    }
  } }), 'digital-workers.http');
}
