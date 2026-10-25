import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const artifacts = resolve(process.env.WORKFORCE_REVIEW_UI_ARTIFACTS ?? 'artifacts/workflow-header-validation/review-ui');
const root = process.cwd();
const archive = process.env.WORKFORCE_UI_ARCHIVE && resolve(process.env.WORKFORCE_UI_ARCHIVE);
const archiveDirectory = archive ? await mkdtemp(resolve(tmpdir(), 'workforce-review-ui-')) : undefined;
const sourceRoot = archiveDirectory ? resolve(archiveDirectory, 'package') : root;
let archiveMetadata;
if (archive) {
  try {
    await promisify(execFile)('tar', ['-xzf', archive, '-C', archiveDirectory]);
    const manifest = JSON.parse(await readFile(resolve(sourceRoot, 'package.json'), 'utf8'));
    assert.equal(manifest.name, 'dsh-plugin-composable-workforce');
    archiveMetadata = { path: archive, version: manifest.version, sha256: createHash('sha256').update(await readFile(archive)).digest('hex') };
  } catch (error) { await rm(archiveDirectory, { recursive: true, force: true }); throw error; }
}
const bundle = await build({ nodePaths: [resolve(root, 'node_modules')], stdin: { resolveDir: sourceRoot, loader: 'tsx', contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{WorkforceWorkspace}from'./src/ui/WorkforceWorkspace.tsx';import{ProjectExecutionReview}from'./src/ui/ProjectExecutionReview.tsx';import{createSeedState}from'./src/domain/seed.ts';import{writeUiDraft}from'./src/ui/drafts.ts';
writeUiDraft('workspace-navigation',{scope:'project',projectId:'project',projectView:'staffing',section:'horses'});
const seed=createSeedState('2026-10-25T00:00:00.000Z');const employee={...seed.templates[0],projectId:'project'};
window.calls=[];let snapshot=seed;
function fixture(kind){snapshot=structuredClone(seed);snapshot.projects=[{id:'project',name:'不应显示旧项目选择'}];snapshot.runs=[{id:'run',projectId:'project',employeeId:employee.id,employeeSnapshot:employee,request:'仅验收这次执行',output:'已提交所需交付',artifacts:[{id:'artifact',title:'测试报告',content:'关键用例已通过'}],version:4,status:'awaiting-review',createdAt:'2026-10-25T00:00:00.000Z',updatedAt:'2026-10-25T00:00:00.000Z'},{id:'private',projectId:'other',request:'其他项目不应显示'}];
if(kind==='task'||kind==='stale'){snapshot.runs[0].workTaskId='task';snapshot.workState={briefs:[],events:[],receipts:[],deliverables:[{id:'deliverable',projectId:'project',taskId:'task',title:'任务报告',revisions:[{version:1,content:'成果内容',inputVersions:[],reviews:[],createdAt:'2026-10-25T00:00:00Z'}]}],tasks:[{id:'task',projectId:'project',title:'旧任务',goal:'保留真实验收路径',acceptanceCriteria:['可重复验证'],attemptRunIds:kind==='stale'?['run','new-run']:['run'],status:'awaiting-review',version:7}]};}
if(kind==='flow'){snapshot.runs[0].workflow={workflowRunId:'flow',stepId:'step',attempt:1};snapshot.workflowRuns=[{id:'flow',projectId:'project',status:'paused',version:6,definition:{name:'历史流程',steps:[{id:'step',name:'提交报告',instruction:'报告'}]},steps:[{stepId:'step',status:'awaiting-review',attempts:[{runId:'run',number:1}]}]}];}}
const client={snapshot:async()=>structuredClone(snapshot),listModels:async()=>({models:[]}),reviewRun:async(...args)=>{window.calls.push(['run',...args]);snapshot.runs[0].status='succeeded';},workCommand:async(...args)=>{window.calls.push(['task',...args]);snapshot.runs[0].status='succeeded';snapshot.workState.tasks[0].status='accepted';},controlWorkflow:async(...args)=>{window.calls.push(['flow',...args]);snapshot.runs[0].status='succeeded';snapshot.workflowRuns[0].steps[0].status='accepted';snapshot.workflowRuns[0].status='succeeded';}};
function App(){const[view,setView]=useState('library');const[key,setKey]=useState(0);window.openReview=kind=>{fixture(kind);setKey(value=>value+1);setView('review')};return view==='library'?<WorkforceWorkspace client={client}/>:<ProjectExecutionReview key={key} client={client} projectId="project" initialRunId="run" onClose={()=>setView('library')} onOpenSession={id=>window.calls.push(['session',id])}/>;}createRoot(document.getElementById('root')).render(<App/>);
` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false, outfile: 'app.js', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' }).catch(async error => { if (archiveDirectory) await rm(archiveDirectory, { recursive: true, force: true }); throw error; });
const server = createServer((request, response) => {
  const suffix = request.url === '/app.js' ? 'app.js' : request.url === '/app.css' ? 'app.css' : undefined;
  const file = suffix && bundle.outputFiles.find(file => file.path.endsWith(suffix));
  if (file) { response.writeHead(200, { 'Content-Type': suffix.endsWith('.css') ? 'text/css' : 'text/javascript' }); response.end(file.text); return; }
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>html{--dsw-alias-bg-base:#151515;--dsw-alias-bg-layer-2:#292929;--dsw-alias-label-primary:#f5f5f5;--dsw-alias-label-secondary:#b9b9bd;--dsw-alias-label-tertiary:#929296;--dsw-alias-border-l2:#424246;--dsw-font-xxs-12:12px/18px Arial;--dsw-font-xs-13:13px/20px Arial;--dsw-font-base-strong-16:600 16px/24px Arial;--dsw-font-family:Arial;background:#151515;color:#f5f5f5;font-family:Arial}body{margin:0}#root{height:100vh}button{font:inherit;cursor:pointer}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const library = page.getByRole('navigation', { name: '资源库', exact: true });
  await expect(library.getByRole('button')).toHaveCount(3);
  await expect(library).toContainText('自由职业人库'); await expect(library).toContainText('团队'); await expect(library).toContainText('工作流');
  await expect(page.getByLabel('选择具体项目')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '引入通用模板', exact: true })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: '项目工作区', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '模型配置', exact: true })).toBeVisible();
  await mkdir(artifacts, { recursive: true }); await page.screenshot({ path: resolve(artifacts, 'library-only.png') });
  for (const family of ['run', 'task', 'flow']) {
    await page.evaluate(kind => window.openReview(kind), family);
    await expect(page.getByRole('heading', { name: '交付验收', exact: true })).toBeVisible();
    await expect(page.getByText('其他项目不应显示', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '验收通过', exact: true })).toBeEnabled();
    await page.getByLabel('验收意见', { exact: true }).fill('已核验交付');
    await page.getByRole('button', { name: '验收通过', exact: true }).click();
    await expect(page.getByRole('button', { name: '验收通过', exact: true })).toHaveCount(0);
    const call = await page.evaluate(() => window.calls.at(-1)); assert.equal(call[0], family);
    if (family === 'run') assert.equal(call[3].expectedVersion, 4);
    if (family === 'task') { assert.equal(call[1], 'work.reviewTask'); assert.equal(call[3].expectedVersion, 7); assert.equal(call[2].runId, 'run'); }
    if (family === 'flow') { assert.equal(call[1].action, 'review'); assert.equal(call[1].expectedVersion, 6); assert.equal(call[1].runId, 'run'); }
  }
  await page.evaluate(() => window.openReview('stale'));
  await expect(page.getByText('这是历史执行，当前版本已变化。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '验收通过', exact: true })).toHaveCount(0);
  await page.screenshot({ path: resolve(artifacts, 'historical-attempt.png') });
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(library).toBeVisible(); await expect(library.getByRole('button')).toHaveCount(3);
  assert.deepEqual(errors, []);
  const report = { passed: true, ...(archiveMetadata ? { pluginArchive: archiveMetadata } : {}), checks: ['忽略旧项目scope草稿，仅显示三类资源库', '项目选择/旧5tabs/引入模板入口不再存在', '精确执行交付页面不展示其他项目记录', '普通运行按run版本验收', '项目任务按task版本与当前attempt验收', '旧结构工作流暂停时仍可按workflow版本验收', '过期attempt只读，返回回到资源库', '无浏览器异常'] };
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); if (archiveDirectory) await rm(archiveDirectory, { recursive: true, force: true }); }
