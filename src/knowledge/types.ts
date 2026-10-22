import type { KnowledgeOrganization, ModelModule } from '../domain/types.js';
import type { KnowledgeSourceCategory } from './categories.js';

/** A template and each project installation own detached knowledge spaces. */
export interface KnowledgeSpace {
  kind: 'template' | 'project';
  teamId: string;
  projectId?: string;
  /** Omitted for the team library; present for one member's private library. */
  memberId?: string;
}
export interface KnowledgeInput {
  id: string;
  title: string;
  content: string;
  provenance: string;
  verified: boolean;
  /** One primary source category; older callers default to reference material. */
  category?: KnowledgeSourceCategory;
  /** Why the source was assigned this category, without asserting its truth. */
  classificationReason?: string;
  /** Uploaded original bytes remain in A and are never model context. */
  originalFile?: KnowledgeOriginalFile;
}
export interface KnowledgeOriginalFile { name: string; mediaType: string; encoding: 'base64'; data: string; sha256: string }
export type KnowledgeUploadTarget =
  | { kind: 'template'; teamId: string; memberId: string; templateId: string }
  | { kind: 'project'; projectId: string; employeeId: string };
export interface KnowledgeUploadFile { name: string; mediaType?: string; base64: string }
export interface KnowledgeUploadedDocument { name: string; mediaType: string; content: string; originalFile: KnowledgeOriginalFile; parser: string }
export interface KnowledgeUploadResult { sourceId: string; title: string; version: number; category: 'reference'; status: 'archived'; compilation: 'pending' }
export interface KnowledgeUploadedSource { sourceId: string; title: string; version: number; category: KnowledgeSourceCategory; attachment: { name: string; mediaType: string; sha256: string; bytes: number } }
export interface KnowledgeSource extends KnowledgeInput {
  category: KnowledgeSourceCategory;
  version: number;
  hash: string;
  text: string;
  createdAt: string;
  processing: string[];
}
export interface KnowledgeCitation {
  sourceId: string;
  sourceVersion: number;
  startLine: number;
  endLine: number;
}
export interface KnowledgeEntry {
  /** Required for policy-bound publications; absent only on legacy snapshots. */
  categoryId?: string;
  id: string;
  title: string;
  content: string;
  citations: KnowledgeCitation[];
}
export interface KnowledgeOverview {
  id: string;
  title: string;
  summary: string;
  entryIds: string[];
}
export interface KnowledgeCompilation {
  entries: KnowledgeEntry[];
  overview: KnowledgeOverview[];
}
export interface KnowledgeSnapshot extends KnowledgeCompilation {
  version: number;
  sourceFingerprint: string;
  policyFingerprint?: string;
  policy?: KnowledgePolicy;
  createdAt: string;
  /** Model synthesis remains candidate knowledge, even with accepted inputs. */
  status: 'candidate';
}
export interface KnowledgePolicyTask {
  id: string; employeeId: string; title: string; goal: string; acceptanceCriteria: string[];
}
export interface KnowledgePolicy {
  version: 1;
  scope: 'team' | 'employee';
  profession: string;
  taskScope: string;
  conceptRules: string;
  categories: KnowledgeOrganization['categories'];
  roles: Array<{ memberId: string; mission: string; duties: string[]; boundaries: string[]; skills: Array<{ id: string; name: string; description: string }> }>;
  tasks: KnowledgePolicyTask[];
}
export interface KnowledgeCompileRequest {
  policy: KnowledgePolicy;
  space: KnowledgeSpace;
  sources: KnowledgeSource[];
  previous?: KnowledgeSnapshot;
  model: ModelModule;
  signal: AbortSignal;
}
export type KnowledgeCompiler = (request: KnowledgeCompileRequest) => Promise<KnowledgeCompilation>;
