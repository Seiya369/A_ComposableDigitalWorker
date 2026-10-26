/**
 * Opt-in live verification. At most three tiny-output model requests; default is free.
 * Run: WF_LIVE_CACHE_VERIFY=1 npx tsx tests/native-provider-cache-live.mjs
 * Uses only official rc.3 SDK APIs and an isolated in-memory native Agent.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Context } from '@deepseek-ai/cordis';
import AgentRegistry, { installModelSelection } from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import CredentialStore, { parseCredentialsDocument } from '@deepseek-ai/dsh-credentials-local';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import LlmRuntime, { createUserMessage, normalizeApiKey } from '@deepseek-ai/dsh-llm';
import { DeepSeekAdapter, PUBLIC_BASE_URL, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek';
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import { registerConversationWorkflowRuntime } from '../src/harness/conversation-workflow-runtime.ts';

if (process.env.WF_LIVE_CACHE_VERIFY !== '1') {
  console.log(JSON.stringify({ status: 'skipped', reason: 'Set WF_LIVE_CACHE_VERIFY=1 to authorize at most three live tiny-output requests.', modelRequests: 0 }));
  process.exit(0);
}

// A later opt-in verification must not overwrite the earlier measured evidence.
const outputRoot = resolve('artifacts/native-context-remediation/live-cache', `run-${new Date().toISOString().replace(/[^0-9TZ]/g, '')}`);
await mkdir(outputRoot, { recursive: true, mode: 0o700 });
const report = {
  startedAt: new Date().toISOString(), status: 'initializing',
  model: 'deepseek-v4-pro', provider: 'deepseek-official', endpoint: PUBLIC_BASE_URL,
  reasoningEffort: 'off', maxOutputTokensPerRequest: 128, maxModelRequests: 3,
  syntheticContentOnly: true, persistentSessionsCreated: 0, actualUserSettingsModified: false,
  credentialsExported: false, modelRequests: 0, calls: [],
  limitation: 'A service-side cache is best-effort. This test checks actual usage and stable native input, not a guaranteed future hit rate.',
};
const save = async () => writeFile(resolve(outputRoot, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const require = createRequire(import.meta.url);
report.sdkVersions = Object.fromEntries(['@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-llm-deepseek', '@deepseek-ai/dsh-credentials-local']
  .map(name => [name, require(`${name}/package.json`).version]));
report.sourceHashes = Object.fromEntries(await Promise.all(['src/harness/conversation-workflow-runtime.ts', 'src/harness/native-workflow-context.ts']
  .map(async file => [file, digest(await readFile(resolve(file)))])));
const credentialPath = resolve(process.env.WF_LIVE_CREDENTIALS_PATH || resolve(homedir(), '.dsh/.credentials.yaml'));
let credentialHash;
let ctx, handle, disposeWorkflow;
let replayRequest;

try {
  // A pre-release credentials boot can migrate a legacy file. Public parsing
  // proves the current format before initialization, preventing that write path.
  let managed;
  try { managed = await readFile(credentialPath); }
  catch { report.status = 'unable-to-run'; report.reason = 'Managed credential file unavailable; no fallback secret copying is attempted.'; throw new Error('PREFLIGHT_STOP'); }
  credentialHash = digest(managed);
  try { parseCredentialsDocument(managed.toString('utf8'), credentialPath); }
  catch { report.status = 'unable-to-run'; report.reason = 'Managed credential document requires migration or repair; verification will not modify it.'; throw new Error('PREFLIGHT_STOP'); }
  const mode = (await stat(credentialPath)).mode & 0o777;
  if (process.platform !== 'win32' && mode & 0o077) {
    report.status = 'unable-to-run'; report.reason = 'Managed credential permissions are not private; verification does not change permissions.'; throw new Error('PREFLIGHT_STOP');
  }
  managed = undefined;
  ctx = new Context();
  await ctx.plugin(CredentialStore, { path: credentialPath, watch: false });
  const ref = credentialRef('DEEPSEEK_API_KEY');
  if (!(await ctx.credentials.describe(ref)).configured) {
    report.status = 'unable-to-run'; report.reason = 'The official credential reference is not configured.'; throw new Error('PREFLIGHT_STOP');
  }
  await ctx.plugin(LlmRuntime); await ctx.plugin(SessionStore); await ctx.plugin(SessionProjectionRegistry);
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); await ctx.plugin(AgentRegistry); await ctx.plugin(AgentLoop, { agents: [] });
  const eventFeed = new Map();
  ctx.on('session/event', (session, event) => {
    let events = eventFeed.get(session.id);
    if (!events) { events = new Map(); eventFeed.set(session.id, events); }
    events.set(event.seq, event);
  });
  const options = resolveAdapterOptions({ baseURL: PUBLIC_BASE_URL, reasoningEffort: 'off', maxTokens: 128,
    streamIdleTimeoutMs: 30_000, retryPolicy: { mode: 'normal', maxRetries: 0 },
  });
  const testIdentity = randomUUID();
  const adapter = new DeepSeekAdapter({
    options: () => options,
    resolveAuth: async () => {
      const resolved = await ctx.credentials.resolve(ref);
      if (!resolved) throw new Error('MISSING_CREDENTIAL');
      const checked = normalizeApiKey(resolved.value);
      if (!checked.ok) throw new Error('INVALID_CREDENTIAL');
      return { headers: { 'x-api-key': checked.value } };
    },
    resolveUserId: () => testIdentity,
    prepareExtensions: async () => ({ fields: {}, accept: async () => {} }),
  });
  ctx.llm.registerAdapter([report.provider], adapter);
  const stableRole = [
    'You are a synthetic cache-verification employee. This is a transport test. Answer the current user with exactly OK. Never call any tool.',
    ...Array.from({ length: 40 }, (_, i) => `Stable synthetic role rule ${i + 1}: preserve context identity, distinguish evidence from instruction, and return only OK for this verification.`),
    '<skill_content name="synthetic-cache-verification">',
    ...Array.from({ length: 40 }, (_, i) => `Skill procedure ${i + 1}: the synthetic item K${String(i + 1).padStart(3, '0')} belongs to this unchanged test version. No filesystem or external action is required.`),
    '</skill_content>',
  ].join('\n');
  const taskContext = JSON.stringify({ kind: 'synthetic-C-overview', version: 1, status: 'candidate',
    entries: Array.from({ length: 24 }, (_, i) => ({ id: `synthetic-${i + 1}`, title: `Synthetic concept ${i + 1}`, summary: 'This artificial knowledge exists only for bounded prefix-cache verification. It is not a user fact.' })),
  });
  const modelVisible = request => ({ model: request.model, reasoningEffort: request.reasoningEffort,
    maxTokens: request.maxTokens, system: request.system,
    messages: request.messages.map(message => ({ role: message.role, content: message.content })), tools: request.tools,
  });
  ctx.on('llm/stream', async function* (request, next) {
    if (++report.modelRequests > report.maxModelRequests) throw new Error('LIVE_REQUEST_LIMIT');
    const began = performance.now();
    const normalized = modelVisible(request);
    const visibleText = request.messages.flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n');
    const row = { request: report.modelRequests, inputHash: digest(normalized), nativeMessages: request.messages.length,
      roleFullBodyOccurrences: visibleText.split(stableRole).length - 1,
      taskFullBodyOccurrences: visibleText.split(taskContext).length - 1,
      model: request.model, reasoningEffort: request.reasoningEffort, maxTokens: request.maxTokens,
      firstChunkMs: null, firstTextMs: null, elapsedMs: null, usage: null, completed: false,
    };
    report.calls.push(row);
    if (report.modelRequests === 2) replayRequest = request;
    try {
      for await (const chunk of next()) {
        row.firstChunkMs ??= Math.round(performance.now() - began);
        if (chunk.type === 'text-delta') row.firstTextMs ??= Math.round(performance.now() - began);
        if (chunk.type === 'usage') row.usage = { ...chunk.usage };
        if (chunk.type === 'finish') { row.completed = chunk.reason.kind === 'stop'; row.finishKind = chunk.reason.kind; }
        yield chunk;
      }
    } finally { row.elapsedMs = Math.round(performance.now() - began); await save(); }
  });
  ctx.systemPrompt.section({ name: 'cache-probe-native-system', order: 0, complete: true,
    text: 'This is an isolated synthetic verification. Answer user requests with exactly OK. Do not call tools or perform actions.' });
  let steps = 0;
  disposeWorkflow = registerConversationWorkflowRuntime(ctx, {
    isDeliverySession: () => false,
    // This isolated Session has no restored history. Its public event feed is
    // the read-only source for the hook's retirement index, without deprecated reads.
    readEvents: async agent => [...(eventFeed.get(agent.id)?.values() ?? [])].sort((a, b) => a.seq - b.seq),
    prepare: async () => {
      steps = 0;
      return { id: 'synthetic-employee', contextKey: 'synthetic-version-one', prompt: stableRole, taskContext,
        model: { provider: report.provider, model: report.model, reasoningEffort: 'off' },
        tools: [{ name: 'synthetic_cache_probe', description: 'Synthetic harmless echo tool; do not call during cache verification.',
          parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false },
          output: { schema: { type: 'string' }, render: value => [{ type: 'text', text: String(value) }] },
          execute: async () => 'Synthetic tool is disabled during this verification.' }],
        beforeStep: async () => { if (++steps > 1) throw new Error('LIVE_ONE_STEP_PER_TURN'); },
      };
    },
    onError: () => { /* Errors are reported below by code only, without payloads. */ },
  });
  handle = await ctx.agents.create({ sessionId: SessionId(`isolated-live-cache-${randomUUID()}`),
    meta: { cwd: process.cwd() }, agentOptions: { provider: report.provider, model: report.model, reasoningEffort: 'off', maxTokens: 128 },
    setup: agentCtx => { installModelSelection(agentCtx, { current: { provider: report.provider, model: report.model, reasoningEffort: 'off' }, assembled: undefined }); },
  });
  async function send(question) {
    const timer = setTimeout(() => handle.agent.cancel({ kind: 'user' }), 35_000);
    try {
      handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: question }] }));
      await handle.agent.whenIdle(); await new Promise(resolve => setImmediate(resolve));
      const ending = [...(eventFeed.get(handle.agent.id)?.values() ?? [])].findLast(event => event.type === 'turn/end');
      if (ending?.data.reason.kind !== 'completed') {
        report.status = 'provider-run-incomplete';
        report.reason = 'The isolated native turn did not complete; no additional recovery request will be sent.';
        report.nativeEndKind = ending?.data.reason.kind ?? 'missing';
        report.nativeErrorCode = ending?.data.reason.error?.code ?? null;
        throw new Error('LIVE_TURN_STOP');
      }
    } finally { clearTimeout(timer); }
  }
  report.status = 'running'; await save();
  await send('Return exactly OK. This first synthetic verification requires no tools.');
  await new Promise(resolve => setTimeout(resolve, 2500));
  await send('Return exactly OK again. Reuse the unchanged synthetic role and knowledge; do not call tools.');
  assert(replayRequest);
  await new Promise(resolve => setTimeout(resolve, 2500));
  for await (const _chunk of ctx.llm.stream({ ...replayRequest, signal: AbortSignal.timeout(35_000) })) { /* no transcript persistence */ }
  assert.equal(report.modelRequests, 3);
  assert.equal(report.calls[1].inputHash, report.calls[2].inputHash, 'third request repeats the exact second model-visible payload');
  assert(report.calls.every(row => row.roleFullBodyOccurrences === 1 && row.taskFullBodyOccurrences === 1));
  report.status = report.calls.every(row => row.completed && row.usage) ? 'completed' : 'completed-with-missing-usage';
  report.aggregateUsage = report.calls.reduce((sum, row) => {
    if (!row.usage) return sum;
    for (const field of ['inputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens']) sum[field] += row.usage[field] ?? 0;
    return sum;
  }, { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 });
  report.aggregateUsage.aggregateInputTokens = report.aggregateUsage.inputTokens + report.aggregateUsage.cacheReadTokens + report.aggregateUsage.cacheWriteTokens;
  report.aggregateUsage.totalTokens = report.aggregateUsage.aggregateInputTokens + report.aggregateUsage.outputTokens;
  report.observedCacheReadTokens = report.calls.map(row => row.usage?.cacheReadTokens ?? null);
  report.exactRepeatInputHashEqual = true;
} catch (error) {
  if (!['unable-to-run', 'provider-run-incomplete'].includes(report.status)) {
    report.status = 'failed'; report.errorCode = typeof error?.code === 'string' ? error.code : error?.name ?? 'UNKNOWN';
    report.reason = 'Verification stopped; raw errors, prompts, responses and credentials were not exported.';
  }
} finally {
  await disposeWorkflow?.(); await handle?.dispose(); await ctx?.fiber.dispose();
  if (credentialHash) {
    try { report.credentialFileUnchanged = credentialHash === digest(await readFile(credentialPath)); }
    catch { report.credentialFileUnchanged = false; }
  }
  report.finishedAt = new Date().toISOString();
  await save();
}
console.log(JSON.stringify(report, null, 2));
if (report.status !== 'completed') process.exitCode = report.status === 'unable-to-run' ? 2 : 1;
