import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { isModelInvocable, renderSkillContent, type SkillViewOptions } from '@deepseek-ai/dsh-skill';

/** Bundled instructions are registered in Harness and included only for selected employees. */
export interface EmployeeSkill { id: string; name: string; description: string; content: string; path: string }

/** Resolve the official winning provider for the project; selecting a skill grants its body only. */
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

const names: Record<string, string> = {
  'architecture-analysis': '架构分析',
  'architecture-design': '架构设计',
  'technical-review': '技术评审',
};

/** Read the package-owned SKILL.md files before publishing the plugin. */
export async function loadEmployeeSkills(directory: string): Promise<Map<string, EmployeeSkill>> {
  const entries = await Promise.all(Object.entries(names).map(async ([id, name]) => {
    const path = resolve(directory, id, 'SKILL.md');
    const raw = await readFile(path, 'utf8');
    const content = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
    return [id, { id, name, description: `${name}：数字员工技术负责人工作方法`, content, path }] as const;
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
