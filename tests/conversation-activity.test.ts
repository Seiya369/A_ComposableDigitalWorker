import assert from 'node:assert/strict';
import test from 'node:test';
import { isConversationAgentBusy } from '../src/harness/conversation-activity.js';

const notice = Object.freeze({ role: 'user', source: Object.freeze({ kind: 'user-approval' }), content: Object.freeze([{ type: 'text', text: 'policy changed' }]) });
const idle = (nextStep: readonly unknown[] = [], nextTurn: readonly unknown[] = []) => ({ status: 'idle', inbox: { nextStep, nextTurn } });

test('ordinary idle conversations stay selectable with only official next-step permission notices', () => {
  const messages = Object.freeze([notice, notice]);
  assert.equal(isConversationAgentBusy(idle(messages), true), false);
  assert.deepEqual(messages, [notice, notice], 'reading activity cannot consume the notices');
  assert.equal(isConversationAgentBusy(undefined, true), false);
  assert.equal(isConversationAgentBusy(idle(), true), false);
});

test('actual execution, all next-turn input, and real or unknown next-step input remain locked', () => {
  assert.equal(isConversationAgentBusy({ ...idle([notice]), status: 'running' }, true), true);
  assert.equal(isConversationAgentBusy(idle([], [notice]), true), true, 'the exception applies only to the official non-waking lane');
  for (const message of [
    { role: 'user', source: { kind: 'user' }, content: notice.content },
    { role: 'user', source: { kind: 'another-plugin' } },
    { role: 'assistant', source: { kind: 'user-approval' } }, {}, null, 'queued-input',
  ]) assert.equal(isConversationAgentBusy(idle([notice, message]), true), true);
});

test('retained capabilities and default callers keep permission notices blocking to avoid losing inbox on disposal', () => {
  assert.equal(isConversationAgentBusy(idle([notice])), true);
  assert.equal(isConversationAgentBusy(idle([notice]), false), true);
});
