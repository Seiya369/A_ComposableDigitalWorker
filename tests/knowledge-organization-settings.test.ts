import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkforceStore } from '../src/domain/store.js';
import { createBlankModules } from '../src/domain/seed.js';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'workforce-organization-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await WorkforceStore.open(join(root, 'state.json'));
  return { root, store };
}

const organization = () => ({
  version: 1 as const, profession: '支付接口开发', taskScope: '负责本项目回执处理',
  conceptRules: '回执标识与订单标识分别建概念；保留适用版本和否定条件。',
  categories: [{ id: 'receipt-protocol', title: '回执协议', description: '标识、重试条件及核验方法' }],
});

test('employee configuration rejects unknown organization fields without writing state', async t => {
  const { store } = await fixture(t);
  const modules = createBlankModules();
  (modules.knowledge as any).organization = { ...organization(), allowNetwork: true };
  const before = await readFile(store.filePath, 'utf8');
  await assert.rejects(store.saveEmployeeConfiguration({ template: { name: '支付工程师', modules } }), /未支持|未知/);
  assert.equal(await readFile(store.filePath, 'utf8'), before);
});

test('employee configuration enforces organization types and independent UTF-16 bounds', async t => {
  const { store } = await fixture(t);
  const invalid = [
    null, [],
    { ...organization(), version: 2 },
    { ...organization(), profession: 123 },
    { ...organization(), profession: '专'.repeat(2001) },
    { ...organization(), taskScope: '任'.repeat(4001) },
    { ...organization(), conceptRules: '😀'.repeat(4001) },
    { ...organization(), categories: {} },
    { ...organization(), categories: Array.from({ length: 25 }, (_, i) => ({ id: `topic-${i}`, title: '领域', description: '' })) },
    { ...organization(), categories: [{ id: '../private', title: '不合法', description: '' }] },
    { ...organization(), categories: [{ id: 'A', title: '不合法', description: '' }] },
    { ...organization(), categories: [{ id: `a${'b'.repeat(64)}`, title: '不合法', description: '' }] },
    { ...organization(), categories: [{ id: 'receipt', title: '', description: '' }] },
    { ...organization(), categories: [{ id: 'receipt', title: '题'.repeat(121), description: '' }] },
    { ...organization(), categories: [{ id: 'receipt', title: '回执', description: '详'.repeat(2001) }] },
    { ...organization(), categories: [{ id: 'receipt', title: '回执', description: false }] },
    { ...organization(), categories: [{ id: 'receipt', title: '回执', description: '', hiddenRule: true }] },
    { ...organization(), categories: [{ id: 'receipt', title: '甲', description: '' }, { id: 'receipt', title: '乙', description: '' }] },
    { profession: '', taskScope: '', conceptRules: '', categories: [] },
  ];
  const before = await readFile(store.filePath, 'utf8');
  for (const value of invalid) {
    const modules = createBlankModules(); (modules.knowledge as any).organization = value;
    await assert.rejects(store.saveEmployeeConfiguration({ template: { name: '拒绝无效规则', modules } }), { code: 'VALIDATION' }, JSON.stringify(value).slice(0, 160));
    assert.equal(await readFile(store.filePath, 'utf8'), before);
  }
  const modules = createBlankModules();
  modules.knowledge.organization = {
    version: 1, profession: '专'.repeat(2000), taskScope: '任'.repeat(4000), conceptRules: '😀'.repeat(4000),
    categories: Array.from({ length: 24 }, (_, i) => ({ id: i === 0 ? `a${'b'.repeat(63)}` : `topic-${i}`, title: '题'.repeat(120), description: '详'.repeat(2000) })),
  };
  const saved = await store.saveEmployeeConfiguration({ template: { name: '合法边界', modules } });
  assert.deepEqual(saved.modules.knowledge.organization, modules.knowledge.organization);
});

test('organization survives reload and exchange while project employees keep a detached copy', async t => {
  const { root, store } = await fixture(t);
  const modules = createBlankModules(); modules.knowledge.organization = organization();
  const template = await store.saveEmployeeConfiguration({ template: { name: '支付工程师', modules } });
  const project = await store.saveProject({ name: '支付项目', rootPath: root });
  const employee = await store.createEmployee({ projectId: project.id, templateId: template.id });
  template.modules.knowledge.organization!.categories[0]!.title = '回执协议与校验';
  await store.saveTemplate(template);
  assert.deepEqual((await store.reload()).employees.find(entry => entry.id === employee.id)!.modules.knowledge.organization, organization());
  for (const scope of ['template', 'project'] as const) {
    const id = scope === 'template' ? template.id : employee.id;
    const bundle = store.exportBundle({ scope, kind: 'employee', id, ...(scope === 'project' ? { projectId: project.id } : {}) });
    const result = await store.importBundle(bundle, { scope, requestId: `organization-${scope}`, ...(scope === 'project' ? { projectId: project.id } : {}) });
    const imported = scope === 'template' ? store.snapshot().templates.find(entry => entry.id === result.rootId)! : store.snapshot().employees.find(entry => entry.id === result.rootId)!;
    assert.deepEqual(imported.modules.knowledge.organization, scope === 'template' ? template.modules.knowledge.organization : organization());
    assert.equal(imported.modules.knowledge.organization!.categories[0]!.id, 'receipt-protocol');
  }
  const changed = structuredClone(employee.modules);
  changed.knowledge.organization!.taskScope = '只处理项目实例核验';
  await store.updateEmployee(employee.id, { modules: changed });
  const reopened = await WorkforceStore.open(store.filePath);
  assert.equal(reopened.snapshot().templates.find(entry => entry.id === template.id)!.modules.knowledge.organization!.taskScope, '负责本项目回执处理');
  assert.equal(reopened.snapshot().employees.find(entry => entry.id === employee.id)!.modules.knowledge.organization!.taskScope, '只处理项目实例核验');
});

test('six controlled source categories save and transfer while invalid or unknown fields are rejected', async t => {
  const { store } = await fixture(t);
  const invalid = [
    { source: { category: '../private' } },
    { source: { category: null } },
    { source: { category: 1 } },
    { source: { category: 'reference', approve: true } },
    { knowledge: { allowNetwork: true } },
  ];
  const before = await readFile(store.filePath, 'utf8');
  for (const mutation of invalid) {
    const modules = createBlankModules();
    modules.knowledge.sources = [{ id: 'source', title: '资料', kind: 'text', value: '原文', ...mutation.source } as any];
    Object.assign(modules.knowledge, mutation.knowledge);
    await assert.rejects(store.saveTemplate({ name: '非法来源分类', modules }));
    assert.equal(await readFile(store.filePath, 'utf8'), before);
  }
  const modules = createBlankModules();
  const categories = ['reference', 'requirements-decisions', 'task-evidence', 'incidents-reflections', 'environment-constraints', 'preferences-capabilities'] as const;
  modules.knowledge.sources = categories.map((category, i) => ({ id: `source-${i}`, title: category, kind: 'text', value: `原文 ${i}`, category }));
  const template = await store.saveEmployeeConfiguration({ template: { name: '六类来源', modules } });
  const bundle = store.exportBundle({ scope: 'template', kind: 'employee', id: template.id });
  const imported = await store.importBundle(bundle, { scope: 'template', requestId: 'six-categories' });
  const copy = store.snapshot().templates.find(entry => entry.id === imported.rootId)!;
  assert.deepEqual(copy.modules.knowledge.sources.map(source => source.category), categories);
  const legacy = createBlankModules(); legacy.knowledge.sources = [{ id: 'legacy', title: '旧资料', kind: 'text', value: '未分类原文' }];
  const saved = await store.saveTemplate({ name: '旧记录兼容', modules: legacy });
  assert.equal(saved.modules.knowledge.sources[0]!.category, undefined);
});

test('strict exchange rejects invalid organization and source fields for templates and project instances atomically', async t => {
  const { root, store } = await fixture(t);
  const modules = createBlankModules();
  modules.knowledge.organization = organization();
  modules.knowledge.sources = [{ id: 'source', title: '协议', kind: 'text', value: '原文', category: 'reference' }];
  const template = await store.saveTemplate({ name: '可交换岗位', modules });
  const project = await store.saveProject({ name: '可交换项目', rootPath: root });
  const employee = await store.createEmployee({ projectId: project.id, templateId: template.id });
  const bundle = store.exportBundle({ scope: 'project', projectId: project.id, kind: 'employee', id: employee.id });
  const mutate = [
    (knowledge: any) => { knowledge.organization.version = '1'; },
    (knowledge: any) => { knowledge.organization.taskScope = false; },
    (knowledge: any) => { knowledge.organization.conceptRules = []; },
    (knowledge: any) => { knowledge.organization.profession = 'p'.repeat(2001); },
    (knowledge: any) => { knowledge.organization.taskScope = 't'.repeat(4001); },
    (knowledge: any) => { knowledge.organization.conceptRules = 'c'.repeat(8001); },
    (knowledge: any) => { knowledge.organization.categories = Array.from({ length: 25 }, (_, i) => ({ id: `topic-${i}`, title: '领域', description: '' })); },
    (knowledge: any) => { knowledge.organization.categories[0].id = 12; },
    (knowledge: any) => { knowledge.organization.categories[0].title = ' '; },
    (knowledge: any) => { knowledge.organization.categories[0].title = 't'.repeat(121); },
    (knowledge: any) => { knowledge.organization.categories[0].description = 'd'.repeat(2001); },
    (knowledge: any) => { knowledge.organization.categories.push({ ...knowledge.organization.categories[0], title: '同 ID' }); },
    (knowledge: any) => { knowledge.organization.hidden = true; },
    (knowledge: any) => { knowledge.organization.categories[0].approve = true; },
    (knowledge: any) => { knowledge.sources[0].category = 'other'; },
    (knowledge: any) => { knowledge.sources[0].extra = true; },
    (knowledge: any) => { knowledge.extra = true; },
  ];
  const before = await readFile(store.filePath, 'utf8');
  for (const group of ['templates', 'employees'] as const) for (const [i, change] of mutate.entries()) {
    const invalid = structuredClone(bundle); change(invalid.data[group][0]!.modules.knowledge);
    await assert.rejects(store.importBundle(invalid, { scope: 'project', projectId: project.id, requestId: `invalid-${group}-${i}` }));
    assert.equal(await readFile(store.filePath, 'utf8'), before);
  }
});
