import type { Context } from '@deepseek-ai/cordis';
import { isModelInvocable, type SkillLookupOptions } from '@deepseek-ai/dsh-skill';
import type {} from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-agent-preset-registry';
import { BASH_UNAVAILABLE, NATIVE_DEFAULT_TOOLS, UNKNOWN_TOOL_UNAVAILABLE, type EmployeeCapabilityCatalog } from '../domain/capability-catalog.js';
import { EMPLOYEE_PRESET_ID } from './employee-preset.js';

const descriptions: Record<string, string> = {
  read: '读取授权的项目文本文件', read_image: '读取授权的项目图片（需模型及宿主支持）',
  write: '写入授权路径；需明确授予 write 权限', edit: '编辑授权文件；需明确授予 edit 权限',
  glob: '查找授权项目目录的文件', grep: '搜索授权项目目录的内容',
  web_search: '搜索互联网；需网络授权', web_fetch: '读取网页；需网络授权',
  skill: '载入这个人员已选择的 Skill', todo_write: '维护当前会话待办',
  ask_user_question: '向用户澄清缺失信息', present: '呈现已授权的项目成果文件',
};

/** Fresh official registries, white-list projection, sanitized failures only. */
export async function listEmployeeCapabilities(ctx: Context, options: SkillLookupOptions = {}): Promise<EmployeeCapabilityCatalog> {
  let lease: Awaited<ReturnType<NonNullable<typeof ctx.agentPresets>['acquireScope']>> | undefined;
  let employeeLease: typeof lease;
  try {
    // The Web surface registers native tools and filesystem skills in its
    // default preset, rather than the host layer. This public read lease does
    // not create a Session or execute a model request.
    lease = await ctx.get('agentPresets')?.acquireScope();
    employeeLease = await ctx.get('agentPresets')?.acquireScope(EMPLOYEE_PRESET_ID);
    const summaries = await ctx.skills.list({ ...options, scope: lease?.key });
    const schemas = ctx.tools.schemas(lease?.key);
    const installed = new Set(ctx.tools.schemas(employeeLease?.key).map(tool => tool.name));
    const shared = new Set<string>(NATIVE_DEFAULT_TOOLS);
    const defaultTools = NATIVE_DEFAULT_TOOLS.map(id => ({
      id, description: descriptions[id]!, available: id === 'skill' || installed.has(id),
      ...(id !== 'skill' && !installed.has(id) ? { reason: 'DSH 当前未注册此工具；安装对应官方工具插件后刷新。' } : {}),
    }));
    return {
      skills: summaries.filter(isModelInvocable).map(skill => ({ id: skill.name, name: skill.name, description: skill.description, source: ['project-dsh', 'project-agents', 'runtime', 'user-dsh', 'user-agents', 'bundled'].includes(skill.source) ? skill.source : 'custom' })),
      defaultTools,
      specialTools: schemas.filter(tool => !shared.has(tool.name) && !tool.name.startsWith('worker_')).map(tool => ({
        id: tool.name, description: tool.description, available: false,
        reason: ['bash', 'terminal', 'pwsh', 'job_output', 'job_list', 'job_kill'].includes(tool.name) ? BASH_UNAVAILABLE : UNKNOWN_TOOL_UNAVAILABLE,
      })),
      limitations: [BASH_UNAVAILABLE, '文件读写始终限制在项目与人员授权路径内；覆盖写入和编辑需要单独授权。', 'Skills 只加载所选指令，不自动授予其依赖的工具、项目外资源或网络权限。', '目录搜索须对整个目标子树拥有读取授权，不能用搜索绕过单文件授权。'],
    };
  } catch {
    if (options.signal?.aborted) options.signal.throwIfAborted();
    throw new Error('无法读取 DSH 能力目录，请检查官方技能与工具服务后重试。');
  } finally {
    const released = await Promise.allSettled([employeeLease?.[Symbol.asyncDispose](), lease?.[Symbol.asyncDispose]()]);
    if (released.some(result => result.status === 'rejected')) throw new Error('DSH 能力目录读取作用域未能正常释放，请重试。');
  }
}
