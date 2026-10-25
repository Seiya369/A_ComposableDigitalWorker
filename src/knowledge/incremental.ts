import { createHash } from 'node:crypto';
import type { KnowledgeCitation, KnowledgeCompilation, KnowledgeConcept, KnowledgeEntry, KnowledgeRelation, KnowledgeSnapshot, KnowledgeSource, KnowledgeSourceIdentity } from './types.js';

export interface KnowledgeDependencySource {
  id: string;
  version: number;
  title: string;
  /** Source nature is preserved for conflict review; verification is not authorization. */
  category: NonNullable<KnowledgeSource['category']>;
  provenance: string;
  verified: boolean;
  lineCount: number;
  excerpts: Array<{ startLine: number; endLine: number; text: string }>;
}
export interface KnowledgeConceptAnchor {
  id: string;
  name: string;
  kind?: 'entity' | 'concept';
  aliases?: string[];
}
export interface IncrementalKnowledgePlan {
  changedSources: KnowledgeSource[];
  removedSourceIds: string[];
  /** Whole obsolete objects, never old prose with its citations clipped away. */
  affected: KnowledgeCompilation;
  retained: KnowledgeCompilation;
  dependencySources: KnowledgeDependencySource[];
  anchors: KnowledgeConceptAnchor[];
  relatedEntries: Array<Pick<KnowledgeEntry, 'id' | 'title' | 'citations'>>;
  relatedRelations: Array<Pick<KnowledgeRelation, 'id' | 'sourceId' | 'targetId' | 'predicate' | 'basis'>>;
  sourceManifest: KnowledgeSourceIdentity[];
  sourceFingerprint: string;
  baseVersion?: number;
  needsModel: boolean;
}

const normalized = (value: string): string => value.normalize('NFKC').trim().toLocaleLowerCase();
const sourceIdentity = ({ id, version, hash, verified }: KnowledgeSource): KnowledgeSourceIdentity => ({ id, version, hash, verified });
const sourceOrder = (left: { id: string }, right: { id: string }): number => left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
const fingerprint = (sources: KnowledgeSource[]): string => createHash('sha256').update(JSON.stringify([...sources].sort(sourceOrder).map(source => [source.id, source.version, source.hash, source.verified]))).digest('hex');
const graph = (value?: KnowledgeCompilation) => value?.conceptGraph ?? { schemaVersion: 1 as const, concepts: [], relations: [] };
const compilation = (value?: KnowledgeCompilation): KnowledgeCompilation => ({ entries: value?.entries ?? [], overview: value?.overview ?? [], ...(value?.conceptGraph ? { conceptGraph: value.conceptGraph } : {}) });
const empty = (): KnowledgeCompilation => ({ entries: [], overview: [], conceptGraph: { schemaVersion: 1, concepts: [], relations: [] } });
const citationsOf = (value?: KnowledgeCompilation): KnowledgeCitation[] => value ? [...value.entries.flatMap(item => item.citations), ...graph(value).concepts.flatMap(item => item.citations), ...graph(value).relations.flatMap(item => item.citations)] : [];
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const sameIdentity = (left: KnowledgeSourceIdentity, right: KnowledgeSourceIdentity): boolean => left.version === right.version && left.hash === right.hash && left.verified === right.verified;

/** Matching runs locally. No full existing index or unrelated article goes to the model. */
function containsName(text: string, name: string): boolean {
  const needle = normalized(name);
  if (!needle) return false;
  let offset = text.indexOf(needle);
  while (offset !== -1) {
    const first = needle[0]!; const last = needle[needle.length - 1]!;
    const before = text[offset - 1] ?? ''; const after = text[offset + needle.length] ?? '';
    // ASCII identifiers are words; CJK names commonly appear without spaces.
    if ((!/[a-z0-9_]/.test(first) || !/[a-z0-9_]/.test(before)) && (!/[a-z0-9_]/.test(last) || !/[a-z0-9_]/.test(after))) return true;
    offset = text.indexOf(needle, offset + 1);
  }
  return false;
}

/** Source-level delta with a transitive, evidence-bound invalidation frontier. */
export function planIncrementalKnowledge(sources: KnowledgeSource[], previous?: KnowledgeSnapshot): IncrementalKnowledgePlan {
  const active = new Map(sources.map(source => [source.id, source]));
  check(active.size === sources.length, 'Incremental knowledge sources contain duplicate IDs');
  const sourceFingerprint = fingerprint(sources);
  const sourceManifest = [...sources].sort(sourceOrder).map(sourceIdentity);
  const oldCitations = citationsOf(previous);
  const old = new Map<string, KnowledgeSourceIdentity>();
  if (previous?.sourceManifest) {
    for (const identity of previous.sourceManifest) {
      check(!old.has(identity.id), 'Incremental source manifest contains duplicate IDs');
      old.set(identity.id, identity);
    }
    for (const citation of oldCitations) check(old.get(citation.sourceId)?.version === citation.sourceVersion, 'Previous knowledge evidence disagrees with its source manifest');
  } else if (previous?.sourceFingerprint === sourceFingerprint) {
    for (const identity of sourceManifest) old.set(identity.id, identity);
  } else if (previous) {
    // A legacy snapshot only proves that its explicitly cited A versions were read.
    for (const citation of oldCitations) {
      const known = old.get(citation.sourceId);
      check(!known || known.version === citation.sourceVersion, 'Previous knowledge contains conflicting source versions');
      const current = active.get(citation.sourceId);
      old.set(citation.sourceId, current?.version === citation.sourceVersion ? sourceIdentity(current) : { id: citation.sourceId, version: citation.sourceVersion, hash: '', verified: false });
    }
  }
  const changedIds = new Set(sources.filter(source => !old.has(source.id) || !sameIdentity(old.get(source.id)!, sourceIdentity(source))).map(source => source.id));
  for (const citation of oldCitations) if (active.has(citation.sourceId) && active.get(citation.sourceId)!.version !== citation.sourceVersion) changedIds.add(citation.sourceId);
  const changedSources = sources.filter(source => changedIds.has(source.id));
  const removedSourceIds = [...old.keys()].filter(id => !active.has(id)).sort();
  const invalid = (citations: KnowledgeCitation[]): boolean => citations.some(citation => changedIds.has(citation.sourceId) || active.get(citation.sourceId)?.version !== citation.sourceVersion);
  const oldGraph = graph(previous);
  const affectedEntries = new Set((previous?.entries ?? []).filter(item => invalid(item.citations)).map(item => item.id));
  const affectedConcepts = new Set(oldGraph.concepts.filter(item => invalid(item.citations) || item.entryIds.some(id => affectedEntries.has(id))).map(item => item.id));
  const affectedRelations = new Set(oldGraph.relations.filter(item => invalid(item.citations) || item.entryIds.some(id => affectedEntries.has(id)) || affectedConcepts.has(item.sourceId) || affectedConcepts.has(item.targetId)).map(item => item.id));
  const affectedOverview = new Set((previous?.overview ?? []).filter(item => item.entryIds.some(id => affectedEntries.has(id))).map(item => item.id));
  const affected: KnowledgeCompilation = {
    entries: (previous?.entries ?? []).filter(item => affectedEntries.has(item.id)),
    overview: (previous?.overview ?? []).filter(item => affectedOverview.has(item.id)),
    conceptGraph: { schemaVersion: 1, concepts: oldGraph.concepts.filter(item => affectedConcepts.has(item.id)), relations: oldGraph.relations.filter(item => affectedRelations.has(item.id)) },
  };
  const retained: KnowledgeCompilation = previous ? {
    entries: previous.entries.filter(item => !affectedEntries.has(item.id)),
    overview: previous.overview.filter(item => !affectedOverview.has(item.id)),
    ...(previous.conceptGraph ? { conceptGraph: { schemaVersion: 1, concepts: oldGraph.concepts.filter(item => !affectedConcepts.has(item.id)), relations: oldGraph.relations.filter(item => !affectedRelations.has(item.id)) } } : {}),
  } : empty();
  const text = normalized(changedSources.map(source => `${source.title}\n${source.text}`).join('\n\n'));
  const relatedEntryIds = new Set<string>();
  const anchorIds = new Set<string>();
  for (const concept of graph(retained).concepts) {
    if ([concept.name, ...(concept.aliases ?? [])].some(name => containsName(text, name))) {
      anchorIds.add(concept.id);
      concept.entryIds.forEach(id => relatedEntryIds.add(id));
    }
  }
  for (const entry of retained.entries) if (containsName(text, entry.title)) relatedEntryIds.add(entry.id);
  for (const item of [...affected.overview, ...graph(affected).concepts, ...graph(affected).relations]) item.entryIds.forEach(id => relatedEntryIds.add(id));
  for (const relation of graph(affected).relations) { anchorIds.add(relation.sourceId); anchorIds.add(relation.targetId); }
  for (const concept of graph(retained).concepts) if (concept.entryIds.some(id => relatedEntryIds.has(id))) anchorIds.add(concept.id);
  const anchors = graph(retained).concepts.filter(item => anchorIds.has(item.id)).map(({ id, name, kind, aliases }) => ({ id, name, ...(kind ? { kind } : {}), ...(aliases ? { aliases } : {}) }));
  const relatedEntries = retained.entries.filter(item => relatedEntryIds.has(item.id)).map(({ id, title, citations }) => ({ id, title, citations }));
  const suppliedAnchorIds = new Set(anchors.map(item => item.id));
  const relatedRelations = graph(retained).relations.filter(item => suppliedAnchorIds.has(item.sourceId) && suppliedAnchorIds.has(item.targetId)).map(({ id, sourceId, targetId, predicate, basis }) => ({ id, sourceId, targetId, predicate, basis }));
  check(anchors.length <= 100 && relatedEntries.length <= 200, 'Incremental knowledge dependency frontier is too large; split the changed sources instead of sending the entire library');
  check(relatedRelations.length <= 300, 'Incremental knowledge related relation frontier is too large; split the update');
  const dependencies = new Map<string, Array<{ startLine: number; endLine: number }>>();
  const dependencyCitations = [...citationsOf(affected), ...relatedEntries.flatMap(item => item.citations), ...graph(retained).concepts.filter(item => anchorIds.has(item.id)).flatMap(item => item.citations)];
  for (const citation of dependencyCitations) {
    const current = active.get(citation.sourceId);
    if (!current || changedIds.has(current.id) || current.version !== citation.sourceVersion) continue;
    const lineCount = current.text.split('\n').length;
    check(Number.isSafeInteger(citation.startLine) && Number.isSafeInteger(citation.endLine) && citation.startLine > 0 && citation.endLine >= citation.startLine && citation.endLine <= lineCount, 'Incremental dependency has an invalid evidence range');
    const ranges = dependencies.get(current.id) ?? [];
    ranges.push({ startLine: citation.startLine, endLine: citation.endLine }); dependencies.set(current.id, ranges);
  }
  const dependencySources = [...dependencies].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([id, ranges]) => {
    const source = active.get(id)!; const lines = source.text.split('\n');
    const merged: Array<{ startLine: number; endLine: number }> = [];
    for (const range of ranges.sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine)) {
      const last = merged[merged.length - 1];
      if (last && range.startLine <= last.endLine + 1) last.endLine = Math.max(last.endLine, range.endLine);
      else merged.push({ ...range });
    }
    return { id, version: source.version, title: source.title, category: source.category ?? 'reference', provenance: source.provenance, verified: source.verified, lineCount: lines.length, excerpts: merged.map(range => ({ ...range, text: lines.slice(range.startLine - 1, range.endLine).join('\n') })) };
  });
  check(dependencySources.reduce((count, source) => count + source.excerpts.length, 0) <= 1_000, 'Incremental knowledge has too many dependency excerpts; split the update');
  check(Buffer.byteLength(JSON.stringify({ changedSources, affected, dependencySources, anchors, relatedEntries, relatedRelations })) <= 2_000_000, 'Incremental knowledge update exceeds its dependency budget; split the update');
  const changed = changedSources.length > 0 || removedSourceIds.length > 0 || affected.entries.length > 0 || affected.overview.length > 0 || graph(affected).concepts.length > 0 || graph(affected).relations.length > 0;
  return { changedSources, removedSourceIds, affected, retained: !changed && previous ? compilation(previous) : retained, dependencySources, anchors, relatedEntries, relatedRelations, sourceManifest, sourceFingerprint, ...(previous ? { baseVersion: previous.version } : {}), needsModel: changedSources.length > 0 || (changed && dependencySources.length > 0) };
}

function validateDeltaEvidence(plan: IncrementalKnowledgePlan, delta: KnowledgeCompilation): void {
  const changed = new Map(plan.changedSources.map(source => [source.id, source]));
  const dependencies = new Map(plan.dependencySources.map(source => [source.id, source]));
  for (const citation of citationsOf(delta)) {
    const current = changed.get(citation.sourceId);
    const dependency = dependencies.get(citation.sourceId);
    check(Number.isSafeInteger(citation.startLine) && Number.isSafeInteger(citation.endLine) && citation.startLine > 0 && citation.endLine >= citation.startLine, 'Incremental delta has an invalid evidence range');
    check(current ? current.version === citation.sourceVersion && citation.endLine <= current.text.split('\n').length : dependency?.version === citation.sourceVersion && dependency.excerpts.some(excerpt => citation.startLine >= excerpt.startLine && citation.endLine <= excerpt.endLine), 'Incremental delta cites evidence outside its supplied changed sources or dependency excerpts');
  }
}

/** Merge a bounded patch; retained prose and evidence can never be rewritten by the model. */
export function mergeIncrementalKnowledge(plan: IncrementalKnowledgePlan, delta: KnowledgeCompilation): KnowledgeCompilation {
  if (!plan.needsModel) return { ...plan.retained, compilationTrace: { revision: 'strict-incremental-v1', changedSourceIds: plan.changedSources.map(source => source.id), removedSourceIds: plan.removedSourceIds, modelCalls: 0 } };
  check(delta && Array.isArray(delta.entries) && Array.isArray(delta.overview), 'Incremental knowledge delta is incomplete');
  check(delta.conceptGraph === undefined || (delta.conceptGraph.schemaVersion === 1 && Array.isArray(delta.conceptGraph.concepts) && Array.isArray(delta.conceptGraph.relations)), 'Incremental knowledge delta graph is incomplete');
  const allowedEntryIds = new Set([...delta.entries.map(item => item.id), ...plan.relatedEntries.map(item => item.id)]);
  for (const item of [...delta.overview, ...graph(delta).concepts, ...graph(delta).relations]) check(Array.isArray(item.entryIds) && item.entryIds.every(id => allowedEntryIds.has(id)), 'Incremental delta references a knowledge entry outside its provided frontier');
  const allowedConceptIds = new Set([...graph(delta).concepts.map(item => item.id), ...plan.anchors.map(item => item.id)]);
  for (const relation of graph(delta).relations) check(allowedConceptIds.has(relation.sourceId) && allowedConceptIds.has(relation.targetId), 'Incremental delta references a concept endpoint outside its provided frontier');
  validateDeltaEvidence(plan, delta);
  const namespace = createHash('sha256').update(JSON.stringify([plan.sourceFingerprint, [...plan.changedSources].sort(sourceOrder).map(sourceIdentity), plan.removedSourceIds])).digest('hex').slice(0, 12);
  const assignedId = (kind: string, id: string, affected: Set<string>): string => {
    check(typeof id === 'string' && /^[\p{L}\p{N}][\p{L}\p{N}._:-]{0,199}$/u.test(id), 'Incremental delta contains an invalid knowledge ID');
    // Models need only the local frontier. New IDs cannot require a full-library
    // ID inventory merely to avoid a generic "entry" or "overview" collision.
    return plan.baseVersion === undefined || affected.has(id) ? id : `delta-${namespace}-${kind}-${createHash('sha256').update(id).digest('hex').slice(0, 20)}`;
  };
  const affectedEntryIds = new Set(plan.affected.entries.map(item => item.id));
  const affectedOverviewIds = new Set(plan.affected.overview.map(item => item.id));
  const affectedConceptIds = new Set(graph(plan.affected).concepts.map(item => item.id));
  const affectedRelationIds = new Set(graph(plan.affected).relations.map(item => item.id));
  const entryRemap = new Map<string, string>();
  const entries = delta.entries.map(item => {
    check(!entryRemap.has(item.id), 'Incremental delta contains duplicate knowledge entry IDs');
    const id = assignedId('entry', item.id, affectedEntryIds); entryRemap.set(item.id, id);
    return id === item.id ? item : { ...item, id };
  });
  const entryIds = (ids: string[]): string[] => ids.map(id => entryRemap.get(id) ?? id);
  const overviewIds = new Set<string>();
  const overviews = delta.overview.map(item => {
    check(!overviewIds.has(item.id), 'Incremental delta contains duplicate overview IDs'); overviewIds.add(item.id);
    return { ...item, id: assignedId('overview', item.id, affectedOverviewIds), entryIds: entryIds(item.entryIds) };
  });
  check(entries.every(item => !plan.retained.entries.some(kept => kept.id === item.id)), 'Incremental delta ID conflicts with retained knowledge');
  check(overviews.every(item => !plan.retained.overview.some(kept => kept.id === item.id)), 'Incremental delta ID conflicts with retained overview');
  const oldConcepts = [...graph(plan.retained).concepts, ...graph(plan.affected).concepts];
  const byId = new Map(oldConcepts.map(item => [item.id, item]));
  const byName = new Map<string, string>();
  for (const concept of oldConcepts) for (const name of [concept.name, ...(concept.aliases ?? [])]) {
    const key = normalized(name); const existing = byName.get(key);
    check(!existing || existing === concept.id, 'Previous knowledge contains ambiguous concept names'); byName.set(key, concept.id);
  }
  const retainedConcepts = new Map(graph(plan.retained).concepts.map(item => [item.id, item]));
  const deltaEntryIds = new Set(entries.map(item => item.id));
  const remap = new Map<string, string>();
  const additions = new Map<string, KnowledgeConcept>();
  const newNames = new Map<string, string>();
  for (const original of graph(delta).concepts) {
    const candidate = { ...original, entryIds: entryIds(original.entryIds) };
    assignedId('concept', candidate.id, affectedConceptIds); // Validate even when reusing an existing canonical name.
    check(!remap.has(candidate.id), 'Incremental delta contains duplicate concept IDs');
    const names = [candidate.name, ...(candidate.aliases ?? [])].map(normalized);
    const targets = new Set(names.flatMap(name => byName.has(name) ? [byName.get(name)!] : []));
    if (byId.has(candidate.id)) targets.add(candidate.id);
    check(targets.size <= 1, 'Incremental concept aliases ambiguously join different existing concepts');
    const canonical = [...targets][0] ?? assignedId('concept', candidate.id, affectedConceptIds);
    remap.set(candidate.id, canonical);
    const kept = retainedConcepts.get(canonical);
    if (kept) {
      check(names.some(name => byName.get(name) === canonical), 'Incremental delta cannot redefine a retained concept');
      check(candidate.kind === undefined || kept.kind === undefined || candidate.kind === kept.kind, 'Incremental delta conflicts with a retained concept kind');
      check(candidate.entryIds.every(id => kept.entryIds.includes(id) || deltaEntryIds.has(id)), 'Incremental delta may only append new knowledge links to a retained concept');
      const entryIds = [...kept.entryIds, ...candidate.entryIds.filter(id => !kept.entryIds.includes(id))];
      retainedConcepts.set(canonical, entryIds.length === kept.entryIds.length ? kept : { ...kept, entryIds: [...new Set(entryIds)] });
      continue;
    }
    check(!additions.has(canonical), 'Incremental delta contains duplicate canonical concepts; merge synonymous concepts');
    for (const name of names) {
      const existing = newNames.get(name);
      check(!existing || existing === canonical, 'Incremental delta contains ambiguous new concept names'); newNames.set(name, canonical);
    }
    additions.set(canonical, candidate.id === canonical ? candidate : { ...candidate, id: canonical });
  }
  const retainedRelations = graph(plan.retained).relations;
  const relationKey = (item: { sourceId: string; targetId: string; predicate: string }): string => JSON.stringify([item.sourceId, item.targetId, normalized(item.predicate)]);
  const retainedRelationKeys = new Set(retainedRelations.map(relationKey));
  const relationIds = new Set<string>();
  const relations = graph(delta).relations.map(relation => {
    check(!relationIds.has(relation.id), 'Incremental delta contains duplicate relation IDs'); relationIds.add(relation.id);
    const mapped = { ...relation, id: assignedId('relation', relation.id, affectedRelationIds), sourceId: remap.get(relation.sourceId) ?? relation.sourceId, targetId: remap.get(relation.targetId) ?? relation.targetId, entryIds: entryIds(relation.entryIds) };
    check(mapped.sourceId !== mapped.targetId, 'Incremental concept merging created a self-referential relation');
    check(!retainedRelationKeys.has(relationKey(mapped)), 'Incremental delta repeats a retained relation after concept canonicalization');
    return mapped;
  });
  return {
    entries: [...plan.retained.entries, ...entries],
    overview: [...plan.retained.overview, ...overviews],
    ...(plan.retained.conceptGraph || delta.conceptGraph ? { conceptGraph: { schemaVersion: 1, concepts: [...retainedConcepts.values(), ...additions.values()], relations: [...retainedRelations, ...relations] } } : {}),
  };
}
