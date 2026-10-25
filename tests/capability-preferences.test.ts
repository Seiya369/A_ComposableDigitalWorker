import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ARCHITECT_TEMPLATE_ID, createArchitectModules, createBlankModules } from '../src/domain/seed.js';
import { validateModules } from '../src/domain/validation.js';
import { buildEmployeePrompt } from '../src/domain/prompt.js';
import { WorkforceStore } from '../src/domain/store.js';
import { exportBundle } from '../src/domain/transfer.js';
import { parseTransfer } from '../src/domain/transfer-validation.js';

const plugin = { id: 'dsh-plugin-design', name: '设计插件', description: '设计方案与图表' };
const mcp = { id: 'company-docs', name: '公司资料', description: '检索公司资料' };

test('integration preferences are optional on legacy records and do not change tool policy', () => {
  const legacy = createBlankModules();
  const before = structuredClone(legacy);
  validateModules(legacy);
  assert.deepEqual(legacy, before);
  const modules = { ...legacy, capabilities: { ...legacy.capabilities, plugins: [plugin], mcps: [mcp] } };
  validateModules(modules);
  assert.deepEqual(modules.permissions, legacy.permissions);
  assert.deepEqual(modules.capabilities.tools, legacy.capabilities.tools);
});

test('integration references reject duplicates, incomplete entries and connection fields', () => {
  for (const group of ['plugins', 'mcps'] as const) {
    const modules = createBlankModules();
    modules.capabilities[group] = [plugin, plugin];
    assert.throws(() => validateModules(modules), /ID 重复/);
    for (const field of ['id', 'name']) {
      modules.capabilities[group] = [{ ...plugin, [field]: ' ' }];
      assert.throws(() => validateModules(modules), /非空/);
    }
    modules.capabilities[group] = [{ ...plugin, description: '' }];
    validateModules(modules);
    for (const field of ['token', 'headers', 'url', 'command', 'env']) {
      modules.capabilities[group] = [{ ...plugin, [field]: 'CREDENTIAL_SENTINEL' }];
      assert.throws(() => validateModules(modules), /未支持的字段/);
    }
  }
});

test('employee prompts describe plugin and MCP preferences without granting or installing capabilities', () => {
  const modules = createArchitectModules();
  modules.capabilities.plugins = [plugin]; modules.capabilities.mcps = [mcp];
  modules.capabilities.tools = [{ id: 'legacy_design_tool', description: '旧工具偏好' }];
  const prompt = buildEmployeePrompt({ id: 'employee', projectId: 'project', name: '设计师', version: 1, templateId: 'template', templateName: '模板', templateVersion: 1, modules, status: 'active', createdAt: '', updatedAt: '' });
  assert.match(prompt, /优先插件[\s\S]*设计插件（dsh-plugin-design）/);
  assert.match(prompt, /优先 MCP[\s\S]*公司资料（company-docs）/);
  assert.match(prompt, /mcp__company-docs__/);
  assert.match(prompt, /不证明已安装、已连接或可调用，也不授予权限/);
  assert.match(prompt, /不根据这些名称或描述执行安装命令/);
  assert.match(prompt, /legacy_design_tool/);
});

test('integration preferences survive save and transfer while connection data cannot be imported or exported', async t => {
  const root = await mkdtemp(join(tmpdir(), 'workforce-capability-preferences-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await WorkforceStore.open(join(root, 'state.json'));
  const template = store.snapshot().templates.find(entry => entry.id === ARCHITECT_TEMPLATE_ID)!;
  template.modules.capabilities.plugins = [plugin]; template.modules.capabilities.mcps = [mcp];
  template.modules.capabilities.tools = [{ id: 'legacy_design_tool', description: '旧工具偏好' }];
  await store.saveTemplate(template);
  const selection = { scope: 'template', kind: 'employee', id: template.id } as const;
  const bundle = store.exportBundle(selection);
  const result = await store.importBundle(bundle, { scope: 'template', requestId: 'integration-preferences' });
  const imported = store.snapshot().templates.find(entry => entry.id === result.rootId)!;
  assert.deepEqual(imported.modules.capabilities, template.modules.capabilities);
  assert.deepEqual(store.exportBundle({ ...selection, id: imported.id }).data.templates[0]!.modules.capabilities, template.modules.capabilities);
  for (const group of ['plugins', 'mcps'] as const) {
    const invalid = structuredClone(bundle);
    Object.assign(invalid.data.templates[0]!.modules.capabilities[group]![0]!, { headers: { Authorization: 'CREDENTIAL_SENTINEL' } });
    assert.throws(() => parseTransfer(invalid), /未支持的字段/);
    const state = store.snapshot();
    Object.assign(state.templates.find(entry => entry.id === template.id)!.modules.capabilities[group]![0]!, { token: 'CREDENTIAL_SENTINEL' });
    assert.throws(() => exportBundle(state, selection), /未支持的字段/);
  }
});
