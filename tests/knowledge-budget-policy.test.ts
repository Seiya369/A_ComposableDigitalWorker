import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContextPacket } from '../src/knowledge/context.js';
import { BUDGET_PRESETS, createKnowledgeBudgetController } from '../scripts/knowledge-budget-policy.js';

// A deliberately synthetic counter tests policy arithmetic, not any model's tokenizer.
const counter = (serialized: string) => serialized.length;
const countMode = 'synthetic-code-units';
const options = { preset: 'target' as const, counter, countMode };
function packet(layer: 'A' | 'B' | 'C', id: string, length: number, library: 'team' | 'employee' = 'team', version = 1): ContextPacket {
  return { kind: 'workforce-knowledge-context', packetId: `${layer}/${library}/${id}/${version}`, layer,
    pieces: [{ layer, id, library, version, startLine: 1, endLine: 1, text: `${id}:` + '证'.repeat(length) }],
    directory: [{ layer, id, library, version }], metadata: { documentCount: 1, omittedDocumentCount: 0 },
    ...(layer === 'A' ? { reason: 'verify' as const } : {}), truncated: false, tokenEstimate: 0, countMode };
}

test('target policy has 32K daily, 48K soft and 64K shared hard budgets without altering production defaults', () => {
  const controller = createKnowledgeBudgetController(options);
  assert.equal(BUDGET_PRESETS.target.target, 32000);
  assert.equal(controller.snapshot().budget.soft, 48000);
  assert.equal(controller.snapshot().budget.hard, 64000);
  assert.equal(controller.snapshot().budget.cTarget, 4000);
  assert.equal(controller.snapshot().budget.cMax, 8000);
  assert.equal(controller.snapshot().budget.aRead, 4000);
});

test('current evidence and fixed C survive above both daily and soft thresholds unchanged', () => {
  const controller = createKnowledgeBudgetController(options);
  controller.beginPhase('compare-exceptions');
  const fixed = packet('C', 'index', 1800);
  controller.activate(fixed);
  const required = Array.from({ length: 16 }, (_, index) => packet('A', `source-${index}`, 3000, index % 2 ? 'employee' : 'team'));
  for (const value of required) assert.equal(controller.activate(value, { neededNow: true }).accepted, true);
  const result = controller.snapshot();
  assert.ok(result.tokenCount > result.budget.soft);
  assert.ok(result.tokenCount <= result.budget.hard);
  assert.equal(result.status, 'headroom-used');
  assert.deepEqual(result.packets, [fixed, ...required]);
  assert.equal(result.tokenCount, counter(result.serializedContext));
});

test('crossing soft compacts optional prior evidence back under target but protects current evidence', () => {
  const controller = createKnowledgeBudgetController(options);
  controller.beginPhase('old-phase');
  for (let index = 0; index < 6; index++) controller.activate(packet('B', `old-${index}`, 6500));
  controller.beginPhase('current-phase');
  const current = packet('A', 'required-negation-and-exception', 3000, 'employee', 7);
  controller.activate(current);
  const result = controller.activate(packet('B', 'current-required', 7500));
  assert.ok(result.softTriggered);
  assert.ok(result.tokenCount <= result.budget.target);
  assert.ok(result.packets.some(value => value.packetId === current.packetId));
  assert.ok(result.recovery.totalReferences > 0);
  const page = controller.referencePage(0, 16);
  assert.ok(page.entries.some(value => value.id.startsWith('old-') && value.library === 'team' && value.version === 1));
  assert.equal(result.recovery.method, 'referencePage');
});

test('when necessary evidence exceeds the shared hard limit it requires phases and rejects atomically', () => {
  const controller = createKnowledgeBudgetController(options);
  controller.beginPhase('all-necessary');
  for (let index = 0; index < 24; index++) {
    const result = controller.activate(packet('A', `essential-${index}`, 3000));
    if (!result.accepted) {
      assert.equal(result.status, 'phase-handoff');
      assert.equal(result.handoff?.reason, 'knowledge-hard-limit');
      assert.ok(result.handoff!.requiredTokens > result.handoff!.availableTokens);
      assert.deepEqual(controller.snapshot().packets, result.packets);
      assert.ok(!result.packets.some(value => value.packetId.includes(`essential-${index}/`)));
      return;
    }
  }
  assert.fail('the 64K hard bound must refuse the overflowing evidence');
});

test('compaction releases space for later reads without permanently reducing its capacity', () => {
  const controller = createKnowledgeBudgetController(options);
  controller.beginPhase('one');
  for (let index = 0; index < 6; index++) controller.activate(packet('B', `old-${index}`, 6500));
  controller.beginPhase('two');
  for (let index = 0; index < 6; index++) assert.equal(controller.activate(packet('B', `fresh-${index}`, 6500)).accepted, true);
  const result = controller.snapshot();
  assert.equal(result.budget.hard, 64000);
  assert.ok(result.tokenCount > result.budget.target);
  assert.equal(result.packets.filter(value => value.pieces.some(piece => piece.id.startsWith('fresh-'))).length, 6);
});

test('duplicate spans across packets are stored once and keep current protection', () => {
  const controller = createKnowledgeBudgetController(options);
  const first = packet('B', 'same', 5000);
  controller.activate(first);
  const duplicate = { ...structuredClone(first), packetId: 'second-copy' };
  const result = controller.activate(duplicate, { neededNow: false });
  assert.equal(result.packets.flatMap(value => value.pieces).length, 1);
  assert.equal(result.recovery.totalReferences, 0);
});

test('64K models reserve output then shrink knowledge to at most 20% of input capacity', () => {
  const controller = createKnowledgeBudgetController({ ...options, modelContextTokens: 64000, reservedOutputTokens: 8000 });
  const { budget } = controller.snapshot();
  assert.equal(budget.hard, Math.floor((64000 - 8000) * 0.2));
  assert.ok(budget.target < 8000);
  assert.ok(budget.aRead < BUDGET_PRESETS.target.aRead);
  assert.ok(budget.cMax < BUDGET_PRESETS.target.cMax);
  assert.equal(budget.modelHeadroomChecked, true);
});

test('remaining input capacity overrides the percentage and explicitly refuses a full context', () => {
  const controller = createKnowledgeBudgetController({ ...options, modelContextTokens: 64000, reservedOutputTokens: 8000, otherInputTokens: 55600 });
  assert.equal(controller.snapshot().budget.hard, 400);
  const result = controller.activate(packet('A', 'required', 1000));
  assert.equal(result.accepted, false);
  assert.equal(result.handoff?.reason, 'model-input-exhausted');
  assert.equal(result.packets.length, 0);
});

test('a fully reserved model input cannot even accept the recovery envelope', () => {
  const controller = createKnowledgeBudgetController({ ...options, modelContextTokens: 64000, reservedOutputTokens: 8000, otherInputTokens: 56000 });
  const result = controller.snapshot();
  assert.equal(result.budget.hard, 0);
  assert.equal(result.accepted, false);
  assert.equal(result.handoff?.reason, 'model-input-exhausted');
});

test('stale optional content is retired before useful optional content and C cannot be retired', () => {
  const controller = createKnowledgeBudgetController(options);
  const fixed = packet('C', 'fixed', 1800);
  const useful = packet('B', 'useful', 5000);
  controller.activate(fixed);
  controller.activate(useful, { neededNow: false });
  const result = controller.activate(packet('B', 'invalidated', 5000, 'employee', 9), { neededNow: false, stale: true });
  assert.deepEqual(result.packets, [fixed, useful]);
  assert.equal(controller.referencePage().entries[0]?.id, 'invalidated');
  const refusal = controller.activate(packet('C', 'cannot-shrink-c', 7500));
  assert.equal(refusal.accepted, false);
  assert.equal(refusal.handoff?.reason, 'fixed-c-hard-limit');
  assert.deepEqual(controller.snapshot().packets, [fixed, useful]);
});

test('no tokenizer reports an upper bound and a reference tokenizer never claims target-model exactness', () => {
  const fallback = createKnowledgeBudgetController({ exactCounter: true }).snapshot();
  assert.equal(fallback.exact, false);
  assert.equal(fallback.countMode, 'utf8-byte-upper-bound');
  assert.equal(createKnowledgeBudgetController({ countMode: 'pretend-model-tokenizer' }).snapshot().countMode, 'utf8-byte-upper-bound');
  const reference = createKnowledgeBudgetController({ ...options, exactCounter: true }).snapshot();
  assert.equal(reference.exact, true);
  assert.equal(reference.counterScope, 'serialized-context/reference-encoding');
  assert.equal(reference.targetModelExact, false);
});

test('retired indexes remain paged and recoverable without growing the active prompt', () => {
  const controller = createKnowledgeBudgetController(options);
  controller.beginPhase('navigation');
  const navigation = packet('B', 'nav', 0);
  navigation.pieces = [];
  navigation.directory = Array.from({ length: 1200 }, (_, index) => ({ layer: 'B' as const, library: index % 2 ? 'team' as const : 'employee' as const, id: `source-${index}`, version: index + 1 }));
  navigation.metadata.navigationOnly = true;
  const result = controller.activate(navigation, { neededNow: false });
  assert.equal(result.accepted, true);
  assert.equal(result.recovery.totalReferences, 1200);
  assert.ok(result.tokenCount < 1000);
  const page = controller.referencePage(17, 3);
  assert.deepEqual(page.entries.map(value => [value.id, value.version]), [['source-17', 18], ['source-18', 19], ['source-19', 20]]);
  assert.equal(page.nextOffset, 20);
  assert.ok(page.tokenCount <= result.budget.aRead);
});
