import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import type { ConversationWorkflowSnapshot } from '../src/client/conversation-workflow.js';

// Bundle actual plugin components so CSS imports are handled exactly at a build
// boundary; native hooks/effects are not simulated or patched for this projection.
async function renderer(t: { after(callback: () => Promise<void>): void }) {
  const temp = await mkdtemp(resolve(tmpdir(), 'workforce-workflow-ui-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const file = resolve(temp, 'render.cjs');
  await build({ stdin: { resolveDir: process.cwd(), contents: `
    import { createElement } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { ConversationWorkflowPicker, ConversationWorkflowSteps } from './src/ui/ConversationWorkflow.tsx';
    export function render(snapshot, recoveryNotice) {
      const controller = { read: () => ({ snapshot, loading: false, pending: false, error: 'stale workflow error' }),
        subscribe: () => () => {}, refresh: async () => {}, selectWorkflow: async () => false, selectStep: async () => false, dispose() {} };
      return renderToStaticMarkup(createElement('main', null,
        createElement(ConversationWorkflowPicker, { sessionId: snapshot.sessionId, controller, recovery: recoveryNotice ? { read: () => recoveryNotice, subscribe: () => () => {}, retry() {} } : undefined }),
        createElement(ConversationWorkflowSteps, { sessionId: snapshot.sessionId, controller })));
    }
  ` }, outfile: file, bundle: true, platform: 'node', format: 'cjs', loader: { '.css': 'empty' }, logLevel: 'silent', define: { 'process.env.NODE_ENV': '"production"' } });
  return createRequire(import.meta.url)(file).render as (snapshot: ConversationWorkflowSnapshot, recoveryNotice?: string) => string;
}

const snapshot = (workflowEnabled: boolean): ConversationWorkflowSnapshot => ({
  sessionId: 'session', projectId: 'project', revision: 1, selection: 'inherit', workflowEnabled,
  workflowTemplateId: 'stale-software', workflowName: '软件工程', currentStepId: 'build', instanceVersion: 2,
  ownerName: '开发人员', choices: [{ id: 'stale-software', name: '软件工程', version: 1 }],
  steps: [{ id: 'build', name: '开发', status: 'current', employeeName: '开发人员' }],
});

test('disabled Chat workflow service renders no selector, step strip, owner or stale workflow error', async t => {
  const render = await renderer(t);
  const html = render(snapshot(false));
  assert.equal(html, '<main></main>');
  const ordinary = render(snapshot(true));
  assert.match(ordinary, /wf-conversation-workflow-picker/);
  assert.match(ordinary, /wf-conversation-workflow-steps/);
  assert.match(ordinary, /开发人员/);
});


test('disabled Chat workflow still exposes the generic unsent-attachment recovery notice', async t => {
  const render = await renderer(t);
  const html = render(snapshot(false), '未发送附件需要保留，请处理后刷新连接');
  assert.match(html, /role="alert"/);
  assert.match(html, /未发送附件需要保留/);
  assert.match(html, /刷新继续/);
  assert.doesNotMatch(html, /wf-conversation-workflow-picker|wf-conversation-workflow-steps|工作流：软件工程|开发人员/);
});

test('disabled Chat exposes a failed native handoff as a generic retry without workflow controls', async t => {
  const render = await renderer(t);
  const html = render({ ...snapshot(false), continuationError: '恢复原生对话失败，请重试' });
  assert.match(html, /role="alert"/); assert.match(html, /恢复原生对话失败/); assert.match(html, /重试/);
  assert.doesNotMatch(html, /wf-conversation-workflow-picker|wf-conversation-workflow-steps|工作流：软件工程|开发人员|stale workflow error/);
});
