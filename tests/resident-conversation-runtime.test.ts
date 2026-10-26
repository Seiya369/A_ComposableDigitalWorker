import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import AgentRegistry, { installModelSelection, type AgentHandle } from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import LlmRuntime, { createUserMessage, LlmAdapter, ReasoningEffortId, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm';
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import FileSystem from '@deepseek-ai/dsh-fs-local';
import WorkingDirectory from '@deepseek-ai/dsh-working-directory';
import SkillRegistry, { type SkillCandidate } from '@deepseek-ai/dsh-skill';
import * as FileTools from '@deepseek-ai/dsh-tool-fs';
import * as SkillTool from '@deepseek-ai/dsh-tool-skill';
import { WorkforceStore } from '../src/domain/store.js';
import { resolveConversationEmployee, type ConversationEmployeeMode } from '../src/domain/conversation-employee.js';
import { registerConversationWorkflowRuntime } from '../src/harness/conversation-workflow-runtime.js';
import { WorkforceRuntime, type KnowledgeRuntime } from '../src/harness/runtime.js';
import { loadEmployeeSkills } from '../src/harness/skills.js';

class OfflineAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = [];
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model, context: { contextWindow: 1_048_576 }, reasoning: { efforts: [{ id: ReasoningEffortId('high'), name: 'High' }], default: ReasoningEffortId('high') } };
  }
  async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(request);
    const answer = `OFFLINE_RESIDENT_ANSWER_${this.requests.length}`;
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: answer };
    yield { type: 'block-end', index: 0, block: { type: 'text', text: answer } };
    yield { type: 'usage', usage: { inputTokens: 30, outputTokens: 10 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
const visible = (request: GenerateOptions) => JSON.stringify({ system: request.system, messages: request.messages.map(({ role, content }) => ({ role, content })) });
const pluginContexts = (request: GenerateOptions) => request.messages.flatMap(message => {
  const source = message.source as { kind: string; sections?: Array<{ name: string; text: string }> };
  return source?.kind === 'runtime-context' ? source.sections ?? [] : [];
}).filter(section => /composable-workforce|digital-worker/.test(section.name));
const digest = (text: string) => createHash('sha256').update(text).digest('hex');

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'resident-native-runtime-'));
  const projectRoot = join(directory, 'Chat'); await mkdir(projectRoot);
  await writeFile(join(projectRoot, 'README.md'), 'RESIDENT_PROJECT_FILE_EVIDENCE');
  const store = await WorkforceStore.open(join(directory, 'state.json'));
  const project = await store.saveProject({ id: 'resident-fixture', name: 'Chat', rootPath: projectRoot });
  const skills = await loadEmployeeSkills(resolve('skills'));
  for (const id of ['employee-template-product', 'employee-template-architect']) {
    const template = store.snapshot().templates.find(entry => entry.id === id)!; assert.ok(template);
    await store.saveTemplate({ ...template, modules: { ...template.modules, model: { mode: 'override', provider: 'resident-fixture', model: id, reasoningEffort: 'high' } } });
  }
  const counters = { skillDiscoveryCalls: 0, skillBodies: 0, knowledgePrepare: 0, knowledgeOverview: 0, knowledgeIngest: 0 };
  const knowledge: KnowledgeRuntime = {
    spacesForEmployee: () => [{ kind: 'project', projectId: project.id, teamId: 'resident-fixture-team' }],
    prepareFor: async () => { counters.knowledgePrepare++; },
    overviewFor: async () => { counters.knowledgeOverview++; return 'RESIDENT_C_KNOWLEDGE_SENTINEL'; },
    overviewDocumentsFor: async () => { counters.knowledgeOverview++; return [{ layer: 'C', id: 'resident-concept', library: 'team', version: 1, title: 'Confirmed concept', content: 'RESIDENT_C_KNOWLEDGE_SENTINEL' }]; },
    ingestFor: async () => { counters.knowledgeIngest++; }, searchFor: async () => [], readFor: async () => undefined,
  };
  const ctx = new Context(), adapter = new OfflineAdapter();
  for (const plugin of [LlmRuntime, SessionStore, SessionProjectionRegistry, SystemPrompt, ToolRuntime, FileSystem, WorkingDirectory, SkillRegistry, AgentRegistry]) await ctx.plugin(plugin);
  await ctx.plugin(AgentLoop, { agents: [] }); await ctx.plugin(FileTools); await ctx.plugin(SkillTool);
  ctx.llm.registerAdapter(['resident-fixture'], adapter);
  ctx.systemPrompt.section({ name: 'resident-native-system', order: -1000, text: 'NATIVE_SYSTEM_IDENTITY_SENTINEL' });
  ctx.systemPrompt.context({ name: 'resident-native-policy', order: 0, required: true, text: 'NATIVE_REQUIRED_POLICY_SENTINEL' });
  const provider = 'resident-production-bundled-fixture';
  ctx.skills.registerProvider(() => ({ name: provider,
    list: async () => { counters.skillDiscoveryCalls++; return [...skills.values()].map((skill): SkillCandidate => ({ name: skill.id, description: skill.description, source: 'bundled', provider,
      invocation: { modelInvocable: true, userInvocable: true }, rank: 600, locator: skill.id })); },
    get: async candidate => { counters.skillBodies++; const skill = skills.get(candidate.name)!;
      return { ...candidate, content: `RESIDENT_REQUIRED_SKILL_BODY_SENTINEL\n${skill.content}` }; },
  }));
  const handles: AgentHandle[] = [], attached: string[] = [], errors: unknown[] = [], streams: Array<{ id: string; type: string }> = [];
  const workspace = { path: projectRoot, sessionIds: attached, attachSession: async (id: string) => { attached.push(id); } };
  ctx.provide('workspaceRegistry', { get: (id: string) => id === project.id ? workspace : undefined } as never);
  const runtime = new WorkforceRuntime(ctx, store, skills, {}, knowledge);
  const dispose = registerConversationWorkflowRuntime(ctx, {
    isDeliverySession: () => false,
    prepare: (agent, key, request, signal) => {
      const view = resolveConversationEmployee(store.snapshot(), project.id, agent.id);
      return view.conversationEmployee ? runtime.openEmployeeConversationTurn(agent, key, request, view, signal) : Promise.resolve(undefined);
    },
    readEvents: async agent => agent.session.snapshotEvents(),
    onError: error => errors.push(error),
  });
  ctx.on('agent/assistant-stream', ({ agent, frame }) => streams.push({ id: agent.id, type: frame.type }));
  const createNative = async (name: string) => {
    const handle = await ctx.agents.create({ sessionId: SessionId(name), meta: { cwd: projectRoot },
      agentOptions: { provider: 'resident-fixture', model: 'native-user-selected', reasoningEffort: ReasoningEffortId('high') },
      setup: agentCtx => { installModelSelection(agentCtx, { current: { provider: 'resident-fixture', model: 'native-user-selected', reasoningEffort: ReasoningEffortId('high') }, assembled: undefined }); },
    }); handles.push(handle); attached.push(handle.agent.id); return handle.agent;
  };
  const native = await createNative('resident-same-native-session');
  const set = async (templateId: string, mode: ConversationEmployeeMode, agent = native) => {
    const view = resolveConversationEmployee(store.snapshot(), project.id, agent.id);
    return store.setConversationEmployee({ projectId: project.id, sessionId: agent.id, templateId, mode },
      { expectedRevision: store.snapshot().revision, expectedVersion: view.conversationEmployee?.version ?? 0 });
  };
  const clear = async () => {
    const view = resolveConversationEmployee(store.snapshot(), project.id, native.id);
    return store.clearConversationEmployee({ projectId: project.id, sessionId: native.id },
      { expectedRevision: store.snapshot().revision, expectedVersion: view.conversationEmployee?.version ?? 0 });
  };
  const send = async (message: string, agent = native) => {
    const before = adapter.requests.length;
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: message }] }));
    await agent.whenIdle();
    const run = store.snapshot().runs.filter(run => run.sessionId === agent.id && !run.parentRunId).at(-1);
    if (run) await runtime.wait(run.id);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(adapter.requests.length, before + 1, JSON.stringify(errors.map(error => String(error))));
    const request = adapter.requests.at(-1)!;
    assert.equal(request.sessionId, agent.id); assert.ok(Object.isFrozen(request));
    assert.match(visible(request), /NATIVE_SYSTEM_IDENTITY_SENTINEL/); assert.match(visible(request), /NATIVE_REQUIRED_POLICY_SENTINEL/);
    return request;
  };
  t.after(async () => { await dispose(); await runtime.dispose(); for (const handle of handles) await handle.dispose(); await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }); });
  return { store, project, ctx, adapter, runtime, native, createNative, set, clear, send, counters, errors, streams, directory };
}

test('explicit resident consult and execute keep native history/stream, restore tools, switch employee, and unbind locally', async t => {
  const f = await fixture(t);
  assert.equal(resolveConversationEmployee(f.store.snapshot(), f.project.id, f.native.id).conversationEmployee, null);
  await f.set('employee-template-product', 'consult');
  const first = await f.send('你是谁');
  assert.equal(first.tools?.length ?? 0, 0);
  assert.equal(first.model, 'employee-template-product', 'explicit employee model is retained');
  assert.equal(first.reasoningEffort, ReasoningEffortId('high'), 'consult preserves the explicitly configured employee reasoning');
  assert.equal(first.messages.filter(message => message.source?.kind === 'skill-catalog').length, 0);
  assert.deepEqual(f.counters, { skillDiscoveryCalls: 0, skillBodies: 0, knowledgePrepare: 0, knowledgeOverview: 0, knowledgeIngest: 0 });
  assert.doesNotMatch(visible(first), /RESIDENT_REQUIRED_SKILL_BODY_SENTINEL|RESIDENT_C_KNOWLEDGE_SENTINEL/);
  const second = await f.send('再介绍一次你的职责');
  assert.match(visible(second), /OFFLINE_RESIDENT_ANSWER_1/);
  assert.equal(second.tools?.length ?? 0, 0); assert.equal(f.counters.skillBodies, 0);
  const mission = f.store.snapshot().templates.find(template => template.id === 'employee-template-product')!.modules.responsibilities.mission;
  assert.equal(visible(second).split(mission).length - 1, 1, 'stable resident role is retained once across turns');
  assert.ok(f.streams.filter(frame => frame.id === f.native.id && frame.type === 'start').length >= 2);
  const unrelated = await f.createNative('resident-unaffected-native-session');
  const ordinary = await f.send('普通原生助手问题', unrelated);
  assert.ok(ordinary.tools?.some(tool => tool.name === 'read')); assert.ok(ordinary.tools?.some(tool => tool.name === 'skill'));
  assert.equal(ordinary.model, 'native-user-selected');
  assert.equal(pluginContexts(ordinary).length, 0, 'other conversation has no employee context');
  await f.set('employee-template-product', 'execute');
  const execute = await f.send('请分析并准备需求验收清单');
  assert.ok(execute.tools?.some(tool => tool.name === 'read')); assert.ok(execute.tools?.some(tool => tool.name === 'skill'));
  assert.ok(execute.tools?.some(tool => tool.name === 'worker_memory_search'));
  assert.match(visible(execute), /RESIDENT_REQUIRED_SKILL_BODY_SENTINEL/); assert.match(visible(execute), /RESIDENT_C_KNOWLEDGE_SENTINEL/);
  assert.ok(f.counters.skillBodies > 0); assert.ok(f.counters.knowledgePrepare > 0);
  const counts = { ...f.counters };
  await f.set('employee-template-architect', 'consult');
  const switched = await f.send('现在由谁回答');
  assert.equal(switched.model, 'employee-template-architect'); assert.equal(switched.tools?.length ?? 0, 0);
  assert.equal(f.counters.skillBodies, counts.skillBodies); assert.equal(f.counters.knowledgePrepare, counts.knowledgePrepare);
  await f.clear();
  const afterUnbind = await f.send('继续普通原生对话');
  assert.equal(resolveConversationEmployee(f.store.snapshot(), f.project.id, f.native.id).conversationEmployee, null);
  assert.ok(afterUnbind.tools?.some(tool => tool.name === 'read'));
  assert.match(visible(afterUnbind), /OFFLINE_RESIDENT_ANSWER_1/);
  assert.equal(f.ctx.agents.get(SessionId(f.native.id)), f.native, 'no replacement Agent or Session');
  assert.equal(f.store.snapshot().runs.filter(run => run.conversationEmployee).length, 4, 'only resident business turns create resident attempts');
  assert.deepEqual(f.errors, []);
});

test('complete software seed consultation request composition is measured without paid calls or production histories', async t => {
  const consult = await fixture(t);
  await consult.set('employee-template-product', 'consult');
  const light = await consult.send('你是谁');
  const execute = await fixture(t);
  await execute.set('employee-template-product', 'execute');
  const full = await execute.send('你是谁');
  const summarize = (request: GenerateOptions, counters: typeof consult.counters) => ({
    provider: request.provider, model: request.model, reasoningEffort: request.reasoningEffort,
    toolNames: request.tools?.map(tool => tool.name) ?? [],
    toolSchemaBytes: Buffer.byteLength(JSON.stringify(request.tools ?? [])),
    sentCatalogMessages: request.messages.filter(message => message.source?.kind === 'skill-catalog').length,
    modelContentBytes: Buffer.byteLength(visible(request)),
    fullEnvelopeBytes: Buffer.byteLength(JSON.stringify(request)),
    employeeContexts: pluginContexts(request).map(section => ({ name: section.name, bytes: Buffer.byteLength(section.text), sha256: digest(section.text) })),
    messageComposition: request.messages.map(message => ({ role: message.role, source: message.source?.kind ?? 'none', bytes: Buffer.byteLength(JSON.stringify(message.content)) })),
    operations: { ...counters },
  });
  const comparison = { safety: 'Official in-memory rc.3 Agent/Session and filesystem/skill plugins; complete production product-role seed and bundled Skills, isolated temporary Chat directories, offline response Adapter. No user Session, credentials, external model or cache usage claims.',
    unit: 'UTF-8 serialized bytes; not tokenizer count. Native fixture includes official filesystem and skill tools; it is not a full desktop native 32-tool snapshot.',
    consult: summarize(light, consult.counters), execute: summarize(full, execute.counters) };
  assert.equal(comparison.consult.toolNames.length, 0);
  assert.equal(comparison.consult.sentCatalogMessages, 0);
  assert.equal(comparison.execute.sentCatalogMessages, 1, 'native discovery and required-skill lookup emit exactly one complete catalog to this first execution request');
  assert.ok(comparison.execute.toolNames.length > 0);
  assert.ok(comparison.consult.modelContentBytes < comparison.execute.modelContentBytes);
  assert.equal(comparison.consult.operations.skillBodies, 0);
  assert.equal(comparison.consult.operations.knowledgePrepare, 0);
  assert.ok(comparison.execute.operations.skillBodies > 0);
  const output = resolve('artifacts/resident-chat/native-api'); await mkdir(output, { recursive: true });
  await writeFile(join(output, 'complete-seed-comparison.json'), JSON.stringify(comparison, null, 2) + '\n');
});
