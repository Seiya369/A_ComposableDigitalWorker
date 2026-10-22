import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { countContextTokens, type ContextPiece } from '../src/knowledge/context.js';
import { runContextTask, taskDocuments, type ContextTaskRun } from '../scripts/knowledge-context-task.js';
import { knowledgeBudgetCandidates, knowledgeContextTasks, type KnowledgeContextTask } from './fixtures/knowledge-context-tasks.js';

test('context benchmark gold comes from authored evidence and valid versioned source locations', () => {
  assert.ok(knowledgeContextTasks.length >= 12);
  assert.equal(new Set(knowledgeContextTasks.map(task => task.id)).size, knowledgeContextTasks.length);
  for (const task of knowledgeContextTasks) {
    assert.ok(task.query.length > 20, task.id);
    assert.ok(task.gold.length > 0, `${task.id}: no gold evidence`);
    for (const source of task.sources) {
      assert.ok(source.id.length <= 200, `${task.id}: source ID must be ingestible`);
      assert.ok(Buffer.byteLength(source.title) <= 1600, `${task.id}: title must be ingestible`);
      assert.ok(Buffer.byteLength(source.provenance) <= 8000, `${task.id}: provenance must be ingestible`);
    }
    for (const gold of task.gold) {
      let evidence: string;
      if (gold.layer === 'A') {
        const source = task.sources.find(item => item.id === gold.id);
        assert.ok(source, `${task.id}: unknown A ${gold.id}`);
        assert.equal(source.version, gold.sourceVersion, `${task.id}: source version`);
        assert.ok(gold.startLine && gold.endLine && gold.startLine <= gold.endLine, `${task.id}: missing location`);
        evidence = source.text.split('\n').slice(gold.startLine - 1, gold.endLine).join('\n');
      } else if (gold.layer === 'B') {
        const entry = task.compilation.entries.find(item => item.id === gold.id);
        assert.ok(entry, `${task.id}: unknown B ${gold.id}`);
        evidence = entry.content;
      } else {
        const overview = task.compilation.overview.find(item => item.id === gold.id);
        assert.ok(overview, `${task.id}: unknown C ${gold.id}`);
        evidence = `${overview.title}\n${overview.summary}`;
      }
      for (const fragment of gold.fragments) assert.ok(evidence.includes(fragment), `${task.id}: invalid gold ${fragment}`);
    }
    for (const entry of task.compilation.entries) {
      for (const citation of entry.citations) {
        const raw = task.sources.find(item => item.id === citation.sourceId);
        assert.ok(raw && raw.version === citation.sourceVersion, `${task.id}: B → A source version`);
        assert.ok(citation.startLine >= 1 && citation.endLine <= raw.text.split('\n').length, `${task.id}: B → A line range`);
      }
    }
  }
});

function sourceSpan(content: string, piece: ContextPiece): string {
  const lines = content.split('\n');
  let start = lines.slice(0, piece.startLine - 1).reduce((sum, line) => sum + line.length + 1, 0);
  let end = lines.slice(0, piece.endLine - 1).reduce((sum, line) => sum + line.length + 1, 0);
  start += (piece.startColumn ?? 1) - 1;
  end += (piece.endColumn ?? lines[piece.endLine - 1]!.length + 1) - 1;
  return content.slice(start, end);
}

export function scoreContextTask(task: KnowledgeContextTask, run: ContextTaskRun) {
  const returned = run.trace.flatMap(item => item.packet.pieces);
  const active = run.snapshot.packets.flatMap(item => item.pieces);
  const documents = taskDocuments(task);
  const isCovered = (pieces: ContextPiece[], layer: string, id: string, fragment: string) =>
    pieces.some(piece => piece.layer === layer && piece.id === id && piece.text.includes(fragment));
  const gold = task.gold.flatMap(item => item.fragments.map(fragment => ({ ...item, fragment })));
  const returnedCoverage = gold.filter(item => isCovered(returned, item.layer, item.id, item.fragment));
  const activeCoverage = gold.filter(item => isCovered(active, item.layer, item.id, item.fragment));
  const invalidPieces = returned.filter(piece => {
    const document = documents.find(item => item.layer === piece.layer && item.id === piece.id && item.version === piece.version && item.library === piece.library);
    if (!document || piece.startLine < 1 || piece.endLine > document.content.split('\n').length || piece.startLine > piece.endLine) return true;
    return sourceSpan(document.content, piece) !== piece.text;
  });
  const invalidLinks = run.trace.flatMap(item => item.packet.pieces.map(piece => ({ packet: item.packet, piece }))).filter(({ packet, piece }) => {
    const directory = packet.directory.find(item => item.layer === piece.layer && item.id === piece.id && item.version === piece.version && item.library === piece.library);
    if (!directory) return true;
    if (piece.layer === 'B') {
      const entry = task.compilation.entries.find(item => item.id === piece.id);
      return JSON.stringify(directory.citations) !== JSON.stringify(entry?.citations);
    }
    if (piece.layer === 'C') {
      const overview = task.compilation.overview.find(item => item.id === piece.id);
      return JSON.stringify(directory.entryIds) !== JSON.stringify(overview?.entryIds);
    }
    return false;
  });
  const activeReferenceCoverage = activeCoverage.filter(item => item.layer !== 'A' || active.some(piece =>
    piece.layer === item.layer && piece.id === item.id && piece.version === item.sourceVersion && piece.text.includes(item.fragment)
    && piece.startLine <= item.endLine! && piece.endLine >= item.startLine!));
  const noise = new Set(task.noiseIds);
  const noiseC = new Set(task.compilation.overview.filter(item => item.entryIds.every(id => noise.has(id))).map(item => item.id));
  const selectedBytes = active.reduce((sum, item) => sum + Buffer.byteLength(item.text), 0);
  const noiseBytes = active.filter(item => noise.has(item.id) || noiseC.has(item.id)).reduce((sum, item) => sum + Buffer.byteLength(item.text), 0);
  const layerOverflows = run.trace.filter(item => item.actualTokens > item.maxTokens);
  const activeOverflows = run.trace.filter(item => item.activeActualTokens > run.budget.totalTokens || item.activeTokens > run.budget.totalTokens);
  const finalLayerOverflows = [
    ['C', run.budget.cTokens], ['B', run.budget.bActiveTokens], ['A', run.budget.aActiveTokens],
  ].filter(([layer, limit]) => countContextTokens(run.snapshot.packets.filter(item => item.layer === layer)) > Number(limit));
  return {
    taskId: task.id, label: task.label, budget: run.budget.name, countMode: run.countMode,
    goldFragments: gold.length, returnedGold: returnedCoverage.length, activeGold: activeCoverage.length,
    activeReferencedGold: activeReferenceCoverage.length, invalidPieces: invalidPieces.length, invalidLinks: invalidLinks.length,
    missingReturned: gold.filter(item => !returnedCoverage.includes(item)).map(item => `${item.layer}:${item.id}:${item.fragment}`),
    missingActive: gold.filter(item => !activeCoverage.includes(item)).map(item => `${item.layer}:${item.id}:${item.fragment}`),
    selectedBytes, noiseBytes, noiseRatio: selectedBytes ? Number((noiseBytes / selectedBytes).toFixed(4)) : 0,
    perReadOverflows: layerOverflows.length, activeOverflows: activeOverflows.length + finalLayerOverflows.length,
    readHops: run.trace.filter(item => item.packet.layer !== 'C').length,
    maxActiveEstimate: Math.max(0, ...run.trace.map(item => item.activeTokens)),
    finalActiveEstimate: run.snapshot.tokenEstimate, compactedCount: run.snapshot.compactedCount,
    duplicateGrowth: run.trace.reduce((sum, item) => sum + item.duplicateGrowth, 0),
    unresolvedContinuations: run.unresolvedContinuations, errors: run.errors,
  };
}

test('authored tasks compare three real context budgets without exceeding any envelope', async () => {
  const results = knowledgeBudgetCandidates.flatMap(budget => knowledgeContextTasks.map(task => scoreContextTask(task, runContextTask(task, budget))));
  const summary = knowledgeBudgetCandidates.map(budget => {
    const cases = results.filter(item => item.budget === budget.name);
    return {
      budget, cases: cases.length, goldFragments: cases.reduce((sum, item) => sum + item.goldFragments, 0),
      returnedGold: cases.reduce((sum, item) => sum + item.returnedGold, 0), activeGold: cases.reduce((sum, item) => sum + item.activeGold, 0),
      activeReferencedGold: cases.reduce((sum, item) => sum + item.activeReferencedGold, 0),
      fullActiveCases: cases.filter(item => item.activeGold === item.goldFragments && item.activeReferencedGold === item.goldFragments && !item.errors.length).length,
      overflows: cases.reduce((sum, item) => sum + item.perReadOverflows + item.activeOverflows, 0),
      invalidPieces: cases.reduce((sum, item) => sum + item.invalidPieces, 0), invalidLinks: cases.reduce((sum, item) => sum + item.invalidLinks, 0), readHops: cases.reduce((sum, item) => sum + item.readHops, 0),
      errors: cases.reduce((sum, item) => sum + item.errors.length, 0), duplicateGrowth: cases.reduce((sum, item) => sum + item.duplicateGrowth, 0),
    };
  });
  if (process.env.KNOWLEDGE_CONTEXT_REPORT_DIR) {
    const output = resolve(process.env.KNOWLEDGE_CONTEXT_REPORT_DIR);
    await mkdir(output, { recursive: true });
    const boundSources = await Promise.all(['src/knowledge/context.ts', 'tests/fixtures/knowledge-context-tasks.ts', 'scripts/knowledge-context-task.ts', 'tests/knowledge-context-benchmark.test.ts']
      .map(async file => ({ file, sha256: createHash('sha256').update(await readFile(resolve(file))).digest('hex') })));
    await writeFile(join(output, 'retrieval-report.json'), `${JSON.stringify({
      dataset: 'knowledge-context-authored-v1', scope: 'Offline authored evidence selection and active-context retention. No model answer quality is inferred.',
      counter: 'Conservative UTF-8 byte upper bound, including serialized packet metadata; not an exact provider tokenizer.',
      generatedAt: new Date().toISOString(), boundSources, summary, results,
    }, null, 2)}\n`);
    const rows = summary.map(item => `| ${item.budget.name} | ${item.returnedGold}/${item.goldFragments} | ${item.activeGold}/${item.goldFragments} | ${item.activeReferencedGold}/${item.goldFragments} | ${item.fullActiveCases}/${item.cases} | ${item.overflows} | ${item.readHops} | ${item.errors} |`);
    await writeFile(join(output, 'retrieval-report.md'), [
      '# ABC 上下文离线任务评估', '',
      '范围：14 个手工任务，三档预算，共 42 次生产选择器与活跃上下文池运行。检索路线由语料预先给定；不评价模型自主检索或回答质量。', '',
      '计数：完整序列化知识包的 UTF-8 字节保守上界，不是模型实际 tokenizer。所有元数据计入预算。', '',
      '| 档位 | 返回证据 | 最终活跃证据 | 正确引用证据 | 完整任务 | 溢出 | 读取次数 | 错误 |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |', ...rows, '',
      'gold 包含逐字数值、命令、接口、否定、例外、冲突状态、候选证据、版本和原文行定位。返回覆盖与最终活跃覆盖分别统计；曾经读到但后来被收拢的内容不冒充当前仍在场。', '',
      '本组任务中 balanced 档保留全部关键证据，expanded 档没有增加覆盖；compact 档存在证据缺失和最小引用包放不下的错误。因此将 12K 保守估算总预算作为当前默认候选，继续通过独立模型回答测试核验。这个结果不证明对任意任务都最优。', '',
      '噪声比例只计算标注明确无关的文档，不将同一相关文档中未标为 gold 的其他内容一律判为噪声。详细缺失片段、压缩次数、引用和每任务结果见 JSON。', '',
    ].join('\n'));
  }
  console.log(`Context task budget summary: ${JSON.stringify(summary)}`);
  assert.equal(results.reduce((sum, item) => sum + item.perReadOverflows + item.activeOverflows, 0), 0, 'serialized per-read and active budgets must hold');
  assert.equal(results.reduce((sum, item) => sum + item.invalidPieces, 0), 0, 'every returned span must match the original version and exact coordinates');
  assert.equal(results.reduce((sum, item) => sum + item.invalidLinks, 0), 0, 'selected C → B and B → A links must remain exact');
  assert.equal(results.reduce((sum, item) => sum + item.duplicateGrowth, 0), 0, 'immediate identical activations must not grow the pool');
  const selected = summary.find(item => item.budget.name === 'balanced')!;
  assert.equal(selected.fullActiveCases, knowledgeContextTasks.length, 'balanced default must retain all authored required evidence with exact references');
});
