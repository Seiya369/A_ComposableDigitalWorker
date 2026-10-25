/** Source component regression; no Harness instance or user profile is used.
 * Both WebGL and deliberately disabled WebGL must retain a strongly dragged node
 * through reader resizing, Return to full graph and the Fit graph control.
 */
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out=resolve(process.env.WORKFORCE_WIKI_COMPONENT_ARTIFACTS || resolve(root,'artifacts/wiki-circle-validation/component-regression'));await mkdir(out,{recursive:true});
const entry=`import {useRef,useState} from 'react';import{createRoot}from'react-dom/client';
import{WikiNetwork}from'${root}/third_party/llm-wiki/web/WikiNetwork.tsx';import{WikiI18nProvider}from'${root}/third_party/llm-wiki/web/i18n.tsx';import'${root}/third_party/llm-wiki/web/styles.css';
const ids=['a','b','c','d','e','p','q'],pairs=[['a','b'],['b','c'],['c','d'],['d','e'],['p','q']];
const view={schemaVersion:1,spaceId:'smoke',version:1,status:{state:'ready'},pages:ids.map(id=>({id,path:id+'.md',type:'concept',title:id,content:'# '+id,aliases:[],entryIds:['entry-'+id],citations:[],links:[]})),graph:{kind:'semantic',nodes:ids.map(id=>({id,path:id+'.md',label:id,type:'concept',community:id==='p'||id==='q'?1:0,linkCount:pairs.filter(pair=>pair.includes(id)).length})),edges:pairs.map(([source,target],i)=>({id:'edge-'+i,source,target,weight:1,relations:[{id:'rel-'+i,sourceId:source,targetId:target,predicate:'depends on',basis:'explicit',entryIds:['entry'],citations:[{sourceId:'s',sourceVersion:1,startLine:1,endLine:1}]}]})),communities:[]}};
function Fixture(){const[selected,setSelected]=useState('a'),[exploration,setExploration]=useState(),[request,setRequest]=useState(),[reader,setReader]=useState(false);const nonce=useRef(0);
 const explore=ids=>{setExploration(ids);setRequest({id:'a',nonce:++nonce.current,nodeIds:ids});};
 return <WikiI18nProvider locale='en'><section className='wiki-app' style={{width:860,height:620}}><header className='wiki-toolbar'><button onClick={()=>setReader(v=>!v)}>Toggle reader</button><button onClick={()=>explore(['a','b'])}>Explore AB</button><button onClick={()=>explore(['a','b','c','d','e'])}>Explore ABCDE</button><button onClick={()=>{setSelected(undefined);setExploration(undefined);setRequest({id:'',nonce:++nonce.current});}}>Clear</button></header><div className='wiki-body'><div className='wiki-network-area'><WikiNetwork view={view} colorMode='community' hiddenTypes={new Set()} query='' dark={true} selectedNode={selected} explorationNodeIds={exploration} focusRequest={request} onNode={setSelected} onEdge={()=>{}} onClear={()=>setSelected(undefined)}/></div>{reader&&<aside className='wiki-reader'><header>Reader</header></aside>}</div></section></WikiI18nProvider>;}createRoot(document.getElementById('root')).render(<Fixture/>);`;
await build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},outfile:resolve(out,'app.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',nodePaths:[resolve(root,'third_party/llm-wiki/node_modules'),resolve(root,'node_modules')],alias:{react:resolve(root,'third_party/llm-wiki/node_modules/react'),'react-dom':resolve(root,'third_party/llm-wiki/node_modules/react-dom')},define:{'process.env.NODE_ENV':'"production"'}});
await writeFile(resolve(out,'index.html'),`<!doctype html><html data-theme='dark'><head><link rel='stylesheet' href='/app.css'></head><body><div id='root'></div><script src='/app.js'></script></body></html>`);
const server=createServer(async(req,res)=>{try{const name=req.url==='/'?'index.html':req.url.slice(1);if(!['index.html','app.js','app.css'].includes(name))throw Error('no');res.setHeader('Content-Type',name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'text/html');res.end(await readFile(resolve(out,name)));}catch{res.statusCode=404;res.end();}});await new Promise(done=>server.listen(0,'127.0.0.1',done));const url='http://127.0.0.1:'+server.address().port;
const reports=[];
try{for(const mode of ['sigma','fallback']){const browser=await chromium.launch({headless:true,args:mode==='sigma'?['--enable-unsafe-swiftshader']:['--disable-webgl']});try{
 const page=await browser.newPage({viewport:{width:1040,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);
 const net=page.getByRole('region',{name:'Knowledge network',exact:true});await expect(net.locator('button[data-node-id]')).toHaveCount(7);
 const read=()=>net.locator('button[data-node-id]').evaluateAll(nodes=>nodes.map(n=>({id:n.dataset.nodeId,x:Number(n.dataset.x),y:Number(n.dataset.y),screenX:Number(n.dataset.screenX),screenY:Number(n.dataset.screenY)})));
 await expect.poll(async()=>(await read()).every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))).toBe(true);const initial=await read();const xs=initial.map(p=>p.x),ys=initial.map(p=>p.y);const bbox={left:Math.min(...xs),right:Math.max(...xs),top:Math.min(...ys),bottom:Math.max(...ys)};
 await expect(net).toHaveAttribute('data-layout-kind','semantic-network');await expect(net).toHaveAttribute('data-group-count','2');
 await expect(net.locator('.wiki-focus-relations')).toHaveCount(0);await expect(net.locator('.wiki-group')).toHaveCount(0);
 await expect(net.locator('button[data-edge-id]')).toHaveCount(5);
 assert.deepEqual(JSON.parse(await net.getAttribute('data-highlighted-nodes')).sort(),['a','b']);
 assert.deepEqual(JSON.parse(await net.getAttribute('data-highlighted-edges')),['edge-0']);
 const initialRadii=initial.map(p=>Math.hypot(p.x,p.y));assert.ok(initialRadii.every(radius=>Math.abs(radius-100)<1e-6),'All seven real nodes start on one regular circle centered at the origin');
 const angles=initial.map(p=>(Math.atan2(p.y,p.x)+Math.PI*2)%(Math.PI*2)).sort((a,b)=>a-b);
 const angleGaps=angles.map((angle,index)=>(angles[(index+1)%angles.length]-angle+Math.PI*2)%(Math.PI*2));
 assert.ok(angleGaps.every(gap=>Math.abs(gap-Math.PI*2/7)<1e-6),'The single circle has equal angular gaps, even across disconnected components');
 await page.screenshot({path:resolve(out,mode+'-initial-circular-layout.png')});
 await page.getByRole('button',{name:'Toggle reader',exact:true}).click();await expect(page.locator('.wiki-reader')).toBeVisible();await page.getByRole('button',{name:'Clear',exact:true}).click();await page.waitForTimeout(240);
 for(let i=0;i<8;i++){await net.getByRole('button',{name:'Zoom out graph',exact:true}).click();await page.waitForTimeout(190);}
 const beforeDrag=await read();const p=beforeDrag.find(n=>n.id==='p');const box=await net.boundingBox();const canvas=mode==='sigma'?net.locator('canvas.sigma-mouse'):net.locator('svg.wiki-fallback');await canvas.dragTo(canvas,{sourcePosition:{x:p.screenX,y:p.screenY},targetPosition:{x:box.width-28,y:box.height/2}});await expect.poll(async()=>{const n=(await read()).find(n=>n.id==='p');return n.x>bbox.right||n.x<bbox.left||n.y>bbox.bottom||n.y<bbox.top;}).toBe(true);
 const dragged=await read();const coords=rows=>rows.map(({id,x,y})=>({id,x,y}));
 const check=async()=>{const points=await read(),bounds=await net.boundingBox();return {ratio:Number(await net.getAttribute('data-camera-ratio')),width:bounds.width,height:bounds.height,outside:points.filter(n=>n.screenX<28||n.screenX>bounds.width-28||n.screenY<28||n.screenY>bounds.height-28),worldCoordinatesRetained:JSON.stringify(coords(points))===JSON.stringify(coords(dragged))};};
 await page.getByRole('button',{name:'Clear',exact:true}).click();await page.waitForTimeout(300);await expect.poll(async()=>(await check()).outside.length).toBe(0);const whileReaderOpen=await check();await page.screenshot({path:resolve(out,mode+'-return-full-reader-open.png')});
 await page.getByRole('button',{name:'Toggle reader',exact:true}).click();await expect(page.locator('.wiki-reader')).toHaveCount(0);await page.getByRole('button',{name:'Clear',exact:true}).click();await page.waitForTimeout(300);await expect.poll(async()=>(await check()).outside.length).toBe(0);const afterReaderClosed=await check();await page.screenshot({path:resolve(out,mode+'-return-full-reader-closed.png')});
 await net.getByRole('button',{name:'Zoom out graph',exact:true}).click();await page.waitForTimeout(190);await net.getByRole('button',{name:'Fit graph',exact:true}).click();await page.waitForTimeout(280);await expect.poll(async()=>(await check()).outside.length).toBe(0);const afterFitButton=await check();
 const failed=whileReaderOpen.outside.length||!whileReaderOpen.worldCoordinatesRetained||afterReaderClosed.outside.length||!afterReaderClosed.worldCoordinatesRetained||afterFitButton.outside.length||!afterFitButton.worldCoordinatesRetained;
 const result={mode,status:failed?'reproduced-failure':'passed',initialCircularLayout:{center:{x:0,y:0},radii:initialRadii,angleGaps,worldCoordinates:coords(initial),realComponents:2,realEdges:5,leftRelationOverlays:0},originalBounds:bbox,draggedNode:dragged.find(p=>p.id==='p'),whileReaderOpen,afterReaderClosed,afterFitButton,errors};assert.deepEqual(errors,[]);reports.push(result);console.log(JSON.stringify(result));
 }finally{await browser.close();}}}finally{await new Promise(done=>server.close(done));}
assert.deepEqual(reports[0].initialCircularLayout.worldCoordinates,reports[1].initialCircularLayout.worldCoordinates,'WebGL and fallback share the exact deterministic initial circle');
await writeFile(resolve(out,'report.json'),JSON.stringify({status:reports.every(r=>r.status==='passed')?'passed':'failed',reports},null,2));assert.ok(reports.every(r=>r.status==='passed'));console.log('PASS both renderers start on the same real-node circle and retain strong-drag coordinates while fitting all nodes after both reset paths');
