import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

// Isolated interactive fixture: no service profile, account, model, or live data is read.
const team = { id: 'team', name: '软件开发团', description: '原始说明', version: 3, knowledgeEnabled: true, createdAt: '2026-10-24T00:00:00.000Z', updatedAt: '2026-10-24T00:00:00.000Z', members: [
  { memberId: 'product', templateId: 'template', name: '产品负责人' },
  { memberId: 'architect', templateId: 'template', name: '架构师', reportsTo: 'product' },
  { memberId: 'developer', templateId: 'template', name: '开发人员', reportsTo: 'architect' },
], workflows: [{ id: 'software', name: '软件工程', sourceTemplateId: 'source', sourceTemplateVersion: 2, maxAttempts: 7, steps: [
  { id: 'plan', name: '技术方案', memberId: 'architect', instruction: '做好方案', outputs: ['技术方案'], timeoutMs: 12345 },
  { id: 'build', name: '开发实现', memberId: 'developer', instruction: '完成实现', acceptanceCriteria: ['执行验证'], onRejectStepId: 'plan' },
] }] };
const artifactRoot = resolve(process.env.WORKFORCE_TEAM_REMOVAL_UI_ARTIFACTS ?? 'artifacts/team-member-removal-validation');
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `import React,{useState} from 'react'; import {createRoot} from 'react-dom/client'; import {TeamEditor} from './src/ui/TeamEditor.tsx'; import './src/ui/workforce.css';
window.saves=[]; window.escapes=0; document.addEventListener('keydown',event=>{if(event.key==='Escape')window.escapes++});
const initial=${JSON.stringify(team)};
function App(){const [team,setTeam]=useState(initial);return <div className="wf-root"><button onClick={()=>setTeam({...initial,id:'last-member',members:[initial.members[1]],workflows:[{...initial.workflows[0],steps:[initial.workflows[0].steps[0]]}]})}>只留最后一岗</button><TeamEditor key={team.id} team={team} templates={[{id:'template',name:'岗位模板',status:'ready'}]} busy={false} onDirty={()=>{}} onSelectMember={()=>{}} onAddEmployee={()=>{}} onDelete={async()=>{window.deleted=true}} onSave={async(name,description,members,version,workflows,knowledgeEnabled)=>{const saved={...team,name,description,members,workflows,knowledgeEnabled,version:version+1};window.saves.push(saved);setTeam(saved);return true}}/></div>};createRoot(document.getElementById('root')).render(<App/>);` }, bundle: true, platform: 'browser', format: 'iife', write: false, outfile: 'app.js', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
const server = createServer((request, response) => {
  const path = request.url === '/app.js' ? 'app.js' : request.url === '/app.css' ? 'app.css' : undefined;
  const output = path && bundle.outputFiles.find(file => file.path.endsWith(path));
  if (output) { response.writeHead(200, { 'Content-Type': path.endsWith('.css') ? 'text/css' : 'text/javascript' }); response.end(output.text); }
  else { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><html><head><link rel="stylesheet" href="/app.css"><style>html{--dsw-alias-bg-layer-2:#2c2c2c;--dsw-alias-bg-layer-3:#363636;--dsw-alias-label-primary:#f4f4f4;--dsw-alias-label-secondary:#b4b4b4;--dsw-alias-border-l2:#484848;--dsw-alias-border-l1:#3d3d3d;--dsw-alias-state-error-primary:#f43f5e;--dsw-font-family:Arial;--dsw-font-s-14:14px/1.5 Arial}body{margin:0}.wf-root{height:100vh}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const editor = page.locator('.wf-team-editor');
  const rows = editor.locator('.wf-team-member-row');
  const removal = editor.getByRole('button', { name: '移除岗位 架构师', exact: true });
  await expect(removal).toBeEnabled(); await removal.click();
  const dialog = page.getByRole('dialog', { name: '移除团队岗位', exact: true });
  await expect(dialog).toBeVisible(); await expect(dialog.getByLabel('步骤接手人')).toHaveValue('product');
  await expect(dialog.getByRole('list', { name: '需要交接的步骤' })).toContainText('软件工程 · 技术方案');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(rows).toHaveCount(3); assert.equal(await page.evaluate(() => window.saves.length), 0);
  await removal.click(); await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  assert.equal(await page.evaluate(() => window.escapes), 0, 'Escape closes only the native handover dialog');
  await expect(removal).toBeFocused();
  await removal.click(); await dialog.getByLabel('步骤接手人').selectOption('developer');
  await mkdir(artifactRoot, { recursive: true });
  await page.screenshot({ path: resolve(artifactRoot, 'handover-dialog.png') });
  await dialog.getByRole('button', { name: '确认移除', exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(rows).toHaveCount(2);
  await expect(rows.nth(1).getByLabel('上一级')).toHaveValue('product');
  assert.equal(await page.evaluate(() => window.saves.length), 0, 'Confirmation changes only the unsaved draft');
  await editor.getByRole('button', { name: '保存团队', exact: true }).click();
  await expect(editor.getByRole('button', { name: '保存团队', exact: true })).toBeDisabled();
  const saved = await page.evaluate(() => window.saves[0]);
  assert.equal(saved.members.length, 2); assert.equal(saved.workflows[0].steps[0].memberId, 'developer');
  assert.deepEqual(saved.workflows, team.workflows.map(workflow => ({ ...workflow, steps: workflow.steps.map(step => ({ ...step, memberId: step.memberId === 'architect' ? 'developer' : step.memberId })) })));
  await page.getByRole('button', { name: '只留最后一岗', exact: true }).click();
  await editor.getByRole('button', { name: '移除岗位 架构师', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('请先引入接手人，再移除此岗位。');
  await expect(dialog.getByRole('button', { name: '确认移除', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.evaluate(() => window.saves.length), 1, 'Last-role guard does not mutate or silently remove workflow steps');
  assert.deepEqual(errors, []);
  const result = { passed: true, checks: ['被工作流引用的岗位可点击移除', '明确显示需交接步骤和接手人', '取消与 Escape 保留草稿并恢复焦点', '确认仅改草稿', '保存原子交接并重接直属下属', '步骤ID及返回引用等隐藏配置保留', '最后一岗说明先引入接手人', '无模型或宿主调用', '无浏览器运行错误'] };
  await writeFile(resolve(artifactRoot, 'report.json'), JSON.stringify(result, null, 2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); }
