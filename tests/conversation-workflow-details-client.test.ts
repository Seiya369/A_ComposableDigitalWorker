import assert from 'node:assert/strict';
import test from 'node:test';
import { createConversationWorkflowDetailsClient } from '../src/client/conversation-workflow-details.js';

test('details transport retains session, step and exact delivery version with a cancellable read-only request', async () => {
  const calls: Array<{ path: string; body?: unknown; signal?: AbortSignal }> = [];
  const controller = new AbortController();
  const client = createConversationWorkflowDetailsClient(async <T>(path: string, body?: unknown, signal?: AbortSignal) => { calls.push({ path, body, signal }); return {} as T; });
  await client.load('native/chat?name', { stepId: 'step/#one', runId: 'run&one', runVersion: 4 }, controller.signal);
  const query = new URL(calls[0]!.path, 'http://fixture.invalid').searchParams;
  assert.deepEqual(Object.fromEntries(query), { sessionId: 'native/chat?name', stepId: 'step/#one', runId: 'run&one', runVersion: '4' });
  assert.equal(calls[0]!.body, undefined); assert.equal(calls[0]!.signal, controller.signal);
  await client.load('old-native-chat', { runId: 'legacy-run' });
  assert.equal(new URL(calls[1]!.path, 'http://fixture.invalid').searchParams.has('runVersion'), false, 'legacy callers do not acquire an invented version');
});
