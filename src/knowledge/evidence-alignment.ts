import { isDeepStrictEqual } from 'node:util';
import type { KnowledgeCitation, KnowledgeCompilation, KnowledgeSource } from './types.js';

export interface GraphEvidenceAlignmentIssue {
  itemType: 'concept' | 'relation';
  itemId: string;
  label: string;
  citation: KnowledgeCitation;
  entryIds: string[];
  knowledgeReferences: Array<{ entryId: string; citations: KnowledgeCitation[] }>;
}

/** A narrowly repairable containment error; invalid A evidence is never repairable here. */
export function graphEvidenceAlignmentIssues(compilation: KnowledgeCompilation, sources: KnowledgeSource[], retained: KnowledgeCompilation): GraphEvidenceAlignmentIssue[] {
  const graph = compilation.conceptGraph;
  if (!graph) return [];
  const sourceById = new Map(sources.map(source => [source.id, source]));
  const entries = new Map(compilation.entries.map(entry => [entry.id, entry]));
  const validCitation = (citation: KnowledgeCitation): void => {
    const source = sourceById.get(citation.sourceId);
    const lines = source?.text.split('\n');
    if (!source || source.version !== citation.sourceVersion || !Number.isSafeInteger(citation.startLine) || !Number.isSafeInteger(citation.endLine) || citation.startLine < 1 || citation.endLine < citation.startLine || !lines || citation.endLine > lines.length) throw new Error('Knowledge citation line range or source version is invalid');
    if (!lines.slice(citation.startLine - 1, citation.endLine).join('\n').trim()) throw new Error('Knowledge citation contains no evidence');
  };
  // Preflight every A reference before deciding whether an alignment retry is allowed.
  for (const item of [...compilation.entries, ...graph.concepts, ...graph.relations]) {
    if (!Array.isArray(item.citations) || !item.citations.length) throw new Error('Knowledge source references are required');
    item.citations.forEach(validCitation);
  }
  const retainedIds = new Set([...(retained.conceptGraph?.concepts ?? []), ...(retained.conceptGraph?.relations ?? [])].map(item => item.id));
  const issues: GraphEvidenceAlignmentIssue[] = [];
  for (const [itemType, items] of [['concept', graph.concepts], ['relation', graph.relations]] as const) {
    for (const item of items) {
      if (!Array.isArray(item.entryIds) || !item.entryIds.length || item.entryIds.some(id => !entries.has(id))) throw new Error('Graph has a dangling knowledge reference');
      for (const citation of item.citations) {
        const supported = item.entryIds.some(id => entries.get(id)!.citations.some(reference => reference.sourceId === citation.sourceId && reference.sourceVersion === citation.sourceVersion && reference.startLine <= citation.startLine && reference.endLine >= citation.endLine));
        if (supported) continue;
        if (retainedIds.has(item.id)) throw new Error('原有知识的图谱引用范围不覆盖，不能通过本次增量修正');
        issues.push({ itemType, itemId: item.id, label: 'name' in item ? item.name : item.predicate, citation: { ...citation }, entryIds: [...item.entryIds], knowledgeReferences: item.entryIds.map(entryId => ({ entryId, citations: entries.get(entryId)!.citations.map(reference => ({ ...reference })) })) });
      }
    }
  }
  return issues;
}

/** A correction may align evidence, but may not erase graph items or rewrite semantics. */
export function assertEvidenceAlignmentRepairScope(original: KnowledgeCompilation, repaired: KnowledgeCompilation): void {
  const shape = (value: KnowledgeCompilation) => ({
    entries: new Map(value.entries.map(({ citations: _citations, ...entry }) => [entry.id, entry])),
    overview: new Map(value.overview.map(item => [item.id, item])),
    concepts: new Map((value.conceptGraph?.concepts ?? []).map(({ entryIds: _entryIds, citations: _citations, ...item }) => [item.id, item])),
    relations: new Map((value.conceptGraph?.relations ?? []).map(({ entryIds: _entryIds, citations: _citations, ...item }) => [item.id, item])),
  });
  if (!isDeepStrictEqual(shape(original), shape(repaired))) throw new Error('证据对齐修正超出引用范围或删改知识内容，保留上一版知识');
}
