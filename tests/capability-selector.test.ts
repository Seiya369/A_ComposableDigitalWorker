import assert from 'node:assert/strict';
import test from 'node:test';
import { createBlankModules } from '../src/domain/seed.js';
import { validateModules } from '../src/domain/validation.js';
import { resolveSelectedSkillName, selectSkillUsage, selectPreferredTool, selectPreferredIntegration } from '../src/ui/CapabilitySelector.js';
import { buildEmployeePrompt } from '../src/domain/prompt.js';

const skill = { id: 'design-method', name: 'Design', description: 'Method', source: 'runtime' };
test('selected skills display the current DSH name without rewriting old aliases or grouping', () => {
  const modules = createBlankModules();
  const selected = { id: 'architecture-analysis', name: '架构分析', description: 'Saved method', usage: 'required' as const };
  modules.capabilities.skills = [selected];
  const original = structuredClone(modules);
  const catalog = [{ id: selected.id, name: 'architecture-analysis', description: 'Current method', source: 'bundled' }];
  assert.equal(resolveSelectedSkillName(selected, catalog), 'architecture-analysis');
  assert.deepEqual(modules, original);
  assert.equal(resolveSelectedSkillName(selected, [{ ...catalog[0]!, name: 'current-dsh-name' }]), 'current-dsh-name');
});
test('selected skill names fall back to stable IDs when the catalog is absent or missing the skill', () => {
  const selected = { id: 'architecture-analysis', name: '架构分析', description: '' };
  assert.equal(resolveSelectedSkillName(selected), selected.id);
  assert.equal(resolveSelectedSkillName(selected, []), selected.id);
  assert.equal(resolveSelectedSkillName(selected, [skill]), selected.id);
});
test('reselecting a skill synchronizes its DSH name while keeping role-specific instructions', () => {
  const modules = createBlankModules();
  modules.capabilities.skills = [{ id: skill.id, name: '旧中文别名', description: 'Custom role instructions', useWhen: 'API review', usage: 'required' }];
  const updated = selectSkillUsage(modules, skill, 'preferred');
  assert.deepEqual(updated.capabilities.skills, [{ id: skill.id, name: skill.name, description: 'Custom role instructions', useWhen: 'API review', usage: 'preferred' }]);
  assert.equal(modules.capabilities.skills[0]!.name, '旧中文别名');
});
test('external skill names remain exactly as supplied by DSH', () => {
  const external = { id: 'vendor-api-review', name: 'vendor-api-review', description: 'External method', source: 'user-dsh' };
  assert.equal(resolveSelectedSkillName({ id: external.id }, [external]), external.name);
  assert.equal(selectSkillUsage(createBlankModules(), external, 'required').capabilities.skills[0]!.name, external.name);
});
test('required and preferred skills are independent from preserved legacy permissions', () => {
  const original = createBlankModules();
  const required = selectSkillUsage(original, skill, 'required');
  const preferred = selectSkillUsage(required, skill, 'preferred');
  assert.equal(required.capabilities.skills[0]!.usage, 'required');
  assert.equal(preferred.capabilities.skills[0]!.usage, 'preferred');
  assert.deepEqual(preferred.permissions, original.permissions);
  assert.deepEqual(original.capabilities.skills, []);
  assert.deepEqual(selectSkillUsage(preferred, skill).capabilities.skills, []);
});
test('tool preferences do not grant, revoke or change native permissions', () => {
  const original = createBlankModules();
  const selected = selectPreferredTool(original, { id: 'mcp__design__inspect', description: 'Inspect', available: true }, true);
  assert.equal(selected.capabilities.tools[0]!.id, 'mcp__design__inspect');
  assert.deepEqual(selected.permissions, original.permissions);
  assert.deepEqual(selectPreferredTool(selected, { id: 'mcp__design__inspect', description: '', available: true }, false).capabilities.tools, []);
});
test('package and MCP selections stay separate and preserve old tool preferences', () => {
  const original = createBlankModules();
  original.capabilities.tools = [{ id: 'legacy_tool', description: 'Preserved' }];
  const plugin = { id: 'dsh-plugin-design', name: 'Design', description: 'Design package', available: true };
  const mcp = { id: 'design__server', name: 'Design server', description: 'MCP tools', available: true };
  const withPlugin = selectPreferredIntegration(original, 'plugins', plugin, true);
  const selected = selectPreferredIntegration(withPlugin, 'mcps', mcp, true);
  assert.deepEqual(selected.capabilities.plugins, [{ id: plugin.id, name: plugin.name, description: plugin.description }]);
  assert.deepEqual(selected.capabilities.mcps, [{ id: mcp.id, name: mcp.name, description: mcp.description }]);
  assert.deepEqual(selected.capabilities.tools, original.capabilities.tools);
  assert.deepEqual(selected.permissions, original.permissions);
  assert.equal(original.capabilities.plugins, undefined);
  assert.equal(original.capabilities.mcps, undefined);
  const removed = selectPreferredIntegration(selected, 'plugins', plugin, false);
  assert.deepEqual(removed.capabilities.plugins, []);
  assert.deepEqual(removed.capabilities.mcps, selected.capabilities.mcps);
});
test('unavailable packages cannot be added but missing saved references can be removed', () => {
  const original = createBlankModules();
  const option = { id: 'disabled-plugin', name: 'Disabled', description: '', available: false, reason: 'Disabled in DSH' };
  assert.equal(selectPreferredIntegration(original, 'plugins', option, true), original);
  const selected = selectPreferredIntegration(original, 'plugins', { ...option, available: true }, true);
  assert.equal(selectPreferredIntegration(selected, 'plugins', { ...option, available: true }, true), selected);
  assert.deepEqual(selectPreferredIntegration(selected, 'plugins', option, false).capabilities.plugins, []);
});
test('catalog-only metadata and connection configuration never enter saved preferences', () => {
  const original = createBlankModules();
  const option = { id: 'docs', name: 'Docs', description: 'Read docs', available: true, reason: 'Status only', managementBundle: 'dsh-plugin-docs-owner', url: 'https://private.example/mcp', token: 'SECRET_SENTINEL' };
  const selected = selectPreferredIntegration(original, 'mcps', option, true);
  assert.deepEqual(selected.capabilities.mcps, [{ id: 'docs', name: 'Docs', description: 'Read docs' }]);
  assert.doesNotMatch(JSON.stringify(selected.capabilities), /SECRET_SENTINEL|private\.example|Status only|available|managementBundle|dsh-plugin-docs-owner/);
});
test('legacy skills remain required and hidden delivery criteria do not become task requirements', () => {
  const modules = createBlankModules();
  modules.responsibilities = { mission: 'Design software', duties: ['Review evidence'], boundaries: [] };
  modules.capabilities.skills = [{ id: skill.id, name: skill.name, description: skill.description }];
  modules.delivery.acceptanceCriteria = ['LEGACY_CRITERION_SENTINEL'];
  modules.delivery.requiredArtifacts = ['LEGACY_ARTIFACT_SENTINEL'];
  validateModules(modules, true);
  const prompt = buildEmployeePrompt({ id: 'employee', projectId: 'project', name: 'Design', version: 1, templateId: 'template', templateName: 'Template', templateVersion: 1, modules, status: 'active', createdAt: '', updatedAt: '' });
  assert.match(prompt, /必备 Skill[\s\S]*Design/);
  assert.doesNotMatch(prompt, /LEGACY_CRITERION_SENTINEL|LEGACY_ARTIFACT_SENTINEL/);
  assert.throws(() => validateModules({ ...modules, capabilities: { ...modules.capabilities, skills: [{ ...skill, usage: 'sometimes' }] } }), /技能使用方式/);
});
