import type { ModelModule } from '../domain/types.js';
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
}
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
  createdAt: string;
  /** Model synthesis remains candidate knowledge, even with accepted inputs. */
  status: 'candidate';
}
export interface KnowledgeCompileRequest {
  space: KnowledgeSpace;
  sources: KnowledgeSource[];
  previous?: KnowledgeSnapshot;
  model: ModelModule;
  signal: AbortSignal;
}
export type KnowledgeCompiler = (request: KnowledgeCompileRequest) => Promise<KnowledgeCompilation>;
