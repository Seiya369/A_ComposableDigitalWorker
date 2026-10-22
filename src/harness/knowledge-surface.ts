import type { ContentBlock, Message, ToolResultMessage, ToolSchema } from '@deepseek-ai/dsh-llm';
import type { Session, SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session';
import type {} from '@deepseek-ai/dsh-compaction';
import { estimateMessage } from '@deepseek-ai/dsh-token-meter/estimate';
import {
  ContextBudgetError, countContextTokens, createContextPool, defaultContextCounter, DEFAULT_COUNT_MODE,
  type ContextCounter, type ContextLayer, type ContextLimits, type ContextPacket,
} from '../knowledge/context.js';

export interface KnowledgeSurfaceOptions {
  /** Captured official session/event notifications, including prior replacements. */
  events?: readonly SessionEvent[];
  contextWindow?: number;
  outputReserve?: number;
  headroom?: number;
  /** Current assembled system text, including C. Replaces the logged system for measurement. */
  systemText?: string;
  tools?: readonly ToolSchema[];
  /** Admitted by the loop after pre-step, so not present in the session surface yet. */
  pendingMessages?: readonly Message[];
  pendingText?: string;
  counter?: ContextCounter;
  countMode?: string;
}

export interface KnowledgeSurfaceUsage {
  cTokens: number; bTokens: number; aTokens: number; totalTokens: number;
  requestTokens: number; replaced: number; countMode: string;
  contextWindow: number; contextWindowKnown: boolean; outputReserve: number;
  headroom: number; knowledgeLimit: number;
}

export class KnowledgeContextBudgetError extends ContextBudgetError {
  constructor(message = 'Knowledge and task history cannot fit the context budget; narrow this task phase or hand it off.') {
    super(message); this.name = 'KnowledgeContextBudgetError';
  }
}

interface KnowledgeReference {
  kind: 'workforce-knowledge-reference'; layer: ContextLayer; packetId: string; contentOmitted: true;
  directory: Array<{ layer: ContextLayer; id: string; library: 'team' | 'employee'; version: number; provenance?: string; citationOffset?: number }>;
  reason?: ContextPacket['reason'];
  navigationOnly?: true;
}
type SurfaceKnowledge = ContextPacket | KnowledgeReference;
interface Candidate {
  seq: SessionSeq; event: SessionEvent<'tool/result'>; message: ToolResultMessage; value: SurfaceKnowledge;
}
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isLayer = (value: unknown): value is ContextLayer => value === 'A' || value === 'B' || value === 'C';
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const nonnegative = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
function validIdentity(value: unknown): boolean {
  return isObject(value) && isLayer(value.layer) && typeof value.id === 'string' && value.id.length > 0
    && (value.library === 'team' || value.library === 'employee') && positive(value.version);
}

/** Parse only a complete producer envelope, never search inside source text for marker strings. */
function parseKnowledge(content: readonly ContentBlock[]): SurfaceKnowledge | undefined {
  if (content.length !== 1 || content[0]?.type !== 'text') return undefined;
  let value: unknown;
  try { value = JSON.parse(content[0].text); } catch { return undefined; }
  if (!isObject(value) || !isLayer(value.layer) || typeof value.packetId !== 'string' || !/^[a-f0-9]{24}$/.test(value.packetId)) return undefined;
  if (value.kind === 'workforce-knowledge-reference' && value.contentOmitted === true
    && (value.directory === undefined || Array.isArray(value.directory) && value.directory.every(validIdentity))) return value as unknown as KnowledgeReference;
  if (value.kind !== 'workforce-knowledge-context' || !Array.isArray(value.pieces) || !Array.isArray(value.directory)
    || typeof value.truncated !== 'boolean' || typeof value.countMode !== 'string' || !nonnegative(value.tokenEstimate)
    || !isObject(value.metadata) || !nonnegative(value.metadata.documentCount) || !nonnegative(value.metadata.omittedDocumentCount)) return undefined;
  if (!value.directory.every(validIdentity) || !value.pieces.every(piece => isObject(piece) && validIdentity(piece)
    && positive(piece.startLine) && positive(piece.endLine) && piece.startLine <= piece.endLine && typeof piece.text === 'string'
    && (piece.startColumn === undefined || positive(piece.startColumn)) && (piece.endColumn === undefined || positive(piece.endColumn)))) return undefined;
  if (value.directory.some(entry => (entry as Record<string, unknown>).layer !== value.layer)
    || value.pieces.some(piece => (piece as Record<string, unknown>).layer !== value.layer)) return undefined;
  return value as unknown as ContextPacket;
}

function reference(value: SurfaceKnowledge): KnowledgeReference {
  return {
    kind: 'workforce-knowledge-reference', layer: value.layer, packetId: value.packetId, contentOmitted: true,
    directory: (value.directory ?? []).map(entry => {
      const provenance = entry.provenance;
      const page = provenance?.match(/当前\s*(\d+)\s*[–-]/);
      const citationOffset = 'citationOffset' in entry && nonnegative(entry.citationOffset) ? entry.citationOffset as number
        : page ? Number(page[1]) - 1 : undefined;
      return { layer: entry.layer, id: entry.id, library: entry.library, version: entry.version,
        ...(provenance ? { provenance } : {}), ...(citationOffset === undefined ? {} : { citationOffset }) };
    }),
    ...(value.reason ? { reason: value.reason } : {}),
    ...(value.kind === 'workforce-knowledge-reference' ? value.navigationOnly ? { navigationOnly: true as const } : {}
      : value.metadata.navigationOnly ? { navigationOnly: true as const } : {}),
  };
}

/** Recover producer metadata from logged origins when reading an older compact reference. */
function recoverReference(candidate: Candidate, events: ReadonlyMap<SessionSeq, SessionEvent>): SurfaceKnowledge {
  if (candidate.value.kind !== 'workforce-knowledge-reference' || candidate.value.directory?.length) return candidate.value;
  const pending = [...candidate.event.sourceEventSeqs ?? []]; const seen = new Set<SessionSeq>();
  while (pending.length) {
    const seq = pending.shift()!; if (seen.has(seq)) continue; seen.add(seq);
    const event = events.get(seq); if (event?.type !== 'tool/result') continue;
    const value = parseKnowledge(event.data.message.content);
    if (value?.packetId === candidate.value.packetId && value.directory?.length) return reference(value);
    pending.push(...event.sourceEventSeqs ?? []);
  }
  return candidate.value;
}
const render = (value: SurfaceKnowledge): ContentBlock[] => [{ type: 'text', text: JSON.stringify(value) }];

/**
 * Bound knowledge on the official model surface using logged, replayable replacements.
 * The archive, original tool events, non-knowledge messages, and message identities remain intact.
 */
export function compactKnowledgeSurface(
  session: Session, overview: ContextPacket | undefined, limits: ContextLimits, options: KnowledgeSurfaceOptions = {},
): KnowledgeSurfaceUsage {
  const counter = options.counter ?? defaultContextCounter;
  const countMode = options.countMode ?? (options.counter ? 'custom-token-counter' : DEFAULT_COUNT_MODE);
  const contextWindow = options.contextWindow ?? 64_000;
  const outputReserve = options.outputReserve ?? Math.min(8_000, Math.floor(contextWindow / 4));
  const headroom = options.headroom ?? 512;
  if (!positive(contextWindow) || !nonnegative(outputReserve) || !nonnegative(headroom)) throw new KnowledgeContextBudgetError('Invalid model context capacity or reserve.');
  const inputLimit = contextWindow - outputReserve - headroom;
  if (inputLimit <= 0) throw new KnowledgeContextBudgetError('The model window cannot accommodate its output reserve and safety headroom.');
  const nodes = [...session.surface.nodes];
  const events = new Map((options.events ?? []).map(event => [event.seq, event]));
  const calls = new Map((options.events ?? []).flatMap(event => event.type === 'tool/call'
    ? [[event.data.callId, event.data.name] as const] : []));
  const candidates: Candidate[] = [];
  const derived = session.deriveMessages();
  // A caller must supply event observations, rather than introduce deprecated synchronous log reads.
  if (!options.events && derived.some(message => message.role === 'tool' && parseKnowledge(message.content))) {
    throw new KnowledgeContextBudgetError('Official session/event observations are required to budget knowledge results safely.');
  }
  for (const seq of nodes) {
    const event = events.get(seq);
    if (event?.type !== 'tool/result' || event.data.message.source.kind !== 'tool'
      || calls.get(event.data.message.source.callId) !== 'worker_memory_search') continue;
    const message = session.deriveEventMessage(event);
    if (!message || message.role !== 'tool' || message.isError) continue;
    const value = parseKnowledge(message.content);
    if (value && value.layer !== 'C') candidates.push({ seq, event, message, value });
  }
  for (const candidate of candidates) candidate.value = recoverReference(candidate, events);
  const cTokens = overview ? countContextTokens(overview, counter) : 0;
  if (cTokens > limits.cMax) throw new KnowledgeContextBudgetError('The pinned C overview exceeds its context limit.');

  const effectiveMessages = (contents: ReadonlyMap<string, ContentBlock[]>): unknown[] => {
    const messages: unknown[] = derived.filter(message => options.systemText === undefined || message.role !== 'system')
      .map(message => contents.has(message.id) ? { ...message, content: contents.get(message.id)! } : message);
    if (options.systemText !== undefined) messages.unshift({ role: 'system', content: [{ type: 'text', text: options.systemText }] });
    const ids = new Set(derived.map(message => message.id));
    messages.push(...(options.pendingMessages ?? []).filter(message => !ids.has(message.id)));
    if (options.pendingText) messages.push({ role: 'user', content: [{ type: 'text', text: options.pendingText }] });
    return messages;
  };
  const requestCost = (contents: ReadonlyMap<string, ContentBlock[]>): number => countContextTokens({
    messages: effectiveMessages(contents), tools: options.tools ?? session.requestHeader()?.tools ?? [],
  }, counter);
  const empty = new Map(candidates.map(candidate => [candidate.message.id, [] as ContentBlock[]]));
  const baseRequestTokens = requestCost(empty);
  if (baseRequestTokens > inputLimit) throw new KnowledgeContextBudgetError('Task instructions, tools and non-knowledge history already exceed the available input budget; narrow this phase or hand it off.');
  // systemText/derived system already contains C; add C only to the knowledge accounting allowance.
  const knowledgeLimit = Math.min(limits.total, Math.floor((contextWindow - outputReserve) * 0.25), cTokens + inputLimit - baseRequestTokens);
  if (knowledgeLimit < cTokens) throw new KnowledgeContextBudgetError('The pinned C overview cannot fit the remaining knowledge allowance.');

  // Identical packets keep the most recent body; prior occurrences become small, counted pointers.
  const latest = new Map<string, Candidate>();
  for (const candidate of candidates) if (candidate.value.kind === 'workforce-knowledge-context') latest.set(candidate.value.packetId, candidate);
  const references = candidates.filter(candidate => candidate.value.kind === 'workforce-knowledge-reference' || latest.get(candidate.value.packetId) !== candidate);
  const referenceCost = (layer?: ContextLayer) => references.filter(candidate => !layer || candidate.value.layer === layer)
    .reduce((sum, candidate) => sum + countContextTokens(reference(candidate.value), counter), 0);
  const poolLimits = { ...limits,
    total: knowledgeLimit - referenceCost(), bActive: limits.bActive - referenceCost('B'), aActive: limits.aActive - referenceCost('A'),
  };
  if (!positive(poolLimits.total) || !positive(poolLimits.bActive) || !positive(poolLimits.aActive)) throw new KnowledgeContextBudgetError('Knowledge reference metadata has exhausted this phase budget; hand off the task.');
  const pool = createContextPool(poolLimits, { counter, countMode });
  try {
    if (overview) pool.activate(overview);
    for (const candidate of candidates) {
      if (candidate.value.kind === 'workforce-knowledge-context' && latest.get(candidate.value.packetId) === candidate) pool.activate(candidate.value);
    }
  } catch (error) {
    if (error instanceof ContextBudgetError) throw new KnowledgeContextBudgetError(error.message);
    throw error;
  }
  const packed = new Map(pool.snapshot().packets.map(packet => [packet.packetId, packet]));
  const replacements = new Map<string, ContentBlock[]>();
  let bTokens = 0; let aTokens = 0;
  for (const candidate of candidates) {
    const selected = candidate.value.kind === 'workforce-knowledge-context' && latest.get(candidate.value.packetId) === candidate
      ? packed.get(candidate.value.packetId) : undefined;
    const value = selected?.pieces.length ? selected : reference(candidate.value);
    const cost = countContextTokens(value, counter);
    if (value.layer === 'B') bTokens += cost; else aTokens += cost;
    replacements.set(candidate.message.id, render(value));
  }
  const totalTokens = cTokens + bTokens + aTokens;
  const requestTokens = requestCost(replacements);
  if (totalTokens > knowledgeLimit || bTokens > limits.bActive || aTokens > limits.aActive || requestTokens > inputLimit) {
    throw new KnowledgeContextBudgetError('The complete knowledge envelopes and task history do not fit the request budget; narrow this phase or hand it off.');
  }
  // All planning/validation happens before the first durable mutation.
  let replaced = 0;
  for (const candidate of candidates) {
    const content = replacements.get(candidate.message.id)!;
    if (JSON.stringify(content) === JSON.stringify(candidate.message.content)) continue;
    session.append('compaction/prune', {
      shadowedRange: { start: candidate.seq, end: candidate.seq }, shadowedSeqs: [candidate.seq],
      shadowedTokenCount: estimateMessage(candidate.message),
    });
    session.append('tool/result', { ...candidate.event.data, message: { ...candidate.message, content } }, {
      surfaceOp: { op: 'replace', startSeq: candidate.seq, endSeq: candidate.seq }, sourceEventSeqs: [candidate.seq],
    });
    replaced++;
  }
  return { cTokens, bTokens, aTokens, totalTokens, requestTokens, replaced, countMode,
    contextWindow, contextWindowKnown: options.contextWindow !== undefined, outputReserve, headroom, knowledgeLimit };
}
