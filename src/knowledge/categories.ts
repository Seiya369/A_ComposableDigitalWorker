/** Controlled source categories; display text and submitted content never become paths. */
export const KNOWLEDGE_SOURCE_CATEGORIES = [
  'reference', 'requirements-decisions', 'task-evidence', 'incidents-reflections',
  'environment-constraints', 'preferences-capabilities',
] as const;
export type KnowledgeSourceCategory = typeof KNOWLEDGE_SOURCE_CATEGORIES[number];
export const KNOWLEDGE_SOURCE_CATEGORY_LABELS: Record<KnowledgeSourceCategory, string> = {
  reference: '专业资料',
  'requirements-decisions': '需求与决策',
  'task-evidence': '任务证据',
  'incidents-reflections': '失败与反思',
  'environment-constraints': '环境与约束',
  'preferences-capabilities': '偏好与能力',
};
export const KNOWLEDGE_SOURCE_CATEGORY_FOLDERS: Record<KnowledgeSourceCategory, string> = {
  reference: '01-reference',
  'requirements-decisions': '02-requirements-decisions',
  'task-evidence': '03-task-evidence',
  'incidents-reflections': '04-incidents-reflections',
  'environment-constraints': '05-environment-constraints',
  'preferences-capabilities': '06-preferences-capabilities',
};
