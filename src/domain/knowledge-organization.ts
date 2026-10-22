import { invariant } from './errors.js';
import type { KnowledgeOrganization } from './types.js';

function fields(value: unknown, allowed: readonly string[], label: string): asserts value is Record<string, unknown> {
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value), `${label}必须为对象`);
  for (const key of Object.keys(value)) invariant(allowed.includes(key), `${label}包含未支持的字段：${key}`);
}

function boundedText(value: unknown, label: string, min: number, max: number): asserts value is string {
  invariant(typeof value === 'string' && value.length >= min && value.length <= max, `${label}长度必须为 ${min}–${max} 个 UTF-16 字符`);
  if (min > 0) invariant(value.trim().length > 0, `${label}不能为空白`);
}

/** Used at configuration and exchange boundaries; no runtime or permission effects. */
export function validateKnowledgeOrganization(value: unknown): asserts value is KnowledgeOrganization {
  fields(value, ['version', 'profession', 'taskScope', 'conceptRules', 'categories'], '知识组织规则');
  invariant(value.version === 1, '知识组织规则版本无效');
  boundedText(value.profession, '专业说明', 0, 2000);
  boundedText(value.taskScope, '任务范围', 0, 4000);
  boundedText(value.conceptRules, '概念提取规则', 0, 8000);
  invariant(Array.isArray(value.categories) && value.categories.length <= 24, '知识分类最多 24 项');
  const ids = new Set<string>();
  for (const category of value.categories) {
    fields(category, ['id', 'title', 'description'], '知识分类');
    invariant(typeof category.id === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(category.id), '知识分类 ID 必须为 1–64 位小写字母、数字或连字符，并以字母开头');
    invariant(!ids.has(category.id), '知识分类 ID 重复'); ids.add(category.id);
    boundedText(category.title, '知识分类名称', 1, 120);
    boundedText(category.description, '知识分类说明', 0, 2000);
  }
}
