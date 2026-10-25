import { WorkforceError } from '../domain/errors.js';

export const AUTO_ARCHIVE_CATEGORIES = ['task-evidence', 'incident/reflection-proposal', 'environment/constraint'] as const;
export type AutoArchiveCategory = typeof AUTO_ARCHIVE_CATEGORIES[number];

/** Per-library admission switches; existing evidence and knowledge remain readable. */
export interface KnowledgeArchivePolicy {
  schemaVersion: 1;
  version: number;
  categories: Record<AutoArchiveCategory, boolean>;
}
export interface KnowledgeArchivePolicyChange {
  category: AutoArchiveCategory;
  enabled: boolean;
  expectedVersion: number;
}

export function defaultKnowledgeArchivePolicy(): KnowledgeArchivePolicy {
  return { schemaVersion: 1, version: 1, categories: { 'task-evidence': true, 'incident/reflection-proposal': true, 'environment/constraint': true } };
}

export function isAutoArchiveCategory(value: unknown): value is AutoArchiveCategory {
  return typeof value === 'string' && (AUTO_ARCHIVE_CATEGORIES as readonly string[]).includes(value);
}

export function validateKnowledgeArchivePolicyChange(value: unknown): asserts value is KnowledgeArchivePolicyChange {
  if (!value || typeof value !== 'object') throw new WorkforceError('VALIDATION', '自动归档设置无效');
  const input = value as Partial<KnowledgeArchivePolicyChange>;
  if (!isAutoArchiveCategory(input.category)) throw new WorkforceError('VALIDATION', '自动归档分类无效');
  if (typeof input.enabled !== 'boolean') throw new WorkforceError('VALIDATION', '自动归档开关必须为布尔值');
  if (!Number.isSafeInteger(input.expectedVersion) || Number(input.expectedVersion) < 1) throw new WorkforceError('VALIDATION', '自动归档设置版本无效');
}

export function validateKnowledgeArchivePolicy(value: unknown): KnowledgeArchivePolicy {
  if (!value || typeof value !== 'object') throw new WorkforceError('VALIDATION', '自动归档配置损坏');
  const policy = value as Partial<KnowledgeArchivePolicy>;
  if (policy.schemaVersion !== 1 || !Number.isSafeInteger(policy.version) || Number(policy.version) < 1 || !policy.categories || typeof policy.categories !== 'object' || Array.isArray(policy.categories)
    || Object.keys(policy.categories).length !== AUTO_ARCHIVE_CATEGORIES.length || AUTO_ARCHIVE_CATEGORIES.some(category => typeof policy.categories![category] !== 'boolean')) {
    throw new WorkforceError('VALIDATION', '自动归档配置损坏');
  }
  return structuredClone(policy as KnowledgeArchivePolicy);
}
