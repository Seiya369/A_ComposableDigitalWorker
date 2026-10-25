import type { KnowledgeCitation, KnowledgeSnapshot, KnowledgeSource } from './types.js';
import type { KnowledgeLibraryStatus } from './library-api.js';

/** Data-only boundary to the separately licensed, shared LLM Wiki program. */
export interface WikiPage {
  id: string;
  path: string;
  title: string;
  type: 'entity' | 'concept' | 'source' | 'overview' | 'synthesis';
  content: string;
  markdown: string;
  entryIds: string[];
  citations: KnowledgeCitation[];
  aliases?: string[];
  links: string[];
}
export interface WikiNode { id: string; label: string; type: string; path: string; linkCount: number; community: number }
export interface WikiEdge {
  id: string;
  source: string;
  target: string;
  weight: number;
  relations?: Array<{ id: string; sourceId: string; targetId: string; predicate: string; summary?: string; basis: 'explicit' | 'inferred'; citations: KnowledgeCitation[]; entryIds: string[] }>;
}
export interface WikiCommunity { id: number; nodeCount: number; cohesion: number; meanIntraDegree: number; topNodes: string[] }
export interface WikiLibraryView {
  schemaVersion: 1;
  engine: { name: 'llm_wiki'; version: string; revision: string };
  spaceId: string;
  version: number;
  status: KnowledgeLibraryStatus;
  pages: WikiPage[];
  /** Reading pages are complete; the main graph contains only semantic objects. */
  graph: { kind?: 'semantic'; nodes: WikiNode[]; edges: WikiEdge[]; communities: WikiCommunity[] };
}
export interface WikiBuildRequest { spaceId: string; snapshot: KnowledgeSnapshot; sources: KnowledgeSource[] }
export interface WikiAnalysisRequest { purpose: string; index: string; sourceContent: string; schema: string }
export interface WikiRuntime {
  build(request: WikiBuildRequest, signal?: AbortSignal): Promise<Omit<WikiLibraryView, 'status'>>;
  analysisPrompt(request: WikiAnalysisRequest, signal?: AbortSignal): Promise<string>;
  dispose(): Promise<void>;
}
