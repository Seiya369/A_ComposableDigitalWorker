import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

// This fixture exercises only plugin-owned slots and transport. It does not touch a user profile.
const directory = resolve(process.env.WORKFORCE_CONVERSATION_UI_ARTIFACTS ?? 'artifacts/conversation-workflow-validation/ui');
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React from 'react';import{createRoot}from'react-dom/client';
import{ConversationWorkflowPicker,ConversationWorkflowSteps}from'./src/ui/ConversationWorkflow.tsx';
import{createConversationWorkflowController}from'./src/client/conversation-workflow.ts';import'./src/client/integration.css';
const selections=new Map();let defaultId;let revision=1;let current='requirements';const completed=new Set();
window.calls=[];window.failNext=false;window.delayNext=false;
const names={software:'软件工程',quick:'快速修复'};const steps=[['requirements','需求澄清','产品负责人'],['design','交互设计','UX/UI设计师'],['architecture','技术方案','技术负责人'],['development','开发实现','开发人员'],['testing','回归验收','测试负责人'],['release','发布交付','运维负责人']];
const controller=createConversationWorkflowController({
 async load(sessionId){const id=selections.has(sessionId)?selections.get(sessionId):defaultId;return {sessionId,projectId:sessionId==='outside'?undefined:'project',revision,selection:selections.has(sessionId)?'override':'inherit',workflowTemplateId:id??undefined,workflowName:names[id],instanceVersion:revision,currentStepId:current,steps:id?steps.map(([id,name,employeeName])=>({id,name,employeeName,status:id===current?'current':completed.has(id)?'completed':'pending'})):[],choices:[{id:'software',name:names.software,version:1},{id:'quick',name:names.quick,version:1},{id:'broken',name:'缺少负责人',version:1,disabled:true,disabledReason:'请先完善工作流负责人'}]};},
 async selectWorkflow(sessionId,id,snapshot){window.calls.push({type:'workflow',sessionId,id,revision:snapshot.revision});if(window.delayNext){window.delayNext=false;await new Promise(done=>setTimeout(done,500));}if(window.failNext){window.failNext=false;revision++;throw Error('配置已更新，请重试');}if(!defaultId&&id)defaultId=id;else selections.set(sessionId,id);revision++;},
 async selectStep(sessionId,id,snapshot){window.calls.push({type:'step',sessionId,id,revision:snapshot.revision});current=id;revision++;}
},{pollMs:100000});
window.controller=controller;
function Pane({id,title}){return <section data-pane={id}><header><h1>{title}</h1><ConversationWorkflowSteps sessionId={id} controller={controller}/></header><div className="native-tabs"><span>对话</span><span>轨迹</span></div><div className="body">对话内容</div><footer><ConversationWorkflowPicker sessionId={id} controller={controller} onOpenWorkspace={projectId=>window.openWorkspace=projectId}/><button>其他操作</button></footer></section>}
function App(){return <><div className="fixture-controls"><button onClick={()=>{completed.add('requirements');revision++;void controller.refresh('a')}}>标记需求验收</button><button onClick={()=>window.failNext=true}>下次冲突</button><button onClick={()=>window.delayNext=true}>下次延迟</button><button onClick={()=>controller.dispose()}>卸载插件</button></div><main><Pane id="a" title="项目对话甲"/><Pane id="b" title="项目对话乙"/><Pane id="outside" title="非项目对话"/></main></>};createRoot(document.getElementById('root')).render(<App/>);` }, bundle: true, platform: 'browser', format: 'iife', write: false, outfile: 'app.js', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
const server = createServer((request, response) => {
  const suffix = request.url === '/app.js' ? 'app.js' : request.url === '/app.css' ? 'app.css' : undefined;
  const file = suffix && bundle.outputFiles.find(file => file.path.endsWith(suffix));
  if (file) { response.writeHead(200, { 'Content-Type': suffix.endsWith('.css') ? 'text/css' : 'text/javascript' }); response.end(file.text); return; }
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>
  html{--dsw-alias-bg-base:#151515;--dsw-alias-bg-layer-2:#292929;--dsw-alias-label-primary:#f5f5f5;--dsw-alias-label-secondary:#b9b9bd;--dsw-alias-label-tertiary:#929296;--dsw-alias-state-business-primary:#4285f4;--dsw-alias-border-l2:#424246;--dsw-alias-interactive-bg-hover:#3e3e43;--dsw-alias-state-error-primary:#fa5252;--dsw-font-xxs-12:12px/18px Arial;--dsw-elevation-soft:0 4px 14px #0005;background:#151515;color:#f5f5f5;font-family:Arial}body{margin:0}button{font:inherit;color:inherit;cursor:pointer}main{display:grid;grid-template-columns:1fr;gap:16px;padding:12px}section{min-width:0;border:1px solid #424246;border-radius:8px}header{display:flex;align-items:center;gap:12px;padding:10px;min-width:0}h1{font-size:14px;flex:1;min-width:0;margin:0}.native-tabs{display:flex;gap:30px;padding:8px 14px;border-bottom:1px solid #424246;font-size:13px}.native-tabs span:first-child{color:var(--dsw-alias-state-business-primary)}.body{height:120px;padding:16px;color:#929296}footer{display:flex;align-items:center;gap:20px;padding:12px;background:#202020;border-radius:0 0 8px 8px}footer>button,.fixture-controls button{border:1px solid #424246;border-radius:8px;padding:5px 8px;background:transparent;font-size:12px}.fixture-controls{display:flex;flex-wrap:wrap;gap:6px;padding:8px}section[data-pane=outside] .body{height:24px}
  </style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const a = page.locator('[data-pane="a"]'), b = page.locator('[data-pane="b"]');
  const pickerA = () => a.getByRole('button', { name: /^(选择工作流|工作流：)/ });
  const pickerB = () => b.getByRole('button', { name: /^(选择工作流|工作流：)/ });
  await expect(pickerA()).toBeEnabled();
  await pickerA().click();
  const listA = a.getByRole('listbox', { name: '项目工作流' });
  await expect(listA).toBeFocused();
  await expect(listA.getByRole('option').first()).toHaveText('无');
  await expect(listA.getByRole('option', { name: '缺少负责人', exact: true })).toHaveAttribute('aria-disabled', 'true');
  const menuBox = await listA.boundingBox(), triggerBox = await pickerA().boundingBox();
  assert.ok(menuBox.y + menuBox.height <= triggerBox.y, 'Picker opens above the native input control');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(pickerA()).toHaveText('工作流：软件工程'); await expect(pickerB()).toHaveText('工作流：软件工程');
  await expect(pickerA()).toBeFocused();
  await expect(listA).toHaveCount(0);
  await expect(page.locator('[data-pane="outside"]').getByRole('button', { name: '选择工作流' })).toHaveCount(0);
  await pickerA().click(); await page.keyboard.press('Tab');
  await expect(a.getByRole('button', { name: '项目工作区', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(listA).toBeFocused();
  const beforeManagement = await page.evaluate(() => window.calls.length);
  await a.getByRole('button', { name: '项目工作区', exact: true }).click();
  assert.equal(await page.evaluate(() => window.openWorkspace), 'project');
  assert.equal(await page.evaluate(() => window.calls.length), beforeManagement);
  await expect(listA).toHaveCount(0);

  await pickerB().click(); await b.getByRole('option', { name: '无', exact: true }).click();
  await expect(pickerB()).toHaveText('工作流'); await expect(pickerA()).toHaveText('工作流：软件工程');
  await expect(b.getByRole('navigation')).toHaveCount(0);
  const steps = a.getByRole('navigation', { name: '软件工程步骤' });
  await steps.getByRole('button', { name: /3\. 技术方案/ }).click();
  await expect(steps.getByRole('button', { name: /3\. 技术方案/ })).toHaveAttribute('aria-current', 'step');
  await expect(steps.getByRole('button', { name: /1\. 需求澄清/ })).toHaveClass(/is-pending/);
  await expect(steps.getByRole('button', { name: /2\. 交互设计/ })).toHaveClass(/is-pending/);
  const nativeBlue = await a.locator('.native-tabs span').first().evaluate(element => getComputedStyle(element).color);
  assert.equal(await steps.getByRole('button', { name: /3\. 技术方案/ }).evaluate(element => getComputedStyle(element).color), nativeBlue);
  await page.getByRole('button', { name: '标记需求验收', exact: true }).click();
  await expect(steps.getByRole('button', { name: /1\. 需求澄清/ })).toHaveClass(/is-completed/);
  assert.equal(await steps.getByRole('button', { name: /1\. 需求澄清/ }).evaluate(element => getComputedStyle(element).color), 'rgb(245, 245, 245)');

  await pickerA().click(); await page.keyboard.press('End');
  await expect(listA).toHaveAttribute('aria-activedescendant', /option-2$/);
  await page.keyboard.press('Escape'); await expect(listA).toHaveCount(0); await expect(pickerA()).toBeFocused();
  await pickerA().click(); await a.locator('.body').click(); await expect(listA).toHaveCount(0);

  await page.getByRole('button', { name: '下次冲突', exact: true }).click();
  const before = await page.evaluate(() => window.calls.length);
  await pickerA().click(); await a.getByRole('option', { name: '快速修复', exact: true }).click();
  await expect(a.getByRole('alert')).toContainText('配置已更新，请重试');
  assert.equal(await page.evaluate(() => window.calls.length), before + 1);
  await expect(pickerA()).toHaveText('工作流：软件工程');
  await page.keyboard.press('Escape');
  await pickerA().click(); await a.getByRole('option', { name: '快速修复', exact: true }).click();
  await expect(pickerA()).toHaveText('工作流：快速修复');
  await expect(a.getByRole('alert')).toHaveCount(0); await expect(pickerB()).toHaveText('工作流');

  await page.getByRole('button', { name: '下次延迟', exact: true }).click();
  await pickerA().click(); await a.getByRole('option', { name: '软件工程', exact: true }).click();
  await expect(pickerA()).toBeDisabled(); await expect(a.getByRole('navigation').getByRole('button').first()).toBeDisabled();
  await expect(pickerA()).toHaveText('工作流：软件工程'); await expect(pickerA()).toBeEnabled();

  await mkdir(directory, { recursive: true });
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No page overflow at ${width}px`);
    await pickerA().click();
    const bounds = await a.locator('.wf-conversation-workflow-menu').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, `Menu remains in the viewport at ${width}px`);
    await page.keyboard.press('Escape');
    await page.screenshot({ path: resolve(directory, `workflow-${width}.png`) });
  }
  await page.getByRole('button', { name: '卸载插件', exact: true }).click();
  assert.deepEqual(errors, []);
  const checks = ['工作流列表向上展开，首项无', '首选工作流在同项目会话中继承', '无为本对话独立覆盖', '非项目会话不显示入口', '插件自有菜单项目工作区入口可键盘访问且不触发任务', '点击步骤只变当前，不伪造前序完成', '当前步骤使用原生对话蓝、已验收白色', '上下键、Home/End、Enter、Escape、外点和焦点回归', 'CAS冲突保留原选择且不自动重试', '忙碌时阻止重复提交', '320/768/1440px菜单和步骤条不撑破页面', '插件controller可清理且无浏览器错误'];
  await writeFile(resolve(directory, 'report.json'), JSON.stringify({ passed: true, checks }, null, 2));
  process.stdout.write(`${JSON.stringify({ passed: true, checks })}\n`);
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); }
