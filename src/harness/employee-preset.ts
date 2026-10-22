import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-agent-preset-registry';

export const EMPLOYEE_PRESET_ID = 'composable-workforce';

/** Audited native tools only; no automatic instruction loading or alternative delegation. */
export const EMPLOYEE_PRESET_PLUGINS = [
  { id: 'files', name: '@deepseek-ai/dsh-tool-fs' },
  { id: 'search', name: '@deepseek-ai/dsh-tool-fs-search', config: { sampleOverCapGlobResults: false } },
  { id: 'todo', name: '@deepseek-ai/dsh-tool-todo', config: { allowParallelInProgress: true } },
  { id: 'web', name: '@deepseek-ai/dsh-tool-web' },
  { id: 'questions', name: '@deepseek-ai/dsh-tool-ask-user' },
  { id: 'present', name: '@deepseek-ai/dsh-tool-present' },
] as const;

/** Register through the official preset registry. The caller owns the exact disposer. */
export async function registerEmployeePreset(ctx: Context): Promise<(() => Promise<void>) | undefined> {
  const registry = ctx.get('agentPresets');
  if (!registry) return undefined; // Preset-free TUI/test compositions use the audited host tools.
  return registry.register({ id: EMPLOYEE_PRESET_ID, name: 'graph_horses 项目人员', description: '遵守人员路径与网络权限的官方工具组合。', plugins: structuredClone(EMPLOYEE_PRESET_PLUGINS) });
}
