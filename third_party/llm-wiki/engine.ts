/** GPL-3.0 bridge around unmodified nashsu/llm_wiki graph modules. */
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { detectCommunities } from './upstream/lib/wiki-graph-analysis';
import { buildAnalysisPrompt } from './generated/analysis-prompt';
import type { WikiBuildRequest, WikiPage, WikiEdge, WikiNode, WikiAnalysisRequest, WikiLibraryView } from '../../src/knowledge/wiki-types.js';
import type { KnowledgeCitation } from '../../src/knowledge/types.js';

const ENGINE = { name: 'llm_wiki' as const, version: '0.6.13', revision: 'e08cfce65aad8b76b13546a081c1a8d4422b70c3' };
const MAX_BYTES = 16 * 1024 * 1024;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const string = (value: unknown, label: string): string => { if (typeof value !== 'string') throw new Error(`Invalid ${label}`); return value; };
const array = <T>(value: unknown, label: string): T[] => { if (!Array.isArray(value)) throw new Error(`Invalid ${label}`); return value as T[]; };
function object(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}`); return value as Record<string, unknown>; }
const unique = <T>(values: T[]) => [...new Set(values)];
const communityCache = new Map<string, ReturnType<typeof detectCommunities>>();
function semanticCommunities(nodes: WikiNode[], edges: WikiEdge[]): ReturnType<typeof detectCommunities> {
  // Louvain admits multiple solutions. Preserve a process-local choice when
  // only reading pages change, without changing upstream randomness or code.
  const key = digest(JSON.stringify({ nodes: nodes.map(node => [node.id, node.label, node.linkCount]), edges: edges.map(edge => [edge.source, edge.target, edge.weight]) }));
  let result = communityCache.get(key);
  if (result) communityCache.delete(key);
  else result = detectCommunities(nodes, edges);
  communityCache.set(key, result);
  if (communityCache.size > 16) communityCache.delete(communityCache.keys().next().value!);
  return { assignments: new Map(result.assignments), communities: result.communities.map(community => ({ ...community, topNodes: [...community.topNodes] })) };
}

export async function build(request: WikiBuildRequest): Promise<Omit<WikiLibraryView, 'status'>> {
  object(request, 'Wiki request');
  const spaceId = string(request.spaceId, 'space ID');
  if (!spaceId || spaceId.length > 4096) throw new Error('Invalid Wiki space ID');
  const snapshot = object(request.snapshot, 'snapshot') as unknown as WikiBuildRequest['snapshot'];
  if (!Number.isSafeInteger(snapshot.version) || snapshot.version < 0) throw new Error('Invalid snapshot version');
  const entries = array<WikiBuildRequest['snapshot']['entries'][number]>(snapshot.entries, 'entries');
  const overview = array<WikiBuildRequest['snapshot']['overview'][number]>(snapshot.overview, 'overview');
  const sources = array<WikiBuildRequest['sources'][number]>(request.sources, 'sources');
  if (entries.length > 2000 || sources.length > 2000 || overview.length > 2000) throw new Error('Wiki page limit exceeded');
  if (snapshot.conceptGraph && object(snapshot.conceptGraph, 'concept graph').schemaVersion !== 1) throw new Error('Invalid Wiki concept graph version');
  const concepts = snapshot.conceptGraph ? array<NonNullable<typeof snapshot.conceptGraph>['concepts'][number]>(snapshot.conceptGraph.concepts, 'concepts') : [];
  const relations = snapshot.conceptGraph ? array<NonNullable<typeof snapshot.conceptGraph>['relations'][number]>(snapshot.conceptGraph.relations, 'relations') : [];
  if (concepts.length > 500 || relations.length > 1500) throw new Error('Wiki graph limit exceeded');
  const id = (kind: string, value: string) => `p-${digest(`${spaceId}\0${kind}\0${value}`)}`;
  const sourceMap = new Map<string, typeof sources[number]>();
  for (const source of sources) {
    object(source, 'source'); string(source.id, 'source ID'); string(source.title, 'source title'); string(source.text, 'source text');
    if (!Number.isSafeInteger(source.version) || source.version < 1 || sourceMap.has(source.id)) throw new Error('Invalid or duplicate Wiki source');
    sourceMap.set(source.id, source);
  }
  const entryMap = new Map(entries.map(entry => [string(entry.id, 'entry ID'), entry]));
  const conceptMap = new Map(concepts.map(concept => [string(concept.id, 'concept ID'), concept]));
  if (entryMap.size !== entries.length || conceptMap.size !== concepts.length) throw new Error('Duplicate Wiki identity');
  function citations(value: KnowledgeCitation[]): KnowledgeCitation[] {
    return array<KnowledgeCitation>(value, 'citations').map(citation => {
      object(citation, 'citation');
      const source = sourceMap.get(citation.sourceId);
      if (!source || citation.sourceVersion !== source.version || !Number.isSafeInteger(citation.startLine) || !Number.isSafeInteger(citation.endLine) || citation.startLine < 1 || citation.endLine < citation.startLine || citation.endLine > source.text.split('\n').length) throw new Error('Wiki citation is outside the authorized sources');
      if (!source.text.split('\n').slice(citation.startLine - 1, citation.endLine).join('\n').trim()) throw new Error('Wiki citation contains no evidence');
      return { sourceId: citation.sourceId, sourceVersion: citation.sourceVersion, startLine: citation.startLine, endLine: citation.endLine };
    });
  }
  function entryIds(value: string[]): string[] { return unique(array<string>(value, 'entry links').map(value => { if (!entryMap.has(value)) throw new Error('Unknown Wiki article'); return value; })); }
  const entryEvidence = new Map(entries.map(entry => {
    const refs = citations(entry.citations);
    if (!refs.length) throw new Error('Wiki article requires source evidence');
    return [entry.id, refs];
  }));
  function graphEvidence(value: KnowledgeCitation[], linked: string[]): { refs: KnowledgeCitation[]; ids: string[] } {
    const refs = citations(value); const ids = entryIds(linked);
    if (!refs.length || !ids.length) throw new Error('Wiki semantic item requires article and source evidence');
    if (refs.some(ref => !ids.some(entryId => entryEvidence.get(entryId)!.some(articleRef => articleRef.sourceId === ref.sourceId && articleRef.sourceVersion === ref.sourceVersion && articleRef.startLine <= ref.startLine && articleRef.endLine >= ref.endLine)))) throw new Error('Wiki semantic evidence is not supported by its articles');
    return { refs, ids };
  }
  const pages: WikiPage[] = [];
  function page(kind: string, key: string, title: string, type: WikiPage['type'], content: string, linkedEntries: string[], refs: KnowledgeCitation[], links: string[], aliases?: string[]) {
    const pageId = id(kind, key);
    const safeLinks = unique(links).filter(target => target !== pageId);
    const citedSources = unique(refs.map(ref => id('source', ref.sourceId)));
    const metadata = ['---', `title: ${JSON.stringify(title)}`, `type: ${type}`, `sources: ${JSON.stringify(citedSources)}`, `related: ${JSON.stringify(safeLinks)}`, '---'].join('\n');
    const outgoing = safeLinks.length ? `\n\n${safeLinks.map(target => `[[${target}]]`).join(' · ')}` : '';
    const folder = { entity: 'entities', concept: 'concepts', source: 'sources', synthesis: 'synthesis', overview: '' }[type];
    pages.push({ id: pageId, path: type === 'overview' ? 'wiki/overview.md' : `wiki/${folder}/${pageId}.md`, title, type, content, markdown: `${metadata}\n${content}${outgoing}`, entryIds: linkedEntries, citations: refs, links: safeLinks, ...(aliases ? { aliases } : {}) });
  }
  const conceptLinks = new Map(concepts.map(concept => [concept.id, new Set<string>()]));
  const relationIds = new Set<string>();
  const relationKeys = new Set<string>();
  const edgeGroups = new Map<string, WikiEdge>();
  for (const relation of relations) {
    if (!conceptMap.has(relation.sourceId) || !conceptMap.has(relation.targetId)) throw new Error('Unknown Wiki relationship endpoint');
    if (relation.sourceId === relation.targetId) throw new Error('Wiki relationship cannot be self-referential');
    if (relation.basis !== 'explicit' && relation.basis !== 'inferred') throw new Error('Invalid Wiki relationship basis');
    const relationId = string(relation.id, 'relationship ID');
    const predicate = string(relation.predicate, 'relationship predicate');
    if (!relationId.trim() || !predicate.trim() || relationIds.has(relationId)) throw new Error('Invalid or duplicate Wiki relationship identity');
    relationIds.add(relationId);
    const relationKey = JSON.stringify([relation.sourceId, relation.targetId, predicate.normalize('NFKC').trim().toLocaleLowerCase()]);
    if (relationKeys.has(relationKey)) throw new Error('Duplicate Wiki semantic relationship');
    relationKeys.add(relationKey);
    const { refs, ids } = graphEvidence(relation.citations, relation.entryIds);
    const metadata: NonNullable<WikiEdge['relations']>[number] = { id: `r-${digest(`${spaceId}\0relation\0${relationId}`)}`, sourceId: id('concept', relation.sourceId), targetId: id('concept', relation.targetId), predicate, ...(relation.summary ? { summary: string(relation.summary, 'relationship summary') } : {}), basis: relation.basis, citations: refs, entryIds: ids };
    const [source, target] = [metadata.sourceId, metadata.targetId].sort();
    const pair = `${source}\0${target}`;
    let edge = edgeGroups.get(pair);
    if (!edge) { edge = { id: `e-${digest(pair)}`, source, target, weight: 0, relations: [] }; edgeGroups.set(pair, edge); }
    edge.relations!.push(metadata); edge.weight++;
    conceptLinks.get(relation.sourceId)!.add(id('concept', relation.targetId));
    conceptLinks.get(relation.targetId)!.add(id('concept', relation.sourceId));
  }
  for (const concept of concepts) {
    const { refs, ids } = graphEvidence(concept.citations, concept.entryIds);
    const aliases = concept.aliases?.map(alias => string(alias, 'concept alias'));
    if (concept.kind !== undefined && concept.kind !== 'entity' && concept.kind !== 'concept') throw new Error('Invalid Wiki concept kind');
    const type = (concept as typeof concept & { kind?: string }).kind === 'entity' ? 'entity' : 'concept';
    page('concept', concept.id, string(concept.name, 'concept name'), type, string(concept.summary, 'concept summary'), ids, refs, [...conceptLinks.get(concept.id)!, ...ids.map(value => id('entry', value)), ...refs.map(ref => id('source', ref.sourceId))], aliases);
  }
  for (const entry of entries) {
    const refs = entryEvidence.get(entry.id)!;
    const linkedConcepts = concepts.filter(concept => concept.entryIds.includes(entry.id)).map(concept => id('concept', concept.id));
    page('entry', entry.id, string(entry.title, 'entry title'), 'synthesis', string(entry.content, 'entry body'), [entry.id], refs, [...linkedConcepts, ...refs.map(ref => id('source', ref.sourceId))]);
  }
  for (const source of sources) {
    const refs = [{ sourceId: source.id, sourceVersion: source.version, startLine: 1, endLine: Math.max(1, source.text.split('\n').length) }];
    const linked = entries.filter(entry => entry.citations.some(ref => ref.sourceId === source.id && ref.sourceVersion === source.version)).map(entry => entry.id);
    page('source', source.id, source.title, 'source', source.text, linked, refs, [...linked.map(value => id('entry', value)), ...concepts.filter(concept => concept.citations.some(ref => ref.sourceId === source.id)).map(concept => id('concept', concept.id))]);
  }
  if (overview.length) {
    const ids = unique(overview.flatMap(item => entryIds(item.entryIds)));
    const body = overview.map(item => `## ${string(item.title, 'overview title')}\n\n${string(item.summary, 'overview body')}`).join('\n\n');
    page('overview', 'overview', '知识概览', 'overview', body, ids, [], ids.map(value => id('entry', value)));
  }
  const known = new Set(pages.map(page => page.id));
  if (known.size !== pages.length) throw new Error('Duplicate Wiki page');
  if (pages.some(page => page.links.some(link => !known.has(link)))) throw new Error('Unknown Wiki target');
  // Reader navigation stays in pages.links. The main graph has only the
  // explicitly supplied semantic concepts and relations, never document links.
  const edges = [...edgeGroups.values()].sort((left, right) => left.id.localeCompare(right.id));
  const degrees = new Map<string, number>();
  for (const edge of edges) {
    degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + edge.relations!.length);
    degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + edge.relations!.length);
  }
  const nodes: WikiNode[] = pages.filter(page => page.type === 'concept' || page.type === 'entity').map(page => ({ id: page.id, label: page.title, type: page.type, path: page.path, linkCount: degrees.get(page.id) ?? 0, community: 0 })).sort((left, right) => left.id.localeCompare(right.id));
  const { assignments, communities } = semanticCommunities(nodes, edges);
  for (const node of nodes) node.community = assignments.get(node.id) ?? 0;
  const graph = { kind: 'semantic' as const, nodes, edges, communities };
  return { schemaVersion: 1, engine: ENGINE, spaceId, version: snapshot.version, pages, graph };
}

export function analysisPrompt(request: WikiAnalysisRequest): string {
  object(request, 'analysis request');
  return buildAnalysisPrompt(string(request.purpose, 'purpose'), string(request.index, 'index'), string(request.sourceContent, 'source content'), string(request.schema, 'schema'));
}

async function daemon(): Promise<void> {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    let requestId: unknown;
    try {
      if (Buffer.byteLength(line, 'utf8') > MAX_BYTES) throw new Error('Wiki request size exceeded');
      const message = object(JSON.parse(line), 'message');
      requestId = string(message.id, 'request ID');
      const value = message.method === 'build' ? await build(message.request as unknown as WikiBuildRequest) : message.method === 'analysisPrompt' ? analysisPrompt(message.request as unknown as WikiAnalysisRequest) : (() => { throw new Error('Unknown Wiki method'); })();
      process.stdout.write(`${JSON.stringify({ id: requestId, ok: true, value })}\n`);
    } catch (error) { process.stdout.write(`${JSON.stringify({ id: requestId, ok: false, error: error instanceof Error ? error.message : 'Wiki engine failed' })}\n`); }
  }
}
void daemon();
