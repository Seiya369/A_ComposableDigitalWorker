/** Exact packaged Wiki HTML with a data-only controlled parent, no models or user profile. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
const out = resolve(process.env.WORKFORCE_WIKI_TOOLBAR_ARTIFACTS || 'artifacts/workflow-reference-ui-validation/wiki-toolbar');
const archive = process.env.WORKFORCE_UI_ARCHIVE;
const html = archive ? execFileSync('tar', ['-xOf', archive, 'package/lib/llm-wiki/web.html'], {maxBuffer:20_000_000}) : await readFile('lib/llm-wiki/web.html');
const citation = {sourceId:'source',sourceVersion:1,startLine:1,endLine:1};
const pages = [['a','Alpha','concept'],['b','Beta','entity'],['entry','Knowledge article','synthesis']].map(([id,title,type])=>({id,title,type,path:id+'.md',content:title+' definition',markdown:title+' definition',entryIds:['entry'],citations:[citation],links:[]}));
const view = {schemaVersion:1,spaceId:'isolated-toolbar',version:1,status:{state:'ready'},pages,graph:{kind:'semantic',nodes:pages.slice(0,2).map(p=>({id:p.id,label:p.title,type:p.type,path:p.path,linkCount:1,community:0})),edges:[{id:'edge',source:'a',target:'b',weight:1,relations:[{id:'relation',sourceId:'a',targetId:'b',predicate:'uses',basis:'explicit',citations:[citation],entryIds:['entry']}]}],communities:[{id:0,nodeCount:2,topNodes:['Alpha','Beta']} ]}};
const update = {namespace:'workforce-llm-wiki',protocolVersion:1,type:'init',channel:'isolated-toolbar-channel-0001',epoch:0,view,locale:'zh',theme:{mode:'dark'},canRebuild:false};
const parent = `<!doctype html><html><body style="margin:0"><iframe id="wiki" sandbox="allow-scripts" style="border:0;width:100vw;height:100vh" src="/wiki"></iframe><script>window.messages=[];window.update=${JSON.stringify(update)};window.send=()=>document.querySelector('iframe').contentWindow.postMessage(window.update,'*');addEventListener('message',e=>{window.messages.push(e.data?.type);if(e.data?.type==='ready')window.send()});</script></body></html>`;
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(req.url==='/wiki'?html:parent);});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const checks=[],errors=[]; let browser;
await mkdir(out,{recursive:true});
try {
  browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
  const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);const graph=page.frameLocator('#wiki');
  let epoch=0;
  for(const locale of ['zh','en']) for(const theme of ['dark','light']) for(const width of [1440,320]) {
    await page.setViewportSize({width,height:900});
    await page.evaluate(({locale,theme,epoch})=>{window.update={...window.update,epoch,locale,theme:{mode:theme}};window.send();},{locale,theme,epoch:++epoch});
    const title=locale==='zh'?'知识图谱':'Knowledge graph';const type=locale==='zh'?'节点类别':'Node types';const groups=locale==='zh'?'知识分组':'Knowledge groups';const fit=locale==='zh'?'适配图谱':'Fit graph';
    await expect(graph.locator('.wiki-toolbar > strong')).toHaveText(title);
    await expect(graph.getByRole('button',{name:groups,exact:true})).toHaveAttribute('aria-pressed','true');
    assert.deepEqual(await graph.locator('.wiki-toolbar').evaluate(n=>[n.children[0].tagName,n.children[1].className,n.children[2].className]),['STRONG','wiki-color-mode','wiki-stats']);
    await expect(graph.locator('.wiki-overview')).toHaveCount(0);
    await graph.getByRole('button',{name:type,exact:true}).click();await expect(graph.locator('.wiki-legend button')).toHaveCount(2);
    await graph.locator('.wiki-legend button').last().click();await expect(graph.locator('[data-node-id]')).toHaveCount(1);
    await graph.getByRole('button',{name:fit,exact:true}).click();await expect(graph.locator('[data-node-id]')).toHaveCount(2);
    await graph.getByRole('searchbox').fill('Alpha');await expect(graph.locator('[data-node-id]')).toHaveCount(1);
    await graph.getByRole('button',{name:fit,exact:true}).click();await expect(graph.getByRole('searchbox')).toHaveValue('');await expect(graph.locator('[data-node-id]')).toHaveCount(2);
    await graph.locator('[data-node-id="a"]').focus();await graph.locator('[data-node-id="a"]').press('Enter');await expect(graph.locator('.wiki-reader')).toBeVisible();
    await graph.getByRole('button',{name:fit,exact:true}).click();await expect(graph.locator('.wiki-reader')).toHaveCount(0);
    assert.equal(await graph.locator('html').evaluate(n=>n.scrollWidth<=n.clientWidth),true);
    await page.screenshot({path:resolve(out,`toolbar-${locale}-${theme}-${width}.png`)});
    checks.push(`${locale}-${theme}-${width}`);
  }
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>window.messages.some(type=>['rebuild-request','source-request'].includes(type))),false);
} finally {
  await browser?.close();await new Promise(done=>server.close(done));
  await writeFile(resolve(out,'report.json'),JSON.stringify({checks,errors,archive:archive?resolve(archive):null,archiveSha256:archive?createHash('sha256').update(await readFile(archive)).digest('hex'):null,htmlSha256:createHash('sha256').update(html).digest('hex'),scope:'Packaged Wiki web program with a controlled parent and fixture data; not an official-host execution.'},null,2));
}
console.log(JSON.stringify({status:'passed',checks:checks.length}));
