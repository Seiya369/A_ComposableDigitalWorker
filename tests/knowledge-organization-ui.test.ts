import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createBlankModules } from '../src/domain/seed.js';
import { ModuleEditor } from '../src/ui/ModuleEditor.js';
import type { WorkforceClient } from '../src/ui/client.js';
import { KnowledgeUploadedSourceList } from '../src/ui/KnowledgeUploadedSources.js';
import { KNOWLEDGE_UPLOAD_ACCEPT } from '../src/knowledge/upload-limits.js';

test('knowledge editor presents six source categories and organization without changing legacy settings on render', () => {
  const modules = createBlankModules();
  modules.knowledge.sources = [{ id: 'legacy', title: '旧资料', kind: 'text', value: '原文' }];
  let changes = 0;
  const html = renderToStaticMarkup(createElement(ModuleEditor, {
    activeModule: 'knowledge', modules, onChange() { changes++; }, templates: [], client: {} as WorkforceClient,
  }));
  for (const label of ['投喂马料', '需求决策', '任务证据', '失败反思', '环境约束', '偏好能力', '编纂规则', '专业说明', '任务范围', '概念提取规则', '知识分类']) assert.ok(html.includes(label), label);
  assert.equal(changes, 0);
  assert.equal(modules.knowledge.organization, undefined);
  assert.equal(modules.knowledge.sources[0]!.category, undefined);
});

test('knowledge upload presentation separates durable A receipts from the unsaved employee configuration', () => {
  const modules = createBlankModules();
  let changes = 0, uploads = 0;
  const html = renderToStaticMarkup(createElement(ModuleEditor, {
    activeModule: 'knowledge', modules, onChange() { changes++; }, templates: [], client: {} as WorkforceClient,
    onUploadKnowledge: async () => { uploads++; }, knowledgeUploadAccept: KNOWLEDGE_UPLOAD_ACCEPT,
    knowledgeUploadTargetLabel: '研发团队 / 架构师 · 模板私有资料',
    knowledgeUploadedSources: createElement(KnowledgeUploadedSourceList, { sources: [{ sourceId: 'upload:source', title: '设计资料.pdf', version: 2, category: 'reference', attachment: { name: '设计资料.pdf', mediaType: 'application/pdf', sha256: '0123456789abcdef'.repeat(4), bytes: 100 } }] }),
  }));
  for (const text of ['研发团队 / 架构师', '设计资料.pdf', 'v2', '0123456789ab…', '已上传资料（A）', '编纂另行排队', '单文件 ≤ 1 MiB', '扫描件 OCR 与旧 DOC 暂不支持']) assert.ok(html.includes(text), text);
  assert.ok(html.includes(`accept="${KNOWLEDGE_UPLOAD_ACCEPT}"`));
  assert.match(html, /type="file" hidden="" multiple=""/);
  assert.equal(changes, 0); assert.equal(uploads, 0);
  assert.equal(modules.knowledge.sources.length, 0);
});
