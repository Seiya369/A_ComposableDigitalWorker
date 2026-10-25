import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseDocument } from 'yaml';
import type { Context } from '@deepseek-ai/cordis';
import { isModelInvocable, renderSkillContent, type SkillViewOptions } from '@deepseek-ai/dsh-skill';

/** Bundled instructions join the native registry; required role skills load once per work order. */
export interface EmployeeSkill { id: string; name: string; description: string; content: string; path: string }

/** Resolve the official model-invocable provider; role preferences never expand tool permissions. */
export async function resolveEmployeeSkill(ctx: Context, bundled: ReadonlyMap<string, EmployeeSkill>, id: string, cwd: string, signal: AbortSignal, scope?: SkillViewOptions['scope']): Promise<string> {
  signal.throwIfAborted();
  const registry = ctx.get('skills');
  if (registry) {
    let skill;
    try { skill = await registry.get(id, { cwd, signal, scope }); }
    catch { signal.throwIfAborted(); throw new Error(`无法载入所选技能：${id}`); }
    if (!skill || !isModelInvocable(skill)) throw new Error(`技能未安装或不允许模型调用：${id}`);
    return renderSkillContent(skill);
  }
  // A service-less unit-test composition can still exercise package-owned instructions.
  // Production declares skills as a mandatory official service dependency.
  const skill = bundled.get(id);
  if (!skill) throw new Error(`技能未安装：${id}`);
  return `## 技能 ${skill.name}\n${skill.content}`;
}

export const BUNDLED_EMPLOYEE_SKILLS: Record<string, string> = {
  'architecture-analysis': '架构分析',
  'architecture-design': '架构设计',
  'technical-review': '技术评审',
  'requirements-acceptance': '需求与验收',
  'ux-design-review': '交互与体验规范',
  'quality-verification': '测试与质量验证',
  'release-readiness': '发布与运行核验',
  'incremental-implementation': '增量实现',
  'frontend-ui-engineering': '界面工程与体验核验',
  'design-system-guidance': '设计体系参考',
  'test-driven-development': '行为测试',
  'debugging-and-error-recovery': '故障定位与恢复',
  'webapp-testing': 'Web 应用验证',
  'shipping-and-launch': '发布准备与上线核验',
  'ci-cd-and-automation': '流水线与自动化',
  'grill-with-docs': '需求澄清与记录',
  'to-spec': '实施规格',
  'to-tickets': '实施工作包',
  'code-review': '代码与测试审查',
  'pr': 'PR 说明稿',
  'retro': '阶段复盘',
  'worktree-cleanup': '临时工作树清理',
};

/** Read the package-owned SKILL.md files before publishing the plugin. */
export async function loadEmployeeSkills(directory: string): Promise<Map<string, EmployeeSkill>> {
  const entries = await Promise.all(Object.entries(BUNDLED_EMPLOYEE_SKILLS).map(async ([id, name]) => {
    const path = resolve(directory, id, 'SKILL.md');
    const raw = await readFile(path, 'utf8');
    const header = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw);
    if (!header) throw new Error(`技能缺少声明：${id}`);
    const document = parseDocument(header[1]!);
    const metadata = document.toJS();
    const content = raw.slice(header[0].length).trim();
    if (document.errors.length || !metadata || metadata.name !== id || typeof metadata.description !== 'string' || !metadata.description.trim() || metadata['disable-model-invocation'] === true || !content) throw new Error(`员工技能声明无效或不能自动调用：${id}`);
    return [id, { id, name, description: metadata.description, content, path }] as const;
  }));
  return new Map(entries);
}

/** All registrations are scoped Cordis effects and unwind with the plugin. */
export function registerEmployeeSkills(ctx: Context, skills: ReadonlyMap<string, EmployeeSkill>): void {
  for (const skill of skills.values()) {
    ctx.skills.register({ name: skill.id, description: skill.description, content: skill.content,
      path: skill.path, source: 'bundled', resourceBase: { kind: 'directory', path: resolve(skill.path, '..') } });
  }
}
