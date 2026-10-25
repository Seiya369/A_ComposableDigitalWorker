import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createWikiRuntime, LLM_WIKI_ENGINE } from '../src/knowledge/wiki-runtime.js';
import type { WikiBuildRequest } from '../src/knowledge/wiki-types.js';
import { build as bundle } from 'esbuild';

let enginePath: string;
let buildDirectory: string;
before(async () => {
  buildDirectory = await mkdtemp(resolve(tmpdir(), 'shared-wiki-test-build-'));
  enginePath = resolve(buildDirectory, 'engine.cjs');
  await bundle({ entryPoints: [resolve('third_party/llm-wiki/engine.ts')], outfile: enginePath, absWorkingDir: resolve('.'), bundle: true, platform: 'node', format: 'cjs', target: 'node22' });
});
after(async () => { if (buildDirectory) await rm(buildDirectory, { recursive: true, force: true }); });
function fixture(spaceId: string, marker: string): WikiBuildRequest {
  const citation = { sourceId: 'same-id', sourceVersion: 1, startLine: 1, endLine: 2 };
  return { spaceId, sources: [{ id: 'same-id', title: `${marker} 原始资料`, content: `${marker} 原始内容\n第二行`, text: `${marker} 原始内容\n第二行`, provenance: 'test', verified: false, version: 1, hash: 'hash', createdAt: '2026-10-24', processing: [] }], snapshot: {
    version: 1, sourceFingerprint: 'same-fingerprint', createdAt: '2026-10-24', status: 'candidate',
    entries: [{ id: 'same-id', title: `${marker} 文章`, content: `${marker} 正文`, citations: [citation] }],
    overview: [{ id: 'same-id', title: `${marker} 导航`, summary: `${marker} 概览`, entryIds: ['same-id'] }],
    conceptGraph: { schemaVersion: 1, concepts: [
      { id: 'same-id', name: `${marker} 概念`, summary: `${marker} 概念说明`, aliases: [`${marker}别名`], entryIds: ['same-id'], citations: [citation] },
      { id: 'entity', name: `${marker} 实体`, summary: `${marker} 实体说明`, kind: 'entity', entryIds: ['same-id'], citations: [citation] } as never,
    ], relations: [{ id: 'same-id', sourceId: 'same-id', targetId: 'entity', predicate: '用于', basis: 'inferred', summary: `${marker} 待验证关联`, entryIds: ['same-id'], citations: [{ ...citation, startLine: 2 }] }] },
  } };
}
function enginePids(): number[] {
  if (process.platform === 'win32') return [];
  return execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).split('\n').flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    return match && Number(match[2]) === process.pid && match[3].includes(enginePath) ? [Number(match[1])] : [];
  });
}

test('one pinned shared engine builds isolated semantic graphs and full reading indexes without copying sources', async () => {
  const runtime = createWikiRuntime({ enginePath });
  const beforeEngine = createHash('sha256').update(await readFile(enginePath)).digest('hex');
  const requests = [fixture('employee:a', '员工甲'), fixture('employee:b', '员工乙'), fixture('team:a', '团队甲')];
  const inputs = JSON.stringify(requests);
  try {
    const views = await Promise.all(requests.map(request => runtime.build(request)));
    assert.equal(JSON.stringify(requests), inputs, 'projection does not mutate A/B/C');
    assert.deepEqual(views[0].engine, LLM_WIKI_ENGINE);
    for (let index = 0; index < views.length; index++) {
      const view = views[index];
      assert.equal(view.spaceId, requests[index].spaceId);
      assert.equal(view.pages.length, 5);
      assert.equal(view.graph.kind, 'semantic');
      assert.equal(view.graph.nodes.length, 2);
      assert.deepEqual(new Set(view.graph.nodes.map(node => node.type)), new Set(['concept', 'entity']));
      assert.deepEqual(new Set(view.pages.map(page => page.type)), new Set(['entity', 'concept', 'source', 'synthesis', 'overview']));
      assert.equal(view.graph.edges.length, 1);
      assert.equal(view.graph.edges[0].weight, 1, 'weights count semantic relations only');
      assert.deepEqual(view.graph.nodes.map(node => node.linkCount), [1, 1]);
      assert(view.graph.communities.length > 0, 'original Louvain analysis ran');
      const relationship = view.graph.edges.find(edge => edge.relations?.length)?.relations?.[0];
      assert.equal(relationship?.predicate, '用于');
      assert.equal(relationship?.basis, 'inferred');
      assert.equal(relationship?.citations[0].startLine, 2);
      assert.equal(relationship?.sourceId, view.pages.find(page => page.type === 'concept')?.id);
      assert.equal(relationship?.targetId, view.pages.find(page => page.type === 'entity')?.id);
      assert(view.pages.every(page => /^wiki\//.test(page.path) && !page.path.includes('..')));
      const own = ['员工甲', '员工乙', '团队甲'][index];
      const other = ['员工甲', '员工乙', '团队甲'].filter(marker => marker !== own);
      assert(other.every(marker => !JSON.stringify(view).includes(marker)));
      assert.equal(new Set(view.pages.map(page => page.id)).size, 5, 'IDs distinguish overlapping record kinds');
    }
    assert(views[0].pages.every(page => !views[1].pages.some(other => other.id === page.id)));
    const firstPid = enginePids();
    if (process.platform !== 'win32') assert.equal(firstPid.length, 1);
    const repeated = await runtime.build(requests[0]);
    assert.deepEqual(repeated, views[0]);
    assert.deepEqual(enginePids(), firstPid, 'all spaces and repeated calls share one process');
    assert.equal(createHash('sha256').update(await readFile(enginePath)).digest('hex'), beforeEngine);
  } finally { await runtime.dispose(); }
  assert.equal(enginePids().length, 0, 'dispose leaves no program child');
  await assert.rejects(runtime.build(requests[0]), /disposed/);
});

test('multiple predicates and reverse relations share one edge while preserving direction, evidence and isolated concepts', async () => {
  const runtime = createWikiRuntime({ enginePath });
  try {
    const request = fixture('semantic-multiple', '语义');
    const graph = request.snapshot.conceptGraph!;
    const first = graph.relations[0]!;
    graph.relations.push(
      { ...first, id: 'constraint', predicate: '约束', basis: 'explicit', summary: '独立的明确约束' },
      { ...first, id: 'reverse', sourceId: first.targetId, targetId: first.sourceId, predicate: '支持', basis: 'explicit', summary: '反向关系不丢失' },
    );
    graph.concepts.push({ ...graph.concepts[0]!, id: 'isolated', name: '孤立概念', aliases: [], summary: '存在证据，但没有已知语义关系。' });
    const input = JSON.stringify(request);
    const view = await runtime.build(request);
    assert.equal(JSON.stringify(request), input);
    assert.equal(view.pages.length, 6);
    assert.equal(view.graph.nodes.length, 3);
    assert.equal(view.graph.edges.length, 1);
    const edge = view.graph.edges[0]!;
    assert.equal(edge.weight, 3);
    assert.equal(edge.relations!.length, 3);
    const conceptId = view.pages.find(page => page.title === '语义 概念')!.id;
    const entityId = view.pages.find(page => page.type === 'entity')!.id;
    assert.deepEqual(edge.relations!.map(relation => [relation.sourceId, relation.targetId, relation.predicate, relation.basis]), [
      [conceptId, entityId, '用于', 'inferred'],
      [conceptId, entityId, '约束', 'explicit'],
      [entityId, conceptId, '支持', 'explicit'],
    ]);
    assert.deepEqual(edge.relations!.map(relation => relation.summary), ['语义 待验证关联', '独立的明确约束', '反向关系不丢失']);
    for (const relation of edge.relations!) {
      assert.deepEqual(relation.citations, [{ sourceId: 'same-id', sourceVersion: 1, startLine: 2, endLine: 2 }]);
      assert.deepEqual(relation.entryIds, ['same-id']);
    }
    assert.equal(view.graph.nodes.find(node => node.id === conceptId)!.linkCount, 3);
    assert.equal(view.graph.nodes.find(node => node.id === entityId)!.linkCount, 3);
    assert.equal(view.graph.nodes.find(node => node.label === '孤立概念')!.linkCount, 0);
    assert.equal(view.graph.edges.reduce((count, edge) => count + edge.relations!.length, 0), 3);
    assert.equal(view.graph.communities.reduce((count, community) => count + community.nodeCount, 0), 3, 'upstream community analysis includes the isolated concept');
  } finally { await runtime.dispose(); }
});

test('shared evidence, article links and wiki navigation never manufacture semantic relationships', async () => {
  const runtime = createWikiRuntime({ enginePath });
  try {
    const request = fixture('no-semantic-relations', '共现');
    request.snapshot.conceptGraph!.relations = [];
    request.sources[0]!.text += '\n[[共现 概念]] [[共现 实体]] [[共现 文章]]';
    request.sources[0]!.content = request.sources[0]!.text;
    request.snapshot.entries[0]!.content = '同篇同时提到 [[共现 概念]] 和 [[共现 实体]]，并不表示两者有事实关系。';
    const view = await runtime.build(request);
    assert.equal(view.pages.length, 5, 'source, article and overview remain readable');
    assert.ok(view.pages.some(page => page.links.length > 0), 'reader navigation remains available');
    assert.equal(view.graph.nodes.length, 2);
    assert.deepEqual(view.graph.edges, []);
    assert.deepEqual(view.graph.nodes.map(node => node.linkCount), [0, 0]);
    assert.ok(view.graph.communities.every(community => community.nodeCount === 1));
  } finally { await runtime.dispose(); }
});

test('legacy source-and-article snapshots have an empty main graph without losing reading pages', async () => {
  const runtime = createWikiRuntime({ enginePath });
  try {
    const request = fixture('legacy-reader', '旧库');
    delete request.snapshot.conceptGraph;
    const view = await runtime.build(request);
    assert.equal(view.graph.kind, 'semantic');
    assert.deepEqual(view.graph.nodes, []);
    assert.deepEqual(view.graph.edges, []);
    assert.deepEqual(view.graph.communities, []);
    assert.deepEqual(new Set(view.pages.map(page => page.type)), new Set(['source', 'synthesis', 'overview']));
    assert.equal(view.pages.find(page => page.type === 'synthesis')!.content, '旧库 正文');
  } finally { await runtime.dispose(); }
});

test('adding many source and article pages cannot change semantic degrees, weights or communities', async () => {
  const runtime = createWikiRuntime({ enginePath });
  try {
    const request = fixture('stable-semantic-projection', '稳定');
    request.snapshot.conceptGraph!.concepts.push({ ...request.snapshot.conceptGraph!.concepts[0]!, id: 'isolated', name: '稳定的孤立概念', aliases: [] });
    const original = await runtime.build(request);
    const expanded = structuredClone(request);
    for (let index = 0; index < 30; index++) {
      const sourceId = `additional-source-${index}`, entryId = `additional-entry-${index}`;
      expanded.sources.push({ ...expanded.sources[0]!, id: sourceId, title: `原始资料 ${index}`, content: '[[稳定 概念]] [[稳定 实体]]', text: '[[稳定 概念]] [[稳定 实体]]' });
      expanded.snapshot.entries.push({ id: entryId, title: `相关资料文章 ${index}`, content: '更多文章引用同一来源和同名概念，只增加阅读入口。', citations: [{ sourceId, sourceVersion: 1, startLine: 1, endLine: 1 }, { sourceId: 'same-id', sourceVersion: 1, startLine: 1, endLine: 2 }] });
      expanded.snapshot.overview[0]!.entryIds.push(entryId);
      for (const concept of expanded.snapshot.conceptGraph!.concepts) concept.entryIds = [...concept.entryIds, entryId];
    }
    const projected = await runtime.build(expanded);
    assert.equal(projected.pages.length, original.pages.length + 60);
    assert.deepEqual(projected.graph, original.graph, 'only semantic concepts and relations may determine the main graph');
    assert.ok(projected.pages.find(page => page.type === 'concept')!.entryIds.length > 30);
  } finally { await runtime.dispose(); }
});

test('a semantic ring keeps its process-local Louvain choice when reading pages change or builds repeat', async () => {
  const runtime = createWikiRuntime({ enginePath });
  try {
    const request = fixture('stable-ring-community', '环');
    const graph = request.snapshot.conceptGraph!;
    graph.concepts = Array.from({ length: 12 }, (_, index) => ({ ...graph.concepts[0]!, id: `ring-${index}`, name: `环概念 ${index}`, aliases: [] }));
    graph.relations = graph.concepts.map((concept, index) => ({ id: `ring-relation-${index}`, sourceId: concept.id, targetId: graph.concepts[(index + 1) % graph.concepts.length]!.id, predicate: '相邻约束', basis: 'explicit', entryIds: ['same-id'], citations: [...request.snapshot.entries[0]!.citations] }));
    const baseline = await runtime.build(request);
    assert.equal(baseline.graph.nodes.length, 12);
    assert.equal(baseline.graph.edges.length, 12);
    const expanded = structuredClone(request);
    for (let index = 0; index < 30; index++) {
      const sourceId = `reader-source-${index}`, entryId = `reader-entry-${index}`;
      expanded.sources.push({ ...expanded.sources[0]!, id: sourceId, title: `阅读原件 ${index}` });
      expanded.snapshot.entries.push({ id: entryId, title: `阅读文章 ${index}`, content: '[[环概念 0]] [[环概念 1]]', citations: [{ sourceId, sourceVersion: 1, startLine: 1, endLine: 2 }] });
      expanded.snapshot.overview[0]!.entryIds.push(entryId);
    }
    const expected = structuredClone(baseline.graph);
    // Mutating an already-returned host value cannot poison the child cache.
    baseline.graph.nodes[0]!.community = 999;
    baseline.graph.communities[0]!.topNodes[0] = 'HOST_MUTATION';
    for (let iteration = 0; iteration < 12; iteration++) {
      const projected = await runtime.build(iteration % 2 ? request : expanded);
      assert.deepEqual(projected.graph, expected, 'reading-only changes cannot restart randomized community selection');
    }
  } finally { await runtime.dispose(); }
});

test('semantic relations require current nonempty evidence supported by their linked articles', async () => {
  const runtime = createWikiRuntime({ enginePath });
  try {
    const cases: Array<[(request: WikiBuildRequest) => void, RegExp]> = [
      [request => { request.snapshot.conceptGraph!.relations[0]!.citations = []; }, /requires article and source evidence/],
      [request => { request.snapshot.conceptGraph!.relations[0]!.entryIds = []; }, /requires article and source evidence/],
      [request => { request.snapshot.conceptGraph!.relations[0]!.citations[0]!.sourceVersion = 2; }, /outside the authorized/],
      [request => { request.snapshot.conceptGraph!.relations[0]!.targetId = 'unknown'; }, /Unknown Wiki relationship endpoint/],
      [request => { request.snapshot.conceptGraph!.relations[0]!.targetId = request.snapshot.conceptGraph!.relations[0]!.sourceId; }, /self-referential/],
      [request => { request.snapshot.conceptGraph!.relations[0]!.basis = 'co-occurrence' as never; }, /relationship basis/],
      [request => { request.sources[0]!.text = 'Valid first line\n '; }, /contains no evidence/],
      [request => {
        request.snapshot.entries[0]!.citations[0]!.endLine = 1;
        for (const concept of request.snapshot.conceptGraph!.concepts) concept.citations[0]!.endLine = 1;
      }, /not supported by its articles/],
      [request => { request.snapshot.conceptGraph!.relations.push({ ...request.snapshot.conceptGraph!.relations[0]!, id: 'duplicate-predicate' }); }, /Duplicate Wiki semantic relationship/],
    ];
    for (const [mutate, expected] of cases) {
      const request = fixture('invalid-semantic-evidence', '校验'); mutate(request);
      await assert.rejects(runtime.build(request), expected);
    }
  } finally { await runtime.dispose(); }
});

test('upstream analysis prompt is extracted with its significance, grounding and output-limit rules', async () => {
  const runtime = createWikiRuntime({ enginePath });
  try {
    const prompt = await runtime.analysisPrompt({ purpose: '架构研究', schema: '不得混入个人偏好', sourceContent: '来源正文', index: '现有知识页' });
    assert.match(prompt, /expert research analyst/);
    assert.match(prompt, /Page-worthy: yes/);
    assert.match(prompt, /at most 16,000 characters/);
    assert.match(prompt, /Do not transfer claims/);
    assert.match(prompt, /Simplified Chinese/);
    assert.match(prompt, /架构研究/); assert.match(prompt, /现有知识页/); assert.match(prompt, /不得混入个人偏好/);
  } finally { await runtime.dispose(); }
});

test('bad citations and hostile IDs cannot escape the authorized virtual page set', async () => {
  const runtime = createWikiRuntime({ enginePath });
  try {
    const bad = fixture('../../etc/passwd', '安全');
    bad.snapshot.entries[0].citations[0].sourceId = 'other-private-source';
    await assert.rejects(runtime.build(bad), /outside the authorized/);
    const good = fixture('../../etc/passwd', '安全');
    good.snapshot.conceptGraph!.concepts[0].id = '../../etc/passwd';
    good.snapshot.conceptGraph!.relations[0].sourceId = '../../etc/passwd';
    const view = await runtime.build(good);
    assert(view.pages.every(page => /^p-[a-f0-9]{64}$/.test(page.id)));
    assert(view.pages.every(page => !page.path.includes('etc')));
  } finally { await runtime.dispose(); }
});

test('runtime cancellation and timeout terminate work; a queued cancellation never starts another child', async () => {
  const folder = await mkdtemp(resolve(tmpdir(), 'shared-wiki-runtime-'));
  const fake = resolve(folder, 'hanging.cjs');
  await writeFile(fake, 'process.stdin.resume();setInterval(()=>{},1000);');
  const runtime = createWikiRuntime({ enginePath: fake, timeoutMs: 80 });
  try {
    const controller = new AbortController();
    const active = runtime.analysisPrompt({ purpose: '', schema: '', index: '', sourceContent: '' });
    const queued = runtime.analysisPrompt({ purpose: '', schema: '', index: '', sourceContent: '' }, controller.signal);
    controller.abort();
    await assert.rejects(queued, { name: 'AbortError' });
    await assert.rejects(active, /timed out/);
    const cancelling = new AbortController();
    const next = runtime.analysisPrompt({ purpose: '', schema: '', index: '', sourceContent: '' }, cancelling.signal);
    cancelling.abort();
    await assert.rejects(next, { name: 'AbortError' });
  } finally { await runtime.dispose(); await rm(folder, { recursive: true, force: true }); }
});

test('runtime refuses cross-space responses at the JSON boundary', async () => {
  const folder = await mkdtemp(resolve(tmpdir(), 'shared-wiki-response-'));
  const fake = resolve(folder, 'wrong-space.cjs');
  await writeFile(fake, `require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);console.log(JSON.stringify({id:m.id,ok:true,value:{schemaVersion:1,engine:${JSON.stringify(LLM_WIKI_ENGINE)},spaceId:'other',version:1,pages:[],graph:{nodes:[],edges:[],communities:[]}}}));});`);
  const runtime = createWikiRuntime({ enginePath: fake });
  try { await assert.rejects(runtime.build(fixture('correct', '安全')), /identity mismatch/); }
  finally { await runtime.dispose(); await rm(folder, { recursive: true, force: true }); }
});

test('the shared program receives no host model credentials or Node injection environment', async () => {
  const folder = await mkdtemp(resolve(tmpdir(), 'shared-wiki-env-'));
  const fake = resolve(folder, 'environment.cjs');
  await writeFile(fake, `require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);console.log(JSON.stringify({id:m.id,ok:true,value:Object.keys(process.env).sort().join(',')}));});`);
  const previous = process.env.WORKFORCE_PRIVATE_MODEL_CREDENTIAL;
  process.env.WORKFORCE_PRIVATE_MODEL_CREDENTIAL = 'test-only-private-value';
  const runtime = createWikiRuntime({ enginePath: fake });
  try {
    const keys = await runtime.analysisPrompt({ purpose: '', schema: '', index: '', sourceContent: '' });
    assert(!keys.includes('WORKFORCE_PRIVATE_MODEL_CREDENTIAL'));
    assert(!keys.includes('NODE_OPTIONS'));
    assert(!keys.includes('DSH_HOME'));
  } finally {
    if (previous === undefined) delete process.env.WORKFORCE_PRIVATE_MODEL_CREDENTIAL; else process.env.WORKFORCE_PRIVATE_MODEL_CREDENTIAL = previous;
    await runtime.dispose(); await rm(folder, { recursive: true, force: true });
  }
});
