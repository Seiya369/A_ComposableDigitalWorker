import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import type { ConversationEmployeeSnapshot } from '../src/client/conversation-employee.js';
import { translateUiText } from '../src/ui/i18n.js';

const card = { name: '产品负责人', mission: '明确可验收的需求', duties: ['澄清需求'], boundaries: ['不代替用户发布'], capabilities: { skills: [{ name: '需求分析', description: '分析目标', usage: 'required' as const }], tools: [], plugins: [], mcps: [] } };
const view = (extra: Partial<ConversationEmployeeSnapshot> = {}): ConversationEmployeeSnapshot => ({ enabled: true, busy: false, revision: 1, sessionId: 'chat', projectId: 'project', conversationEmployee: null, choices: [{ kind: 'template', id: 'product', name: card.name, description: card.mission, card }], ...extra });
async function renderer(t: { after(callback: () => Promise<void>): void }) {
  const temp = await mkdtemp(resolve(tmpdir(), 'workforce-employee-ui-')); t.after(() => rm(temp, { recursive: true, force: true }));
  const file = resolve(temp, 'render.cjs');
  await build({ stdin: { resolveDir: process.cwd(), contents: `
    import { createElement } from 'react'; import { renderToStaticMarkup } from 'react-dom/server';
    import { ConversationEmployee, ConversationEmployeeMenu } from './src/ui/ConversationEmployee.tsx';
    export function render(snapshot, menu = false) {
      const controller = { read: () => ({ snapshot, loading:false, pending:false }), subscribe: () => () => {}, refresh: async () => {}, select: async () => false, clear: async () => false, dispose() {} };
      return renderToStaticMarkup(createElement(menu ? ConversationEmployeeMenu : ConversationEmployee, menu
        ? { snapshot, active:1, pending:false, menuId:'resident', onActive(){}, onChoose(){}, onKeys(){}, onRefresh(){} }
        : { sessionId:snapshot.sessionId, controller }));
    }
  ` }, outfile: file, bundle: true, platform: 'node', format: 'cjs', loader: { '.css': 'empty' }, logLevel: 'silent', define: { 'process.env.NODE_ENV': '"production"' } });
  return createRequire(import.meta.url)(file).render as (snapshot: ConversationEmployeeSnapshot, menu?: boolean) => string;
}

test('resident header is an explicit Chat control and remains absent in project mode', async t => {
  const render = await renderer(t);
  assert.equal(render(view({ enabled: false })), '');
  const html = render(view());
  assert.match(html, /选择对话员工/); assert.match(html, /aria-haspopup="listbox"/); assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /工作流|data-composer-input|wf-conversation-workflow/);
});

test('resident header identifies its selected employee while keeping all internal IDs hidden', async t => {
  const render = await renderer(t);
  const html = render(view({ employee: card, conversationEmployee: { sessionId: 'private-session', projectId: 'private-project', employeeId: 'private-employee', mode: 'consult', version: 2, createdAt: 'today', updatedAt: 'today' } }));
  assert.match(html, /产品负责人/); assert.doesNotMatch(html, /private-session|private-project|private-employee|today/);
});

test('conversation employee dropdown contains only names and an empty selection', async t => {
  const render = await renderer(t), html = render(view(), true);
  assert.match(html, /role="listbox"/); assert.match(html, /aria-activedescendant="resident-option-1"/);
  assert.match(html, />无</); assert.match(html, />产品负责人</);
  assert.doesNotMatch(html, /轻咨询|执行任务|处理方式|岗位职责|岗位建议|仅在此对话|模型与推理|查看员工资料|<details|<fieldset|type="radio"|<small|明确可验收的需求|澄清需求|需求分析/);
  assert.doesNotMatch(html, /templateId|product|project/);
});

test('unavailable resident offers exit and busy affects this menu only', async t => {
  const render = await renderer(t);
  const snapshot = view({ busy: true, employee: card, unavailableReason: '常驻员工已暂停，请启用员工或退出常驻', conversationEmployee: { sessionId: 'chat', projectId: 'project', employeeId: 'employee', mode: 'consult', version: 1, createdAt: 'today', updatedAt: 'today' } });
  const html = render(snapshot, true);
  assert.match(html, />无</); assert.match(html, /常驻员工已暂停/); assert.match(html, /aria-disabled="true"/); assert.doesNotMatch(html, /<fieldset|type="radio"/);
});

test('resident product copy supports the native English locale', () => {
  assert.equal(translateUiText('选择对话员工', 'en'), 'Select conversation employee');
  assert.equal(translateUiText('无', 'en'), 'None');
  assert.equal(translateUiText('常驻员工已更新，请刷新后重试', 'en'), 'The resident employee has changed. Refresh and try again.');
});
