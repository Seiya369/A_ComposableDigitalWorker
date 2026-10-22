import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import LlmRuntime, { LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import SessionStore from '@deepseek-ai/dsh-session';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import FileSystem from '@deepseek-ai/dsh-fs-local';
import WorkingDirectory from '@deepseek-ai/dsh-working-directory';
import SkillRegistry from '@deepseek-ai/dsh-skill';
import WebRuntime from '@deepseek-ai/dsh-web';
import Subprocess from '@deepseek-ai/dsh-subprocess-local';
import * as FileObservation from '@deepseek-ai/dsh-fs-observation-policy';
import * as FileTools from '@deepseek-ai/dsh-tool-fs';
import * as WebTools from '@deepseek-ai/dsh-tool-web';
import * as BashTool from '@deepseek-ai/dsh-tool-bash';
import { WorkforceStore } from '../src/domain/store.js';
import { ARCHITECT_TEMPLATE_ID } from '../src/domain/seed.js';
import { WorkforceRuntime } from '../src/harness/runtime.js';
import { listEmployeeCapabilities } from '../src/harness/capability-catalog.js';
import { nativeToolEntitlement } from '../src/domain/capability-catalog.js';
import { registerEmployeePreset, EMPLOYEE_PRESET_ID } from '../src/harness/employee-preset.js';

class Scripted extends LlmAdapter {
  requests: GenerateOptions[] = [];
  constructor(private steps: Array<(request: GenerateOptions) => StreamChunk[] | Promise<StreamChunk[]>>) { super(); }
  async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(request);
    const step = this.steps.shift(); if (!step) throw new Error('script exhausted');
    for (const chunk of await step(request)) yield chunk;
  }
}
const reply = (value: string): StreamChunk[] => [
  { type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text: value },
  { type: 'block-end', index: 0, block: { type: 'text', text: value } }, { type: 'finish', reason: { kind: 'stop' } },
];
const call = (name: string, args: object): StreamChunk[] => {
  const id = ToolCallId('capability-fixture-call'), argumentsText = JSON.stringify(args);
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentsText },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: argumentsText } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ];
};

async function fixture(t: TestContext, steps: ConstructorParameters<typeof Scripted>[0], presets = false) {
  const root = await mkdtemp(resolve(tmpdir(), 'workforce-native-'));
  const projectRoot = resolve(root, 'project'); await mkdir(projectRoot);
  await writeFile(resolve(projectRoot, 'README.md'), 'NATIVE_READ_SENTINEL old text');
  await writeFile(resolve(root, 'outside.txt'), 'OUTSIDE_SECRET_SENTINEL');
  const store = await WorkforceStore.open(resolve(root, 'state.json'));
  const project = await store.saveProject({ id: 'native-fixture', name: 'Native', rootPath: projectRoot });
  const initial = await store.createEmployee({ projectId: project.id, templateId: ARCHITECT_TEMPLATE_ID });
  const modules = structuredClone(initial.modules);
  modules.model = { mode: 'override', provider: 'fixture', model: 'fixture' }; modules.capabilities.skills = [];
  const employee = await store.updateEmployee(initial.id, { modules });
  const adapter = new Scripted(steps), ctx = new Context();
  ctx.baseUrl = new URL('../', import.meta.url).href;
  if (presets) await ctx.plugin(Loader);
  await ctx.plugin(LlmRuntime); await ctx.plugin(SessionStore); await ctx.plugin(SessionProjectionRegistry);
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); await ctx.plugin(FileSystem);
  await ctx.plugin(FileObservation);
  await ctx.plugin(WorkingDirectory); await ctx.plugin(SkillRegistry); await ctx.plugin(WebRuntime);
  if (!presets) { await ctx.plugin(FileTools); await ctx.plugin(WebTools); }
  await ctx.plugin(AgentRegistry); await ctx.plugin(AgentLoop, { agents: [] });
  ctx.llm.registerAdapter(['fixture'], adapter);
  const sessions: string[] = [];
  ctx.provide('workspaceRegistry', { get: (id: string) => id === project.id ? { sessionIds: sessions, attachSession: async (id: string) => { sessions.push(id); } } : undefined } as never);
  let unregister: (() => Promise<void>) | undefined;
  if (presets) {
    await ctx.plugin(Subprocess);
    ctx.provide('userQuestions', { ask: async () => ({ answers: [] }) } as never);
    await ctx.plugin(AgentPresets, { default: 'standard' });
    await ctx.agentPresets.register({ id: 'standard', plugins: [
      { name: '@deepseek-ai/dsh-agent-instructions', config: { dshHome: root, agentsHome: root, maxBytes: 65536 } },
      { name: '@deepseek-ai/dsh-skill-filesystem', config: { includeDefaultRoots: false, customSkillDirs: [resolve(root, 'skills')], watch: false } },
      { name: '@deepseek-ai/dsh-tool-fs' }, { name: '@deepseek-ai/dsh-tool-web' },
    ] });
    unregister = await registerEmployeePreset(ctx);
  }
  const runtime = new WorkforceRuntime(ctx, store, new Map());
  t.after(async () => { await runtime.dispose(); await unregister?.(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); });
  return { root, projectRoot, store, project, employee, modules, adapter, ctx, runtime,
    run: async () => { const run = await runtime.start({ projectId: project.id, employeeId: employee.id, request: 'Execute the fixture task' }); return runtime.wait(run.id); } };
}

test('native catalog contains only public metadata and refuses unsupported installed tools', async t => {
  const f = await fixture(t, [() => reply('done')]);
  f.ctx.skills.register({ name: 'grill-with-docs', description: 'Selected local method', content: 'PRIVATE_BODY', source: 'custom', path: '/private/skill.md' });
  f.ctx.skills.register({ name: 'human-only', description: 'Hidden from models', content: 'HIDDEN', source: 'custom', invocation: { modelInvocable: false, userInvocable: true } });
  f.ctx.tools.register({ name: 'dangerous_custom_tool', description: 'Third-party tool', parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: () => [] }, execute: async () => 'never' });
  const catalog = await listEmployeeCapabilities(f.ctx, { cwd: f.projectRoot });
  assert.deepEqual(catalog.skills.map(skill => skill.id), ['grill-with-docs']);
  assert.doesNotMatch(JSON.stringify(catalog), /PRIVATE_BODY|\/private|locator|resourceBase/);
  assert.equal(catalog.defaultTools.find(tool => tool.id === 'read')?.available, true);
  assert.equal(catalog.specialTools.find(tool => tool.id === 'dangerous_custom_tool')?.available, false);
  assert.equal(nativeToolEntitlement('read', f.modules), true);
  assert.equal(nativeToolEntitlement('edit', f.modules), false);
  assert.equal(nativeToolEntitlement('web_fetch', f.modules), false);
});

test('native read stays inside live project grants and denies traversal and symlinks', async t => {
  const f = await fixture(t, [
    () => call('read', { file_path: 'README.md' }),
    () => call('read', { file_path: '../outside.txt' }),
    () => call('read', { file_path: 'docs/alias.txt' }),
    () => reply('done'),
  ]);
  await mkdir(resolve(f.projectRoot, 'docs')); await symlink(resolve(f.root, 'outside.txt'), resolve(f.projectRoot, 'docs/alias.txt'));
  const result = await f.run(); assert.equal(result.status, 'awaiting-review', result.error);
  assert.match(JSON.stringify(f.adapter.requests[1]), /NATIVE_READ_SENTINEL/);
  const later = JSON.stringify(f.adapter.requests.at(-1));
  assert.match(later, /项目范围/); assert.match(later, /符号链接/); assert.doesNotMatch(later, /OUTSIDE_SECRET_SENTINEL/);
});

test('native edit needs explicit grant, edits real files, and registers a delivery artifact', async t => {
  const f = await fixture(t, [
    () => call('read', { file_path: 'README.md' }), () => call('edit', { file_path: 'README.md', old_string: 'old text', new_string: 'new text' }), () => reply('done'),
  ]);
  f.modules.permissions.allowedTools.push('edit'); f.modules.permissions.writePaths = ['README.md'];
  await f.store.updateEmployee(f.employee.id, { modules: f.modules });
  const result = await f.run(); assert.equal(result.status, 'awaiting-review', result.error);
  assert.equal(await readFile(resolve(f.projectRoot, 'README.md'), 'utf8'), 'NATIVE_READ_SENTINEL new text');
  assert.equal(result.artifacts.find(item => item.path === 'README.md')?.title, 'README.md');
  assert.equal(result.artifacts.find(item => item.path === 'README.md')?.content, 'NATIVE_READ_SENTINEL new text');
});

test('native edit retains distinct text snapshots for consecutive execution attempts', async t => {
  const f = await fixture(t, [
    () => call('read', { file_path: 'README.md' }), () => call('edit', { file_path: 'README.md', old_string: 'old text', new_string: 'first revision' }), () => reply('first'),
    () => call('read', { file_path: 'README.md' }), () => call('edit', { file_path: 'README.md', old_string: 'first revision', new_string: 'second revision' }), () => reply('second'),
  ]);
  f.modules.permissions.allowedTools.push('edit'); f.modules.permissions.writePaths = ['README.md']; await f.store.updateEmployee(f.employee.id, { modules: f.modules });
  const first = await f.run(), second = await f.run();
  assert.equal(first.artifacts[0]?.content, 'NATIVE_READ_SENTINEL first revision');
  assert.equal(second.artifacts[0]?.content, 'NATIVE_READ_SENTINEL second revision');
  assert.equal(f.store.snapshot().runs.find(run => run.id === first.id)!.artifacts[0]?.content, 'NATIVE_READ_SENTINEL first revision');
});

test('legacy create-only permission never grants native overwrite or edit', async t => {
  const f = await fixture(t, [
    () => call('write', { file_path: 'docs/architecture/new.md', content: 'UNAUTHORIZED_CONTENT' }), () => reply('done'),
  ]);
  const result = await f.run(); assert.equal(result.status, 'awaiting-review', result.error);
  assert(!f.adapter.requests[0]!.tools?.some(tool => ['edit', 'write'].includes(tool.name)));
  await assert.rejects(readFile(resolve(f.projectRoot, 'docs/architecture/new.md')), /ENOENT/);
});

test('native empty text is snapshotted and binary or large presentations are explicit path-only deliveries', async t => {
  const f = await fixture(t, [
    () => call('write', { file_path: 'docs/architecture/empty.txt', content: '' }),
    () => call('present', { files: [{ path: 'docs/binary.pdf' }, { path: 'docs/large.txt' }] }), () => reply('done'),
  ], true);
  await mkdir(resolve(f.projectRoot, 'docs')); await writeFile(resolve(f.projectRoot, 'docs/binary.pdf'), Buffer.from([0, 255, 0]));
  await writeFile(resolve(f.projectRoot, 'docs/large.txt'), 'L'.repeat(100_001));
  f.modules.permissions.allowedTools.push('write'); await f.store.updateEmployee(f.employee.id, { modules: f.modules });
  const result = await f.run(); assert.equal(result.status, 'awaiting-review', result.error);
  assert.equal(result.artifacts.find(artifact => artifact.path === 'docs/architecture/empty.txt')?.content, '');
  assert.match(result.artifacts.find(artifact => artifact.path === 'docs/binary.pdf')!.mediaType!, /unavailable-binary/);
  assert.match(result.artifacts.find(artifact => artifact.path === 'docs/large.txt')!.mediaType!, /unavailable-too-large/);
});

test('installed DSH skill is loaded for the selected person and unselected skills are denied', async t => {
  const f = await fixture(t, [() => call('skill', { name: 'unselected-method' }), () => call('skill', { name: 'grill-with-docs' }), () => reply('done')]);
  f.ctx.skills.register({ name: 'grill-with-docs', description: 'Question with evidence', content: 'SELECTED_METHOD_SENTINEL', source: 'custom' });
  f.ctx.skills.register({ name: 'unselected-method', description: 'Other method', content: 'UNSELECTED_METHOD_SENTINEL', source: 'custom' });
  f.modules.capabilities.skills = [{ id: 'grill-with-docs', name: 'grill-with-docs', description: 'Question with evidence' }];
  await f.store.updateEmployee(f.employee.id, { modules: f.modules });
  const result = await f.run(); assert.equal(result.status, 'awaiting-review', result.error);
  assert.match(JSON.stringify(f.adapter.requests[0]), /SELECTED_METHOD_SENTINEL/);
  assert.match(JSON.stringify(f.adapter.requests.at(-1)), /技能未配置/);
  assert.doesNotMatch(JSON.stringify(f.adapter.requests), /UNSELECTED_METHOD_SENTINEL/);
});

test('native Web reaches its provider only while the personnel network grant remains enabled', async t => {
  let called = 0, revoke = async () => {};
  const f = await fixture(t, [() => call('web_fetch', { url: 'https://example.test/first' }), async () => { await revoke(); return call('web_fetch', { url: 'https://example.test/second' }); }, () => reply('done')]);
  f.ctx.web.registerFetchProvider({ id: 'fixture', available: () => true, fetch: async request => { called++; return { url: request.url, statusCode: 200, body: { kind: 'text', content: 'REAL_PROVIDER_SENTINEL' }, truncated: false }; } });
  f.modules.permissions.allowNetwork = true; await f.store.updateEmployee(f.employee.id, { modules: f.modules });
  revoke = async () => { f.modules.permissions.allowNetwork = false; await f.store.updateEmployee(f.employee.id, { modules: f.modules }); };
  const result = await f.run(); assert.equal(result.status, 'awaiting-review', result.error); assert.equal(called, 1);
  assert.match(JSON.stringify(f.adapter.requests[1]), /REAL_PROVIDER_SENTINEL/);
  assert.match(JSON.stringify(f.adapter.requests.at(-1)), /权限已撤销/);
});

test('official Bash definition is never inherited even with shell and network flags', async t => {
  let executed = 0;
  const f = await fixture(t, [() => call('bash', { description: 'Forbidden command', command: 'cat ../outside.txt' }), () => reply('done')]);
  f.ctx.provide('shell', { sandboxMode: undefined, resolve: () => { executed++; throw new Error('must never resolve'); } } as never);
  f.ctx.provide('shellEnv', { collect: async () => ({}) } as never);
  await f.ctx.plugin(BashTool);
  f.modules.permissions.allowShell = true; f.modules.permissions.allowNetwork = true;
  f.modules.permissions.allowedTools.push('bash'); f.modules.capabilities.tools.push({ id: 'bash', description: 'Still unsafe' });
  await f.store.updateEmployee(f.employee.id, { modules: f.modules });
  const catalog = await listEmployeeCapabilities(f.ctx, { cwd: f.projectRoot });
  assert.match(catalog.specialTools.find(tool => tool.id === 'bash')!.reason!, /不能限制项目外读取或网络/);
  const result = await f.run(); assert.equal(result.status, 'awaiting-review', result.error);
  assert.equal(executed, 0); assert(!f.adapter.requests[0]!.tools?.some(tool => tool.name === 'bash'));
  assert.doesNotMatch(JSON.stringify(f.adapter.requests), /OUTSIDE_SECRET_SENTINEL/);
});

test('official preset read lease discovers installed skills while employee execution excludes default AGENTS hooks', async t => {
  const f = await fixture(t, [() => call('read', { file_path: 'README.md' }), () => call('skill', { name: 'grill-with-docs' }), () => reply('done')], true);
  await writeFile(resolve(f.root, 'AGENTS.md'), 'DEFAULT_PRESET_OUTSIDE_INSTRUCTIONS_SENTINEL');
  await mkdir(resolve(f.root, 'skills/grill-with-docs'), { recursive: true });
  await writeFile(resolve(f.root, 'skills/grill-with-docs/SKILL.md'), '---\nname: grill-with-docs\ndescription: Ask evidence-grounded questions\n---\nFILESYSTEM_SELECTED_SKILL_SENTINEL');
  f.modules.capabilities.skills = [{ id: 'grill-with-docs', name: 'grill-with-docs', description: 'Ask evidence-grounded questions' }];
  await f.store.updateEmployee(f.employee.id, { modules: f.modules });
  assert(!f.ctx.tools.schemas().some(tool => tool.name === 'read'), 'Web-style host has no globally registered file tools');
  assert.equal((await f.ctx.agentPresets.resolve()).broken, undefined);
  const catalog = await listEmployeeCapabilities(f.ctx, { cwd: f.projectRoot });
  assert(catalog.skills.some(skill => skill.id === 'grill-with-docs'));
  assert.equal(catalog.defaultTools.find(tool => tool.id === 'read')?.available, true);
  const result = await f.run(); assert.equal(result.status, 'awaiting-review', result.error);
  const session = f.ctx.agents.get(result.sessionId! as never)!;
  assert.equal(f.ctx.agentPresets.composedPreset(session.ctx), EMPLOYEE_PRESET_ID);
  const requests = JSON.stringify(f.adapter.requests);
  assert.match(requests, /NATIVE_READ_SENTINEL/); assert.match(requests, /FILESYSTEM_SELECTED_SKILL_SENTINEL/);
  assert.doesNotMatch(requests, /DEFAULT_PRESET_OUTSIDE_INSTRUCTIONS_SENTINEL/);
});

test('native directory search requires a complete subtree grant and searches the smaller authorized directory', async t => {
  const f = await fixture(t, [() => call('grep', { pattern: 'SEARCH_SENTINEL', path: '.' }), () => call('grep', { pattern: 'SEARCH_SENTINEL', path: 'docs' }), () => reply('done')], true);
  await mkdir(resolve(f.projectRoot, 'docs')); await writeFile(resolve(f.projectRoot, 'docs/search.txt'), 'SEARCH_SENTINEL authorized result');
  const result = await f.run(); assert.equal(result.status, 'awaiting-review', result.error);
  assert.match(JSON.stringify(f.adapter.requests[1]), /整个子树/);
  assert.match(JSON.stringify(f.adapter.requests.at(-1)), /authorized result/);
});

test('later permissive tool policies cannot override a denied native path check', async t => {
  const f = await fixture(t, [() => call('read', { file_path: '../outside.txt' }), () => reply('done')]);
  f.ctx.on('tools/pre-execute', async (_exec, next) => { await next(); return { kind: 'allow' }; });
  const result = await f.run(); assert.equal(result.status, 'awaiting-review', result.error);
  assert.match(JSON.stringify(f.adapter.requests.at(-1)), /路径检查尚未通过/);
  assert.doesNotMatch(JSON.stringify(f.adapter.requests), /OUTSIDE_SECRET_SENTINEL/);
});

test('capability catalog contains sanitized diagnostics when a provider fails', async () => {
  const ctx = { get: () => undefined, skills: { list: async () => { throw new Error('SECRET_CREDENTIAL_VALUE'); } }, tools: { schemas: () => [] } } as unknown as Context;
  await assert.rejects(listEmployeeCapabilities(ctx), error => { assert.match((error as Error).message, /能力目录/); assert.doesNotMatch((error as Error).message, /SECRET_CREDENTIAL_VALUE/); return true; });
});
