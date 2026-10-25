/** Plugin-owned component checks. Controlled transport and Wiki handshake fixture; no host/profile is touched. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const directory = resolve(process.env.WORKFORCE_DETAILS_UI_ARTIFACTS || 'artifacts/project-preview-validation/component');
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: String.raw`
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{ConversationWorkflowDetails}from'./src/ui/ConversationWorkflowDetails.tsx';
import{WorkforceI18nProvider,translateUiText}from'./src/ui/i18n.tsx';
import'./src/ui/conversation-workflow.css';import'./src/ui/SharedWikiGraph.css';
window.calls=[];window.wikiMode='empty';window.wikiFailOnce=false;window.reviewConflict=false;
let revision=10,current='step-2',runVersion=2,reviewStatus='awaiting-review';const completions=new Set(['step-1']);
let snapshot={active:'zh',revision:0,locales:[{id:'zh',label:'中文',fallback:'en'},{id:'en',label:'English'}]};const listeners=new Set();
const runtime={subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},getSnapshot:()=>snapshot,bind:()=>((key,values)=>translateUiText(key,snapshot.active,values))};
window.setLocale=active=>{snapshot={...snapshot,active,revision:snapshot.revision+1};for(const listener of listeners)listener()};
const names=['需求确认与跨团队决策记录 <user content>','方案实现与阶段验收','尚未开始的下一阶段',...Array.from({length:7},(_,i)=>'后续步骤'+(i+4)+'：保留完整竖向工作流')];
const returns={'step-2':'step-1','step-5':'step-2','step-8':'step-3','step-10':'step-10'};
const steps=()=>names.map((name,i)=>{const id='step-'+(i+1);return{id,name,status:completions.has(id)?'completed':id===current?'current':'pending',employeeName:i===0?'产品负责人':'开发负责人',...(returns[id]?{onRejectStepId:returns[id]}:{})}});
const at='2026-10-25T01:02:03.000Z';const mediaType='application/vnd.composable-workforce.confirmed-items+json';
const declarations={schemaVersion:1,items:[{id:'scope-confirmed',title:'保持原始需求范围 <user item>',content:'声明正文：仅交付已确定的功能。\n<script>window.fixtureInjected=true</script>'}]};
const accepted={id:'accepted-run',version:4,title:'需求当前交付',status:'succeeded',employeeName:'产品负责人',legacy:false,stepId:'step-1',stepName:names[0],sessionId:'accepted-chat',createdAt:at,updatedAt:at,output:'需求交付正文 <script>window.fixtureInjected=true</script>',artifacts:[{id:'document',title:'需求与决策.md',path:'docs/需求与决策 <script>.md',mediaType:'text/markdown',content:'# 已验收需求\n原始交付快照',contentLength:20},{id:'binary',title:'流程图.png',path:'design/流程图.png',mediaType:'image/png'},{id:'item-declarations',title:'需求确定事项.confirmed-items.json',path:'docs/需求确定事项.confirmed-items.json',mediaType,content:JSON.stringify(declarations),contentLength:JSON.stringify(declarations).length},{id:'long-document',title:'完整阶段设计说明.md',path:'docs/design-full.md',mediaType:'text/markdown',content:Array.from({length:160},(_,index)=>'章节 '+index+'：完整阶段设计说明与可追溯验收依据。').join('\n')}],acceptance:{decision:'accepted',reviewer:'项目负责人',at,note:'确认需求范围及验收依据'},reviewable:false};
const oldStep1={...accepted,id:'old-step1-run',version:1,title:'需求历史版本交付',output:'旧需求回复，不是当前已验收版本',artifacts:[{id:'old-requirements',title:'旧版需求.md',content:'旧需求文档快照'}],acceptance:{decision:'accepted',reviewer:'历史评审人',at,note:'历史版本验收'}};
function pending(){return{id:'current-run',version:runVersion,title:'当前方案交付',status:reviewStatus,employeeName:'开发负责人',legacy:false,stepId:'step-2',stepName:names[1],sessionId:'current-chat',createdAt:at,updatedAt:at,output:'方案交付回复，仅作为阶段补充说明。',artifacts:[{id:'implementation',title:'实现说明.md',path:'docs/implementation.md',content:'真实实现说明快照'}],reviewable:reviewStatus==='awaiting-review'&&current==='step-2',...(reviewStatus==='succeeded'?{acceptance:{decision:'accepted',reviewer:'用户',note:'验收通过',at}}:{})}}
const oldCurrentAccepted={...pending(),id:'old-current-accepted',version:1,title:'旧方案交付',status:'succeeded',output:'旧实现验收回复',artifacts:[{id:'old-implementation',title:'旧版已验收实现.md',path:'docs/old-implementation.md',content:'旧版实现快照'}],reviewable:false,acceptance:{decision:'accepted',reviewer:'用户',note:'旧版验收',at}};
const oldCurrentItems=[{id:'old-current-item',title:'旧实现的事项声明',content:'只属于旧版已验收实现。',sourceArtifactId:'old-implementation',runId:oldCurrentAccepted.id,runVersion:oldCurrentAccepted.version,reviewer:'用户',acceptedAt:at}];
function itemsForAccepted(){return declarations.items.map(item=>({...item,sourceArtifactId:'item-declarations',runId:accepted.id,runVersion:accepted.version,reviewer:accepted.acceptance.reviewer,acceptedAt:at}))}
const failedLater=()=>({...accepted,id:'failed-later-run',version:1,title:'需求后续失败尝试',status:'failed',output:'失败尝试，不是已验收文件',artifacts:[],acceptance:undefined,error:'受控后续失败'});
const runs=()=>[...(window.latestFailure?[failedLater()]:[]),accepted,oldStep1,pending(),oldCurrentAccepted];
const summaries=()=>runs().map(({artifacts,output,acceptance,reviewable,error,...summary})=>summary);
window.bumpHistoricalVersion=()=>{oldStep1.version++;revision++};
window.resetPending=()=>{reviewStatus='awaiting-review';current='step-2';completions.delete('step-2');revision++;runVersion++};
window.acceptedDeclaration=declarations;window.acceptedVersion=()=>accepted.version;
function details(selection={}){const selectedRun=selection.runId?runs().find(run=>run.id===selection.runId):undefined;const stepId=selection.stepId||selectedRun?.stepId||current;const step=steps().find(step=>step.id===stepId);const history=summaries().filter(run=>run.stepId===stepId);const latest=selectedRun||(stepId==='step-1'?(window.latestFailure?failedLater():accepted):stepId==='step-2'?pending():undefined);const effective=stepId==='step-1'&&completions.has('step-1')?accepted:stepId==='step-2'?(reviewStatus==='succeeded'?pending():oldCurrentAccepted):undefined;return{projectId:'project-a',projectName:'交付平台项目 <user project>',sessionId:'chat-a',revision,instanceId:'flow-instance',instanceVersion:revision,name:'软件项目工作流 <different workflow>',currentStepId:current,projectWiki:{employeeId:'product-owner',teamId:'project-team'},steps:steps(),selectedStep:{...step,instruction:'按已确认的范围完成当前步骤，不改变其他项目内容。',outputs:['阶段性文件','可追溯的决策依据'],acceptanceCriteria:['成果可核验','明确未完成项'],onRejectStepId:returns[stepId]||stepId,onRejectStepName:names[Number((returns[stepId]||stepId).split('-')[1])-1],owner:{id:stepId==='step-1'?'product-owner':'developer',name:step.employeeName},roster:[{id:'product-owner',name:'产品负责人',status:'active'},{id:'developer',name:'开发负责人',status:'active',managerId:'product-owner'}],...(latest?{latestDelivery:latest}:{}),...(effective?{acceptedDelivery:effective}:{}),history,historyTotal:history.length,confirmedItems:stepId==='step-1'&&effective?itemsForAccepted():stepId==='step-2'&&effective?.id===oldCurrentAccepted.id?oldCurrentItems:[]},history:summaries(),historyTotal:summaries().length,tasks:stepId==='step-2'?[{id:'task-1',title:'实现并验证方案',status:'awaiting-review',employeeId:'developer',employeeName:'开发负责人',stepId}]:[],tasksTotal:stepId==='step-2'?1:0}}
const client={async load(sessionId,selection={},signal){window.calls.push({kind:'load',sessionId,selection:{...selection}});if(window.delayStep===selection.stepId){window.delayStep='';await new Promise(done=>setTimeout(done,300))}if(signal?.aborted)throw new DOMException('Aborted','AbortError');if(selection.runId&&window.failReadRunId===selection.runId){window.failReadRunId='';throw Error('交付版本已更新，请刷新记录后重新查看')}if(selection.runId){const run=runs().find(run=>run.id===selection.runId);if(!run||selection.stepId&&run.stepId!==selection.stepId)throw Error('交付不属于所选步骤');if(selection.runVersion!==undefined&&selection.runVersion!==run.version)throw Error('交付版本已更新，请刷新记录后重新查看')}return details(selection)},async review(input){window.calls.push({kind:'review',input:{...input}});if(window.reviewConflict){window.reviewConflict=false;revision++;runVersion++;throw Error('工作区已更新，请刷新后再验收')}if(input.expectedRevision!==revision||input.runVersion!==runVersion||input.instanceVersion!==revision)throw Error('工作区已更新，请刷新后再验收');reviewStatus=input.decision==='accepted'?'succeeded':'blocked';if(input.decision==='accepted'){completions.add('step-2');current='step-3'}else{completions.delete('step-1');completions.delete('step-2');current='step-1'}revision++;return details({stepId:'step-2'})},projectWikiClient:{async knowledgeLibrary(target){window.calls.push({kind:'wiki-read',target});if(window.wikiFailOnce){window.wikiFailOnce=false;throw Error('受控知识读取失败')}const mode=window.wikiMode;return{target,title:'当前项目团队的团队知识库',enabled:mode!=='disabled',compiler:{role:'team-librarian'},categories:[],sources:[],status:{state:mode==='disabled'?'disabled':mode==='ready'?'ready':'empty'},supportedExtensions:['.md'],maxFileBytes:100000,maxUploadBytes:100000,libraries:[{library:'team',teamId:'project-team',label:'当前项目团队'}],...(mode==='ready'?{snapshot:{version:3,sourceFingerprint:'fixture',createdAt:at,status:'candidate',entries:[],overview:[]}}:{})}},async knowledgeWiki(target){window.calls.push({kind:'wiki-graph-read',target});return{schemaVersion:1,engine:{name:'llm_wiki',version:'fixture',revision:'fixture'},spaceId:'project-a/team',version:3,status:{state:'ready'},pages:[],graph:{kind:'semantic',nodes:[],edges:[],communities:[]}}}}};
function App(){const[open,setOpen]=useState(false);return <WorkforceI18nProvider runtime={runtime}><button id="open-details" onClick={()=>setOpen(true)}>打开工作流详情</button>{open&&<ConversationWorkflowDetails client={client} sessionId="chat-a" onClose={()=>setOpen(false)} onChanged={async()=>{window.calls.push({kind:'changed'})}} onActivate={async stepId=>{window.calls.push({kind:'activate',stepId});current=stepId;revision++;return true}} onOpenSession={sessionId=>window.calls.push({kind:'open-session',sessionId})}/>}</WorkforceI18nProvider>};createRoot(document.getElementById('root')).render(<App/>);
` }, bundle: true, platform: 'browser', format: 'iife', write: false, outfile: 'app.js', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
const server = createServer((request, response) => {
  if (request.url === '/digital-workers/api/wiki') {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(`<!doctype html><html><body data-fixture-kind="wiki-handshake-only" style="margin:12px;background:#151515;color:#f5f5f5;font:13px Arial"><p id="wiki-ready">Wiki handshake fixture loading</p><script>addEventListener('message',event=>{const m=event.data;if(m?.namespace==='workforce-llm-wiki'&&(m.type==='init'||m.type==='update')){document.querySelector('#wiki-ready').textContent='Project Wiki version '+m.view.version;document.body.dataset.canRebuild=String(m.canRebuild)}});parent.postMessage({namespace:'workforce-llm-wiki',protocolVersion:1,type:'ready'},'*');</script></body></html>`); return;
  }
  const suffix = request.url === '/app.js' ? 'app.js' : request.url === '/app.css' ? 'app.css' : undefined;
  const file = suffix && bundle.outputFiles.find(file => file.path.endsWith(suffix));
  if (file) { response.writeHead(200, { 'Content-Type': suffix.endsWith('.css') ? 'text/css' : 'text/javascript' }); response.end(file.text); return; }
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>
  html{--dsw-alias-bg-base:#151515;--dsw-alias-bg-layer-2:#292929;--dsw-alias-label-primary:#f5f5f5;--dsw-alias-label-secondary:#b9b9bd;--dsw-alias-label-tertiary:#929296;--dsw-alias-state-business-primary:#4285f4;--dsw-alias-border-l2:#424246;--dsw-alias-interactive-bg-hover:#29292e;--dsw-alias-state-error-primary:#fa5252;--dsw-font-xxs-12:12px/18px Arial;--dsw-elevation-soft:0 4px 14px #0005;background:#151515;color:#f5f5f5;font-family:Arial;color-scheme:dark}body{margin:0;padding:24px}button{font:inherit;color:inherit;cursor:pointer}button#open-details{padding:8px 12px;background:#292929;border:1px solid #424246;border-radius:6px}*{box-sizing:border-box}html[data-light=true]{--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-2:#eee;--dsw-alias-label-primary:#191919;--dsw-alias-label-secondary:#555;--dsw-alias-label-tertiary:#777;--dsw-alias-border-l2:#ddd;--dsw-alias-interactive-bg-hover:#eee;background:#fff;color:#191919;color-scheme:light}
  </style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser, page;
const checks = [], errors = [], metrics = {};
const check = name => { checks.push(name); console.log('PASS ' + name); };
const sources = ['src/ui/ConversationWorkflowDetails.tsx', 'src/ui/conversation-workflow-details.css', 'src/ui/conversation-workflow.css', 'src/ui/ConversationWorkflowWiki.tsx', 'src/ui/conversation-workflow-wiki.css', 'src/ui/locales/workflow.ts'];
const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
try {
  // Omitting channel/executablePath deliberately uses Playwright's isolated bundled Chromium.
  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await mkdir(directory, { recursive: true });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const dialog = () => page.locator('dialog.wf-conversation-details');
  const nav = () => dialog().locator('.wf-conversation-details-flow');
  const step = id => nav().locator(`[data-step-id="${id}"]`);
  const section = name => dialog().getByRole('region', { name, exact: true });
  const instruction = () => dialog().locator('details.wf-conversation-details-instruction:not([data-requirement])');
  const instructionSummary = () => instruction().locator(':scope > summary');
  const instructionBody = () => instruction().locator('.wf-conversation-details-requirements dd');
  const persistentRequirements = () => section('步骤内容').locator(':scope > .wf-conversation-details-requirements');
  const history = () => dialog().locator('.wf-conversation-delivery-history');
  const artifact = id => dialog().locator(`.wf-conversation-artifacts > details[data-artifact-id="${id}"]`);
  const settled = async () => { await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))); };
  const select = async id => { const old = await page.evaluate(() => window.calls.filter(call => call.kind === 'load').length); await step(id).click(); await expect.poll(() => page.evaluate(() => window.calls.filter(call => call.kind === 'load').length)).toBeGreaterThan(old); await expect(step(id)).toHaveAttribute('aria-current', 'true'); await expect(dialog().locator('.wf-conversation-details-body')).toHaveAttribute('aria-busy', 'false'); await settled(); };
  const writes = () => page.evaluate(() => window.calls.filter(call => ['activate', 'review', 'changed'].includes(call.kind)));
  const lastLoad = () => page.evaluate(() => window.calls.filter(call => call.kind === 'load').at(-1));
  const nodeAppearance = () => nav().evaluate(nav => {
    const color = value => { const probe = document.createElement('span'); probe.style.color = value; probe.style.display = 'none'; nav.append(probe); const result = getComputedStyle(probe).color; probe.remove(); return result; };
    return { palette: { completed: 'rgb(255, 255, 255)', current: color('var(--dsw-alias-state-business-primary)'), pending: color('var(--dsw-alias-label-tertiary)') }, cornerShapeSupported: CSS.supports('corner-shape', 'round'),
      nodes: [...nav.querySelectorAll('button[data-step-id]')].map(button => {
        const dot = button.querySelector('[data-flow-node]'), number = dot.querySelector('.wf-conversation-workflow-step-number'), style = getComputedStyle(dot), digit = getComputedStyle(number), ring = getComputedStyle(dot, '::before'), box = dot.getBoundingClientRect(), text = number.getBoundingClientRect();
        return { id: button.dataset.stepId, status: button.parentElement.className.match(/is-(completed|current|pending)/)?.[1], inspected: button.getAttribute('aria-current') === 'true',
          number: number.textContent, dotText: dot.textContent, fill: style.backgroundColor, color: digit.color, width: box.width, height: box.height, borderRadius: style.borderRadius, cornerShape: style.getPropertyValue('corner-shape'),
          sharedDotClass: dot.classList.contains('wf-conversation-workflow-dot'), ownStatusClass: dot.className.match(/is-(completed|current|pending)/)?.[1], fontSize: digit.fontSize, fontWeight: digit.fontWeight, variantNumeric: digit.fontVariantNumeric,
          numberCenterError: { x: Math.abs(text.x + text.width / 2 - box.x - box.width / 2), y: Math.abs(text.y + text.height / 2 - box.y - box.height / 2) },
          ring: { content: ring.content, width: ring.width, borderWidth: ring.borderTopWidth, borderStyle: ring.borderTopStyle, borderRadius: ring.borderRadius, cornerShape: ring.getPropertyValue('corner-shape'), opacity: ring.opacity, pointerEvents: ring.pointerEvents } };
      }) };
  });
  const assertNodeStates = async () => {
    const appearance = await nodeAppearance();
    appearance.nodes.forEach((node, index) => {
      assert.equal(node.sharedDotClass, true); assert.equal(node.ownStatusClass, node.status);
      assert.equal(node.number, String(index + 1), 'all states retain their global step number'); assert.equal(node.dotText, String(index + 1), 'completed circles keep their number instead of replacing it with a checkmark');
      assert.equal(node.fill, appearance.palette[node.status], `${node.id} uses the same white/business-blue/tertiary-gray status token as the top strip`);
      assert.equal(node.color, 'rgb(0, 0, 0)'); assert.equal(node.fontSize, '12px'); assert.equal(node.fontWeight, '600'); assert.ok(node.variantNumeric.includes('tabular-nums'));
      assert.equal(node.width, 28); assert.equal(node.height, 28); assert.equal(node.borderRadius, '50%'); assert.ok(node.numberCenterError.x < 1 && node.numberCenterError.y < 1);
      assert.equal(node.ring.content, '""'); assert.equal(node.ring.borderWidth, '1px'); assert.equal(node.ring.borderStyle, 'solid'); assert.equal(node.ring.borderRadius, '50%');
      assert.ok(parseFloat(node.ring.width) > 0 && parseFloat(node.ring.width) < node.width); assert.equal(node.ring.opacity, '0.35'); assert.equal(node.ring.pointerEvents, 'none');
      if (appearance.cornerShapeSupported) { assert.equal(node.cornerShape, 'round'); assert.equal(node.ring.cornerShape, 'round'); }
    });
    return appearance;
  };
  const inspectRun = async id => { await history().locator(`[data-run-id="${id}"]`).click(); await expect(dialog().locator('.wf-conversation-delivery')).toHaveAttribute('data-delivery-id', id); await expect(dialog().locator('.wf-conversation-details-body')).toHaveAttribute('aria-busy', 'false'); };
  const workflowTab = () => dialog().getByRole('tab', { name: '工作流', exact: true });
  const wikiTab = () => dialog().getByRole('tab', { name: '项目知识库', exact: true });
  const returnGeometry = () => nav().evaluate(node => {
    const canvas = node.querySelector('.wf-conversation-details-flow-canvas'), svg = node.querySelector('svg.wf-conversation-details-return-lines');
    const rect = canvas.getBoundingClientRect(); const copies = [...node.querySelectorAll('.wf-conversation-details-step-copy')].map(copy => copy.getBoundingClientRect().left - rect.left);
    return [...node.querySelectorAll('path[data-reject-from]')].map(path => { const total = path.getTotalLength(), points = Array.from({ length: 97 }, (_, index) => { const point = path.getPointAtLength(total * index / 96); return { x: point.x, y: point.y }; }); const source = [...canvas.querySelectorAll('[data-flow-node]')].find(node => node.dataset.flowNode === path.dataset.rejectFrom).getBoundingClientRect(), target = [...canvas.querySelectorAll('[data-flow-node]')].find(node => node.dataset.flowNode === path.dataset.rejectTo).getBoundingClientRect(), self = path.dataset.rejectFrom === path.dataset.rejectTo; return { from: path.dataset.rejectFrom, to: path.dataset.rejectTo, d: path.getAttribute('d'), start: points[0], end: points.at(-1), expectedStart: { x: source.left - rect.left - 2, y: source.top - rect.top + source.height / 2 + (self ? 8 : 0) }, expectedEnd: { x: target.left - rect.left - 2, y: target.top - rect.top + target.height / 2 - (self ? 8 : 0) }, minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)), minY: Math.min(...points.map(p => p.y)), maxY: Math.max(...points.map(p => p.y)), svgWidth: svg.getBoundingClientRect().width, svgHeight: Number(svg.getAttribute('height')), copyLeft: Math.min(...copies) }; });
  });
  const assertReturns = values => {
    assert.deepEqual(values.map(({ from, to }) => [from, to]), [['step-2', 'step-1'], ['step-5', 'step-2'], ['step-8', 'step-3'], ['step-10', 'step-10']]);
    for (const route of values) { assert.ok(route.minX >= 0 && route.maxX < route.svgWidth, 'complete return path remains inside its canvas'); assert.ok(route.minY >= 0 && route.maxY <= route.svgHeight, 'no return path is clipped vertically'); assert.ok(route.maxX < route.copyLeft - 1, 'return paths never cross step text'); for (const end of ['start', 'end']) for (const axis of ['x', 'y']) assert.ok(Math.abs(route[end][axis] - route[end === 'start' ? 'expectedStart' : 'expectedEnd'][axis]) <= 0.6, 'return path endpoints stay aligned with their real source and target circles'); }
  };
  await page.locator('#open-details').click();
  await expect(nav().getByRole('button')).toHaveCount(10);
  await expect(step('step-2')).toHaveAttribute('aria-current', 'true');
  await expect(dialog().locator(':scope > header h2')).toHaveText('交付平台项目 <user project>');
  await expect(nav()).toContainText('软件项目工作流 <different workflow>');
  assert.equal(await dialog().locator(':scope > header button').count(), 1);
  await expect(dialog().locator(':scope > header').getByRole('button', { name: '关闭详情', exact: true })).toBeVisible();
  await expect(dialog().getByRole('button', { name: '刷新详情', exact: true })).toHaveCount(0);
  await expect(dialog().getByRole('button', { name: '项目 Wiki', exact: true })).toHaveCount(0);
  assert.deepEqual(await dialog().locator('.wf-conversation-details-content > section').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))), ['步骤内容', '交付记录', '交付成果']);
  await expect(section('步骤内容')).toContainText('步骤说明'); await expect(section('步骤内容')).toContainText('验收标准'); await expect(section('步骤内容')).toContainText('退回目标');
  assert.equal((await dialog().boundingBox()).width, 1120);
  assert.equal(await dialog().locator('.wf-conversation-details-body').evaluate(node => getComputedStyle(node).padding), '0px');
  const navBox = await nav().boundingBox(), contentBox = await dialog().locator('.wf-conversation-details-content').boundingBox();
  assert.ok(navBox.x + navBox.width <= contentBox.x + 1);
  check('project-name-header-close-only-tabs-and-three-ordered-sections-retain-separate-workflow-columns');
  const initialStates = await assertNodeStates();
  assert.deepEqual(initialStates.nodes.slice(0, 3).map(node => node.status), ['completed', 'current', 'pending']);
  metrics.nodeStates = { initial: initialStates };
  await expect(instruction()).toHaveJSProperty('open', false); await expect(instructionBody()).toBeHidden();
  await expect(instructionSummary().getByRole('heading', { name: '步骤内容', exact: true })).toBeVisible();
  await expect(persistentRequirements().locator('dt')).toHaveText(['退回目标']);
  for (const kind of ['outputs','acceptance']) { const fold = dialog().locator('details[data-requirement=' + kind + ']'); await expect(fold).toHaveJSProperty('open', false); await expect(fold.locator('ul')).toBeHidden(); await fold.locator('summary').click(); await expect(fold.locator('ul')).toBeVisible(); await fold.locator('summary').press('Enter'); await expect(fold.locator('ul')).toBeHidden(); }
  check('deliverables-and-acceptance-default-closed-expand-independently-without-writes');
  for (const item of await persistentRequirements().locator('dd').all()) await expect(item).toBeVisible();
  await expect(history()).toBeVisible(); await expect(dialog().locator('.wf-conversation-artifacts')).toBeVisible();
  metrics.instructionOrder = await section('步骤内容').evaluate(section => {
    const identity = section.querySelector('.wf-conversation-details-step-heading'), fold = section.querySelector('details.wf-conversation-details-instruction'), summary = fold.querySelector('summary'), requirements = section.querySelector(':scope > .wf-conversation-details-requirements');
    const rect = node => { const r = node.getBoundingClientRect(); return { y: r.y, bottom: r.bottom }; };
    return { identityBeforeFold: !!(identity.compareDocumentPosition(fold) & Node.DOCUMENT_POSITION_FOLLOWING), foldBeforeRequirements: !!(fold.compareDocumentPosition(requirements) & Node.DOCUMENT_POSITION_FOLLOWING), identity: rect(identity), summary: rect(summary), requirements: rect(requirements) };
  });
  assert.equal(metrics.instructionOrder.identityBeforeFold, true); assert.equal(metrics.instructionOrder.foldBeforeRequirements, true);
  assert.ok(metrics.instructionOrder.identity.bottom <= metrics.instructionOrder.summary.y + 1 && metrics.instructionOrder.summary.bottom <= metrics.instructionOrder.requirements.y + 1, 'step name and owner precede the compact instruction summary, followed by always-visible requirements');
  const beforeFoldCalls = await page.evaluate(() => structuredClone(window.calls));
  await instructionSummary().click(); await expect(instruction()).toHaveJSProperty('open', true); await expect(instructionBody()).toBeVisible();
  await expect(instructionBody()).toHaveText('按已确认的范围完成当前步骤，不改变其他项目内容。');
  await instructionSummary().click(); await expect(instruction()).toHaveJSProperty('open', false); await expect(instructionBody()).toBeHidden();
  await instructionSummary().focus(); await instructionSummary().press('Enter'); await expect(instructionBody()).toBeVisible();
  await instructionSummary().press('Space'); await expect(instruction()).toHaveJSProperty('open', false); await expect(instructionBody()).toBeHidden();
  for (const item of await persistentRequirements().locator('dd').all()) await expect(item).toBeVisible();
  await expect(history()).toBeVisible(); await expect(dialog().locator('.wf-conversation-artifacts')).toBeVisible();
  assert.deepEqual(await page.evaluate(() => window.calls), beforeFoldCalls, 'mouse and keyboard folding never call transport, review, activation or models');
  await instructionSummary().click(); await select('step-1'); await expect(section('步骤内容').getByText('退回目标', {exact:true})).toHaveCount(0); await expect(instruction()).toHaveJSProperty('open', false); await expect(instructionBody()).toBeHidden();
  metrics.nodeStates.inspectedCompleted = await assertNodeStates();
  assert.equal(metrics.nodeStates.inspectedCompleted.nodes[0].inspected, true); assert.equal(metrics.nodeStates.inspectedCompleted.nodes[1].inspected, false);
  const runtimeStyles = appearance => appearance.nodes.map(({ id, status, number, fill }) => ({ id, status, number, fill }));
  assert.deepEqual(runtimeStyles(metrics.nodeStates.inspectedCompleted), runtimeStyles(initialStates), 'viewing a completed step cannot change which circle is actually blue/current');
  await instructionSummary().click(); await select('step-2'); await expect(instruction()).toHaveJSProperty('open', false); await expect(instructionBody()).toBeHidden(); assert.deepEqual(await writes(), []);
  await step('step-3').focus(); await step('step-3').press('Enter'); await expect(step('step-3')).toHaveAttribute('aria-current', 'true'); await expect(dialog().locator('.wf-conversation-details-body')).toHaveAttribute('aria-busy', 'false'); await settled();
  metrics.nodeStates.inspectedPending = await assertNodeStates(); assert.equal(metrics.nodeStates.inspectedPending.nodes[2].inspected, true);
  assert.deepEqual(runtimeStyles(metrics.nodeStates.inspectedPending), runtimeStyles(initialStates), 'keyboard inspection of a pending step preserves the real completed/current/pending colors');
  await select('step-2'); assert.deepEqual(await writes(), []);
  await page.screenshot({ path: resolve(directory, 'step-instruction-default-closed.png') });
  check('instruction-summary-follows-step-identity-defaults-closed-only-hides-instructions-and-supports-mouse-keyboard-without-transport');
  check('left-workflow-circles-share-top-status-tokens-double-rings-and-global-numbers-with-inspection-separate-from-current-state');
  await settled(); await expect(nav()).toHaveAttribute('data-return-count', '4'); metrics.returns = await returnGeometry(); assertReturns(metrics.returns);
  await expect(nav().locator('[data-step-id="step-1"]')).not.toHaveAttribute('aria-label', /验收不合格退回/);
  await expect(step('step-10')).toHaveAttribute('aria-label', /验收不合格退回第10步/);
  check('all-explicit-long-and-self-return-paths-render-completely-in-the-left-gutter-without-invented-loops');

  await expect(dialog().locator('.wf-conversation-delivery-meta')).toContainText('待验收');
  await expect(dialog().getByRole('button', { name: '验收通过', exact: true })).toBeEnabled();
  await expect(history().getByRole('button')).toHaveCount(2);
  await expect(history()).not.toContainText('需求当前交付');
  await expect(dialog().locator('.wf-conversation-confirmed-items > details')).toHaveCount(0);
  await expect(dialog()).not.toContainText('旧实现的事项声明');
  await instructionSummary().click(); await inspectRun('old-current-accepted'); await expect(instruction()).toHaveJSProperty('open', true);
  await expect(dialog()).toContainText('旧版已验收实现.md'); await expect(dialog()).toContainText('旧实现的事项声明');
  assert.deepEqual((await lastLoad()).selection, { stepId: 'step-2', runId: 'old-current-accepted', runVersion: 1 });
  await select('step-2'); await expect(dialog()).not.toContainText('旧版已验收实现.md'); await expect(dialog()).not.toContainText('旧实现的事项声明');
  await expect(instruction()).toHaveJSProperty('open', true); await instructionSummary().click();
  assert.deepEqual(await writes(), []);
  check('selected-step-history-excludes-other-steps-and-pending-delivery-never-mixes-older-accepted-documents-or-items');

  await select('step-1');
  await expect(dialog().locator('.wf-conversation-artifacts > details')).toHaveCount(4);
  await expect(history().getByRole('button')).toHaveCount(2); await expect(history()).not.toContainText('方案交付');
  await artifact('document').locator('summary').click(); await expect(artifact('document').locator('pre')).toHaveText('# 已验收需求\n原始交付快照');
  await artifact('binary').locator('summary').click(); await expect(artifact('binary')).toContainText('此文件暂无文本预览，请到原对话查看。');
  await artifact('item-declarations').locator('summary').click();
  assert.deepEqual(JSON.parse(await artifact('item-declarations').locator('pre').innerText()), await page.evaluate(() => window.acceptedDeclaration));
  const confirmed = dialog().locator('.wf-conversation-confirmed-items > details');
  await expect(confirmed).toHaveCount(1); await expect(confirmed).toHaveAttribute('data-source-artifact-id', 'item-declarations');
  await confirmed.locator('summary').click(); await expect(confirmed.locator('pre')).toHaveText('声明正文：仅交付已确定的功能。\n<script>window.fixtureInjected=true</script>');
  await expect(section('交付成果')).toContainText('来自已验收交付的事项声明');
  await expect(dialog().locator('.wf-conversation-acceptance')).toContainText('确认需求范围及验收依据');
  await dialog().locator('.wf-conversation-delivery-response > summary').click();
  await expect(dialog().locator('.wf-conversation-delivery-response > pre')).toContainText('<script>window.fixtureInjected=true</script>');
  assert.equal(await dialog().locator('script').count(), 0); assert.equal(await page.evaluate(() => window.fixtureInjected), undefined);
  await confirmed.getByRole('button', { name: '查看对应交付', exact: true }).click();
  await expect(dialog().locator('.wf-conversation-delivery')).toHaveAttribute('data-delivery-id', 'accepted-run');
  assert.deepEqual((await lastLoad()).selection, { stepId: 'step-1', runId: 'accepted-run', runVersion: 4 });
  assert.deepEqual(await writes(), []);
  check('documents-vendor-json-confirmed-item-body-and-provenance-open-as-read-only-text-without-html-execution');

  await page.evaluate(() => { window.latestFailure = true; }); await select('step-1');
  await expect(dialog().locator('.wf-conversation-delivery')).toHaveAttribute('data-delivery-id', 'accepted-run');
  await expect(dialog().locator('.wf-conversation-artifacts > details')).toHaveCount(4); await expect(confirmed).toHaveCount(1);
  await expect(dialog().locator('.wf-conversation-delivery-response')).not.toContainText('失败尝试');
  await inspectRun('old-step1-run'); await expect(artifact('old-requirements')).toBeVisible(); await expect(confirmed).toHaveCount(0);
  await expect(section('交付成果')).not.toContainText('保持原始需求范围'); await expect(history()).not.toContainText('方案交付');
  check('completed-step-prefers-effective-accepted-evidence-over-later-failure-and-history-keeps-items-bound-to-exact-delivery');

  await select('step-1'); await page.evaluate(() => window.bumpHistoricalVersion());
  const beforeConflictReads = await page.evaluate(() => window.calls.filter(call => call.kind === 'load').length);
  await history().locator('[data-run-id="old-step1-run"]').click();
  await expect(dialog().getByRole('alert')).toContainText('交付版本已更新'); await expect(dialog().locator('.wf-conversation-delivery')).toHaveAttribute('data-delivery-id', 'accepted-run');
  await page.waitForTimeout(120);
  assert.equal(await page.evaluate(() => window.calls.filter(call => call.kind === 'load').length), beforeConflictReads + 1, 'stale history must never silently replay against a newer version');
  assert.deepEqual((await lastLoad()).selection, { stepId: 'step-1', runId: 'old-step1-run', runVersion: 1 });
  await dialog().getByRole('alert').getByRole('button', { name: '重试', exact: true }).click();
  await expect(dialog().getByRole('alert')).toHaveCount(0); assert.deepEqual((await lastLoad()).selection, { stepId: 'step-1' });
  await inspectRun('old-step1-run'); assert.deepEqual((await lastLoad()).selection, { stepId: 'step-1', runId: 'old-step1-run', runVersion: 2 });
  await expect(confirmed).toHaveCount(0); assert.deepEqual(await writes(), []);
  await select('step-2');
  const retainedDraft = '读取冲突后保留的未提交说明'; await dialog().getByLabel('验收说明', { exact: true }).fill(retainedDraft);
  await page.evaluate(() => { window.failReadRunId = 'old-current-accepted'; });
  const beforeFailedDraftRead = await page.evaluate(() => window.calls.filter(call => call.kind === 'load').length);
  await history().locator('[data-run-id="old-current-accepted"]').click(); await expect(dialog().getByRole('alert')).toContainText('交付版本已更新');
  await expect(dialog().locator('.wf-conversation-delivery')).toHaveAttribute('data-delivery-id', 'current-run'); await expect(artifact('implementation')).toBeVisible(); await expect(confirmed).toHaveCount(0);
  await expect(dialog().getByLabel('验收说明', { exact: true })).toHaveValue(retainedDraft); await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.calls.filter(call => call.kind === 'load').length), beforeFailedDraftRead + 1);
  await dialog().getByRole('alert').getByRole('button', { name: '重试', exact: true }).click(); await expect(dialog().getByRole('alert')).toHaveCount(0); await expect(dialog().getByLabel('验收说明', { exact: true })).toHaveValue(retainedDraft); assert.deepEqual(await writes(), []);
  check('history-version-conflict-retains-original-delivery-files-items-and-unsent-note-without-replay-until-explicit-retry');

  await page.evaluate(() => { window.delayStep = 'step-3'; }); await step('step-3').click(); await step('step-2').click();
  await expect(step('step-2')).toHaveAttribute('aria-current', 'true'); await page.waitForTimeout(350); await expect(step('step-2')).toHaveAttribute('aria-current', 'true');
  await select('step-3'); await expect(section('交付记录')).toContainText('此步骤尚无交付记录'); await expect(history()).toHaveCount(0); assert.deepEqual(await writes(), []);
  await dialog().getByRole('button', { name: '设为当前', exact: true }).click(); await expect.poll(async () => (await writes()).filter(call => call.kind === 'activate').length).toBe(1); await expect(step('step-3')).toContainText('当前步骤');
  await select('step-2'); await dialog().getByRole('button', { name: '设为当前', exact: true }).click(); await expect(step('step-2')).toContainText('当前步骤');
  await section('步骤内容').getByText('已规划任务 · 1', { exact: true }).click(); await expect(section('步骤内容')).toContainText('实现并验证方案');
  check('quick-inspection-cancels-stale-loads-and-only-explicit-activation-switches-the-owner-with-tasks-still-traceable');

  const note = '保留的验收说明 / unsent review note'; await dialog().getByLabel('验收说明', { exact: true }).fill(note);
  const beforeWiki = await writes(); await workflowTab().focus(); await page.keyboard.press('ArrowRight'); await expect(wikiTab()).toHaveAttribute('aria-selected', 'true'); await expect(wikiTab()).toBeFocused(); await expect(dialog()).toContainText('暂无项目知识'); assert.deepEqual(await writes(), beforeWiki);
  await page.keyboard.press('ArrowLeft'); await expect(workflowTab()).toHaveAttribute('aria-selected', 'true'); await expect(workflowTab()).toBeFocused(); await expect(step('step-2')).toHaveAttribute('aria-current', 'true'); await expect(dialog().getByLabel('验收说明', { exact: true })).toHaveValue(note);
  await page.evaluate(() => window.setLocale('en')); await expect(dialog().getByRole('tab', { name: 'Workflow', exact: true })).toBeFocused(); await expect(dialog().getByLabel('Review note', { exact: true })).toHaveValue(note); await expect(dialog().locator('h2')).toHaveText('交付平台项目 <user project>');
  await expect(instruction()).toHaveJSProperty('open', false); await instructionSummary().click(); await expect(instructionBody()).toBeVisible();
  await expect(instructionSummary().getByRole('heading', { name: 'Step content', exact: true })).toBeVisible();
  await page.evaluate(() => window.setLocale('zh'));
  await expect(instruction()).toHaveJSProperty('open', true); await expect(instructionBody()).toBeVisible(); await expect(dialog().getByLabel('验收说明', { exact: true })).toHaveValue(note);
  assert.deepEqual(await writes(), beforeWiki, 'locale changes and instruction folding leave the same selection and unsent note without business writes');
  check('keyboard-workflow-knowledge-tabs-and-live-language-switch-preserve-step-note-and-focus-without-business-writes');

  await page.evaluate(() => { window.wikiMode = 'disabled'; }); await wikiTab().click(); await expect(dialog()).toContainText('团队资料员已停用'); await expect(dialog().locator('iframe')).toHaveCount(0); await workflowTab().click();
  await page.evaluate(() => { window.wikiMode = 'ready'; window.wikiFailOnce = true; }); await wikiTab().click(); await expect(dialog().getByRole('alert')).toContainText('受控知识读取失败'); await dialog().getByRole('button', { name: '重试', exact: true }).click();
  await expect(dialog().locator('.wf-conversation-wiki-status')).toHaveCount(0); await expect(page.frameLocator('iframe').locator('#wiki-ready')).toHaveText('Project Wiki version 3'); await expect(page.frameLocator('iframe').locator('body')).toHaveAttribute('data-fixture-kind', 'wiki-handshake-only'); await expect(page.frameLocator('iframe').locator('body')).toHaveAttribute('data-can-rebuild', 'false');
  const targets = await page.evaluate(() => window.calls.filter(call => call.kind.startsWith('wiki-')).map(call => call.target)); assert.ok(targets.length >= 4); for (const target of targets) assert.deepEqual(target, { scope: 'project', library: 'team', projectId: 'project-a', employeeId: 'product-owner', teamId: 'project-team' }); assert.deepEqual(await writes(), beforeWiki);
  await page.screenshot({ path: resolve(directory, 'wiki-handshake-fixture.png') }); await workflowTab().click(); await expect(dialog().getByLabel('验收说明', { exact: true })).toHaveValue(note);
  await expect(step('step-2')).toHaveAttribute('aria-current', 'true'); await expect(instruction()).toHaveJSProperty('open', false); await expect(instructionBody()).toBeHidden();
  check('project-knowledge-disabled-error-retry-and-read-only-handshake-stub-use-the-exact-frozen-project-team');

  await dialog().getByLabel('验收说明', { exact: true }).fill(''); await dialog().getByRole('button', { name: '退回', exact: true }).click(); await expect(dialog().getByRole('alert')).toContainText('请填写退回原因'); assert.equal((await writes()).filter(call => call.kind === 'review').length, 0);
  await dialog().getByLabel('验收说明', { exact: true }).fill(note); await page.evaluate(() => { window.reviewConflict = true; }); await dialog().getByRole('button', { name: '验收通过', exact: true }).click(); await expect(dialog().getByRole('alert')).toContainText('工作区已更新'); await expect(dialog().getByLabel('验收说明', { exact: true })).toHaveValue(note); await page.waitForTimeout(150); assert.equal((await writes()).filter(call => call.kind === 'review').length, 1);
  await dialog().getByRole('button', { name: '验收通过', exact: true }).click(); await expect(step('step-3')).toContainText('当前步骤'); await select('step-2'); await expect(dialog().locator('.wf-conversation-delivery-meta')).toContainText('已验收');
  const reviews = (await writes()).filter(call => call.kind === 'review'); assert.equal(reviews.length, 2); assert.ok(reviews[1].input.expectedRevision > reviews[0].input.expectedRevision); assert.ok(reviews[1].input.runVersion > reviews[0].input.runVersion); assert.ok(reviews[1].input.instanceVersion > reviews[0].input.instanceVersion); assert.equal(reviews[1].input.note, note);
  check('return-requires-reason-and-review-CAS-conflict-preserves-note-without-replay-before-explicit-fresh-review');
  await page.evaluate(() => window.resetPending()); await select('step-2'); await dialog().getByLabel('验收说明', { exact: true }).fill('补全阶段验证依据'); await dialog().getByRole('button', { name: '退回', exact: true }).click(); await expect(step('step-1')).toContainText('当前步骤'); await select('step-2'); await expect(dialog().locator('.wf-conversation-delivery-meta')).toContainText('已退回');
  const rejection = (await writes()).filter(call => call.kind === 'review').at(-1).input; assert.equal(rejection.decision, 'rejected'); assert.equal(rejection.note, '补全阶段验证依据'); await expect(confirmed).toHaveCount(0);
  check('explicit-return-sends-the-note-updates-current-step-and-never-retains-unmatched-accepted-items');

  await page.evaluate(() => { window.latestFailure = false; }); await select('step-1');
  await artifact('long-document').locator('summary').click(); await expect(artifact('long-document').locator('pre')).toContainText('章节 159：完整阶段设计说明与可追溯验收依据。');
  const assertScrollExtent = async (localeForFooter) => {
    await settled();
    const values = await nav().evaluate(node => { const canvas = node.querySelector('.wf-conversation-details-flow-canvas'), svg = canvas.querySelector('svg'), bounds = canvas.getBoundingClientRect(), container = node.getBoundingClientRect(); return { canvasHeight: bounds.height, canvasScrollHeight: canvas.scrollHeight, svgHeight: Number(svg.getAttribute('height')), navScrollHeight: node.scrollHeight, navClientHeight: node.clientHeight, expectedContentEnd: bounds.top - container.top + node.scrollTop + bounds.height + parseFloat(getComputedStyle(node).paddingBottom) }; });
    assert.ok(values.canvasScrollHeight <= Math.ceil(values.canvasHeight) + 1, 'absolute SVG never inflates its own layout scroll height');
    assert.ok(values.navScrollHeight <= Math.ceil(Math.max(values.navClientHeight, values.expectedContentEnd)) + 2, 'shrinking labels does not leave a stale SVG blank scroll tail');
    await dialog().locator('.wf-conversation-details-body').evaluate(node => { node.scrollTop = 0; }); await nav().evaluate(node => { node.scrollTop = node.scrollHeight; });
    metrics.lastScrollProbe = { ...values, ...await nav().evaluate(node => { const rect = node.getBoundingClientRect(), last = node.querySelector('[data-step-id="step-10"]').getBoundingClientRect(), body = node.closest('.wf-conversation-details-body'), layout = node.closest('.wf-conversation-details-layout'); return { width: innerWidth, navHeight: rect.height, navScrollTop: node.scrollTop, navClientHeight: node.clientHeight, navScrollHeight: node.scrollHeight, bodyHeight: body.clientHeight, bodyScrollHeight: body.scrollHeight, layoutHeight: layout.getBoundingClientRect().height, layoutScrollHeight: layout.scrollHeight, lastTop: last.top, lastBottom: last.bottom }; }) };
    await expect(step('step-10')).toBeInViewport(); await nav().evaluate(node => { node.scrollTop = 0; });
    const content = dialog().locator('.wf-conversation-details-content');
    if (await page.evaluate(() => innerWidth) > 520) {
      assert.ok(await content.evaluate(node => node.scrollHeight > node.clientHeight), 'opened long document remains inside independently scrollable right content');
      await content.evaluate(node => { node.scrollTop = node.scrollHeight; });
    } else await section(localeForFooter === 'en' ? 'Deliverables' : '交付成果').getByText(localeForFooter === 'en' ? 'No accepted item declarations yet' : '暂无已验收的事项声明', { exact: true }).scrollIntoViewIfNeeded();
    await expect(dialog().getByText(localeForFooter === 'en' ? 'No accepted item declarations yet' : '暂无已验收的事项声明', { exact: true })).toBeInViewport();
    const longPreview = artifact('long-document').locator('pre'); await longPreview.scrollIntoViewIfNeeded(); await longPreview.evaluate(node => { node.scrollTop = node.scrollHeight; });
    assert.ok(await longPreview.evaluate(node => node.scrollHeight > node.clientHeight && node.scrollTop + node.clientHeight >= node.scrollHeight - 1), 'long document final paragraph is reachable inside its preview');
    await content.evaluate(node => { node.scrollTop = 0; }); await dialog().locator('.wf-conversation-details-body').evaluate(node => { node.scrollTop = 0; });
    return values;
  };
  const geometry = [];
  for (const locale of ['zh', 'en']) for (const light of [false, true]) for (const width of [320, 768, 1024, 1440]) {
    await page.evaluate(({ locale, light }) => { window.setLocale(locale); document.documentElement.dataset.light = String(light); }, { locale, light }); await page.setViewportSize({ width, height: 1000 }); await settled();
    const values = await dialog().evaluate(node => { const rect = node.getBoundingClientRect(); return { x: rect.x, right: rect.right, width: rect.width, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, documentWidth: document.documentElement.scrollWidth, viewport: innerWidth }; });
    assert.ok(values.x >= -1 && values.right <= width + 1, `${locale}/${light}/${width}: dialog stays in viewport`); assert.ok(values.scrollWidth <= values.clientWidth + 1, `${locale}/${light}/${width}: no dialog overflow`); assert.ok(values.documentWidth <= width, `${locale}/${light}/${width}: no page overflow`);
    await expect(nav().getByRole('button')).toHaveCount(10); await expect(dialog()).toContainText('需求确认与跨团队决策记录 <user content>'); await expect(dialog().locator('h2')).toHaveText('交付平台项目 <user project>'); assertReturns(await returnGeometry());
    const scrollExtent = await assertScrollExtent(locale);
    geometry.push({ locale, theme: light ? 'light' : 'dark', viewportWidth: width, ...values, scrollExtent, nodeStates: await assertNodeStates() }); await page.screenshot({ path: resolve(directory, `details-${locale}-${light ? 'light' : 'dark'}-${width}.png`) });
  }
  metrics.geometry = geometry;
  metrics.scrollResizeRegression = [];
  for (const [locale, width] of [['zh', 320], ['en', 320], ['zh', 1440], ['en', 1440], ['zh', 768]]) {
    await page.evaluate(locale => window.setLocale(locale), locale); await page.setViewportSize({ width, height: 1000 }); await settled();
    metrics.scrollResizeRegression.push({ locale, width, ...await assertScrollExtent(locale) }); assertReturns(await returnGeometry());
  }
  check('Chinese-English-light-dark-320-768-1024-1440-remain-readable-with-all-steps-and-return-paths-without-page-overflow');
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.keyboard.press('Escape'); await expect(dialog()).toHaveCount(0); await expect(page.locator('#open-details')).toBeFocused(); assert.deepEqual(errors, []);
  check('escape-restores-opener-focus-and-the-bundled-browser-has-no-console-or-page-errors');
  await writeFile(resolve(directory, 'report.json'), JSON.stringify({ passed: true, checks, checkCount: checks.length, errors, metrics, sourceHashes, browser: await browser.version(), browserDistribution: 'Playwright bundled Chromium', scope: 'plugin-component-fixture-with-controlled-read-and-review-transport; Wiki iframe handshake fixture is not the packaged Wiki renderer and is not a live-host test' }, null, 2));
} catch (error) {
  if (page) await page.screenshot({ path: resolve(directory, 'failure.png') }).catch(() => {});
  await mkdir(directory, { recursive: true }); await writeFile(resolve(directory, 'report.json'), JSON.stringify({ passed: false, checks, errors, error: error.stack, metrics, sourceHashes }, null, 2)); throw error;
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); }
