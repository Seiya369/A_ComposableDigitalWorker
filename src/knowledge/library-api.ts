import type { EmployeeTemplate, ModelModule, ProjectEmployee } from '../domain/types.js';
import type { KnowledgeEntry, KnowledgeSnapshot, KnowledgeSource } from './types.js';
import type { KnowledgeArchivePolicy, KnowledgeArchivePolicyChange } from './archive-policy.js';
export type { AutoArchiveCategory, KnowledgeArchivePolicy } from './archive-policy.js';

export const KNOWLEDGE_SOURCE_CATEGORIES = [
  { id: 'reference', label: '专业知识', description: '管理专业资料' },
  { id: 'task-evidence', label: '任务档案', description: '记录需求决策与任务成果' },
  { id: 'incident/reflection-proposal', label: '复盘经验', description: '积累复盘提案与已确认经验' },
  { id: 'environment/constraint', label: '工作约束', description: '明确环境权限与工作边界' },
] as const;
export type KnowledgeSourceCategory = typeof KNOWLEDGE_SOURCE_CATEGORIES[number]['id'];
export type LegacyKnowledgeSourceCategory = 'requirement/decision/correction' | 'preference/capability-evidence';
export type KnowledgeSourceCategoryInput = KnowledgeSourceCategory | LegacyKnowledgeSourceCategory;

/** Historical A records stay immutable; normalize at read/admission boundaries. */
export function normalizeKnowledgeCategory(value: unknown): KnowledgeSourceCategory {
  if (value === undefined || value === 'reference') return 'reference';
  if (value === 'task-evidence' || value === 'requirement/decision/correction') return 'task-evidence';
  if (value === 'incident/reflection-proposal' || value === 'preference/capability-evidence') return 'incident/reflection-proposal';
  if (value === 'environment/constraint') return 'environment/constraint';
  throw new Error('Invalid knowledge source category / 资料分类无效');
}
export interface KnowledgeLibraryTarget {
  scope: 'template' | 'project';
  employeeId: string;
  projectId?: string;
  library: 'employee' | 'team';
  teamId?: string;
}
export interface KnowledgeLibraryStatus {
  state: 'disabled' | 'empty' | 'pending' | 'compiling' | 'ready' | 'stale' | 'failed';
  error?: string;
}
export interface KnowledgeLibraryView {
  target: KnowledgeLibraryTarget;
  enabled: boolean;
  /** Always returned by current hosts; optional for older transport fixtures. */
  archivePolicy?: KnowledgeArchivePolicy;
  title: string;
  compiler: { role: 'employee-shadow' | 'team-librarian'; model?: ModelModule };
  categories: Array<{ id: KnowledgeSourceCategory; label: string; count: number }>;
  sources: KnowledgeSource[];
  snapshot?: KnowledgeSnapshot;
  status: KnowledgeLibraryStatus;
  supportedExtensions: string[];
  maxFileBytes: number;
  maxUploadBytes: number;
  libraries: Array<{ library: 'employee' | 'team'; teamId?: string; label: string }>;
}
export interface KnowledgeUploadFile {
  name: string;
  /** Exactly one of content and base64 is accepted. Base64 preserves original bytes. */
  content?: string;
  base64?: string;
  category?: KnowledgeSourceCategoryInput;
}
export interface KnowledgeUploadRequest {
  target: KnowledgeLibraryTarget;
  files: KnowledgeUploadFile[];
  /** May be used with an empty files array to retry pending compilation. */
  retry?: boolean;
}
export interface KnowledgeUploadResult { library: KnowledgeLibraryView; uploaded: string[] }
export interface KnowledgeRemoveRequest { target: KnowledgeLibraryTarget; sourceId: string; version: number; employeeVersion?: number }
export interface KnowledgeRemoveResult {
  library: KnowledgeLibraryView;
  removedSourceId: string;
  /** Present when removal also changed a persisted employee configuration source. */
  employee?: EmployeeTemplate | ProjectEmployee;
}
export interface KnowledgeArchivePolicyRequest extends KnowledgeArchivePolicyChange { target: KnowledgeLibraryTarget }
export type KnowledgeUploadInput = KnowledgeUploadRequest;
export interface KnowledgeDocumentResponse { document: KnowledgeSource | KnowledgeEntry }
