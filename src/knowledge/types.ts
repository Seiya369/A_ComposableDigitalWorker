import type { ModelModule } from '../domain/types.js';
import type { KnowledgeSourceCategory, KnowledgeSourceCategoryInput } from './library-api.js';

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
  /** A source's nature is separate from whether its claims have been verified. */
  category?: KnowledgeSourceCategoryInput;
  original?: { fileName: string; byteLength: number; sha256: string; storageId: string };
  extraction?: { format: 'pdf' | 'docx'; parser: string; warnings: string[]; pageCount?: number };
}
export interface KnowledgeSource extends KnowledgeInput {
  category?: KnowledgeSourceCategory;
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
export interface KnowledgeConcept {
  id: string;
  name: string;
  /** Entity pages require an explicit model classification; old nodes remain concepts. */
  kind?: 'entity' | 'concept';
  summary: string;
  aliases?: string[];
  entryIds: string[];
  citations: KnowledgeCitation[];
}
export interface KnowledgeRelation {
  id: string;
  sourceId: string;
  targetId: string;
  predicate: string;
  summary?: string;
  basis: 'explicit' | 'inferred';
  entryIds: string[];
  citations: KnowledgeCitation[];
}
export interface KnowledgeConceptGraph {
  schemaVersion: 1;
  concepts: KnowledgeConcept[];
  relations: KnowledgeRelation[];
}
export interface KnowledgeCompilation {
  entries: KnowledgeEntry[];
  overview: KnowledgeOverview[];
  /** Older publications remain readable without inventing conceptual relationships. */
  conceptGraph?: KnowledgeConceptGraph;
  compilationTrace?: KnowledgeCompilationTrace;
}
export interface KnowledgeSourceIdentity {
  id: string;
  version: number;
  hash: string;
  verified: boolean;
}
export interface KnowledgeCompilationTrace {
  revision: 'strict-incremental-v1';
  model?: { provider: string; model: string; reasoningEffort?: string };
  changedSourceIds: string[];
  removedSourceIds: string[];
  modelCalls: number;
  usage?: { reportedCalls: number; inputTokens: number; outputTokens: number; totalTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; reasoningTokens?: number };
}
export interface KnowledgeSnapshot extends KnowledgeCompilation {
  version: number;
  sourceFingerprint: string;
  createdAt: string;
  /** Model synthesis remains candidate knowledge, even with accepted inputs. */
  status: 'candidate';
  sourceManifest?: KnowledgeSourceIdentity[];
  compilationTrace?: KnowledgeCompilationTrace;
}
export interface KnowledgeCompileRequest {
  space: KnowledgeSpace;
  sources: KnowledgeSource[];
  previous?: KnowledgeSnapshot;
  model: ModelModule;
  signal: AbortSignal;
}
export interface KnowledgeCompiler {
  (request: KnowledgeCompileRequest): Promise<KnowledgeCompilation>;
  readonly conceptGraphVersion?: 1;
  readonly incrementalVersion?: 1;
}
