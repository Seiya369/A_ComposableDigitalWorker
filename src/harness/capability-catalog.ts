import type { Context } from '@deepseek-ai/cordis';
import { isModelInvocable, type SkillLookupOptions } from '@deepseek-ai/dsh-skill';
import type {} from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-agent-preset-registry';
import { NATIVE_DEFAULT_TOOLS, type EmployeeCapabilityCatalog } from '../domain/capability-catalog.js';
import { listEmployeeIntegrations } from './integration-catalog.js';

/** Read the native default preset without creating a session or installing anything. */
export async function listEmployeeCapabilities(ctx: Context, options: SkillLookupOptions = {}): Promise<EmployeeCapabilityCatalog> {
  let lease: Awaited<ReturnType<NonNullable<typeof ctx.agentPresets>['acquireScope']>> | undefined;
  try {
    lease = await ctx.get('agentPresets')?.acquireScope();
    const summaries = await ctx.skills.list({ ...options, scope: lease?.key });
    const schemas = ctx.tools.schemas(lease?.key).filter(tool => !tool.name.startsWith('worker_'));
    const shared = new Set<string>(NATIVE_DEFAULT_TOOLS);
    const tools = schemas.map(tool => ({ id: tool.name, description: tool.description, available: true }));
    const integrations = await listEmployeeIntegrations(ctx, schemas.map(tool => tool.name));
    options.signal?.throwIfAborted();
    return {
      ...integrations,
      skills: summaries.filter(isModelInvocable).map(skill => ({ id: skill.name, name: skill.name, description: skill.description,
        source: ['project-dsh', 'project-agents', 'runtime', 'user-dsh', 'user-agents', 'bundled'].includes(skill.source) ? skill.source : 'custom' })),
      defaultTools: tools.filter(tool => shared.has(tool.id)),
      specialTools: tools.filter(tool => !shared.has(tool.id)),
      limitations: ['目录来自 DSH 当前默认预设；具体工作单继承来源会话的原生预设，独立工作单采用默认预设。', '必备 Skill 每份工作单载入一次；优先 Skill 与工具只表达业务匹配偏好，不扩大权限。', '工具实际调用遵循 DSH 原生沙箱、审批及各工具自身约束；第三方插件和 MCP 不会因出现在目录中自动获得沙箱隔离。'],
    };
  } catch {
    if (options.signal?.aborted) options.signal.throwIfAborted();
    throw new Error('无法读取 DSH 能力目录，请检查官方技能与工具服务后重试。');
  } finally {
    await lease?.[Symbol.asyncDispose]();
  }
}
