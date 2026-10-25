import assert from 'node:assert/strict';
import test from 'node:test';
import { createConversationReopenNavigation } from '../src/client/conversation-workflow-reopen.js';

function fixture() {
  const opened: string[] = [];
  let current = 'session'; let visible = true; let ticket = new AbortController();
  let blocked: string | undefined;
  const navigation = createConversationReopenNavigation({
    isCurrentConversation: id => visible && current === id,
    isConversationVisible: () => visible,
    beginNavigation: () => { ticket.abort(); ticket = new AbortController(); return ticket.signal; },
    reloadBlockReason: () => blocked,
    reloadSession: id => opened.push(id),
  });
  return { navigation, opened, background: () => { visible = false; }, leave: (id = 'other') => { current = id; ticket.abort(); }, block: (reason?: string) => { blocked = reason; } };
}

test('a host reopened session refreshes its native generation at most once while its initiating conversation is visible', () => {
  const f = fixture(); f.navigation.beforeSelection('session'); f.navigation.onSessionReopened('session'); f.navigation.onSessionReopened('session');
  assert.deepEqual(f.opened, ['session']);
});
test('later user navigation invalidates the pending reopen rather than pulling the user back', () => {
  const f = fixture(); f.navigation.beforeSelection('session'); f.leave(); f.navigation.onSessionReopened('session');
  assert.deepEqual(f.opened, []);
});
test('background panels and a non-current session cannot be reopened by a late response', () => {
  const f = fixture(); f.navigation.beforeSelection('other'); f.navigation.onSessionReopened('other');
  f.navigation.beforeSelection('session'); f.background(); f.navigation.onSessionReopened('session');
  assert.deepEqual(f.opened, []);
});
test('disposal clears the pending navigation capability', () => {
  const f = fixture(); f.navigation.beforeSelection('session'); f.navigation.dispose(); f.navigation.onSessionReopened('session');
  assert.deepEqual(f.opened, []);
});
test('unsent attachments and in-flight input block refresh until an explicit safe retry', () => {
  const f = fixture(); let publications = 0;
  const unsubscribe = f.navigation.subscribe(() => { publications++; });
  f.block('请先处理未发送附件'); f.navigation.beforeSelection('session'); f.navigation.onSessionReopened('session');
  assert.deepEqual(f.opened, []); assert.equal(f.navigation.read('session'), '请先处理未发送附件');
  f.navigation.retry('session'); assert.deepEqual(f.opened, []);
  f.block('输入正在提交'); f.navigation.retry('session'); assert.equal(f.navigation.read('session'), '输入正在提交');
  f.block(); f.navigation.retry('session'); assert.deepEqual(f.opened, ['session']); assert.equal(f.navigation.read('session'), undefined);
  assert.equal(publications, 4); unsubscribe(); f.navigation.dispose();
});
test('an attachment-blocked recovery does not refresh a different selected conversation', () => {
  const f = fixture(); f.block('未发送附件'); f.navigation.beforeSelection('session'); f.navigation.onSessionReopened('session');
  f.leave(); f.block(); f.navigation.retry('session'); assert.deepEqual(f.opened, []);
});
test('a late handoff from A cannot clear the current B recovery capability', () => {
  const f = fixture(); f.navigation.beforeSelection('session');
  f.leave('second'); f.navigation.beforeSelection('second');
  f.navigation.onSessionReopened('session'); assert.deepEqual(f.opened, []);
  f.navigation.onSessionReopened('second'); assert.deepEqual(f.opened, ['second']);
});
test('returning to A recaptures navigation while joining its existing handoff', () => {
  const f = fixture(); f.navigation.beforeSelection('session');
  f.leave('second'); f.navigation.beforeSelection('second');
  f.leave('session'); f.navigation.beforeSelection('session');
  f.navigation.onSessionReopened('second'); assert.deepEqual(f.opened, []);
  f.navigation.onSessionReopened('session'); assert.deepEqual(f.opened, ['session']);
});
