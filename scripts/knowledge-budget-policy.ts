/**
 * Offline candidate policies only. This module does not change production defaults.
 * Counts cover the entire serializedContext envelope, including recovery navigation.
 * A reference encoding count is not an exact count for the employee's target model.
 */
import {
  ContextBudgetError, DEFAULT_COUNT_MODE, defaultContextCounter,
  type ContextCounter, type ContextDirectoryEntry, type ContextLayer, type ContextPacket, type ContextPiece,
} from '../src/knowledge/context.js';

export interface BudgetPolicy {
  target: number; soft: number; hard: number;
  cTarget: number; cMax: number; bRead: number; bActive: number; aRead: number; aActive: number;
}
export const BUDGET_PRESETS = Object.freeze({
  tight: Object.freeze({ target: 6000, soft: 9000, hard: 12000, cTarget: 2000, cMax: 3000, bRead: 3000, bActive: 8000, aRead: 2000, aActive: 4000 }),
  target: Object.freeze({ target: 32000, soft: 48000, hard: 64000, cTarget: 4000, cMax: 8000, bRead: 8000, bActive: 48000, aRead: 4000, aActive: 16000 }),
  roomy: Object.freeze({ target: 64000, soft: 80000, hard: 96000, cTarget: 4000, cMax: 8000, bRead: 8000, bActive: 72000, aRead: 4000, aActive: 24000 }),
} satisfies Record<string, Readonly<BudgetPolicy>>);
export type BudgetPreset = keyof typeof BUDGET_PRESETS;
export interface EffectiveBudget extends BudgetPolicy {
  modelHeadroomChecked: boolean; inputCapacity?: number; remainingInputTokens?: number;
  /** B/A active budgets are cleanup targets; necessary evidence may borrow the shared pool. */
  activeLayerTargetsAreAdvisory: true;
}
export interface KnowledgeBudgetOptions {
  preset?: BudgetPreset; policy?: Partial<BudgetPolicy>;
  modelContextTokens?: number; reservedOutputTokens?: number; otherInputTokens?: number;
  counter?: ContextCounter; countMode?: string;
  /** Caller certifies only the named reference encoding, never the target model. */
  exactCounter?: boolean;
}
export interface BudgetReference {
  layer: ContextLayer; library: 'team' | 'employee'; id: string; version: number;
  startLine?: number; endLine?: number; startColumn?: number; endColumn?: number;
  contentOmitted: true;
}
export interface RecoveryNavigation {
  handle: 'knowledge-budget-ledger/v1'; method: 'referencePage'; offset: 0; limit: 16;
  totalReferences: number;
  /** Each page contains library, document id, version and original span coordinates. */
  readIdentity: 'layer/library/id/version/startLine/startColumn/endLine/endColumn';
}
export interface BudgetHandoff {
  reason: 'knowledge-hard-limit' | 'model-input-exhausted' | 'fixed-c-hard-limit';
  phaseId: string; requiredTokens: number; availableTokens: number;
  action: 'split-phase-and-reread-versioned-evidence';
}
export interface KnowledgeBudgetSnapshot {
  packets: ContextPacket[]; recovery: RecoveryNavigation; serializedContext: string;
  tokenCount: number; countMode: string; exact: boolean;
  counterScope: 'serialized-context/reference-encoding' | 'serialized-context/estimate'; targetModelExact: false;
  budget: EffectiveBudget; accepted: boolean;
  status: 'within-target' | 'headroom-used' | 'phase-handoff'; handoff?: BudgetHandoff;
  phaseId: string; softTriggered: boolean; compactedCount: number;
}
export interface ReferencePage {
  entries: BudgetReference[]; total: number; nextOffset?: number;
  method: 'referencePage'; tokenCount: number; serializedPage: string; countMode: string; exact: boolean;
}
interface ActiveRecord { packet: ContextPacket; neededNow: boolean; stale: boolean; sequence: number }
type Identity = Pick<ContextDirectoryEntry, 'layer' | 'library' | 'id' | 'version'>;
const identity = (value: Identity) => JSON.stringify([value.layer, value.library, value.id, value.version]);
const pieceIdentity = (value: ContextPiece) => JSON.stringify([identity(value), value.startLine, value.startColumn, value.endLine, value.endColumn, value.text]);
const clone = <T>(value: T): T => structuredClone(value);
function nonnegative(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`);
  return value;
}
export function deriveKnowledgeBudget(options: KnowledgeBudgetOptions = {}): EffectiveBudget {
  const configured: BudgetPolicy = { ...BUDGET_PRESETS[options.preset ?? 'target'], ...options.policy };
  for (const [key, value] of Object.entries(configured)) nonnegative(value, key);
  if (!configured.hard || configured.target > configured.soft || configured.soft > configured.hard || configured.cTarget > configured.cMax) {
    throw new Error('Knowledge budgets require 0 <= target <= soft <= hard and cTarget <= cMax');
  }
  const output = nonnegative(options.reservedOutputTokens ?? 0, 'reservedOutputTokens');
  const other = nonnegative(options.otherInputTokens ?? 0, 'otherInputTokens');
  let inputCapacity: number | undefined; let remainingInputTokens: number | undefined;
  if (options.modelContextTokens !== undefined) {
    inputCapacity = Math.max(0, nonnegative(options.modelContextTokens, 'modelContextTokens') - output);
    remainingInputTokens = Math.max(0, inputCapacity - other);
  } else if (output || other) throw new Error('modelContextTokens is required to check output reservation and other input');
  const hard = inputCapacity === undefined ? configured.hard : Math.min(configured.hard, Math.floor(inputCapacity * 0.2), remainingInputTokens!);
  const scale = hard / configured.hard;
  return { target: Math.floor(configured.target * scale), soft: Math.floor(configured.soft * scale), hard,
    cTarget: Math.floor(configured.cTarget * scale), cMax: Math.floor(configured.cMax * scale),
    bRead: Math.floor(configured.bRead * scale), bActive: Math.floor(configured.bActive * scale),
    aRead: Math.floor(configured.aRead * scale), aActive: Math.floor(configured.aActive * scale),
    modelHeadroomChecked: inputCapacity !== undefined, activeLayerTargetsAreAdvisory: true,
    ...(inputCapacity === undefined ? {} : { inputCapacity, remainingInputTokens }),
  };
}

/** A shared team/employee pool; protected evidence is either kept verbatim or refused atomically. */
export class KnowledgeBudgetController {
  readonly budget: EffectiveBudget;
  private readonly counter: ContextCounter;
  private readonly countMode: string;
  private readonly exact: boolean;
  private records: ActiveRecord[] = [];
  // This recoverable identity ledger is outside the prompt. Pages are separately measured.
  private references = new Map<string, BudgetReference>();
  private phaseId = 'initial';
  private sequence = 0;
  private compactedCount = 0;
  private softTriggered = false;
  constructor(options: KnowledgeBudgetOptions = {}) {
    this.budget = deriveKnowledgeBudget(options);
    this.counter = options.counter ?? defaultContextCounter;
    this.countMode = options.counter ? options.countMode ?? 'custom-counter-unverified' : DEFAULT_COUNT_MODE;
    this.exact = Boolean(options.counter && options.exactCounter && this.countMode !== DEFAULT_COUNT_MODE);
  }
  private count(serialized: string): number { return nonnegative(this.counter(serialized), 'Context counter result'); }
  private navigation(references = this.references): RecoveryNavigation {
    return { handle: 'knowledge-budget-ledger/v1', method: 'referencePage', offset: 0, limit: 16,
      totalReferences: references.size, readIdentity: 'layer/library/id/version/startLine/startColumn/endLine/endColumn' };
  }
  private measure(records: ActiveRecord[], references: Map<string, BudgetReference>): { serialized: string; count: number } {
    const serialized = JSON.stringify({ packets: records.map(value => value.packet), recovery: this.navigation(references) });
    return { serialized, count: this.count(serialized) };
  }
  private layerCount(records: ActiveRecord[], layer: ContextLayer): number {
    return this.count(JSON.stringify(records.filter(value => value.packet.layer === layer).map(value => value.packet)));
  }
  snapshot(): KnowledgeBudgetSnapshot {
    const measured = this.measure(this.records, this.references);
    const overflow = measured.count > this.budget.hard;
    return { packets: clone(this.records.map(value => value.packet)), recovery: this.navigation(), serializedContext: measured.serialized,
      tokenCount: measured.count, countMode: this.countMode, exact: this.exact,
      counterScope: this.exact ? 'serialized-context/reference-encoding' : 'serialized-context/estimate', targetModelExact: false,
      budget: { ...this.budget }, phaseId: this.phaseId, accepted: !overflow,
      status: overflow ? 'phase-handoff' : measured.count <= this.budget.target ? 'within-target' : 'headroom-used',
      ...(overflow ? { handoff: { reason: this.budget.modelHeadroomChecked ? 'model-input-exhausted' as const : 'knowledge-hard-limit' as const,
        phaseId: this.phaseId, requiredTokens: measured.count, availableTokens: this.budget.hard,
        action: 'split-phase-and-reread-versioned-evidence' as const } } : {}),
      softTriggered: this.softTriggered, compactedCount: this.compactedCount };
  }
  beginPhase(phaseId: string): KnowledgeBudgetSnapshot {
    if (!phaseId) throw new Error('A phase id is required');
    this.phaseId = phaseId;
    this.records = this.records.map(value => ({ ...value, neededNow: false }));
    this.softTriggered = false;
    return this.snapshot();
  }
  private remember(packet: ContextPacket, references: Map<string, BudgetReference>): void {
    const covered = new Set<string>();
    for (const piece of packet.pieces) {
      covered.add(identity(piece));
      const reference: BudgetReference = { layer: piece.layer, library: piece.library, id: piece.id, version: piece.version,
        startLine: piece.startLine, endLine: piece.endLine,
        ...(piece.startColumn === undefined ? {} : { startColumn: piece.startColumn }),
        ...(piece.endColumn === undefined ? {} : { endColumn: piece.endColumn }), contentOmitted: true };
      references.set(JSON.stringify(reference), reference);
    }
    for (const entry of packet.directory) if (!covered.has(identity(entry))) {
      const reference: BudgetReference = { layer: entry.layer, library: entry.library, id: entry.id, version: entry.version, contentOmitted: true };
      references.set(JSON.stringify(reference), reference);
    }
  }
  activate(packet: ContextPacket, activation: { neededNow?: boolean; stale?: boolean } = {}): KnowledgeBudgetSnapshot {
    if (packet.countMode !== this.countMode) throw new Error('Packet and controller must use the same count mode');
    let neededNow = activation.neededNow ?? true;
    const incoming = clone(packet);
    const incomingKeys = new Set(incoming.pieces.map(pieceIdentity));
    const incomingDocuments = new Set(incoming.directory.map(identity));
    const records: ActiveRecord[] = [];
    // Remove exact duplicate spans, preserving the stronger current-phase protection.
    for (const prior of this.records) {
      const copy = clone(prior);
      const duplicateIds = new Set(copy.packet.pieces.filter(value => incomingKeys.has(pieceIdentity(value))).map(identity));
      if (duplicateIds.size && copy.neededNow) neededNow = true;
      copy.packet.pieces = copy.packet.pieces.filter(value => !incomingKeys.has(pieceIdentity(value)));
      copy.packet.directory = copy.packet.directory.filter(value => !incomingDocuments.has(identity(value)) || copy.packet.pieces.some(piece => identity(piece) === identity(value)));
      if (copy.packet.pieces.length || copy.packet.directory.length) records.push(copy);
    }
    const references = new Map(this.references);
    let compacted = 0;
    // Navigation-only indexes are paged externally, never accumulated as active body.
    if (incoming.layer !== 'C' && !incoming.pieces.length) this.remember(incoming, references);
    else records.push({ packet: incoming, neededNow, stale: activation.stale ?? false, sequence: this.sequence + 1 });
    const evict = (record: ActiveRecord) => {
      this.remember(record.packet, references);
      records.splice(records.indexOf(record), 1); compacted++;
    };
    const optional = () => records.filter(value => value.packet.layer !== 'C' && !value.neededNow)
      .sort((a, b) => Number(b.stale) - Number(a.stale) || a.sequence - b.sequence);
    // Invalid bodies go first. C and current required evidence remain fixed.
    for (const value of optional().filter(value => value.stale)) evict(value);
    const softTriggered = this.measure(records, references).count > this.budget.soft;
    if (softTriggered) {
      for (const value of optional()) {
        if (this.measure(records, references).count <= this.budget.target) break;
        evict(value);
      }
    }
    // A/B limits guide cleanup; they never force deletion of required evidence.
    for (const layer of ['A', 'B'] as const) {
      const maximum = layer === 'A' ? this.budget.aActive : this.budget.bActive;
      for (const value of optional().filter(value => value.packet.layer === layer)) {
        if (this.layerCount(records, layer) <= maximum) break;
        evict(value);
      }
    }
    const measured = this.measure(records, references);
    const cCount = this.layerCount(records, 'C');
    const fixedOverflow = records.some(value => value.packet.layer === 'C') && cCount > this.budget.cMax;
    if (measured.count > this.budget.hard || fixedOverflow) {
      const modelLimited = this.budget.remainingInputTokens !== undefined && this.budget.remainingInputTokens <= this.budget.hard;
      return { ...this.snapshot(), accepted: false, status: 'phase-handoff', softTriggered,
        handoff: { reason: fixedOverflow ? 'fixed-c-hard-limit' : modelLimited ? 'model-input-exhausted' : 'knowledge-hard-limit',
          phaseId: this.phaseId, requiredTokens: fixedOverflow ? cCount : measured.count,
          availableTokens: fixedOverflow ? this.budget.cMax : this.budget.hard, action: 'split-phase-and-reread-versioned-evidence' } };
    }
    this.records = records; this.references = references; this.compactedCount += compacted;
    this.sequence++; this.softTriggered = softTriggered;
    return this.snapshot();
  }
  /** Page count covers entries and pagination; callers must budget a page if injected into a prompt. */
  referencePage(offset = 0, limit = 16, maxTokens = this.budget.aRead): ReferencePage {
    nonnegative(offset, 'offset'); nonnegative(limit, 'limit'); nonnegative(maxTokens, 'maxTokens');
    if (limit < 1 || limit > 64) throw new Error('Reference page limit must be between 1 and 64');
    const all = [...this.references.values()];
    const entries = all.slice(offset, offset + limit);
    while (true) {
      const nextOffset = offset + entries.length < all.length ? offset + entries.length : undefined;
      const serializedPage = JSON.stringify({ entries, total: all.length, ...(nextOffset === undefined ? {} : { nextOffset }), method: 'referencePage' });
      const tokenCount = this.count(serializedPage);
      if (tokenCount <= maxTokens) return { entries: clone(entries), total: all.length, ...(nextOffset === undefined ? {} : { nextOffset }),
        method: 'referencePage', tokenCount, serializedPage, countMode: this.countMode, exact: this.exact };
      if (!entries.length || (entries.length === 1 && offset < all.length)) throw new ContextBudgetError('A versioned recovery identity cannot fit the reference-page budget; split the phase.');
      entries.pop();
    }
  }
}
export function createKnowledgeBudgetController(options: KnowledgeBudgetOptions = {}): KnowledgeBudgetController {
  return new KnowledgeBudgetController(options);
}
