import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import type { WikiRuntime, WikiBuildRequest, WikiAnalysisRequest, WikiLibraryView, WikiPage } from './wiki-types.js';

export interface WikiRuntimeOptions { enginePath?: string; timeoutMs?: number; nodePath?: string }
type BuiltWiki = Omit<WikiLibraryView, 'status'>;
export const LLM_WIKI_ENGINE = { name: 'llm_wiki' as const, version: '0.6.13', revision: 'e08cfce65aad8b76b13546a081c1a8d4422b70c3' };
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

function aborted(): Error { const error = new Error('Wiki request cancelled'); error.name = 'AbortError'; return error; }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid shared Wiki response');
  return value as Record<string, unknown>;
}
function sameJSON(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)])) : value;
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

/** Independently validate the fixed JSON reading-page contract; no GPL executable imports.
 * IDs bind space + record kind + original ID. Markdown is the exact title/type/
 * source/reading-link envelope around authorized A/B/C text, never child-authored prose.
 */
function expectedReadingPages(request: WikiBuildRequest): Map<string, WikiPage> {
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  const pageId = (kind: string, id: string) => `p-${hash(`${request.spaceId}\0${kind}\0${id}`)}`;
  const unique = <T>(values: T[]) => [...new Set(values)];
  const entries = request.snapshot.entries;
  const concepts = request.snapshot.conceptGraph?.concepts ?? [];
  type ReadingRecord = Omit<WikiPage, 'id' | 'path' | 'markdown'> & { kind: string; key: string };
  const definitions: ReadingRecord[] = concepts.map(concept => ({
    kind: 'concept', key: concept.id, type: concept.kind === 'entity' ? 'entity' : 'concept', title: concept.name, content: concept.summary,
    entryIds: unique(concept.entryIds), citations: concept.citations,
    links: [
      ...(request.snapshot.conceptGraph?.relations ?? []).flatMap(relation => relation.sourceId === concept.id ? [pageId('concept', relation.targetId)] : relation.targetId === concept.id ? [pageId('concept', relation.sourceId)] : []),
      ...unique(concept.entryIds).map(id => pageId('entry', id)), ...concept.citations.map(citation => pageId('source', citation.sourceId)),
    ], ...(concept.aliases ? { aliases: concept.aliases } : {}),
  }));
  for (const entry of entries) definitions.push({
    kind: 'entry', key: entry.id, type: 'synthesis', title: entry.title, content: entry.content, entryIds: [entry.id], citations: entry.citations,
    links: [...concepts.filter(concept => concept.entryIds.includes(entry.id)).map(concept => pageId('concept', concept.id)), ...entry.citations.map(citation => pageId('source', citation.sourceId))],
  });
  for (const source of request.sources) {
    const linkedEntries = entries.filter(entry => entry.citations.some(citation => citation.sourceId === source.id && citation.sourceVersion === source.version)).map(entry => entry.id);
    definitions.push({ kind: 'source', key: source.id, type: 'source', title: source.title, content: source.text, entryIds: linkedEntries,
      citations: [{ sourceId: source.id, sourceVersion: source.version, startLine: 1, endLine: Math.max(1, source.text.split('\n').length) }],
      links: [...linkedEntries.map(id => pageId('entry', id)), ...concepts.filter(concept => concept.citations.some(citation => citation.sourceId === source.id)).map(concept => pageId('concept', concept.id))],
    });
  }
  if (request.snapshot.overview.length) {
    const linkedEntries = unique(request.snapshot.overview.flatMap(item => item.entryIds));
    definitions.push({ kind: 'overview', key: 'overview', type: 'overview', title: '知识概览', content: request.snapshot.overview.map(item => `## ${item.title}\n\n${item.summary}`).join('\n\n'), entryIds: linkedEntries, citations: [], links: linkedEntries.map(id => pageId('entry', id)) });
  }
  const folders = { entity: 'entities', concept: 'concepts', source: 'sources', synthesis: 'synthesis', overview: '' };
  const result = new Map<string, WikiPage>();
  for (const { kind, key, ...definition } of definitions) {
    const id = pageId(kind, key);
    if (result.has(id)) throw new Error('Duplicate authorized Wiki reading identity');
    const links = unique(definition.links).filter(link => link !== id);
    const frontmatter = ['---', `title: ${JSON.stringify(definition.title)}`, `type: ${definition.type}`, `sources: ${JSON.stringify(unique(definition.citations.map(citation => pageId('source', citation.sourceId))))}`, `related: ${JSON.stringify(links)}`, '---'].join('\n');
    result.set(id, { ...definition, id, path: definition.type === 'overview' ? 'wiki/overview.md' : `wiki/${folders[definition.type]}/${id}.md`, links,
      markdown: `${frontmatter}\n${definition.content}${links.length ? `\n\n${links.map(link => `[[${link}]]`).join(' · ')}` : ''}` });
  }
  return result;
}
function verifyView(value: unknown, request: WikiBuildRequest): BuiltWiki {
  const view = record(value);
  const engine = record(view.engine);
  if (view.schemaVersion !== 1 || view.spaceId !== request.spaceId || view.version !== request.snapshot.version || engine.name !== 'llm_wiki' || engine.version !== '0.6.13' || engine.revision !== 'e08cfce65aad8b76b13546a081c1a8d4422b70c3') throw new Error('Shared Wiki response identity mismatch');
  if (!Array.isArray(view.pages) || view.pages.length > 6500) throw new Error('Invalid shared Wiki pages');
  const expectedPages = expectedReadingPages(request);
  if (view.pages.length !== expectedPages.size) throw new Error('Shared Wiki reading pages are incomplete');
  const ids = new Set<string>();
  const paths = new Map<string, string>();
  const usedPaths = new Set<string>();
  const pages = new Map<string, Record<string, unknown>>();
  const entries = new Set(request.snapshot.entries.map(entry => entry.id));
  const sources = new Map(request.sources.map(source => [source.id, source]));
  const validateReferences = (owner: Record<string, unknown>): void => {
    if (!Array.isArray(owner.entryIds) || owner.entryIds.some(id => typeof id !== 'string' || !entries.has(id)) || !Array.isArray(owner.citations)) throw new Error('Invalid shared Wiki article references');
    for (const rawCitation of owner.citations) {
      const citation = record(rawCitation);
      const source = sources.get(String(citation.sourceId));
      if (!source || citation.sourceVersion !== source.version || !Number.isSafeInteger(citation.startLine) || !Number.isSafeInteger(citation.endLine) || Number(citation.startLine) < 1 || Number(citation.endLine) < Number(citation.startLine) || Number(citation.endLine) > source.text.split('\n').length) throw new Error('Shared Wiki source reference is outside the authorized snapshot');
    }
  };
  for (const raw of view.pages) {
    const page = record(raw);
    if (typeof page.id !== 'string' || !/^p-[a-f0-9]{64}$/.test(page.id) || ids.has(page.id) || typeof page.path !== 'string' || !/^wiki\/(entities|concepts|sources|synthesis)\/p-[a-f0-9]{64}\.md$|^wiki\/overview\.md$/.test(page.path) || !['entity', 'concept', 'source', 'overview', 'synthesis'].includes(String(page.type)) || typeof page.title !== 'string' || typeof page.content !== 'string' || typeof page.markdown !== 'string' || !Array.isArray(page.entryIds) || !Array.isArray(page.citations) || !Array.isArray(page.links)) throw new Error('Invalid shared Wiki page');
    const expected = expectedPages.get(page.id);
    if (!expected || usedPaths.has(page.path) || !sameJSON(page, expected)) throw new Error('Shared Wiki reading page does not match its authorized snapshot');
    ids.add(page.id);
    usedPaths.add(page.path);
    paths.set(page.id, page.path);
    pages.set(page.id, page);
    validateReferences(page);
  }
  const graph = record(view.graph);
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  const pageId = (kind: string, id: string) => `p-${hash(`${request.spaceId}\0${kind}\0${id}`)}`;
  const concepts = new Map((request.snapshot.conceptGraph?.concepts ?? []).map(concept => [pageId('concept', concept.id), concept]));
  const expectedRelations = new Map((request.snapshot.conceptGraph?.relations ?? []).map(relation => [`r-${hash(`${request.spaceId}\0relation\0${relation.id}`)}`, relation]));
  if (graph.kind !== 'semantic' || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || !Array.isArray(graph.communities) || graph.nodes.length !== concepts.size || graph.edges.length > 1500) throw new Error('Invalid shared Wiki semantic graph');
  const graphIds = new Set<string>();
  const degrees = new Map<string, number>();
  const nodeCommunities = new Map<string, number>();
  for (const raw of graph.nodes) {
    const node = record(raw);
    const concept = concepts.get(String(node.id));
    const page = pages.get(String(node.id));
    const expectedType = concept?.kind === 'entity' ? 'entity' : 'concept';
    if (typeof node.id !== 'string' || !concept || !page || graphIds.has(node.id) || node.path !== paths.get(node.id) || node.label !== concept.name || node.type !== expectedType || page.type !== expectedType || !Number.isSafeInteger(node.linkCount) || Number(node.linkCount) < 0 || !Number.isSafeInteger(node.community) || Number(node.community) < 0) throw new Error('Invalid shared Wiki semantic node');
    graphIds.add(node.id);
    degrees.set(node.id, 0);
    nodeCommunities.set(node.id, Number(node.community));
  }
  const edgeIds = new Set<string>();
  const endpointPairs = new Set<string>();
  const relationIds = new Set<string>();
  for (const raw of graph.edges) {
    const edge = record(raw);
    const pair = [String(edge.source), String(edge.target)].sort().join('\0');
    if (typeof edge.id !== 'string' || edge.id !== `e-${hash(pair)}` || edgeIds.has(edge.id) || endpointPairs.has(pair) || !graphIds.has(String(edge.source)) || !graphIds.has(String(edge.target)) || edge.source === edge.target || !Array.isArray(edge.relations) || !edge.relations.length || edge.weight !== edge.relations.length) throw new Error('Invalid shared Wiki semantic edge');
    edgeIds.add(edge.id);
    endpointPairs.add(pair);
    degrees.set(String(edge.source), degrees.get(String(edge.source))! + edge.relations.length);
    degrees.set(String(edge.target), degrees.get(String(edge.target))! + edge.relations.length);
    for (const rawRelation of edge.relations) {
        const relation = record(rawRelation);
        const expected = expectedRelations.get(String(relation.id));
        if (!expected || typeof relation.id !== 'string' || relationIds.has(relation.id) || relation.sourceId !== pageId('concept', expected.sourceId) || relation.targetId !== pageId('concept', expected.targetId) || relation.sourceId === relation.targetId || ![edge.source, edge.target].includes(relation.sourceId) || ![edge.source, edge.target].includes(relation.targetId) || relation.predicate !== expected.predicate || relation.basis !== expected.basis || (relation.summary ?? undefined) !== (expected.summary || undefined) || !Array.isArray(relation.citations) || !relation.citations.length || !Array.isArray(relation.entryIds) || !relation.entryIds.length || !sameJSON(relation.citations, expected.citations) || !sameJSON(relation.entryIds, expected.entryIds)) throw new Error('Invalid shared Wiki semantic relationship or evidence');
        relationIds.add(relation.id);
        validateReferences(relation);
    }
  }
  if (relationIds.size !== expectedRelations.size || graph.nodes.some(raw => { const node = record(raw); return node.linkCount !== degrees.get(String(node.id)); })) throw new Error('Shared Wiki semantic relationships or degrees are incomplete');
  const communities = new Set<number>();
  for (const raw of graph.communities) {
    const community = record(raw);
    if (!Number.isSafeInteger(community.id) || Number(community.id) < 0 || communities.has(Number(community.id))) throw new Error('Invalid shared Wiki semantic community');
    const members = [...nodeCommunities].filter(([, id]) => id === community.id).map(([id]) => id);
    const memberIds = new Set(members);
    const internalEdges = graph.edges.filter(raw => { const edge = record(raw); return memberIds.has(String(edge.source)) && memberIds.has(String(edge.target)); }).length;
    const possibleEdges = members.length > 1 ? members.length * (members.length - 1) / 2 : 1;
    const names = new Set(members.map(id => concepts.get(id)!.name));
    if (!members.length || community.nodeCount !== members.length || community.cohesion !== internalEdges / possibleEdges || community.meanIntraDegree !== 2 * internalEdges / members.length || !Array.isArray(community.topNodes) || !community.topNodes.length || community.topNodes.length > Math.min(5, members.length) || community.topNodes.some(name => typeof name !== 'string' || !names.has(name))) throw new Error('Invalid shared Wiki semantic community statistics');
    communities.add(Number(community.id));
  }
  if ([...nodeCommunities.values()].some(id => !communities.has(id))) throw new Error('Shared Wiki semantic community membership is incomplete');
  for (const raw of view.pages) if ((record(raw).links as unknown[]).some(id => typeof id !== 'string' || !ids.has(id))) throw new Error('Invalid shared Wiki page link');
  return value as BuiltWiki;
}

/** One package-level program shared by all authorized spaces; no upstream imports. */
export function createWikiRuntime(options: WikiRuntimeOptions = {}): WikiRuntime {
  const location = dirname(fileURLToPath(import.meta.url));
  const packaged = resolve(location, 'llm-wiki/engine.cjs');
  const enginePath = options.enginePath ?? (existsSync(packaged) ? packaged : resolve(location, '../../lib/llm-wiki/engine.cjs'));
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Error('Invalid Wiki runtime timeout');
  let child: ChildProcessWithoutNullStreams | undefined;
  let disposed = false;
  let tail: Promise<unknown> = Promise.resolve();
  let active: { id: string; resolve: (value: unknown) => void; reject: (error: Error) => void } | undefined;
  const running = new Set<ChildProcessWithoutNullStreams>();
  let closing: Promise<void> = Promise.resolve();
  function stop(error: Error): void {
    const previous = child;
    child = undefined;
    const pending = active; active = undefined;
    pending?.reject(error);
    if (previous && !previous.killed) {
      closing = new Promise<void>(resolvePromise => {
        if (previous.exitCode !== null || previous.signalCode !== null) { resolvePromise(); return; }
        const timer = setTimeout(() => previous.kill('SIGKILL'), 1000);
        previous.once('close', () => { clearTimeout(timer); resolvePromise(); });
        previous.kill('SIGTERM');
      });
    }
  }
  function start(): ChildProcessWithoutNullStreams {
    if (child) return child;
    const env: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: '1' };
    for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'TMPDIR', 'TEMP', 'TMP', 'LANG']) if (process.env[name]) env[name] = process.env[name];
    const instance = spawn(options.nodePath ?? process.execPath, [enginePath], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env });
    child = instance;
    running.add(instance);
    instance.stderr.on('data', () => { /* Child diagnostics never include source data in host logs. */ });
    let output = '';
    const onLine = (line: string) => {
      if (child !== instance) return;
      try {
        if (Buffer.byteLength(line) > MAX_RESPONSE_BYTES) throw new Error('Shared Wiki response exceeds limit');
        const response = record(JSON.parse(line));
        if (!active || response.id !== active.id || typeof response.ok !== 'boolean') throw new Error('Shared Wiki response request mismatch');
        const pending = active; active = undefined;
        if (response.ok) pending.resolve(response.value);
        else pending.reject(new Error(typeof response.error === 'string' ? response.error : 'Shared Wiki engine failed'));
      } catch (error) { stop(error instanceof Error ? error : new Error('Shared Wiki response failed')); }
    };
    instance.stdout.setEncoding('utf8');
    instance.stdout.on('data', (chunk: string) => {
      if (child !== instance) return;
      output += chunk;
      let boundary: number;
      while ((boundary = output.indexOf('\n')) !== -1) {
        const line = output.slice(0, boundary);
        output = output.slice(boundary + 1);
        onLine(line);
        if (child !== instance) return;
      }
      if (Buffer.byteLength(output) > MAX_RESPONSE_BYTES) stop(new Error('Shared Wiki response exceeds limit'));
    });
    instance.on('error', error => { if (child === instance) stop(error); });
    instance.on('close', () => { running.delete(instance); if (child === instance) stop(new Error('Shared Wiki engine exited')); });
    return instance;
  }
  function send(method: 'build' | 'analysisPrompt', request: WikiBuildRequest | WikiAnalysisRequest, signal?: AbortSignal): Promise<unknown> {
    if (disposed) return Promise.reject(new Error('Shared Wiki runtime is disposed'));
    if (signal?.aborted) return Promise.reject(aborted());
    const execute = async () => {
      await closing;
      if (disposed) throw new Error('Shared Wiki runtime is disposed');
      if (signal?.aborted) throw aborted();
      const id = randomUUID();
      const line = JSON.stringify({ id, method, request });
      if (Buffer.byteLength(line) > MAX_MESSAGE_BYTES) throw new Error('Shared Wiki request exceeds limit');
      return new Promise<unknown>((resolvePromise, rejectPromise) => {
        let settled = false;
        const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); };
        const resolve = (value: unknown) => { if (!settled) { settled = true; cleanup(); resolvePromise(value); } };
        const reject = (error: Error) => { if (!settled) { settled = true; cleanup(); rejectPromise(error); } };
        const onAbort = () => stop(aborted());
        const timer = setTimeout(() => stop(new Error('Shared Wiki request timed out')), timeoutMs);
        signal?.addEventListener('abort', onAbort, { once: true });
        active = { id, resolve, reject };
        try { start().stdin.write(`${line}\n`, error => { if (error && active?.id === id) stop(error); }); }
        catch (error) { stop(error instanceof Error ? error : new Error('Shared Wiki start failed')); }
      });
    };
    const result = tail.then(execute);
    tail = result.catch(() => undefined);
    if (!signal) return result;
    return new Promise<unknown>((resolvePromise, rejectPromise) => {
      const onAbort = () => rejectPromise(aborted());
      signal.addEventListener('abort', onAbort, { once: true });
      result.then(resolvePromise, rejectPromise).finally(() => signal.removeEventListener('abort', onAbort));
    });
  }
  return {
    async build(request, signal) { return verifyView(await send('build', request, signal), request); },
    async analysisPrompt(request, signal) { const value = await send('analysisPrompt', request, signal); if (typeof value !== 'string' || value.length > MAX_RESPONSE_BYTES) throw new Error('Invalid shared Wiki analysis prompt'); return value; },
    async dispose() {
      if (disposed) return;
      disposed = true;
      stop(new Error('Shared Wiki runtime is disposed'));
      await closing;
      await tail;
    },
  };
}
