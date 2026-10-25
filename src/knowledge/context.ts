import { createHash } from 'node:crypto';
import type { KnowledgeCitation } from './types.js';

export type ContextLayer = 'A' | 'B' | 'C';
export type AActivationReason = 'quote' | 'exact-detail' | 'conflict' | 'verify' | 'missing-evidence' | 'source-comparison' | 'no-wiki';
export const A_ACTIVATION_REASONS: readonly AActivationReason[] = Object.freeze(['quote', 'exact-detail', 'conflict', 'verify', 'missing-evidence', 'source-comparison', 'no-wiki']);
export interface ContextDocument {
  layer: ContextLayer; id: string; library: 'team' | 'employee'; version: number;
  title: string; content: string; citations?: KnowledgeCitation[]; entryIds?: string[];
  provenance?: string; verified?: boolean;
}
export interface ContextPiece {
  layer: ContextLayer; id: string; library: 'team' | 'employee'; version: number;
  startLine: number; endLine: number;
  /** One-based UTF-16 columns; endColumn is exclusive. Present for partial lines. */
  startColumn?: number; endColumn?: number; text: string;
}
export interface ContextDirectoryEntry {
  layer: ContextLayer; id: string; library: 'team' | 'employee'; version: number;
  title?: string; citations?: KnowledgeCitation[]; entryIds?: string[]; verified?: boolean; provenance?: string;
  /** Exact document identity remains readable after active evidence is compacted. */
  contentOmitted?: boolean;
}
export interface ContextCursor {
  layer: ContextLayer; id: string; library: 'team' | 'employee'; version: number;
  startLine: number; startColumn?: number; endLine?: number; endColumn?: number; query?: string;
}
export interface ContextPacket {
  kind: 'workforce-knowledge-context'; packetId: string; layer: ContextLayer;
  pieces: ContextPiece[]; directory: ContextDirectoryEntry[];
  metadata: { documentCount: number; omittedDocumentCount: number; omittedMetadata?: boolean; navigationOnly?: boolean };
  continuation?: ContextCursor[]; reason?: AActivationReason;
  truncated: boolean; tokenEstimate: number; countMode: string;
}
export interface ContextLimits {
  cTarget: number; cMax: number; bRead: number; bActive: number; aRead: number; aActive: number; total: number;
}
export const DEFAULT_CONTEXT_LIMITS: Readonly<ContextLimits> = Object.freeze({
  cTarget: 2000, cMax: 3000, bRead: 3000, bActive: 8000, aRead: 2000, aActive: 4000, total: 12000,
});
/** Safe initial bound, NOT an exact model tokenizer. UTF-8 bytes bound byte-based tokenizers. */
export const DEFAULT_COUNT_MODE = 'utf8-byte-upper-bound';
export type ContextCounter = (serialized: string) => number;
export const defaultContextCounter: ContextCounter = serialized => Buffer.byteLength(serialized, 'utf8');
export function countContextTokens(value: unknown, counter: ContextCounter = defaultContextCounter): number {
  const count = counter(JSON.stringify(value));
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Context counter must return a non-negative safe integer');
  return count;
}
export class ContextBudgetError extends Error {
  readonly code = 'KNOWLEDGE_CONTEXT_BUDGET';
  constructor(message = 'The versioned knowledge index cannot fit the context budget; hand off this task phase or increase its budget.') { super(message); this.name = 'ContextBudgetError'; }
}
export interface ContextPacketOptions {
  query?: string; maxTokens?: number; counter?: ContextCounter; countMode?: string;
  reason?: AActivationReason; startLine?: number; endLine?: number; startColumn?: number; endColumn?: number; cursor?: ContextCursor;
  /** Search/navigation documents have no repository-readable body or continuation cursor. */
  navigationOnly?: boolean;
}

type Range = { start: number; end: number };
const clone = <T>(value: T): T => structuredClone(value);
const identity = (value: Pick<ContextDocument, 'layer' | 'id' | 'library' | 'version'>) => JSON.stringify([value.layer, value.library, value.id, value.version]);
const titleLimit = 48;
function finish<T extends { tokenEstimate: number }>(value: T, counter: ContextCounter): T {
  value.tokenEstimate = 0;
  for (let attempt = 0; attempt < 16; attempt++) {
    const count = countContextTokens(value, counter);
    if (count <= value.tokenEstimate) return value;
    value.tokenEstimate = count;
  }
  throw new Error('Context counter did not converge on a serialized packet bound');
}
function validBudget(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Context budget must be a positive integer');
  return value;
}
function queryTerms(query = ''): string[] {
  const normalized = query.toLocaleLowerCase();
  const terms = new Set(normalized.match(/[a-z0-9_][a-z0-9_.:/%-]*/g) ?? []);
  for (const run of normalized.match(/[\p{Script=Han}]+/gu) ?? []) {
    if (run.length === 1) terms.add(run);
    else for (let index = 0; index < run.length - 1; index++) terms.add(run.slice(index, index + 2));
  }
  return [...terms].filter(term => term.length > 1 || /\p{Script=Han}/u.test(term));
}
function score(text: string, terms: string[]): number {
  const normalized = text.toLocaleLowerCase();
  return terms.reduce((sum, term) => sum + (normalized.includes(term) ? (/^[a-z_]/.test(term) ? 3 : 1) : 0), 0);
}
function linesFor(content: string): { lines: string[]; starts: number[] } {
  const lines = content.split('\n'); let offset = 0;
  return { lines, starts: lines.map(line => { const start = offset; offset += line.length + 1; return start; }) };
}
function coordinate(content: string, offset: number): { line: number; column: number } {
  const before = content.slice(0, offset); const lastBreak = before.lastIndexOf('\n');
  return { line: before.split('\n').length, column: offset - lastBreak };
}
function safeBoundary(content: string, position: number, direction: -1 | 1): number {
  const here = content.charCodeAt(position); const before = content.charCodeAt(position - 1);
  return here >= 0xdc00 && here <= 0xdfff && before >= 0xd800 && before <= 0xdbff ? position + direction : position;
}
function bounds(document: ContextDocument, options: ContextPacketOptions): Range {
  const { lines, starts } = linesFor(document.content);
  const cursor = options.cursor;
  if (cursor && identity(cursor) !== identity(document)) throw new Error('Continuation document/version does not match');
  const startLine = cursor?.startLine ?? options.startLine ?? 1;
  const endLine = cursor?.endLine ?? options.endLine ?? lines.length;
  const startColumn = cursor?.startColumn ?? options.startColumn ?? 1;
  const endColumn = cursor?.endColumn ?? options.endColumn ?? lines[endLine - 1]!.length + 1;
  if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || startLine < 1 || endLine > lines.length || startLine > endLine
    || !Number.isSafeInteger(startColumn) || startColumn < 1 || startColumn > lines[startLine - 1]!.length + 1
    || !Number.isSafeInteger(endColumn) || endColumn < 1 || endColumn > lines[endLine - 1]!.length + 1) throw new Error('Invalid knowledge line/column range');
  const start = starts[startLine - 1]! + startColumn - 1; const end = starts[endLine - 1]! + endColumn - 1;
  if (start > end) throw new Error('Invalid knowledge range');
  return { start: safeBoundary(document.content, start, -1), end: safeBoundary(document.content, end, 1) };
}
function piece(document: ContextDocument, range: Range): ContextPiece {
  const start = coordinate(document.content, range.start); const end = coordinate(document.content, range.end);
  const line = document.content.split('\n');
  const partial = start.column !== 1 || end.column !== line[end.line - 1]!.length + 1;
  return { layer: document.layer, id: document.id, library: document.library, version: document.version,
    startLine: start.line, endLine: end.line, ...(partial ? { startColumn: start.column, endColumn: end.column } : {}), text: document.content.slice(range.start, range.end) };
}
function cursorFor(document: ContextDocument, start: number, end: number, query?: string): ContextCursor {
  const a = coordinate(document.content, start); const b = coordinate(document.content, end);
  return { layer: document.layer, id: document.id, library: document.library, version: document.version,
    startLine: a.line, startColumn: a.column, endLine: b.line, endColumn: b.column, ...(query ? { query } : {}) };
}
function missingRanges(document: ContextDocument, requested: Range, pieces: ContextPiece[], query?: string): ContextCursor[] {
  const { starts, lines } = linesFor(document.content);
  const covered = pieces.filter(item => identity(item) === identity(document)).map(item => ({
    start: starts[item.startLine - 1]! + (item.startColumn ?? 1) - 1,
    end: starts[item.endLine - 1]! + (item.endColumn ?? lines[item.endLine - 1]!.length + 1) - 1,
  })).sort((a, b) => a.start - b.start);
  const result: ContextCursor[] = []; let next = requested.start;
  for (const range of covered) {
    if (range.start > next && document.content.slice(next, range.start).trim()) result.push(cursorFor(document, next, range.start, query));
    next = Math.max(next, range.end + (document.content[range.end] === '\n' ? 1 : 0));
  }
  if (next < requested.end && document.content.slice(next, requested.end).trim()) result.push(cursorFor(document, next, requested.end, query));
  return result;
}
function directoryFor(document: ContextDocument): ContextDirectoryEntry {
  const title = [...document.title].slice(0, titleLimit).join('');
  return { layer: document.layer, id: document.id, library: document.library, version: document.version,
    ...(title ? { title } : {}), ...(document.citations?.length ? { citations: clone(document.citations) } : {}),
    ...(document.entryIds?.length ? { entryIds: [...document.entryIds] } : {}), ...(document.verified === undefined ? {} : { verified: document.verified }),
    ...(document.provenance && Buffer.byteLength(document.provenance, 'utf8') <= 256 ? { provenance: document.provenance } : {}) };
}
function emptyPacket(layer: ContextLayer, countMode: string, reason?: AActivationReason): ContextPacket {
  return { kind: 'workforce-knowledge-context', packetId: '000000000000000000000000', layer, pieces: [], directory: [], metadata: { documentCount: 0, omittedDocumentCount: 0 },
    ...(reason ? { reason } : {}), truncated: false, tokenEstimate: 0, countMode };
}
function desiredRanges(document: ContextDocument, requested: Range, options: ContextPacketOptions): Range[] {
  if (options.cursor || options.startLine !== undefined) return [requested];
  const terms = queryTerms(options.query); if (!terms.length || document.layer === 'C') return [requested];
  const { lines, starts } = linesFor(document.content);
  const ranking = lines.map((line, index) => ({ index, score: score(line, terms) })).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  if (!ranking.length) return [requested];
  const ranges: Range[] = [];
  for (const item of ranking.slice(0, 8)) {
    const from = Math.max(0, item.index - 1); const to = Math.min(lines.length - 1, item.index + 1);
    const next = { start: starts[from]!, end: starts[to]! + lines[to]!.length };
    if (ranges.some(range => next.start >= range.start && next.end <= range.end)) continue;
    const prior = ranges.find(range => next.start <= range.end && next.end >= range.start);
    if (prior) { prior.start = Math.min(prior.start, next.start); prior.end = Math.max(prior.end, next.end); }
    else ranges.push(next);
  }
  return ranges;
}

/** Extracts original spans only. This never writes or recursively summarizes A, B or C. */
export function createContextPacket(documents: ContextDocument[], options: ContextPacketOptions = {}): ContextPacket {
  const layer = documents[0]?.layer ?? options.cursor?.layer ?? 'C';
  if (documents.some(document => document.layer !== layer)) throw new Error('A knowledge packet must contain a single layer');
  if (layer === 'A' && !A_ACTIVATION_REASONS.includes(options.reason!)) throw new Error('A valid source activation reason is required');
  const counter = options.counter ?? defaultContextCounter;
  const countMode = options.countMode ?? (options.counter ? 'custom-token-counter' : DEFAULT_COUNT_MODE);
  const maxTokens = validBudget(options.maxTokens ?? (layer === 'A' ? DEFAULT_CONTEXT_LIMITS.aRead : layer === 'B' ? DEFAULT_CONTEXT_LIMITS.bRead : DEFAULT_CONTEXT_LIMITS.cTarget));
  const query = options.query ?? options.cursor?.query;
  const terms = queryTerms(query);
  let ranked = [...documents].sort((a, b) => (score(b.title, terms) * 3 + score(b.content, terms)) - (score(a.title, terms) * 3 + score(a.content, terms)));
  if (options.cursor) {
    const index = ranked.findIndex(document => identity(document) === identity(options.cursor!));
    if (index < 0) throw new Error('Continuation document/version is unavailable');
    ranked = ranked.slice(index);
  }
  let packet = emptyPacket(layer, countMode, options.reason);
  packet.metadata.documentCount = documents.length;
  if (options.navigationOnly) packet.metadata.navigationOnly = true;
  if (documents.some(document => [...document.title].length > titleLimit || (document.provenance && Buffer.byteLength(document.provenance, 'utf8') > 256))) packet.metadata.omittedMetadata = true;
  const measure = (candidate: ContextPacket) => {
    if (options.navigationOnly) delete candidate.continuation;
    // Equal-width hashes do not have equal BPE cost. Count the real visible identity
    // while choosing spans, rather than replacing a cheap placeholder after fitting.
    const { packetId: _packetId, tokenEstimate: _tokenEstimate, ...visible } = candidate;
    candidate.packetId = createHash('sha256').update(JSON.stringify(visible)).digest('hex').slice(0, 24);
    return finish(candidate, counter).tokenEstimate <= maxTokens;
  };
  if (!measure(packet)) throw new ContextBudgetError();
  let omitted = false;
  for (let docIndex = 0; docIndex < ranked.length; docIndex++) {
    const document = ranked[docIndex]!;
    const requestOptions = { ...options, query, ...(docIndex ? { cursor: undefined, startLine: undefined, endLine: undefined, startColumn: undefined, endColumn: undefined } : {}) };
    const requested = bounds(document, requestOptions);
    const ranges = desiredRanges(document, requested, requestOptions);
    const base = clone(packet); base.directory.push(directoryFor(document));
    base.metadata.omittedDocumentCount = documents.length - base.directory.length;
    const nextDocument = ranked[docIndex + 1];
    if (nextDocument) { base.continuation = [cursorFor(nextDocument, 0, nextDocument.content.length, query)]; base.truncated = true; }
    else { delete base.continuation; base.truncated = false; }
    if (!measure(base)) { omitted = true; break; }
    const whole = clone(base); whole.pieces.push(piece(document, requested));
    if (measure(whole)) { packet = whole; continue; }
    let selected = base; let added = false;
    for (const desired of ranges) {
      const candidate = clone(selected); candidate.pieces.push(piece(document, desired));
      candidate.truncated = true;
      candidate.continuation = [...missingRanges(document, requested, candidate.pieces, query), ...(base.continuation ?? [])];
      if (measure(candidate)) { selected = candidate; added = true; continue; }
      // A long single line is split around matching query terms, never at an arbitrary head prefix.
      let from = desired.start;
      const singleLine = !document.content.slice(desired.start, desired.end).includes('\n');
      if (!options.cursor && singleLine && terms.length) {
        const text = document.content.slice(desired.start, desired.end).toLocaleLowerCase();
        const matches = terms.map(term => text.indexOf(term)).filter(index => index >= 0).sort((a, b) => a - b);
        if (matches.length) from = safeBoundary(document.content, desired.start + Math.max(0, matches[0]! - 100), -1);
      }
      let low = from; let high = desired.end; let fitted: ContextPacket | undefined;
      while (low < high) {
        const until = safeBoundary(document.content, Math.ceil((low + high) / 2), -1);
        if (until <= from) break;
        const partial = clone(selected); partial.pieces.push(piece(document, { start: from, end: until })); partial.truncated = true;
        partial.continuation = [...missingRanges(document, requested, partial.pieces, query), ...(base.continuation ?? [])];
        if (measure(partial)) { fitted = partial; low = until === low ? low + 1 : until; } else high = until - 1;
      }
      if (fitted && !singleLine) {
        const current = fitted.pieces.at(-1)!;
        const fullLength = current.text.length;
        const lastBreak = current.text.lastIndexOf('\n');
        if (lastBreak > 0 && lastBreak < fullLength - 1) {
          const until = from + lastBreak;
          const trimmed = clone(fitted);
          trimmed.pieces[trimmed.pieces.length - 1] = piece(document, { start: from, end: until });
          trimmed.continuation = [...missingRanges(document, requested, trimmed.pieces, query), ...(base.continuation ?? [])];
          if (measure(trimmed)) fitted = trimmed;
        }
      }
      if (fitted) { selected = fitted; added = true; }
      break;
    }
    if (!added) {
      if (!packet.pieces.length) throw new ContextBudgetError('The document identity and one source span cannot fit this read budget.');
      omitted = true; break;
    }
    packet = selected; omitted = true;
    // Preserve enough room for the continuation and exact citations instead of filling with weak matches.
    break;
  }
  packet.metadata.omittedDocumentCount = documents.length - packet.directory.length;
  packet.truncated = packet.truncated || omitted || packet.metadata.omittedDocumentCount > 0;
  if (packet.metadata.omittedDocumentCount && !packet.continuation?.length) {
    const next = ranked[packet.directory.length];
    if (next) packet.continuation = [cursorFor(next, 0, next.content.length, query)];
  }
  if (options.navigationOnly) delete packet.continuation;
  // Metadata/reference pages and the final content identity are visible evidence too.
  if (!measure(packet)) {
    throw new ContextBudgetError();
  }
  return packet;
}

export interface ContextPoolSnapshot { packets: ContextPacket[]; tokenEstimate: number; countMode: string; compactedCount: number }
export interface ContextPoolOptions { counter?: ContextCounter; countMode?: string }
function pieceKey(item: ContextPiece): string { return JSON.stringify([identity(item), item.startLine, item.endLine, item.startColumn, item.endColumn, item.text]); }
function compact(packet: ContextPacket, counter: ContextCounter): ContextPacket {
  const result = emptyPacket(packet.layer, packet.countMode, packet.reason);
  result.packetId = packet.packetId;
  result.directory = packet.directory.map(entry => ({ layer: entry.layer, id: entry.id, library: entry.library, version: entry.version,
    ...(entry.verified === undefined ? {} : { verified: entry.verified }), contentOmitted: true }));
  result.metadata.documentCount = result.directory.length; result.truncated = true;
  return finish(result, counter);
}
export class KnowledgeContextPool {
  private state: ContextPacket[] = [];
  private compactedCount = 0;
  readonly limits: ContextLimits;
  private readonly counter: ContextCounter;
  private readonly countMode: string;
  constructor(limits: Partial<ContextLimits> = {}, options: ContextPoolOptions = {}) {
    this.limits = { ...DEFAULT_CONTEXT_LIMITS, ...limits };
    Object.values(this.limits).forEach(validBudget);
    this.counter = options.counter ?? defaultContextCounter;
    this.countMode = options.countMode ?? (options.counter ? 'custom-token-counter' : DEFAULT_COUNT_MODE);
  }
  private result(packets: ContextPacket[], compactedCount: number): ContextPoolSnapshot {
    return finish({ packets: clone(packets), tokenEstimate: 0, countMode: this.countMode, compactedCount }, this.counter);
  }
  snapshot(): ContextPoolSnapshot { return this.result(this.state, this.compactedCount); }
  activate(packet: ContextPacket): ContextPoolSnapshot {
    if (packet.countMode !== this.countMode) throw new Error('Knowledge packet and active pool must use the same count mode');
    const incoming = finish(clone(packet), this.counter);
    const incomingKeys = new Set(incoming.pieces.map(pieceKey));
    const incomingDirectories = new Set(incoming.directory.map(entry => JSON.stringify(entry)));
    const next = this.state.map(prior => {
      const value = clone(prior);
      const duplicateDirectories = new Set(value.directory.filter(entry => incomingDirectories.has(JSON.stringify(entry))).map(identity));
      value.pieces = value.pieces.filter(item => !incomingKeys.has(pieceKey(item)) || !duplicateDirectories.has(identity(item)));
      value.directory = value.directory.filter(item => !duplicateDirectories.has(identity(item)) || value.pieces.some(span => identity(span) === identity(item)));
      return finish(value, this.counter);
    }).filter(value => value.pieces.length || value.directory.length);
    next.push(incoming);
    let compactedCount = this.compactedCount;
    const excess = (): ContextLayer | 'total' | undefined => {
      for (const layer of ['C', 'B', 'A'] as const) {
        const maximum = layer === 'C' ? this.limits.cMax : layer === 'B' ? this.limits.bActive : this.limits.aActive;
        if (countContextTokens(next.filter(value => value.layer === layer), this.counter) > maximum) return layer;
      }
      return this.result(next, compactedCount).tokenEstimate > this.limits.total ? 'total' : undefined;
    };
    for (let iteration = 0; iteration <= next.length; iteration++) {
      const layer = excess();
      if (!layer) { this.state = next; this.compactedCount = compactedCount; return this.snapshot(); }
      const index = next.findIndex((value, index) => index < next.length - 1 && value.layer !== 'C' && value.pieces.length && (layer === 'total' || value.layer === layer));
      if (index < 0) throw new ContextBudgetError();
      next[index] = compact(next[index]!, this.counter); compactedCount++;
    }
    throw new ContextBudgetError();
  }
}
export function createContextPool(limits: Partial<ContextLimits> = {}, options: ContextPoolOptions = {}): KnowledgeContextPool { return new KnowledgeContextPool(limits, options); }
