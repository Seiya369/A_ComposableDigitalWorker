import assert from 'node:assert/strict';
import test from 'node:test';
import { isLegacyStandaloneRun } from '../src/domain/conversation-session.js';

test('legacy root detection does not confuse linked deliveries with standalone history', () => {
  assert.equal(isLegacyStandaloneRun({}), true);
  for (const fields of [
    { parentRunId: 'parent' },
    { conversationWorkflow: { instanceId: 'instance', stepId: 'step' } },
    { workflow: { workflowRunId: 'flow', stepId: 'step', attempt: 1, timeoutMs: 1000 } },
    { workTaskId: 'task' },
  ]) assert.equal(isLegacyStandaloneRun(fields), false);
});
