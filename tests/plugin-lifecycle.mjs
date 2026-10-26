/** Install an actual tarball through DSH, uninstall, restart, and reinstall.
 * WORKFORCE_LIFECYCLE_UI=1 pauses each phase for CUA inspection; enter next to continue.
 * All profiles, workspaces and memory are temporary. No model request is sent.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';
import { checkHost } from '../integration/check-host.mjs';
import { resolveCliInstallation } from '../integration/harness-baseline.mjs';
import { authenticateWeb, redactWebAuth } from '../integration/web-auth.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const pkg=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
process.env.DSH_INSTALLATION_MANIFEST ||= resolve(root,'.local/official-validation-complete/node_modules/@deepseek-ai/dsh/package.json');
const cliInstallation=await resolveCliInstallation(root);
const installationRoot=resolve(dirname(cliInstallation.manifest),'../..');
if (basename(installationRoot)!=='node_modules') throw new Error('生命周期验收必须使用未修改的官方 npm 安装；设置 DSH_INSTALLATION_MANIFEST。');
const tarball=resolve(process.argv[2]||resolve(root,`artifacts/dsh-plugin-composable-workforce-${pkg.version}.tgz`));
await access(tarball);
await checkHost(cliInstallation.manifest);
const temp=await mkdtemp(resolve(tmpdir(),'workforce-plugin-lifecycle-'));
const home=resolve(temp,'harness');
const profile=resolve(home,'profiles/web');
const statePath=resolve(home,'composable-workforce/state.json');
const knowledgeRoot=resolve(dirname(statePath),'knowledge',basename(statePath));
const reportDirectory=resolve(process.env.WORKFORCE_LIFECYCLE_REPORT_DIR||resolve(root,'artifacts/lifecycle'));
const env={...process.env,DSH_HOME:home,WORKFORCE_HOME:home,DSH_TELEMETRY_DISABLED:'1'};
const timings=[];
const delay=ms=>new Promise(done=>setTimeout(done,ms));
async function programDigest(directory) {
  const hash=createHash('sha256'); let files=0;
  async function visit(path) {
    const entries=(await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name));
    for(const entry of entries){
      const file=resolve(path,entry.name);
      if(entry.isDirectory())await visit(file);
      else{hash.update(file.slice(directory.length));if(entry.isSymbolicLink())hash.update(await readlink(file));else hash.update(await readFile(file));files++;}
    }
  }
  await visit(directory);return {sha256:hash.digest('hex'),files};
}
async function fileInventory(directory) {
  const result={};
  async function visit(path) {
    for(const entry of await readdir(path,{withFileTypes:true})){
      const file=resolve(path,entry.name);
      if(entry.isDirectory())await visit(file);
      else result[relative(directory,file)]=createHash('sha256').update(entry.isSymbolicLink()?await readlink(file):await readFile(file)).digest('hex');
    }
  }
  await visit(directory);return result;
}
async function stableKnowledgeInventory() {
  let previous;let unchanged=0;
  for(let i=0;i<150;i++){
    const locked=await access(resolve(knowledgeRoot,'.write.lock')).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error});
    const inventory=await fileInventory(knowledgeRoot).catch(error=>{if(error.code==='ENOENT')return undefined;throw error});
    const serialized=inventory?JSON.stringify(Object.entries(inventory).sort(([left],[right])=>left.localeCompare(right))):undefined;
    if(!locked&&inventory&&!('.write.lock' in inventory)&&serialized===previous)unchanged++;else unchanged=0;
    previous=serialized;
    if(unchanged>=4)return inventory;
    await delay(200);
  }
  throw new Error('knowledge archive did not settle without its write lock before lifecycle sampling');
}
const originalHost=await programDigest(installationRoot);
const officialRequire=createRequire(cliInstallation.manifest);
const runtimePeers={};
for(const name of Object.keys(pkg.peerDependencies)) {
  const manifestPath=await realpath(officialRequire.resolve(`${name}/package.json`));
  const inside=relative(installationRoot,manifestPath);
  assert.ok(inside&&!isAbsolute(inside)&&inside!=='..'&&!inside.startsWith(`..${sep}`),`${name} escaped the isolated official installation`);
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  assert.equal(manifest.version,pkg.peerDependencies[name],`${name} must match the verified public runtime peer`);
  runtimePeers[name]=manifest.version;
}
const report={tarball,tarballSha256:createHash('sha256').update(await readFile(tarball)).digest('hex'),host:await checkHost(cliInstallation.manifest),runtimePeers,officialInstallation:cliInstallation.manifest,hostBefore:originalHost,checks:[]};
const input=process.env.WORKFORCE_LIFECYCLE_UI==='1'?createInterface({input:process.stdin,output:process.stdout}):undefined;
let child;
let log='';
let cookie='';
async function pause(phase) {
  console.log(JSON.stringify({phase,base,home,statePath},null,2));
  if(input)await new Promise(done=>{console.log('CUA inspection ready. Enter next to continue.');input.once('line',done)});
}
async function cli(...args) {
  const began=performance.now();
  const proc=spawn(process.execPath,[cliInstallation.entry,...args],{cwd:temp,env,stdio:['ignore','pipe','pipe']});
  let output='';
  for(const stream of[proc.stdout,proc.stderr])stream.on('data',chunk=>{output+=chunk});
  const code=await new Promise((done,reject)=>{proc.once('error',reject);proc.once('exit',done)});
  timings.push({kind:'cli',operation:args.includes('add')?'add':'remove',ms:performance.now()-began});
  assert.equal(code,0,output);return output;
}
const server=createServer();
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const port=server.address().port;
await new Promise(done=>server.close(done));
const base=`http://127.0.0.1:${port}`;
async function stop() {
  if(!child||child.exitCode!==null)return;
  child.kill('SIGTERM');
  for(let i=0;i<80&&child.exitCode===null;i++)await delay(100);
  if(child.exitCode===null){child.kill('SIGKILL');await new Promise(done=>child.once('exit',done))}
}
async function start(installed) {
  const began=performance.now();
  log='';cookie='';
  // Exercise the real local launcher too: it must honor removal, not rebuild the profile.
  const manifest=await readFile(resolve(profile,'package.json'),'utf8');
  const patch=await readFile(resolve(profile,'cordis.patch.yml'),'utf8');
  child=spawn(process.execPath,[resolve(root,'scripts/start-harness.mjs')],{cwd:root,env:{...env,WORKFORCE_PORT:String(port)},stdio:['ignore','pipe','pipe']});
  for(const stream of[child.stdout,child.stderr])stream.on('data',chunk=>{log=(log+chunk).slice(-40000)});
  for(let i=0;i<160;i++){
    assert.equal(child.exitCode,null,redactWebAuth(log));
    if (!cookie) {
      const auth = await authenticateWeb(log,base).catch(()=>undefined);
      if (!auth) { await delay(250); continue; }
      cookie=auth.cookie;
    }
    const response=await fetch(installed?`${base}/digital-workers/api/state`:base,{headers:{Cookie:cookie},signal:AbortSignal.timeout(700)}).catch(()=>null);
    if(response?.ok && (response.headers.get('content-type')||'').includes(installed?'application/json':'text/html')){
      if (installed) assert.equal((await fetch(`${base}/digital-workers/api/state`)).status,401,'workforce API must require native browser authentication');
      assert.equal(await readFile(resolve(profile,'package.json'),'utf8'),manifest,'launcher rewrote installation state');
      assert.equal(await readFile(resolve(profile,'cordis.patch.yml'),'utf8'),patch,'launcher rewrote profile configuration');
      timings.push({kind:'startup',installed,ms:performance.now()-began});
      return;
    }
    await delay(250);
  }
  throw new Error(`Harness did not start: ${redactWebAuth(log)}`);
}
async function post(path,body) {
  const response=await fetch(`${base}${path}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie},body:JSON.stringify(body)});
  assert.ok(response.ok,await response.clone().text());return response.json();
}
const command=(action,payload,options)=>post('/digital-workers/api/command',{action,payload,...(options?{options}:{})});
const snapshot=async()=>{const response=await fetch(`${base}/digital-workers/api/state`,{headers:{Cookie:cookie}});assert.ok(response.ok);return response.json()};
const digest=async()=>createHash('sha256').update(await readFile(statePath)).digest('hex');
const install=()=>cli('plugin','--profile','web','add',tarball,'--config.auto-install-peers=false','--config.strict-peer-dependencies=false','--ignore-scripts');

async function checkPackagedWiki(packagePath) {
  for (const path of ['LICENSES.md','third_party/llm-wiki/LICENSE','third_party/llm-wiki/UPSTREAM.json','third_party/llm-wiki/package-lock.json','third_party/llm-wiki/engine.ts','third_party/llm-wiki/web/main.tsx','scripts/build-llm-wiki.mjs','lib/llm-wiki/engine.cjs','lib/llm-wiki/web.html']) await access(resolve(packagePath,path));
  await assert.rejects(access(resolve(packagePath,'third_party/llm-wiki/node_modules')),'the component must not package a dependency tree');
  const provenance=JSON.parse(await readFile(resolve(packagePath,'third_party/llm-wiki/UPSTREAM.json'),'utf8'));
  for(const [path,hash] of Object.entries(provenance.files)) assert.equal(createHash('sha256').update(await readFile(resolve(packagePath,'third_party/llm-wiki',path))).digest('hex'),hash,'archive upstream source differs from its provenance manifest');
  const enginePath=resolve(packagePath,'lib/llm-wiki/engine.cjs');
  const program=spawn(process.execPath,[enginePath],{cwd:temp,env:{PATH:process.env.PATH,...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{})},stdio:['pipe','pipe','pipe']});
  const lines=createInterface({input:program.stdout});
  let errors='';program.stderr.on('data',chunk=>{errors+=chunk});
  try {
    const source={id:'archive-evidence',title:'归档验收资料',content:'订单服务依据职责边界划分模块。',text:'订单服务依据职责边界划分模块。',provenance:'isolated-lifecycle',verified:false,version:1,hash:'fixture',createdAt:'2026-10-24T00:00:00.000Z',processing:[]};
    const citation={sourceId:source.id,sourceVersion:1,startLine:1,endLine:1};
    const request={spaceId:'archive-isolated-space',sources:[source],snapshot:{version:1,sourceFingerprint:'fixture',createdAt:source.createdAt,status:'candidate',entries:[{id:'article',title:'模块划分',content:'订单服务依据职责边界划分模块。',citations:[citation]}],overview:[{id:'overview',title:'模块设计',summary:'职责边界',entryIds:['article']}],conceptGraph:{schemaVersion:1,concepts:[
      {id:'service',name:'订单服务',kind:'entity',summary:'按职责组织的服务。',entryIds:['article'],citations:[citation]},
      {id:'boundary',name:'职责边界',kind:'concept',summary:'模块承担职责的范围。',entryIds:['article'],citations:[citation]},
    ],relations:[{id:'service-based-on-boundary',sourceId:'service',targetId:'boundary',predicate:'依据',basis:'explicit',entryIds:['article'],citations:[citation]}]}}};
    const build=async(id,value)=>{
      const response=new Promise((done,reject)=>{const timer=setTimeout(()=>reject(new Error('Packaged Wiki timed out')),10000);lines.once('line',line=>{clearTimeout(timer);try{done(JSON.parse(line))}catch(error){reject(error)}});program.once('error',error=>{clearTimeout(timer);reject(error)});program.once('exit',code=>{clearTimeout(timer);reject(new Error(errors||`Packaged Wiki exited without a response (${code})`))})});
      program.stdin.write(JSON.stringify({id,method:'build',request:value})+'\n');
      const result=await response;assert.equal(result.ok,true,result.error);assert.equal(result.value.engine.revision,provenance.revision);assert.equal(result.value.graph.kind,'semantic');return result.value;
    };
    const semanticRelations=view=>view.graph.edges.flatMap(edge=>edge.relations.map(relation=>({source:view.graph.nodes.find(node=>node.id===relation.sourceId)?.label,target:view.graph.nodes.find(node=>node.id===relation.targetId)?.label,predicate:relation.predicate,basis:relation.basis,citations:relation.citations,entryIds:relation.entryIds})));
    const expectedRelations=value=>value.snapshot.conceptGraph.relations.map(relation=>({source:value.snapshot.conceptGraph.concepts.find(concept=>concept.id===relation.sourceId)?.name,target:value.snapshot.conceptGraph.concepts.find(concept=>concept.id===relation.targetId)?.name,predicate:relation.predicate,basis:relation.basis,citations:relation.citations,entryIds:relation.entryIds}));
    const semantic=await build('archive-validation',request);
    assert.equal(semantic.pages.length,5,'all A/B/C and concept/entity pages remain readable');
    assert.deepEqual([...new Set(semantic.pages.map(page=>page.type))].sort(),['concept','entity','overview','source','synthesis']);
    assert.equal(semantic.graph.nodes.length,2);assert.equal(semantic.graph.edges.length,1);
    assert.ok(semantic.graph.nodes.every(node=>['concept','entity'].includes(node.type)&&node.linkCount===1));
    assert.equal(semantic.graph.edges[0].weight,1);assert.deepEqual(semanticRelations(semantic),expectedRelations(request));
    assert.equal(semantic.graph.communities.reduce((total,community)=>total+community.nodeCount,0),2,'communities contain only semantic nodes');
    const morePages=structuredClone(request);morePages.sources.push({...source,id:'extra-source',title:'额外阅读资料'});
    const expanded=await build('archive-extra-pages',morePages);
    assert.equal(expanded.pages.length,6);assert.deepEqual(expanded.graph,semantic.graph,'additional A pages cannot alter graph nodes, semantic degrees, edges or communities');
    const multiple=structuredClone(request);multiple.snapshot.conceptGraph.relations.push({...multiple.snapshot.conceptGraph.relations[0],id:'boundary-defines-service',sourceId:'boundary',targetId:'service',predicate:'界定'});
    const multi=await build('archive-multiple-predicates',multiple);
    assert.equal(multi.graph.edges.length,1);assert.equal(multi.graph.edges[0].weight,2);
    assert.deepEqual(semanticRelations(multi),expectedRelations(multiple),'one visual edge preserves both directed predicates and exact evidence');
    assert.ok(multi.graph.nodes.every(node=>node.linkCount===2));
    const disconnected=structuredClone(request);
    disconnected.sources[0].text+='交付验收依据验收标准。';
    disconnected.sources[0].content=disconnected.sources[0].text;
    disconnected.snapshot.entries[0].content=disconnected.sources[0].text;
    disconnected.snapshot.conceptGraph.concepts.push(
      {id:'acceptance',name:'交付验收',kind:'concept',summary:'检查交付成果。',entryIds:['article'],citations:[citation]},
      {id:'criteria',name:'验收标准',kind:'concept',summary:'交付前约定的条件。',entryIds:['article'],citations:[citation]},
    );
    disconnected.snapshot.conceptGraph.relations.push({id:'acceptance-based-on-criteria',sourceId:'acceptance',targetId:'criteria',predicate:'依据',basis:'explicit',entryIds:['article'],citations:[citation]});
    const grouped=await build('archive-disconnected-groups',disconnected);
    assert.equal(grouped.graph.nodes.length,4);assert.equal(grouped.graph.edges.length,2);
    assert.deepEqual(semanticRelations(grouped).sort((a,b)=>a.source.localeCompare(b.source)),expectedRelations(disconnected).sort((a,b)=>a.source.localeCompare(b.source)),'visual grouping cannot insert synthetic bridge relationships');
    assert.ok(grouped.graph.nodes.every(node=>node.linkCount===1),'visual envelopes and shared article/source provenance must not add degree');
    const noRelations=structuredClone(request);noRelations.snapshot.conceptGraph.relations=[];
    const isolated=await build('archive-isolated-concepts',noRelations);
    assert.equal(isolated.graph.nodes.length,2);assert.deepEqual(isolated.graph.edges,[]);assert.ok(isolated.graph.nodes.every(node=>node.linkCount===0),'shared articles and sources must not invent links between isolated concepts');
    const legacy=structuredClone(request);delete legacy.snapshot.conceptGraph;
    const legacyView=await build('archive-legacy-articles',legacy);
    assert.equal(legacyView.pages.length,3);assert.deepEqual(legacyView.graph.nodes,[]);assert.deepEqual(legacyView.graph.edges,[]);assert.deepEqual(legacyView.graph.communities,[]);
    assert.ok(legacyView.pages.some(page=>page.type==='synthesis'&&page.content.includes('订单服务依据职责边界')),'legacy B articles remain readable without inventing concept nodes');
    report.wiki={engine:semantic.engine,graphKind:semantic.graph.kind,pages:semantic.pages.length,nodes:semantic.graph.nodes.length,links:semantic.graph.edges.length,semanticRelations:semantic.graph.edges.reduce((total,edge)=>total+edge.relations.length,0),pageCountIndependent:true,disconnectedSemanticGroupsPreserved:{nodes:grouped.graph.nodes.length,relations:grouped.graph.edges.length,syntheticBridges:0},isolatedConceptsUnlinked:true,multipleDirectedPredicatesPreserved:true,legacyArticlesReadable:true,engineSha256:createHash('sha256').update(await readFile(enginePath)).digest('hex'),webSha256:createHash('sha256').update(await readFile(resolve(packagePath,'lib/llm-wiki/web.html'))).digest('hex')};
  } finally {
    lines.close();program.stdin.end();
    if(program.exitCode===null&&program.signalCode===null) {program.kill('SIGTERM');await new Promise(done=>program.once('close',done));}
  }
  report.checks.push('exact archive includes GPL license, corresponding pinned source and dependency lock; packaged shared engine projects only semantic concepts/entities and evidenced directed relations, preserves all reading pages and legacy articles, computes communities without page-link noise, and stops without a residual process');
}

try {
  await install();
  const packagePath=resolve(profile,'node_modules/dsh-plugin-composable-workforce');
  assert.notEqual(await realpath(packagePath),await realpath(root),'must install the archive, not link the checkout');
  const installed=JSON.parse(await readFile(resolve(packagePath,'package.json'),'utf8'));
  assert.equal(installed.version,pkg.version);
  await checkPackagedWiki(packagePath);
  const packageRequire=createRequire(resolve(packagePath,'package.json'));
  const installedDependenciesRoot=await realpath(resolve(profile,'node_modules'));
  report.parserDependencies={};
  for(const name of ['pdf-parse','mammoth']) {
    assert.equal(installed.dependencies[name],pkg.dependencies[name],`${name} must be declared by the exact installed archive`);
    const entry=await realpath(packageRequire.resolve(name));
    const local=relative(installedDependenciesRoot,entry);
    assert.ok(local!==''&&!isAbsolute(local)&&!local.startsWith(`..${sep}`)&&local!=='..',`${name} must resolve from the isolated installed profile, not the developer checkout or host`);
    let directory=dirname(entry), dependency;
    while(directory!==dirname(directory)) {
      const candidate=await readFile(resolve(directory,'package.json'),'utf8').then(JSON.parse).catch(()=>undefined);
      if(candidate?.name===name) { dependency=candidate;break; }
      directory=dirname(directory);
    }
    assert.equal(dependency?.version,installed.dependencies[name],`${name} resolved an unexpected dependency version`);
    report.parserDependencies[name]={version:dependency.version,entry:local};
  }
  report.checks.push('PDF/DOCX parser dependencies declared by the archive resolve at the exact declared versions inside the isolated profile, without developer-checkout or host dependency links');
  await assert.rejects(access(resolve(packagePath,'integration/harness-workspace-slots.patch')),'archive must not contain a host patch');
  await assert.rejects(access(resolve(packagePath,'.local')),'archive must not contain local data');
  for(const path of ['docs/architecture/project-delivery-review.md','docs/architecture/native-capabilities.md','docs/architecture/team-knowledge.md']) await access(resolve(packagePath,path));
  assert.ok(!(await readFile(resolve(packagePath,'cordis.patch.yml'),'utf8')).includes('disabled: true'));
  await start(true);
  const fresh=await snapshot();
  assert.equal(fresh.templates.length,6,'fresh archive must supply all six software roles');
  assert.equal(fresh.teams[0].members.length,6);
  assert.equal(fresh.workflowTemplates.length,1);
  assert.ok(fresh.workflowTemplates.every(flow=>flow.team.members.length===6 && flow.steps.every(step=>step.inputs.length&&step.outputs.length&&step.acceptanceCriteria.length&&step.onRejectStepId)));
  assert.doesNotMatch(JSON.stringify(fresh),/【演示】|demo-preview/);
  for(const key of ['employees','memories','runs']) assert.equal(fresh[key].length,0);
  for(const file of ['AGENTS.md','docs/decisions/001-official-plugin-boundary.md']) await access(resolve(packagePath,file));
  report.checks.push('fresh actual archive supplies six complete software roles, team and one non-demo software workflow with inputs/outputs/acceptance/rework; no fabricated employees, memory or task executions; boundary documents are packaged');
  const wikiPage=await fetch(`${base}/digital-workers/api/wiki`,{headers:{Cookie:cookie}});
  assert.equal(wikiPage.status,200);assert.ok((wikiPage.headers.get('content-security-policy')||'').includes("connect-src 'none'"));
  assert.ok((await wikiPage.text()).includes('workforce-llm-wiki'));
  assert.equal((await fetch(`${base}/digital-workers/api/wiki`)).status,401,'shared Wiki page must use native host authentication');
  report.checks.push('archive serves the single self-contained Wiki page through authenticated official host routing with network-denying CSP');
  const catalogResponse=await fetch(`${base}/digital-workers/api/models`,{headers:{Cookie:cookie}});
  assert.equal(catalogResponse.status,200,'official Session Controller catalog must be available');
  const catalog=await catalogResponse.json();
  assert.ok(Object.keys(catalog).every(key=>['models','default'].includes(key)),'browser catalog must expose only its allowlisted selector DTO');
  if(catalog.default) {
    assert.ok(Object.keys(catalog.default).every(key=>['provider','model','reasoningEffort'].includes(key)),'default selection exposes an unexpected field');
    assert.equal(typeof catalog.default.provider,'string');
    assert.equal(typeof catalog.default.model,'string');
  }
  assert.ok(Array.isArray(catalog.models));
  const catalogFields=new Set(['provider','providerName','model','modelName','reasoningEfforts','defaultReasoningEffort']);
  for(const model of catalog.models)assert.ok(Object.keys(model).every(key=>catalogFields.has(key)),'browser model entry exposes an unexpected field');
  assert.equal((await snapshot()).runs.length,0,'reading the model catalog must not execute an employee task');
  report.checks.push('official Session Controller model catalog is readable through authenticated plugin API with allowlisted selector fields and creates no employee run');
  const capabilitiesResponse=await fetch(`${base}/digital-workers/api/capabilities`,{headers:{Cookie:cookie}});
  assert.equal(capabilitiesResponse.status,200,'official default Agent preset capability catalog must be available');
  const capabilities=await capabilitiesResponse.json();
  assert.deepEqual(Object.keys(capabilities).sort(),['defaultTools','limitations','mcps','plugins','skills','specialTools']);
  assert.ok(Array.isArray(capabilities.plugins) && Array.isArray(capabilities.mcps),'installed plugin and MCP catalogs must remain available');
  assert.ok(Array.isArray(capabilities.skills)&&capabilities.skills.length>0,'installed skills must be listed');
  assert.ok(capabilities.skills.every(skill=>Object.keys(skill).every(key=>['id','name','description','source'].includes(key))),'skill catalog must not expose installation paths');
  const rolePresets=JSON.parse(await readFile(resolve(packagePath,'skills/software-development-presets.json'),'utf8'));
  assert.equal(rolePresets.roles.length,6);
  for(const role of rolePresets.roles)for(const id of [role.required,...role.preferred.map(skill=>skill.id)])assert.ok(capabilities.skills.some(skill=>skill.id===id&&skill.source==='bundled'),`packaged role skill must be installed and model-invocable: ${id}`);
  await access(resolve(packagePath,'skills/worktree-cleanup/scripts/cleanup.mjs'));
  report.checks.push('six software-role presets resolve all required and preferred skills through the official model-invocable registry; QA includes code-review and the packaged task-owned worktree cleanup resource is present');
  for(const name of ['read','write','edit','glob','grep','web_search','web_fetch']) assert.equal(capabilities.defaultTools.find(tool=>tool.id===name)?.available,true,`public default preset must include native ${name}, not only host-global tools`);
  const nativeTools=[...capabilities.defaultTools,...capabilities.specialTools];
  const nativeShell=process.platform==='win32'?'pwsh':'bash';
  assert.equal(nativeTools.find(tool=>tool.id===nativeShell)?.available,true,`native ${nativeShell} must remain available through the original DSH preset`);
  assert.ok(nativeTools.every(tool=>tool.available===true),'installed native tools must not be blocked by a separate employee adapter allowlist');
  assert.ok(nativeTools.every(tool=>!tool.id.startsWith('worker_')),'project business services must not be employee-selectable tool grants');
  assert.equal((await snapshot()).runs.length,0,'capability discovery must not execute a task');
  report.checks.push('public default Agent preset lease exposes installed native file/Web/Shell and extension tools plus model-invocable skills through allowlisted capability DTO; employee selections are preferences rather than a second ACL; no model call or task is created');
  const path=resolve(temp,'插件验收项目');await mkdir(path);
  const created=await post('/api/workspace/create',{type:'client-request',rpcId:randomUUID(),method:'workspace/create',payload:{args:{request:{path}}}});
  assert.ok(created.result.ok);const workspace=created.result.value.workspace;
  let source=(await snapshot()).templates.find(template=>template.id==='employee-template-architect');
  assert.ok(source);
  // Team librarians follow this same model; no fixture event may reach an external provider.
  const fixtureModules=structuredClone(source.modules);
  fixtureModules.model={mode:'override',provider:'lifecycle-unregistered-provider',model:'fixture'};
  fixtureModules.capabilities.skills=fixtureModules.capabilities.skills.map((skill,index)=>({...skill,usage:index===0?'required':'preferred',...(index===0?{}:{useWhen:'本工作单涉及该岗位业务时'})}));
  fixtureModules.capabilities.tools=[{id:'read',description:'优先读取来源资料',useWhen:'需要核对项目事实时'}];
  source=(await command('template.save',{id:source.id,name:source.name,description:source.description,status:source.status,modules:fixtureModules},{expectedVersion:source.version})).result;
  const {result:employees}=await command('project.employees.create',{projectId:workspace.workspaceId,employees:[{key:'architect',templateId:source.id,templateVersion:source.version,name:'验收架构师'}]});
  assert.deepEqual(employees[0].modules.capabilities,fixtureModules.capabilities,'employee installation must preserve required/preferred Skill routing and tool preferences');
  await command('memory.save',{projectId:workspace.workspaceId,employeeId:employees[0].id,scope:'employee',title:'安装卸载验收记忆',content:'此项目采用模块化边界，重新安装后必须保留。',source:{kind:'user-confirmed',reference:'本地隔离验收数据'}});
  const modules=structuredClone(employees[0].modules);
  // An unregistered adapter fails locally before any external model request.
  modules.model={mode:'override',provider:'lifecycle-unregistered-provider',model:'fixture'};
  await command('employee.update',{id:employees[0].id,input:{modules}});
  const {result:team}=await command('team.save',{name:'生命周期验收团队',members:[{memberId:'architect',templateId:source.id}],workflows:[{id:'review',name:'生命周期验收流程',steps:[{id:'plan',name:'方案',memberId:'architect',instruction:'验证运行记录保留',acceptanceCriteria:['保留项目记录']}]}]});
  const {result:projectTeam}=await command('project.team.configure',{projectId:workspace.workspaceId,teamId:team.id,teamVersion:team.version,templateVersions:{[source.id]:source.version}});
  await command('workflow.start',{projectId:workspace.workspaceId,projectTeamId:projectTeam.id,workflowId:projectTeam.workflows[0].id,workflowVersion:1,request:'验证失败记录在卸载重装后保留',requestId:'lifecycle-flow'});
  for(let i=0;i<100;i++){ if((await snapshot()).workflowRuns?.[0]?.status==='blocked')break; await delay(50); }
  assert.equal((await snapshot()).workflowRuns[0].status,'blocked','unconfigured test provider must fail locally');
  const projectId=workspace.workspaceId;
  const briefInput={projectId,goal:'完成可复核的生命周期项目',scope:'仅使用隔离测试数据，不执行模型推理',completionCriteria:['必交成果的当前版本已人工验收'],maxConcurrent:2};
  const briefOptions={requestId:'lifecycle-work-brief',expectedVersion:0,expectedRevision:(await snapshot()).revision};
  const {result:brief}=await command('work.saveBrief',briefInput,briefOptions);
  const briefHash=await digest();
  assert.equal((await command('work.saveBrief',briefInput,briefOptions)).result.id,brief.id,'same command must replay before stale revision rejection');
  assert.equal(await digest(),briefHash,'idempotent brief retry must not write');
  const {result:task}=await command('work.saveTask',{projectId,title:'人工成果验收',goal:'记录版本及验收证据',employeeId:employees[0].id,acceptanceCriteria:['保留两个成果版本','只验收当前版本'],deliverableTitles:['验收说明']},{requestId:'lifecycle-work-task',expectedVersion:0});
  const placeholder=(await snapshot()).workState.deliverables.find(item=>item.id===task.requiredDeliverableIds[0]);
  const {result:firstDelivery}=await command('work.saveDeliverable',{projectId,id:placeholder.id,taskId:task.id,title:placeholder.title,content:'第一版：待修订',mediaType:'text/markdown'},{requestId:'lifecycle-output-v1',expectedVersion:placeholder.version});
  const {result:secondDelivery}=await command('work.saveDeliverable',{projectId,id:placeholder.id,taskId:task.id,title:placeholder.title,content:'第二版：已补齐验收说明',mediaType:'text/markdown'},{requestId:'lifecycle-output-v2',expectedVersion:firstDelivery.version});
  const beforeStaleReview=await digest();
  const staleReview=await fetch(`${base}/digital-workers/api/command`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie},body:JSON.stringify({action:'work.reviewDeliverable',payload:{projectId,id:placeholder.id,decision:'accepted'},options:{expectedVersion:firstDelivery.version,requestId:'lifecycle-stale-review'}})});
  assert.equal(staleReview.status,409,'review from a superseded revision must conflict');
  assert.equal(await digest(),beforeStaleReview,'stale review must not write');
  await command('work.reviewDeliverable',{projectId,id:placeholder.id,decision:'accepted',note:'确认第二版'},{requestId:'lifecycle-output-review',expectedVersion:secondDelivery.version,expectedRevision:(await snapshot()).revision});
  const currentTask=(await snapshot()).workState.tasks.find(item=>item.id===task.id);
  await command('work.reviewTask',{projectId,id:task.id,decision:'accepted',note:'当前成果符合验收要求'},{requestId:'lifecycle-task-review',expectedVersion:currentTask.version,expectedRevision:(await snapshot()).revision});
  const {result:readyBrief}=await command('work.saveBrief',{...briefInput,requiredDeliverableIds:[placeholder.id]},{requestId:'lifecycle-final-brief',expectedVersion:brief.version});
  await command('work.completeProject',{projectId},{requestId:'lifecycle-complete-project',expectedVersion:readyBrief.version});
  const workState=(await snapshot()).workState;
  assert.equal(workState.briefs.find(item=>item.id===brief.id).status,'completed');
  const preservedOutput=workState.deliverables.find(item=>item.id===placeholder.id);
  assert.equal(preservedOutput.revisions.length,2);
  assert.equal(preservedOutput.revisions[0].review,undefined);
  assert.equal(preservedOutput.revisions[1].review.decision,'accepted');
  assert.equal(workState.tasks.find(item=>item.id===task.id).attemptRunIds.length,0,'human supplied deliverables must not create model attempts');
  report.checks.push('project brief, task and two manual deliverable revisions persist through authenticated API; idempotent command retry is read-only; stale review is rejected; current version and task review permit project completion without model execution');
  const beforeKnowledgeSwitch=await snapshot();
  const installedKnowledge=beforeKnowledgeSwitch.projectTeams.find(item=>item.id===projectTeam.id);
  const {result:disabledKnowledge}=await command('project.team.knowledge',{projectId,teamId:projectTeam.id,enabled:false,version:installedKnowledge.version??1});
  assert.equal(disabledKnowledge.knowledgeEnabled,false);
  const afterKnowledgeSwitch=await snapshot();
  assert.equal(afterKnowledgeSwitch.projectTeams.find(item=>item.id===projectTeam.id).knowledgeEnabled,false);
  assert.equal(afterKnowledgeSwitch.teams.find(item=>item.id===team.id).knowledgeEnabled,true,'instance switch must not change its template');
  assert.deepEqual(afterKnowledgeSwitch.employees,beforeKnowledgeSwitch.employees,'system role switch must not create or edit employees');
  assert.deepEqual(afterKnowledgeSwitch.memories,beforeKnowledgeSwitch.memories,'closing librarian must preserve existing memory');
  report.checks.push('default-on librarian switch persists via authenticated official host route; project override leaves template, employees and memories unchanged and survives reinstall');
  const samples=[];
  const measure=async()=>{const began=performance.now();const result=await snapshot();assert.ok(result.templates.length>=6);samples.push(performance.now()-began);};
  for(let i=0;i<30;i++)await measure();
  const sequential=[...samples];samples.length=0;const batchStart=performance.now();
  for(let batch=0;batch<10;batch++)await Promise.all(Array.from({length:8},measure));
  const summarize=values=>{const sorted=values.toSorted((a,b)=>a-b);return {samples:values.length,p50Ms:sorted[Math.ceil(values.length*.5)-1],p95Ms:sorted[Math.ceil(values.length*.95)-1],maxMs:sorted.at(-1)};};
  report.apiPerformance={scope:'Authenticated loopback state API; no model calls; populated lifecycle fixture',stateBytes:Buffer.byteLength(JSON.stringify(await snapshot())),sequential:summarize(sequential),concurrent:{concurrency:8,...summarize(samples),requestsPerSecond:samples.length*1000/(performance.now()-batchStart)}};
  const baseline=afterKnowledgeSwitch;const hash=await digest();
  report.checks.push('tarball installed through DSH; isolated employee, memory, project workflow and failed attempt created without an external model request');
  await pause('installed');
  const drainResponse=await fetch(`${base}/digital-workers/api/knowledge?scope=template&employeeId=employee-template-architect&library=employee`,{headers:{Cookie:cookie}});
  assert.equal(drainResponse.status,200,await drainResponse.clone().text());
  const settledKnowledgeBefore=await stableKnowledgeInventory();
  await stop();
  const knowledgeBefore=await programDigest(knowledgeRoot);
  report.knowledgeBeforeFiles=await fileInventory(knowledgeRoot);
  assert.deepEqual(report.knowledgeBeforeFiles,settledKnowledgeBefore,'stopping the host changed settled knowledge');
  assert.ok(knowledgeBefore.files>1,'librarian did not archive team/member knowledge');
  await cli('plugin','--profile','web','remove','dsh-plugin-composable-workforce','--config.auto-install-peers=false');
  const removed=JSON.parse(await readFile(resolve(profile,'package.json'),'utf8'));
  assert.ok(!removed.dsh.profile.bundles.includes('dsh-plugin-composable-workforce'));
  assert.equal(await digest(),hash,'uninstall modified employee data');
  await start(false);
  const missing=await fetch(`${base}/digital-workers/api/state`,{headers:{Cookie:cookie}});
  assert.ok(missing.status===404||!(missing.headers.get('content-type')||'').includes('application/json'),'plugin API still active after uninstall');
  assert.equal(await digest(),hash);
  assert.deepEqual(await programDigest(knowledgeRoot),knowledgeBefore,'ordinary removal changed knowledge');
  report.checks.push('uninstall removes bundle and API; restart does not reinstall; profile config and employee data unchanged; native host serves normally');
  await pause('uninstalled');
  await stop();
  await install();
  await start(true);
  assert.deepEqual(await snapshot(),baseline,'reinstall changed persistent employee/project/memory state');
  assert.equal(await digest(),hash);
  report.knowledgeAfterFiles=await stableKnowledgeInventory();
  const reinstalledKnowledge=await programDigest(knowledgeRoot);
  assert.deepEqual(reinstalledKnowledge,knowledgeBefore,'reinstall changed archived knowledge');
  report.checks.push('team librarian archives detached team/member knowledge, creates no extra employee/session, retains knowledge byte-for-byte through ordinary removal and reinstall');
  report.checks.push('reinstall restores identical templates, employee IDs, required/preferred Skill routing, tool preferences, preserved legacy fields, memory, workflow snapshot and failed attempt, project brief, work tasks, deliverable versions and review history; no duplicate instances or replayed task');
  await pause('reinstalled');
  await stop();
  const retained=resolve(temp,'用户交付成果.md');await writeFile(retained,'用户成果保留');
  const credentials=resolve(home,'.credentials.yaml');await writeFile(credentials,'# unrelated native credential fixture\n');
  const patchPath=resolve(profile,'cordis.patch.yml');
  const patchDocument=parseDocument(await readFile(patchPath,'utf8'));
  patchDocument.add({id:'composable-workforce',config:{}});
  await writeFile(patchPath,patchDocument.toString());
  const cleanup=spawn(process.execPath,[resolve(packagePath,'scripts/plugin.mjs'),'purge','--home',home,'--profile','web','--host-stopped'],{cwd:temp,env,stdio:['ignore','pipe','pipe']});
  let cleanupLog='';for(const stream of[cleanup.stdout,cleanup.stderr])stream.on('data',chunk=>{cleanupLog+=chunk});
  const cleanupCode=await new Promise((done,reject)=>{cleanup.once('error',reject);cleanup.once('exit',done)});
  assert.equal(cleanupCode,0,cleanupLog);
  await assert.rejects(access(statePath),'purge left plugin state');
  await assert.rejects(access(knowledgeRoot),'purge left plugin knowledge');
  await assert.rejects(access(dirname(statePath)),'purge left empty plugin-owned parent directories');
  assert.ok(!(await readFile(patchPath,'utf8')).includes('composable-workforce'),'purge left plugin config');
  assert.equal(await readFile(retained,'utf8'),'用户成果保留');
  assert.equal(await readFile(credentials,'utf8'),'# unrelated native credential fixture\n');
  await start(false);await stop();
  report.checks.push('packaged purge command uses official CLI remove, clears dedicated state/config, preserves user deliverables and shared credentials; native host restarts');
  report.hostAfter=await programDigest(installationRoot);
  assert.deepEqual(report.hostAfter,originalHost,'official host program files changed during plugin lifecycle');
  report.checks.push('official npm installation and dependencies have identical program-file hash before and after install/remove/reinstall/purge');
  report.timings=timings;
  report.passed=true;
  console.log('PASS: official install → use → uninstall → native host → reinstall → original data → purge → unchanged official host.');
} finally {
  input?.close();await stop();
  await mkdir(reportDirectory,{recursive:true});
  await writeFile(resolve(reportDirectory,'report.json'),JSON.stringify(report,null,2)+'\n');
  await writeFile(resolve(reportDirectory,'host.log'),redactWebAuth(log));
  await rm(temp,{recursive:true,force:true});
}
