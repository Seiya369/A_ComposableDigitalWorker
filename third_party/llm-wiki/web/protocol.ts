/* SPDX-License-Identifier: GPL-3.0-only
 * Data-only bridge for the shared LLM Wiki web program.
 */
export const NAMESPACE = 'workforce-llm-wiki';
export const PROTOCOL_VERSION = 1;
export interface Citation { sourceId: string; sourceVersion: number; startLine: number; endLine: number }
export interface WikiPage {
  id: string; path: string; title: string; type: string; content: string; markdown: string;
  entryIds: string[]; citations: Citation[]; aliases?: string[]; links: string[];
}
export interface WikiNode { id: string; label: string; type: string; path: string; linkCount: number; community: number }
export interface WikiRelation { id: string; sourceId: string; targetId: string; predicate: string; summary?: string; basis: 'explicit' | 'inferred'; citations: Citation[]; entryIds: string[] }
export interface WikiEdge { id: string; source: string; target: string; weight: number; relations?: WikiRelation[] }
export interface WikiView {
  schemaVersion: 1; spaceId: string; version: number;
  status: { state: string; error?: string };
  pages: WikiPage[];
  graph: { kind: 'semantic'; nodes: WikiNode[]; edges: WikiEdge[]; communities: Array<{ id: number; nodeCount: number; topNodes: string[] }> };
}
export interface Theme { mode: 'light' | 'dark'; colors?: { background?: string; text?: string; border?: string } }
export interface Binding { channel: string; epoch: number; spaceId: string; version: number }
export interface SourcePreview { id: string; version: number; title: string; text: string }
export interface ParentUpdate {
  namespace: typeof NAMESPACE; protocolVersion: 1; type: 'init' | 'update'; channel: string; epoch: number;
  view: WikiView; theme: Theme; locale?: 'zh' | 'en'; rebuilding: boolean; canRebuild: boolean;
}
export interface SourceResponse extends Binding {
  namespace: typeof NAMESPACE; protocolVersion: 1; type: 'source-response'; requestId: string;
  citation: Citation; source?: SourcePreview; error?: string;
}
export function validCitation(value: unknown): value is Citation {
  if (!value || typeof value !== 'object') return false;
  const c = value as Citation;
  return typeof c.sourceId === 'string' && c.sourceId.length > 0 && c.sourceId.length < 512
    && Number.isSafeInteger(c.sourceVersion) && c.sourceVersion > 0
    && Number.isSafeInteger(c.startLine) && c.startLine > 0
    && Number.isSafeInteger(c.endLine) && c.endLine >= c.startLine;
}
export function bindingMatches(message: Partial<Binding>, binding: Binding): boolean {
  return message.channel === binding.channel && message.epoch === binding.epoch
    && message.spaceId === binding.spaceId && message.version === binding.version;
}
export function isSemanticType(type: string): boolean { return type === 'concept' || type === 'entity'; }

/** Keep reading pages separate from the semantic canvas, including its fallback. */
export function semanticGraphForDisplay(view: WikiView): WikiView['graph'] {
  const pages = new Map(view.pages.filter(page => isSemanticType(page.type)).map(page => [page.id, page]));
  const nodes = view.graph.nodes.filter(node => isSemanticType(node.type) && pages.get(node.id)?.type === node.type);
  const ids = new Set(nodes.map(node => node.id));
  const edges = view.graph.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target) && edge.source !== edge.target).flatMap(edge => {
    const relations = edge.relations?.filter(relation => relation && typeof relation.predicate === 'string' && relation.predicate.trim()
      && ((relation.sourceId === edge.source && relation.targetId === edge.target) || (relation.sourceId === edge.target && relation.targetId === edge.source))
      && (relation.basis === 'explicit' || relation.basis === 'inferred')
      && Array.isArray(relation.citations) && relation.citations.length > 0 && relation.citations.every(validCitation)
      && Array.isArray(relation.entryIds) && relation.entryIds.length > 0) ?? [];
    return relations.length ? [{ ...edge, weight: relations.length, relations }] : [];
  });
  const degrees = new Map(nodes.map(node => [node.id, 0]));
  for (const edge of edges) for (const id of [edge.source, edge.target]) degrees.set(id, degrees.get(id)! + edge.relations.length);
  const communities = view.graph.communities.flatMap(community => {
    const members = nodes.filter(node => node.community === community.id);
    const labels = new Set(members.map(node => node.label));
    return members.length ? [{ ...community, nodeCount: members.length, topNodes: community.topNodes.filter(label => labels.has(label)) }] : [];
  });
  return { kind: 'semantic', nodes: nodes.map(node => ({ ...node, linkCount: degrees.get(node.id)! })), edges, communities };
}
export function isParentUpdate(value: unknown): value is ParentUpdate {
  if (!value || typeof value !== 'object') return false;
  const v = value as ParentUpdate;
  return v.namespace === NAMESPACE && v.protocolVersion === PROTOCOL_VERSION && ['init', 'update'].includes(v.type)
    && typeof v.channel === 'string' && v.channel.length >= 16 && v.channel.length <= 128
    && Number.isSafeInteger(v.epoch) && v.epoch >= 0 && v.view?.schemaVersion === 1
    && typeof v.view.spaceId === 'string' && Number.isSafeInteger(v.view.version)
    && Array.isArray(v.view.pages) && v.view.graph?.kind === 'semantic'
    && Array.isArray(v.view.graph.nodes) && Array.isArray(v.view.graph.edges) && Array.isArray(v.view.graph.communities)
    && ['light', 'dark'].includes(v.theme?.mode) && (v.locale === undefined || v.locale === 'zh' || v.locale === 'en');
}
