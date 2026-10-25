import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { createContextPacket, countContextTokens, type ContextPiece, type ContextDocument } from '../src/knowledge/context.js';
import { referenceTokenCounter, REFERENCE_TOKEN_COUNT_MODE, TOKEN_COUNTER_METADATA } from '../scripts/knowledge-token-counter.js';
import { BUDGET_PRESETS } from '../scripts/knowledge-budget-policy.js';
import { runLargeContextTask, largeTaskCLI, type LargeTaskRun, type LargeBudgetName } from '../scripts/knowledge-context-large-task.js';
import { largeKnowledgeTasks, largeTaskDocumentKey, type LargeKnowledgeTask } from './fixtures/knowledge-context-large-tasks.js';

function offsets(document: ContextDocument, piece: ContextPiece) {
  const lines = document.content.split('\n'); const starts: number[] = []; let offset = 0;
  for (const line of lines) { starts.push(offset); offset += line.length + 1; }
  return { start: starts[piece.startLine - 1]! + (piece.startColumn ?? 1) - 1,
    end: starts[piece.endLine - 1]! + (piece.endColumn ?? lines[piece.endLine - 1]!.length + 1) - 1 };
}
function originalSpan(document: ContextDocument, piece: ContextPiece) { const { start, end } = offsets(document, piece); return document.content.slice(start, end); }
function coverage(document: ContextDocument, pieces: ContextPiece[]) {
  const matching = pieces.filter(piece => piece.id === document.id && piece.version === document.version && piece.layer === document.layer);
  const spans = matching.map(piece => offsets(document, piece)).sort((a, b) => a.start - b.start);
  const uncovered: Array<{ start: number; end: number }> = []; let next = 0;
  for (const span of spans) { if (span.start > next) uncovered.push({ start: next, end: span.start }); next = Math.max(next, span.end); }
  if (next < document.content.length) uncovered.push({ start: next, end: document.content.length });
  const missing = uncovered.filter(span => document.content.slice(span.start, span.end).trim());
  return { complete: !missing.length, missingNonWhitespaceChars: missing.reduce((sum, span) => sum + document.content.slice(span.start, span.end).replace(/\s/g, '').length, 0) };
}
export function scoreLargeContextTask(task: LargeKnowledgeTask, run: LargeTaskRun) {
  const accepted = run.trace.filter(read => read.accepted); const returned = accepted.flatMap(read => read.packet.pieces);
  const active = run.snapshot.packets.flatMap(packet => packet.pieces);
  const byKey = new Map(task.documents.map(doc => [JSON.stringify([doc.layer, doc.library, doc.id, doc.version]), doc]));
  const invalidPieces = returned.filter(piece => { const doc = byKey.get(JSON.stringify([piece.layer, piece.library, piece.id, piece.version])); return !doc || originalSpan(doc, piece) !== piece.text; });
  const invalidLinks = accepted.flatMap(read => read.packet.pieces.map(piece => ({ packet: read.packet, piece }))).filter(({ packet, piece }) => {
    const directory = packet.directory.find(entry => entry.id === piece.id && entry.version === piece.version && entry.layer === piece.layer && entry.library === piece.library);
    const doc = byKey.get(JSON.stringify([piece.layer, piece.library, piece.id, piece.version]));
    return !directory || JSON.stringify(directory.citations) !== JSON.stringify(doc?.citations) || JSON.stringify(directory.entryIds) !== JSON.stringify(doc?.entryIds) || directory.verified !== doc?.verified;
  });
  const found = (pieces: ContextPiece[], gold: LargeKnowledgeTask['gold'][number]) => pieces.some(piece => piece.id === gold.id && piece.version === gold.version && piece.text.includes(gold.fragment));
  const returnedGold = task.gold.filter(gold => found(returned, gold)); const activeGold = task.gold.filter(gold => found(active, gold));
  const references = run.recoveryReferences as Array<{ layer?: string; id?: string; version?: number; startLine?: number; endLine?: number }>;
  const invalidRecoveryReferences = references.filter(ref => {
    const doc = task.documents.find(doc => doc.id === ref.id && doc.version === ref.version && doc.layer === ref.layer);
    return !doc || (ref.startLine !== undefined && (ref.startLine < 1 || ref.endLine! > doc.content.split('\n').length));
  });
  let exactRereadGold = 0; const missingRecoveryGold: string[] = [];
  for (const gold of task.gold) {
    if (found(active, gold)) { exactRereadGold++; continue; }
    const recoverable = references.some(ref => ref.id === gold.id && ref.version === gold.version);
    if (!recoverable) { missingRecoveryGold.push(`${gold.id}@${gold.version}: ${gold.fragment}`); continue; }
    const document = task.documents.find(doc => doc.id === gold.id && doc.version === gold.version)!;
    const row = document.content.split('\n').findIndex(line => line.includes(gold.fragment)) + 1;
    const packet = createContextPacket([document], { startLine: row, endLine: row, maxTokens: 1800, counter: referenceTokenCounter, countMode: REFERENCE_TOKEN_COUNT_MODE,
      ...(document.layer === 'A' ? { reason: 'verify' as const } : {}) });
    if (found(packet.pieces, gold)) exactRereadGold++; else missingRecoveryGold.push(`${gold.id}@${gold.version}: ${gold.fragment}`);
  }
  const phaseResults = run.phaseSnapshots.map(({ phase, snapshot }) => {
    const definition = task.phases.find(item => item.id === phase)!;
    const required = task.documents.filter(doc => definition.requiredDocs.includes(largeTaskDocumentKey(doc)));
    const active = snapshot.packets.flatMap(packet => packet.pieces);
    const details = required.map(doc => ({ key: largeTaskDocumentKey(doc), ...coverage(doc, active) }));
    return { phase, activeTokens: snapshot.tokenCount, accepted: snapshot.accepted, status: snapshot.status,
      softTriggered: snapshot.softTriggered, compactedCount: snapshot.compactedCount,
      requiredDocuments: details.length, completeRequiredDocuments: details.filter(doc => doc.complete).length,
      missingRequired: details.filter(doc => !doc.complete), handoff: snapshot.handoff };
  });
  const necessarySourceTokens = task.phases.map(phase => ({ phase: phase.id,
    referenceTokens: referenceTokenCounter(JSON.stringify(task.documents.filter(doc => phase.requiredDocs.includes(largeTaskDocumentKey(doc))))) }));
  const finalPhase = task.phases.find(phase => phase.id === run.snapshot.phaseId);
  const requiredGold = task.gold.filter(gold => finalPhase?.requiredDocs.includes(`${gold.id}@${gold.version}`));
  return { taskId: task.id, label: task.label, budget: run.budget, routeLabel: task.routeLabel, records: task.rowCount,
    sourceTokens: referenceTokenCounter(JSON.stringify(task.documents)), necessarySourceTokens,
    goldCheckpoints: task.gold.length, returnedGold: returnedGold.length, activeGold: activeGold.length,
    activeRequiredGold: requiredGold.filter(gold => found(active, gold)).length, currentRequiredGold: requiredGold.length,
    availableWithExactRereadGold: exactRereadGold, missingRecoveryGold,
    missingReturnedGold: task.gold.filter(gold => !found(returned, gold)),
    invalidPieces: invalidPieces.length, invalidLinks: invalidLinks.length, invalidRecoveryReferences: invalidRecoveryReferences.length,
    packetOverflows: run.trace.filter(read => read.packetTokens > read.maxTokens).length,
    activeOverflows: run.trace.filter(read => read.activeTokens > BUDGET_PRESETS[run.budget].hard).length,
    maxActiveTokens: Math.max(0, ...run.trace.map(read => read.activeTokens)), finalActiveTokens: run.snapshot.tokenCount,
    producedPacketTokens: run.trace.reduce((sum, read) => sum + read.packetTokens, 0),
    readHops: run.trace.length, acceptedReads: accepted.length, rejectedReads: run.trace.filter(read => !read.accepted).length,
    compactedCount: run.snapshot.compactedCount, referenceCount: run.snapshot.recovery.totalReferences,
    rereadDocumentKeys: run.rereadDocumentKeys, phasesCompleted: run.phasesCompleted, phases: phaseResults,
    status: run.snapshot.status, handoff: run.snapshot.handoff, unresolvedContinuations: run.unresolvedContinuations, errors: run.errors,
    allRequiredPhasesComplete: phaseResults.length === task.phases.length && phaseResults.every(phase => phase.completeRequiredDocuments === phase.requiredDocuments),
  };
}

test('eight substantive large tasks compare 12K, 32/48/64K and 96K using an actual reference tokenizer', async () => {
  const files = ['src/knowledge/context.ts', 'scripts/knowledge-budget-policy.ts', 'scripts/knowledge-token-counter.ts', 'scripts/knowledge-context-large-task.ts', 'tests/fixtures/knowledge-context-large-tasks.ts', 'tests/knowledge-context-large-benchmark.test.ts'];
  const hashes = () => Promise.all(files.map(async file => ({ file, sha256: createHash('sha256').update(await readFile(resolve(file))).digest('hex') })));
  const boundSourcesBefore = await hashes();
  const candidates: LargeBudgetName[] = ['tight', 'target', 'roomy'];
  const results: ReturnType<typeof scoreLargeContextTask>[] = [];
  for (const budget of candidates) for (const task of largeKnowledgeTasks) {
    const run = runLargeContextTask(task, budget); results.push(scoreLargeContextTask(task, run));
  }
  const summary = candidates.map(budget => {
    const rows = results.filter(row => row.budget === budget);
    return { budget, policy: BUDGET_PRESETS[budget], cases: rows.length, fullEvidenceCases: rows.filter(row => row.allRequiredPhasesComplete).length,
      gold: rows.reduce((sum, row) => sum + row.goldCheckpoints, 0), returnedGold: rows.reduce((sum, row) => sum + row.returnedGold, 0),
      rereadAvailableGold: rows.reduce((sum, row) => sum + row.availableWithExactRereadGold, 0),
      handoffs: rows.filter(row => row.status === 'phase-handoff').length, compacted: rows.reduce((sum, row) => sum + row.compactedCount, 0),
      errors: rows.reduce((sum, row) => sum + row.errors.length, 0), maxActiveTokens: Math.max(...rows.map(row => row.maxActiveTokens)) };
  });
  const output = resolve(process.env.KNOWLEDGE_LARGE_REPORT_DIR ?? 'artifacts/knowledge-budget-large-2026-10-22');
  await mkdir(output, { recursive: true });
  const boundSources = await hashes();
  const sourcesStableDuringRun = JSON.stringify(boundSourcesBefore) === JSON.stringify(boundSources);
  await writeFile(join(output, 'large-retrieval-report.json'), `${JSON.stringify({ dataset: 'knowledge-context-large-authored-v1', generatedAt: new Date().toISOString(),
    scope: 'Offline source extraction, phase retention, refusal and exact reread. Authored retrieval routes; does not establish autonomous retrieval or model answer quality.',
    counter: TOKEN_COUNTER_METADATA, modelWindow: 'Explicit 1000000-token synthetic test envelope with 16000 output reserved, not the answering model window.',
    goldMethod: 'Answer checkpoints and expected answers are authored independently; full required-source coverage is a separate integrity metric. All business rows are relevant; no non-gold text is automatically counted as noise.',
    boundSources, sourcesStableDuringRun, summary, results }, null, 2)}\n`);
  const failures = results.filter(row => !row.allRequiredPhasesComplete || row.errors.length || row.missingRecoveryGold.length);
  await writeFile(join(output, 'large-retrieval-failures.json'), `${JSON.stringify(failures, null, 2)}\n`);
  await writeFile(join(output, 'large-retrieval-report.md'), ['# 大型ABC证据任务评估', '',
    '8个合成任务×3档预算；每项336–576条业务记录。所有必需页逐字完整性与独立手写关键值分别统计；预给检索路线，不等同模型自主检索或答案正确率。', '',
    '使用真实tiktoken o200k_base参考分词，计入序列化知识包、元数据与回读导航；不声称匹配GPT-6或DeepSeek分词。K=1000。', '',
    '| 候选 | 完整必需阶段任务 | 返回关键值 | 活跃或精确回读 | 阶段移交 | 收拢包 | 峰值参考tokens |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...summary.map(row => `| ${row.budget} | ${row.fullEvidenceCases}/${row.cases} | ${row.returnedGold}/${row.gold} | ${row.rereadAvailableGold}/${row.gold} | ${row.handoffs} | ${row.compacted} | ${row.maxActiveTokens} |`), '',
    'hard限制触发后的缺页、被拒绝阶段和未读取gold保留在large-retrieval-failures.json，不能记为成功。已经收拢的证据仅在版本身份存在且实际按原始行回读成功时计为可回读。当前必要证据不能为达到32K目标而被丢弃。', '',
    '详见JSON中的每阶段完整页数、必需正文计数、真实失败、源码SHA-256。该试验不能证明正式插件交付验收通过。', '' ].join('\n'));
  console.log(`Large task summary: ${JSON.stringify(summary)}`);
  assert.equal(sourcesStableDuringRun, true, 'source hashes must remain stable throughout the benchmark');
  assert.equal(results.reduce((sum, row) => sum + row.invalidPieces + row.invalidLinks + row.invalidRecoveryReferences + row.packetOverflows + row.activeOverflows, 0), 0, 'budget and exact original source identities/spans must hold');
  assert.equal(results.reduce((sum, row) => sum + row.errors.length, 0), 0, 'operational failures must not be silently classified as expected budget handoffs');
  const targetRequired = results.find(row => row.budget === 'target' && row.taskId === 'large-required-over32')!;
  assert.ok(targetRequired.necessarySourceTokens[0]!.referenceTokens > 32000 && targetRequired.necessarySourceTokens[0]!.referenceTokens < 64000, 'same-phase required source fixture genuinely exceeds 32K and fits 64K');
  assert.equal(targetRequired.allRequiredPhasesComplete, true, 'all currently necessary evidence above the ordinary target must remain verbatim');
  assert.ok(targetRequired.finalActiveTokens > 32000, '32K is an operating target, not a mandatory evidence cap');
  const hard = results.find(row => row.budget === 'target' && row.taskId === 'large-hard64-handoff')!;
  assert.ok(hard.necessarySourceTokens[0]!.referenceTokens > 64000, 'atomic source fixture genuinely exceeds 64K');
  assert.equal(hard.status, 'phase-handoff'); assert.ok(hard.rejectedReads > 0); assert.equal(hard.allRequiredPhasesComplete, false);
  const roomyHard = results.find(row => row.budget === 'roomy' && row.taskId === 'large-hard64-handoff')!;
  assert.equal(roomyHard.allRequiredPhasesComplete, true, '96K comparison must actually retain the complete atomic task');
  assert.ok(results.filter(row => row.budget === 'target').some(row => row.compactedCount > 0 && row.rereadDocumentKeys.length > 0 && row.producedPacketTokens > 64000), 'long histories must cross64K, compact and reread original versions');
  assert.ok(results.filter(row => row.budget === 'target').some(row => row.phases.some(phase => phase.softTriggered && phase.compactedCount > 0)), 'real serialized context must activate48K soft collection of optional content');
});

test('large task CLI exposes only task/evidence and bounded pages', () => {
  const output = largeTaskCLI(['question', 'large-required-over32']) as Record<string, unknown>;
  assert.equal(Object.hasOwn(output, 'gold'), false); assert.equal(Object.hasOwn(output, 'expectedAnswer'), false);
  const manifest = largeTaskCLI(['manifest', 'large-required-over32', 'target', '--page', '2', '--page-size', '2']) as { documents: { items: unknown[] } };
  assert.equal(manifest.documents.items.length, 2);
  const read = largeTaskCLI(['read', 'large-zh-contract-audit', 'target', '--doc', 'payment-rules-1', '--start-line', '2', '--end-line', '2']) as { packet: { pieces: ContextPiece[] } };
  assert.ok(read.packet.pieces[0]?.text.includes('每笔上限=18007 分'));
});
