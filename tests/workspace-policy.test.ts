import assert from 'node:assert/strict';
import test from 'node:test';
import { conversationWorkflowsEnabled } from '../src/harness/workspace-policy.js';

test('only the actual Chat directory disables conversation workflows across platform path spellings', () => {
  for (const path of ['/projects/Chat', '/projects/chat/', '/projects/CHAT///', 'C:\\projects\\Chat\\', '\\\\server\\share\\cHaT', '/projects/Chat/.']) {
    assert.equal(conversationWorkflowsEnabled({ path }), false, path);
  }
});

test('other project directories remain workflow enabled regardless of title or Chat ancestors', () => {
  for (const path of ['/projects/chat-service', '/projects/Chat/project', '/projects/Chat/../project', '/projects/research']) {
    const workspace = { path, title: 'Chat' };
    assert.equal(conversationWorkflowsEnabled(workspace), true, path);
  }
});
