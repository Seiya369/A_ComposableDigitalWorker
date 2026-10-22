import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createBlankModules } from '../src/domain/seed.js';
import { ModuleEditor } from '../src/ui/ModuleEditor.js';
import type { WorkforceClient } from '../src/ui/client.js';

test('knowledge editor presents six source categories and organization without changing legacy settings on render', () => {
  const modules = createBlankModules();
  modules.knowledge.sources = [{ id: 'legacy', title: '旧资料', kind: 'text', value: '原文' }];
  let changes = 0;
  const html = renderToStaticMarkup(createElement(ModuleEditor, {
    activeModule: 'knowledge', modules, onChange() { changes++; }, templates: [], client: {} as WorkforceClient,
  }));
  for (const label of ['专业资料', '需求与决策', '任务证据', '失败与反思', '环境与约束', '偏好与能力', '专业说明', '任务范围', '概念提取规则', '知识分类']) assert.ok(html.includes(label), label);
  assert.equal(changes, 0);
  assert.equal(modules.knowledge.organization, undefined);
  assert.equal(modules.knowledge.sources[0]!.category, undefined);
});
