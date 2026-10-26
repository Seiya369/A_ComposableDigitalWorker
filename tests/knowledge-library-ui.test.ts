import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KNOWLEDGE_SOURCE_CATEGORIES, type KnowledgeLibraryView } from '../src/knowledge/library-api.js';
import { filterKnowledgeEntries, filterKnowledgeGraphSources, KnowledgeArchiveSwitch, KnowledgeCompilationUsage, KnowledgeLibrary, KnowledgeMarkdown, professionalKnowledgeSources, validateKnowledgeFiles } from '../src/ui/KnowledgeLibrary.js';
import { createWorkforceClient } from '../src/client/api.js';
import { createBlankModules } from '../src/domain/seed.js';

const library = (): KnowledgeLibraryView => ({
  target: { scope: 'template', employeeId: '员工?&A', library: 'employee' }, enabled: true, title: '员工的专属知识库',
  compiler: { role: 'employee-shadow' }, status: { state: 'ready' },
  categories: KNOWLEDGE_SOURCE_CATEGORIES.map(item => ({ ...item, count: 1 })), libraries: [{ library: 'employee', label: '专属知识库' }],
  supportedExtensions: ['.txt', '.md'], maxFileBytes: 100, maxUploadBytes: 150,
  sources: [
    { id: 'reference', title: '专业材料', content: 'source', text: 'source', provenance: 'synthetic', verified: false, version: 1, hash: 'hash', createdAt: '2026-10-22', processing: [] },
    { id: 'incident', title: '失败观察', category: 'incident/reflection-proposal', content: 'failure', text: 'failure', provenance: 'synthetic', verified: false, version: 1, hash: 'hash', createdAt: '2026-10-22', processing: [] },
  ],
  snapshot: { version: 1, sourceFingerprint: 'hash', createdAt: '2026-10-22', status: 'candidate', overview: [], entries: [
    { id: 'first', title: '专业参考 API', content: '条件依赖版本', citations: [{ sourceId: 'reference', sourceVersion: 1, startLine: 1, endLine: 1 }] },
    { id: 'second', title: '参考标题但实际是失败观察', content: 'API 故障原因仍待核验', citations: [{ sourceId: 'incident', sourceVersion: 1, startLine: 1, endLine: 1 }] },
  ] },
});

test('knowledge compilation accounting keeps historical current trace visible without inventing missing attempts', () => {
  const view = library();
  view.compilationAttempts = [];
  view.snapshot!.compilationTrace = { revision: 'strict-incremental-v1', changedSourceIds: ['PRIVATE_SOURCE'], removedSourceIds: [],
    model: { provider: 'PRIVATE_PROVIDER', model: 'PRIVATE_MODEL' }, modelCalls: 2,
    usage: { reportedCalls: 2, inputTokens: 5645, outputTokens: 9765, totalTokens: 15410 } };
  const html = renderToStaticMarkup(createElement(KnowledgeCompilationUsage, { view }));
  assert.match(html, /当前知识版本 v1 的已有记录/);
  assert.match(html, /data-usage-field="totalTokens">15,410</);
  assert.match(html, /记录可能不完整，未报告用量不代表零消耗/);
  assert.doesNotMatch(html, /PRIVATE_/);
});

test('knowledge compilation accounting is bounded and distinguishes partial failed attempts from unknown usage', () => {
  const view = library();
  view.compilationAttempts = Array.from({ length: 51 }, (_, index) => ({ schemaVersion: 1, id: `attempt-${index}`,
    startedAt: '2026-10-26T08:00:00.000Z', finishedAt: '2026-10-26T08:01:00.000Z', outcome: 'failed', sourceFingerprint: 'PRIVATE_FINGERPRINT',
    ...(index === 0 ? { trace: { revision: 'strict-incremental-v1' as const, changedSourceIds: ['PRIVATE_SOURCE'], removedSourceIds: [], modelCalls: 3,
      usage: { reportedCalls: 1, inputTokens: 20, outputTokens: 8, totalTokens: 28 } } } : {}) }));
  const html = renderToStaticMarkup(createElement(KnowledgeCompilationUsage, { view }));
  assert.equal((html.match(/data-compilation-id=/g) ?? []).length, 50);
  assert.match(html, /知识整理另行使用模型，此处与业务对话分别展示/);
  assert.match(html, /仅部分调用报告用量，已知数值是下限/);
  assert.match(html, /模型调用与用量未报告/);
  assert.doesNotMatch(html, /data-compilation-id="attempt-50"|PRIVATE_/);
});

test('knowledge category filtering follows cited evidence, including legacy source defaults', () => {
  const view = library();
  assert.deepEqual(filterKnowledgeEntries(view, ' api ', 'reference').map(item => item.id), ['first']);
  assert.deepEqual(filterKnowledgeEntries(view, '', 'incident/reflection-proposal').map(item => item.id), ['second']);
  assert.deepEqual(filterKnowledgeEntries(view, '没有此词'), []);
  assert.equal(view.snapshot?.entries.length, 2);
  view.sources[0]!.version = 2;
  assert.deepEqual(filterKnowledgeEntries(view, '', 'reference'), [], 'a stale citation cannot be attributed to the current evidence version');
});

test('professional materials include imported and legacy references without exposing automatic memory as uploads', () => {
  const view = library();
  view.sources.push({ ...view.sources[0]!, id: 'explicit-reference', title: '上传的原稿', category: 'reference' });
  for (const category of KNOWLEDGE_SOURCE_CATEGORIES.slice(1)) view.sources.push({ ...view.sources[0]!, id: category.id, category: category.id });
  const before = structuredClone(view.sources);
  assert.deepEqual(professionalKnowledgeSources(view).map(source => source.id), ['reference', 'explicit-reference']);
  assert.deepEqual(view.sources, before, 'listing professional materials must preserve the full graph evidence');
});

test('a filtered graph keeps exact cross-category evidence while hiding unrelated materials', () => {
  const view = library();
  view.sources.push({ ...view.sources[0]!, id: 'unrelated-reference', category: 'reference' }, { ...view.sources[0]!, id: 'unrelated-task', category: 'task-evidence' });
  view.snapshot!.entries[1]!.citations.push({ sourceId: 'reference', sourceVersion: 1, startLine: 1, endLine: 1 });
  const entries = filterKnowledgeEntries(view, '', 'incident/reflection-proposal');
  assert.deepEqual(filterKnowledgeGraphSources(view, entries, 'incident/reflection-proposal').map(source => source.id), ['reference', 'incident']);
  view.sources[0]!.version = 2;
  assert.deepEqual(filterKnowledgeGraphSources(view, entries, 'incident/reflection-proposal').map(source => source.id), ['incident'], 'a replacement version cannot stand in for a historical citation');
  assert.deepEqual(filterKnowledgeGraphSources(view, entries).map(source => source.id), view.sources.map(source => source.id));
});

test('file selection rejects unsupported, empty and over-budget originals before reading bytes', () => {
  const view = library();
  assert.equal(validateKnowledgeFiles([{ name: '资料.MD', size: 100 }], view), undefined);
  assert.match(validateKnowledgeFiles([{ name: 'program.exe', size: 5 }], view)!, /格式暂不支持/);
  assert.match(validateKnowledgeFiles([{ name: 'empty.txt', size: 0 }], view)!, /空文件/);
  assert.match(validateKnowledgeFiles([{ name: 'large.txt', size: 101 }], view)!, /单份文件/);
  assert.match(validateKnowledgeFiles([{ name: 'a.txt', size: 80 }, { name: 'b.txt', size: 80 }], view)!, /总大小/);
});

test('Wiki Markdown renders readable structure while source HTML and unsafe links stay text', () => {
  const html = renderToStaticMarkup(createElement(KnowledgeMarkdown, { content: '# 专题\n\n- **先核验**\n- `read`\n\n[原始文档](https://example.com/source)\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n\n```html\n<img src=x onerror=alert(1)>\n```' }));
  assert.match(html, /<h4>专题<\/h4>/);
  assert.match(html, /<ul><li><strong>先核验<\/strong><\/li>/);
  assert.match(html, /href="https:\/\/example.com\/source"/);
  assert.doesNotMatch(html, /<script|<img|href="javascript:/);
  assert.match(html, /&lt;script&gt;/);
});

test('an unsaved employee has a save-first state and no upload control', () => {
  const html = renderToStaticMarkup(createElement(KnowledgeLibrary, { client: createWorkforceClient(), modules: createBlankModules(), onChange: () => {} }));
  assert.match(html, /aria-label="认知记忆"/);
  assert.match(html, /先保存员工，再建立专属知识库/);
  assert.doesNotMatch(html, /type="file"/);
});

test('automatic archive controls announce persisted on/off, pending and unsupported connection states', () => {
  const control = (props: Partial<Parameters<typeof KnowledgeArchiveSwitch>[0]> = {}) => renderToStaticMarkup(createElement(KnowledgeArchiveSwitch, { label: '任务档案', enabled: true, pending: false, disabled: false, onChange: () => {}, ...props }));
  assert.match(control(), /role="switch" aria-label="任务档案自动归档" aria-checked="true"/);
  assert.match(control(), /<span>自动归档<\/span>/);
  assert.doesNotMatch(control(), /aria-busy|disabled=""/);
  assert.match(control({ enabled: false }), /aria-checked="false"/);
  const pending = control({ pending: true, disabled: true });
  assert.match(pending, /aria-checked="true" aria-busy="true" disabled=""/);
  assert.match(pending, /title="正在保存…"/);
  const unsupported = control({ disabled: true, unavailable: '当前连接尚不支持保存自动归档设置' });
  assert.match(unsupported, /disabled="" title="当前连接尚不支持保存自动归档设置"/);
  assert.match(unsupported, /aria-checked="true"/, 'a legacy connection must preserve the previous default without pretending to save');
});

test('material removal preserves source and employee versions, announcing only a successful change', async t => {
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
  const view = library(); const input = { target: { ...view.target, library: 'team' as const, teamId: '团队?&B' }, sourceId: '原稿?&C', version: 7, employeeVersion: 4 };
  let changed = 0; let sent: unknown;
  const result = { library: { ...view, sources: [] }, removedSourceId: input.sourceId };
  globalThis.fetch = async (_url, options) => { sent = JSON.parse(String(options?.body)); return Response.json(result); };
  const client = createWorkforceClient({ onChange: () => { changed++; } });
  assert.deepEqual(await client.removeKnowledge!(input), result);
  assert.deepEqual(sent, input);
  assert.equal(changed, 1);
  globalThis.fetch = async () => Response.json({ error: '资料已更新，请刷新' }, { status: 409 });
  await assert.rejects(client.removeKnowledge!(input), /资料已更新/);
  assert.equal(changed, 1, 'a failed removal cannot announce a committed change');
});

test('knowledge transport preserves opaque targets and only announces successful mutations', async t => {
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
  const calls: Array<{ url: string; options?: RequestInit }> = [];
  const view = library(); let changed = 0;
  globalThis.fetch = async (input, options) => { calls.push({ url: String(input), options }); return Response.json(options?.method === 'POST' ? { library: view, uploaded: ['original'] } : view); };
  const client = createWorkforceClient({ onChange: () => { changed++; } });
  await client.knowledgeLibrary!(view.target);
  const query = new URL(calls[0]!.url, 'https://example.com').searchParams;
  assert.equal(query.get('employeeId'), view.target.employeeId);
  assert.equal(query.get('projectId'), null);
  assert.equal(changed, 0);
  const upload = { target: view.target, files: [{ name: '原稿.md', base64: 'c291cmNl', category: 'reference' as const }] };
  await client.uploadKnowledge!(upload);
  assert.deepEqual(JSON.parse(String(calls[1]!.options?.body)), upload);
  assert.equal(changed, 1);
  globalThis.fetch = async () => Response.json({ error: '入库未完成' }, { status: 400 });
  await assert.rejects(client.uploadKnowledge!(upload), /入库未完成/);
  assert.equal(changed, 1);
});

test('shared Wiki and historical source transport preserve opaque scope and exact versions without mutations', async t => {
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
  const calls: string[] = []; let changed = 0;
  const source = library().sources[0]!;
  globalThis.fetch = async (input, options) => { assert.equal(options?.method, 'GET'); calls.push(String(input)); return Response.json(String(input).includes('layer=A') ? { document: source } : { schemaVersion: 1 }); };
  const target = { ...library().target, library: 'team' as const, teamId: '团队?&B' };
  const client = createWorkforceClient({ onChange: () => { changed++; } });
  await client.knowledgeWiki!(target);
  assert.deepEqual(await client.knowledgeSource!(target, '原始?&C', 3), source);
  const wikiUrl = new URL(calls[0]!, 'https://example.com');
  const sourceUrl = new URL(calls[1]!, 'https://example.com');
  assert.equal(wikiUrl.pathname, '/digital-workers/api/knowledge/wiki');
  for (const url of [wikiUrl, sourceUrl]) { assert.equal(url.searchParams.get('employeeId'), target.employeeId); assert.equal(url.searchParams.get('teamId'), target.teamId); }
  assert.equal(sourceUrl.searchParams.get('id'), '原始?&C'); assert.equal(sourceUrl.searchParams.get('version'), '3');
  assert.equal(changed, 0);
});
