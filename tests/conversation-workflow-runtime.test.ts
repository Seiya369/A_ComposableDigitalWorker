import assert from 'node:assert/strict';
import test from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import AgentRegistry, { installModelSelection, type AgentHandle, type ModelSelectionRef } from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import LlmRuntime, { createUserMessage, LlmAdapter, ReasoningEffortId, ToolCallId, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm';
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime, { type ToolDefinition } from '@deepseek-ai/dsh-tools';
import { registerConversationWorkflowRuntime, type ConversationWorkflowRuntimeDependencies, type NativeWorkflowLease } from '../src/harness/conversation-workflow-runtime.js';

const text = (value: string): StreamChunk[] => [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: value },
  { type: 'block-end', index: 0, block: { type: 'text', text: value } },
  { type: 'finish', reason: { kind: 'stop' } },
];
const call = (name: string): StreamChunk[] => [
  { type: 'block-start', index: 0, blockType: 'tool-call' },
  { type: 'tool-call-delta', index: 0, id: ToolCallId(`call-${name}`), name, argumentsDelta: '{}' },
  { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(`call-${name}`), name, arguments: '{}' } },
  { type: 'finish', reason: { kind: 'tool-calls' } },
];
class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = [];
  constructor(private readonly scripts: Array<(request: GenerateOptions) => StreamChunk[] | Promise<StreamChunk[]>>) { super(); }
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model, reasoning: { efforts: [{ id: ReasoningEffortId('high'), name: 'High' }] } };
  }
  async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(request);
    const script = this.scripts.shift();
    if (!script) throw new Error('fixture script exhausted');
    for (const chunk of await script(request)) yield chunk;
  }
}
const tool = (name = 'workflow_fixture', execute = async () => 'fixture tool result'): ToolDefinition => ({
  name, description: 'Lease scoped fixture tool', parameters: { type: 'object', properties: {}, additionalProperties: false },
  output: { schema: { type: 'string' }, render: value => [{ type: 'text', text: String(value) }] }, execute,
});
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
async function fixture(scripts: ConstructorParameters<typeof ScriptedAdapter>[0], deps: ConversationWorkflowRuntimeDependencies, options: { existing?: boolean; toolsMode?: 'native' | 'ptc' } = {}) {
  const ctx = new Context();
  await ctx.plugin(LlmRuntime);
  await ctx.plugin(SessionStore);
  await ctx.plugin(SessionProjectionRegistry);
  await ctx.plugin(SystemPrompt);
  if (options.toolsMode === 'ptc') ctx.provide('ptcRuntime', {
    language: 'typescript', isolation: 'process', executionInstructions: 'Fixture PTC runtime: no program execution in this schema test.',
    sandboxMode: 'workspace-write', timeout: { defaultMs: 1000, maxMs: 1000 },
  } as never);
  await ctx.plugin(ToolRuntime, { mode: options.toolsMode ?? 'native' });
  await ctx.plugin(AgentRegistry);
  await ctx.plugin(AgentLoop, { agents: [] });
  const adapter = new ScriptedAdapter(scripts);
  ctx.llm.registerAdapter(['fixture'], adapter);
  ctx.systemPrompt.section({ name: 'native-complete', order: -1000, text: 'NATIVE_COMPLETE_SYSTEM', complete: options.toolsMode !== 'ptc' });
  ctx.systemPrompt.context({ name: 'native-policy', order: 0, required: true, text: 'NATIVE_PERMISSION_CONTEXT' });
  const selection: ModelSelectionRef = { current: { provider: 'fixture', model: 'native-model' }, assembled: undefined };
  let handle: AgentHandle;
  const create = async () => {
    handle = await ctx.agents.create({ sessionId: SessionId(`native-workflow-${Math.random()}`),
      meta: { cwd: process.cwd() }, agentOptions: { provider: 'fixture', model: 'native-model' },
      setup: agentCtx => { installModelSelection(agentCtx, selection); },
    });
  };
  if (options.existing) await create();
  const dispose = registerConversationWorkflowRuntime(ctx, deps);
  if (!options.existing) await create();
  const send = async (request: string) => {
    handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: request }] }));
    await handle.agent.whenIdle();
    // The durable turn/end listener starts asynchronous business settlement.
    await new Promise(resolve => setImmediate(resolve));
  };
  return { ctx, adapter, selection, agent: handle!.agent, send, dispose,
    cleanup: async () => { await dispose(); await handle.dispose(); },
  };
}
const lease = (id = 'owner-one', extra: Partial<NativeWorkflowLease> = {}): NativeWorkflowLease => ({
  id, prompt: `WORKFLOW_OWNER_CONTEXT:${id}`, model: { provider: 'fixture', model: id }, ...extra,
});

test('first native request has frozen owner context and tools while complete native prompt and history stay intact', async () => {
  const prepared: Array<{ key: string; request: string }> = [];
  const results: SessionEvent[][] = [];
  let toolCalls = 0;
  let beforeSteps = 0;
  let afterTools = 0;
  let disposed = 0;
  const f = await fixture([
    request => {
      assert.equal(request.model, 'owner-one');
      assert.match(JSON.stringify(request), /NATIVE_COMPLETE_SYSTEM/);
      assert.match(JSON.stringify(request), /NATIVE_PERMISSION_CONTEXT/);
      assert.match(JSON.stringify(request), /WORKFLOW_OWNER_CONTEXT:owner-one/);
      assert.ok(request.tools?.some(item => item.name === 'workflow_fixture'), 'tool must be present on the first request');
      return call('workflow_fixture');
    },
    request => { assert.match(JSON.stringify(request), /fixture tool result/); return text('done'); },
  ], {
    isDeliverySession: () => false,
    prepare: async (_agent, key, request) => {
      prepared.push({ key, request });
      return lease('owner-one', { tools: [tool(undefined, async () => { toolCalls++; return 'fixture tool result'; })],
        beforeStep: async () => { beforeSteps++; }, afterTool: async () => { afterTools++; },
        finish: async events => { results.push([...events]); }, dispose: () => { disposed++; },
      });
    },
  });
  try {
    const originalId = f.agent.id;
    await f.send('USER_ORIGINAL_REQUEST');
    assert.equal(f.agent.id, originalId);
    assert.equal(f.ctx.agents.list().length, 1, 'no second agent or session is created');
    assert.deepEqual(prepared.map(value => value.request), ['USER_ORIGINAL_REQUEST']);
    assert.equal(prepared.length, 1, 'reassembly and model continuation must not repeat prepare');
    assert.equal(f.adapter.requests.length, 2, JSON.stringify(f.agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')));
    assert.equal(toolCalls, 1); assert.equal(afterTools, 1); assert.equal(beforeSteps, 2);
    assert.equal(disposed, 1);
    assert.equal(results.length, 1);
    assert.equal(results[0]![0]!.type, 'turn/start');
    assert.equal(results[0]!.at(-1)!.type, 'turn/end');
    assert.equal(f.agent.ctx.tools.get('workflow_fixture', f.agent), undefined, 'lease tool disappears on turn end');
    assert.ok(f.agent.session.snapshotEvents().some(event => event.type === 'assistant/message'));
  } finally { await f.cleanup(); }
});

test('changing selection mid-turn keeps the owner frozen and None restores native selector on the next turn', async () => {
  let selected: string | undefined = 'first';
  let prepared = 0;
  const f = await fixture([
    request => { assert.equal(request.model, 'first'); selected = 'second'; return call('workflow_fixture'); },
    request => { assert.equal(request.model, 'first'); return text('first done'); },
    request => {
      assert.equal(request.model, 'second');
      const notices = request.messages.filter(message => message.role === 'user' && message.source.kind === 'model-selection');
      assert.match(JSON.stringify(notices), /first → second/);
      assert.doesNotMatch(JSON.stringify(notices), /first → native-model/);
      return text('second done');
    },
    request => {
      assert.equal(request.model, 'native-updated');
      assert.ok(!request.tools?.some(item => item.name === 'workflow_fixture'));
      // Historical owner context remains in the log, but no current runtime
      // snapshot silently reactivates it after None.
      const contexts = request.messages.filter(message => message.role === 'user' && message.source.kind === 'runtime-context');
      assert.doesNotMatch(JSON.stringify(contexts.at(-1)), /WORKFLOW_OWNER_CONTEXT/);
      return text('native done');
    },
  ], {
    isDeliverySession: () => false,
    prepare: async () => { prepared++; return selected ? lease(selected, { tools: [tool()] }) : undefined; },
  });
  try {
    await f.send('first request'); await f.send('second request');
    selected = undefined;
    f.selection.current = { provider: 'fixture', model: 'native-updated' };
    await f.send('plain request');
    assert.equal(prepared, 3);
    assert.equal(f.adapter.requests.length, 4);
  } finally { await f.cleanup(); }
});

test('already live native agents are supported and each finish receives only its own turn', async () => {
  const windows: SessionEvent[][] = [];
  const keys: string[] = [];
  const f = await fixture([() => text('one'), () => text('two')], {
    isDeliverySession: () => false,
    prepare: async (_agent, key) => { keys.push(key); return lease(undefined, { finish: async events => { windows.push([...events]); } }); },
  }, { existing: true });
  try {
    await f.send('turn one'); await f.send('turn two');
    assert.equal(windows.length, 2); assert.notEqual(keys[0], keys[1]);
    assert.equal(windows[0]!.filter(event => event.type === 'turn/start').length, 1);
    assert.equal(windows[1]!.filter(event => event.type === 'turn/start').length, 1);
    assert.ok(windows[1]!.every(event => event.seq > windows[0]!.at(-1)!.seq));
    assert.doesNotMatch(JSON.stringify(windows[1]), /turn one/);
  } finally { await f.cleanup(); }
});

test('business settlement completes before a queued turn prepares a new lease', async () => {
  const finishing = deferred();
  const finishEntered = deferred();
  const order: string[] = [];
  const f = await fixture([() => text('one'), () => text('two')], {
    isDeliverySession: () => false,
    prepare: async (_agent, _key, request) => {
      order.push(`prepare:${request}`);
      return lease(undefined, { finish: async () => {
        if (request === 'one') { finishEntered.resolve(); await finishing.promise; order.push('settled:one'); }
      } });
    },
  });
  try {
    const one = f.send('one'); await finishEntered.promise;
    const two = f.send('two');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(order, ['prepare:one']);
    finishing.resolve(); await Promise.all([one, two]);
    assert.deepEqual(order, ['prepare:one', 'settled:one', 'prepare:two']);
  } finally { finishing.resolve(); await f.cleanup(); }
});

test('delivery sessions and diagnostics never prepare or adopt a conversation', async () => {
  let prepared = 0;
  const f = await fixture([request => { assert.equal(request.model, 'native-model'); return text('native'); }], {
    isDeliverySession: () => true, prepare: async () => { prepared++; return lease(); },
  });
  try {
    await f.ctx.systemPrompt.assemble({});
    await f.ctx.systemPrompt.assemble({ agent: f.agent, scope: f.agent });
    await f.send('existing delivery must keep its owner');
    assert.equal(prepared, 0);
  } finally { await f.cleanup(); }
});

test('a preparation failure ends the native turn without silently sending through the native model', async () => {
  let prepared = 0;
  const f = await fixture([], { isDeliverySession: () => false, prepare: async () => { prepared++; throw new Error('step owner is unavailable'); } });
  try {
    await f.send('do not downgrade');
    assert.equal(prepared, 1); assert.equal(f.adapter.requests.length, 0);
    const end = f.agent.session.snapshotEvents().findLast(event => event.type === 'turn/end');
    assert.equal(end?.type, 'turn/end');
    if (end?.type === 'turn/end') { assert.equal(end.data.reason.kind, 'error'); assert.match(JSON.stringify(end.data), /step owner is unavailable/); }
  } finally { await f.cleanup(); }
});

test('failed step authorization still finishes and releases the lease exactly once', async () => {
  let finished = 0; let disposed = 0;
  const f = await fixture([], { isDeliverySession: () => false, prepare: async () => lease(undefined, {
    tools: [tool()], beforeStep: async () => { throw new Error('step authority revoked'); },
    finish: async () => { finished++; }, dispose: () => { disposed++; },
  }) });
  try {
    await f.send('revoked');
    assert.equal(f.adapter.requests.length, 0); assert.equal(finished, 1); assert.equal(disposed, 1);
    assert.equal(f.agent.ctx.tools.get('workflow_fixture', f.agent), undefined);
  } finally { await f.cleanup(); }
});

test('native monotonic guards remain authoritative and lease guards can only further deny', async () => {
  let calls = 0;
  const f = await fixture([
    () => call('workflow_fixture'),
    request => { assert.match(JSON.stringify(request), /NATIVE_POLICY_DENIAL/); return text('denied'); },
    () => call('workflow_fixture'),
    request => { assert.match(JSON.stringify(request), /LEASE_POLICY_DENIAL/); return text('denied'); },
  ], { isDeliverySession: () => false, prepare: async () => lease(undefined, {
    tools: [tool(undefined, async () => { calls++; return 'never'; })],
    guard: () => mode === 'lease' ? 'LEASE_POLICY_DENIAL' : undefined,
  }) });
  let mode = 'native';
  const removeGuard = f.agent.ctx.tools.guard(() => mode === 'native' ? 'NATIVE_POLICY_DENIAL' : undefined);
  try {
    await f.send('native policy'); mode = 'lease'; await f.send('lease policy');
    assert.equal(calls, 0);
  } finally { removeGuard(); await f.cleanup(); }
});

test('unloading cancels an owned turn, removes scoped tools, and preserves the host Agent for later native use', async () => {
  const entered = deferred();
  let finished = 0; let disposed = 0;
  const f = await fixture([
    async request => {
      entered.resolve();
      await new Promise<void>(resolve => { request.signal!.addEventListener('abort', () => resolve(), { once: true }); });
      request.signal!.throwIfAborted();
      return text('unreachable');
    },
    request => { assert.equal(request.model, 'native-model'); return text('native after unload'); },
  ], { isDeliverySession: () => false, prepare: async () => lease(undefined, {
    tools: [tool()], finish: async () => { finished++; }, dispose: () => { disposed++; },
  }) });
  try {
    const sending = f.send('owned turn'); await entered.promise;
    await f.dispose(); await sending;
    assert.equal(finished, 1); assert.equal(disposed, 1);
    assert.equal(f.ctx.agents.get(f.agent.id), f.agent);
    assert.equal(f.agent.ctx.tools.get('workflow_fixture', f.agent), undefined);
    await f.send('plain after unload');
    assert.equal(f.adapter.requests.length, 2);
  } finally { await f.cleanup(); }
});

test('unloading a plain native turn does not cancel it', async () => {
  const entered = deferred(); const release = deferred();
  const f = await fixture([async request => {
    entered.resolve(); await release.promise;
    assert.equal(request.signal?.aborted, false); return text('ordinary native completion');
  }], { isDeliverySession: () => false, prepare: async () => undefined });
  try {
    const sending = f.send('plain native turn'); await entered.promise;
    const closing = f.dispose();
    release.resolve(); await Promise.all([sending, closing]);
    const end = f.agent.session.snapshotEvents().findLast(event => event.type === 'turn/end');
    if (end?.type === 'turn/end') assert.equal(end.data.reason.kind, 'completed');
  } finally { release.resolve(); await f.cleanup(); }
});

test('first PTC request retains the official run_code projection and includes the new lease tool SDK', async () => {
  let prepared = 0;
  const f = await fixture([request => {
    assert.deepEqual(request.tools?.map(item => item.name), ['run_code']);
    assert.match(JSON.stringify(request), /workflow_fixture/);
    assert.match(JSON.stringify(request), /WORKFLOW_OWNER_CONTEXT/);
    return text('schema inspection done');
  }], { isDeliverySession: () => false, prepare: async () => { prepared++; return lease(undefined, { tools: [tool()] }); } }, { toolsMode: 'ptc' });
  try {
    await f.send('PTC schema');
    assert.equal(prepared, 1); assert.equal(f.adapter.requests.length, 1);
  } finally { await f.cleanup(); }
});

test('lease model clears inherited reasoning effort and None restores the current native effort', async () => {
  let selected = true;
  const f = await fixture([
    request => { assert.equal(request.reasoningEffort, undefined); return text('owner provider default'); },
    request => { assert.equal(request.reasoningEffort, 'high'); return text('native high'); },
  ], { isDeliverySession: () => false, prepare: async () => selected ? lease() : undefined });
  try {
    f.selection.current = { provider: 'fixture', model: 'native-model', reasoningEffort: ReasoningEffortId('high') };
    await f.send('owner'); selected = false; await f.send('native');
    assert.equal(f.adapter.requests.length, 2);
  } finally { await f.cleanup(); }
});

test('cancelling asynchronous preparation releases a returned lease without any model request', async () => {
  const entered = deferred(); const complete = deferred();
  let finished = 0; let disposed = 0;
  const f = await fixture([], { isDeliverySession: () => false, prepare: async (_agent, _key, _request, signal) => {
    entered.resolve(); await complete.promise; assert.equal(signal?.aborted, true);
    return lease(undefined, { tools: [tool()], finish: async () => { finished++; }, dispose: () => { disposed++; } });
  } });
  try {
    const sending = f.send('cancel preparation'); await entered.promise;
    f.agent.cancel({ kind: 'user' }); complete.resolve(); await sending;
    assert.equal(f.adapter.requests.length, 0); assert.equal(finished, 1); assert.equal(disposed, 1);
    assert.equal(f.agent.ctx.tools.get('workflow_fixture', f.agent), undefined);
  } finally { complete.resolve(); await f.cleanup(); }
});

test('a tool registration conflict preserves the native tool and releases earlier partial registrations', async () => {
  let finished = 0; let disposed = 0;
  const f = await fixture([], { isDeliverySession: () => false, prepare: async () => lease(undefined, {
    tools: [tool('partial_lease_tool'), tool('existing_native_tool')],
    finish: async () => { finished++; }, dispose: () => { disposed++; },
  }) });
  const removeNativeTool = f.agent.ctx.tools.register(tool('existing_native_tool'));
  try {
    await f.send('conflicting tool');
    assert.equal(f.adapter.requests.length, 0); assert.equal(finished, 1); assert.equal(disposed, 1);
    assert.equal(f.agent.ctx.tools.get('partial_lease_tool', f.agent), undefined);
    assert.ok(f.agent.ctx.tools.get('existing_native_tool', f.agent));
  } finally { removeNativeTool(); await f.cleanup(); }
});

test('a failing finish callback reports once, disposes its lease, and permits the next native turn', async () => {
  const errors: unknown[] = [];
  let selected = true; let disposed = 0;
  const f = await fixture([() => text('one'), () => text('native')], {
    isDeliverySession: () => false, onError: error => errors.push(error),
    prepare: async () => selected ? lease(undefined, { finish: async () => { throw new Error('business settlement failed'); }, dispose: () => { disposed++; } }) : undefined,
  });
  try {
    await f.send('finish failure'); selected = false; await f.send('native still usable');
    assert.equal(errors.length, 1); assert.equal(disposed, 1); assert.equal(f.adapter.requests.length, 2);
    assert.equal(f.adapter.requests[1]!.model, 'native-model');
  } finally { await f.cleanup(); }
});

test('unload during deferred None lookup preserves the original native submission', async () => {
  const entered = deferred(); const release = deferred();
  const f = await fixture([request => { assert.equal(request.signal?.aborted, false); assert.equal(request.model, 'native-model'); return text('plain submission preserved'); }], {
    isDeliverySession: () => false, ownsPendingTurn: () => false,
    prepare: async () => { entered.resolve(); await release.promise; return undefined; },
  });
  try {
    const sending = f.send('ordinary text while None'); await entered.promise;
    const closing = f.dispose(); release.resolve(); await Promise.all([sending, closing]);
    assert.equal(f.adapter.requests.length, 1);
    const end = f.agent.session.snapshotEvents().findLast(event => event.type === 'turn/end');
    if (end?.type === 'turn/end') assert.equal(end.data.reason.kind, 'completed');
  } finally { release.resolve(); await f.cleanup(); }
});

test('unload cancels a synchronously identified pending workflow owner before a slow prepare completes', async () => {
  const entered = deferred();
  const f = await fixture([], { isDeliverySession: () => false, ownsPendingTurn: () => true,
    prepare: async (_agent, _key, _request, signal) => {
      entered.resolve(); await new Promise<void>(resolve => signal!.addEventListener('abort', () => resolve(), { once: true }));
      signal!.throwIfAborted(); return undefined;
    },
  });
  try {
    const sending = f.send('pending owned preparation'); await entered.promise;
    await f.dispose(); await sending;
    assert.equal(f.adapter.requests.length, 0);
    const end = f.agent.session.snapshotEvents().findLast(event => event.type === 'turn/end');
    if (end?.type === 'turn/end') assert.equal(end.data.reason.kind, 'aborted');
  } finally { await f.cleanup(); }
});

test('None awaiting the previous owner settlement survives unload before its prepare callback begins', async () => {
  const finishEntered = deferred(); const releaseFinish = deferred();
  let selected = true; let prepares = 0;
  const f = await fixture([() => text('owned'), request => {
    assert.equal(request.signal?.aborted, false); assert.equal(request.model, 'native-model'); return text('plain after owner settlement');
  }], { isDeliverySession: () => false, ownsPendingTurn: () => selected,
    prepare: async () => { prepares++; return selected ? lease(undefined, { finish: async () => { finishEntered.resolve(); await releaseFinish.promise; } }) : undefined; },
  });
  try {
    const first = f.send('owned turn'); await finishEntered.promise;
    selected = false;
    const second = f.send('plain turn waiting on prior settlement');
    await new Promise(resolve => setImmediate(resolve));
    const closing = f.dispose(); releaseFinish.resolve(); await Promise.all([first, second, closing]);
    assert.equal(prepares, 1, 'the classified None path goes directly to the existing native sink');
    assert.equal(f.adapter.requests.length, 2);
    const end = f.agent.session.snapshotEvents().findLast(event => event.type === 'turn/end');
    if (end?.type === 'turn/end') assert.equal(end.data.reason.kind, 'completed');
  } finally { releaseFinish.resolve(); await f.cleanup(); }
});
