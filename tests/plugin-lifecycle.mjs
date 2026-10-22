/** Install an actual tarball through DSH, uninstall, restart, and reinstall.
 * WORKFORCE_LIFECYCLE_UI=1 pauses each phase for CUA inspection; enter next to continue.
 * All profiles, workspaces and memory are temporary. No model request is sent.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';
import { checkHost } from '../integration/check-host.mjs';
import { resolveCliInstallation } from '../integration/harness-baseline.mjs';
import { authenticateWeb, redactWebAuth } from '../integration/web-auth.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const pkg=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
process.env.DSH_INSTALLATION_MANIFEST ||= resolve(root,'.local/official-validation/node_modules/@deepseek-ai/dsh/package.json');
const cliInstallation=await resolveCliInstallation(root);
const installationRoot=await realpath(resolve(dirname(await realpath(cliInstallation.manifest)),'../..'));
if (basename(installationRoot)!=='node_modules') throw new Error('生命周期验收必须使用未修改的官方 npm 安装；设置 DSH_INSTALLATION_MANIFEST。');
const tarball=resolve(process.argv[2]||resolve(root,`artifacts/dsh-plugin-composable-workforce-${pkg.version}.tgz`));
await access(tarball);
await checkHost(cliInstallation.manifest);
const temp=await mkdtemp(resolve(tmpdir(),'workforce-plugin-lifecycle-'));
const stagedTarball=resolve(temp,'package.tgz');
const home=resolve(temp,'harness');
const profile=resolve(home,'profiles/web');
const statePath=resolve(home,'composable-workforce/state.json');
const knowledgeRoot=resolve(dirname(statePath),'knowledge',basename(statePath));
const reportDirectory=resolve(process.env.WORKFORCE_LIFECYCLE_REPORT_DIR||resolve(root,'artifacts/lifecycle'));
const env={...process.env,DSH_HOME:home,WORKFORCE_HOME:home,DSH_TELEMETRY_DISABLED:'1'};
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
const originalHost=await programDigest(installationRoot);
const officialRequire=createRequire(cliInstallation.manifest);
const runtimePeers={};
const runtimePeerPaths={};
for(const [name,expectedVersion] of Object.entries(pkg.peerDependencies)) {
  const path=await realpath(officialRequire.resolve(`${name}/package.json`));
  const part=relative(installationRoot,path);
  assert.ok(!isAbsolute(part)&&part!=='..'&&!part.startsWith('../')&&!part.startsWith('..\\'),`${name} escaped the independent official stock boundary`);
  const manifest=JSON.parse(await readFile(path,'utf8'));
  assert.equal(manifest.name,name,`${name} must resolve its declared public package`);
  assert.equal(manifest.version,expectedVersion,`${name} must match the verified public runtime peer`);
  runtimePeers[name]=manifest.version;
  runtimePeerPaths[name]=path;
}
const report={tarball,tarballSha256:createHash('sha256').update(await readFile(tarball)).digest('hex'),stagedTarball,host:await checkHost(cliInstallation.manifest),runtimePeers,runtimePeerPaths,officialInstallation:cliInstallation.manifest,hostBefore:originalHost,checks:[]};
const input=process.env.WORKFORCE_LIFECYCLE_UI==='1'?createInterface({input:process.stdin,output:process.stdout}):undefined;
let child;
let log='';
let cookie='';
async function pause(phase) {
  console.log(JSON.stringify({phase,base,home,statePath},null,2));
  if(input)await new Promise(done=>{console.log('CUA inspection ready. Enter next to continue.');input.once('line',done)});
}
async function cli(...args) {
  const proc=spawn(process.execPath,[cliInstallation.entry,...args],{cwd:temp,env,stdio:['ignore','pipe','pipe']});
  let output='';
  for(const stream of[proc.stdout,proc.stderr])stream.on('data',chunk=>{output+=chunk});
  const code=await new Promise((done,reject)=>{proc.once('error',reject);proc.once('exit',done)});
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
const install=()=>cli('plugin','--profile','web','add',stagedTarball,'--ignore-scripts');

try {
  await copyFile(tarball,stagedTarball);
  report.stagedTarballSha256=createHash('sha256').update(await readFile(stagedTarball)).digest('hex');
  assert.equal(report.stagedTarballSha256,report.tarballSha256,'staged archive must match the source archive SHA-256');
  report.checks.push('source archive is staged at a short isolated path with identical SHA-256 and retained through install/remove/reinstall/purge');
  await install();
  const packagePath=resolve(profile,'node_modules/dsh-plugin-composable-workforce');
  assert.notEqual(await realpath(packagePath),await realpath(root),'must install the archive, not link the checkout');
  const installed=JSON.parse(await readFile(resolve(packagePath,'package.json'),'utf8'));
  assert.equal(installed.version,pkg.version);
  await assert.rejects(access(resolve(packagePath,'integration/harness-workspace-slots.patch')),'archive must not contain a host patch');
  await assert.rejects(access(resolve(packagePath,'.local')),'archive must not contain local data');
  for(const path of ['docs/architecture/project-workbench.md','docs/architecture/native-capabilities.md','docs/architecture/team-knowledge.md']) await access(resolve(packagePath,path));
  assert.ok(!(await readFile(resolve(packagePath,'cordis.patch.yml'),'utf8')).includes('disabled: true'));
  await start(true);
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
  assert.deepEqual(Object.keys(capabilities).sort(),['defaultTools','limitations','skills','specialTools']);
  assert.ok(Array.isArray(capabilities.skills)&&capabilities.skills.length>0,'installed skills must be listed');
  assert.ok(capabilities.skills.every(skill=>Object.keys(skill).every(key=>['id','name','description','source'].includes(key))),'skill catalog must not expose installation paths');
  for(const name of ['read','write','edit','glob','grep','web_search','web_fetch']) assert.equal(capabilities.defaultTools.find(tool=>tool.id===name)?.available,true,`public default preset must include native ${name}, not only host-global tools`);
  assert.ok(capabilities.specialTools.filter(tool=>['bash','terminal','pwsh','job_output','job_list','job_kill'].includes(tool.id)).every(tool=>tool.available===false),'shell tools must remain unavailable');
  assert.equal((await snapshot()).runs.length,0,'capability discovery must not execute a task');
  report.checks.push('public default Agent preset lease exposes installed native file/Web tools and skills through allowlisted capability DTO; shell is unavailable; no model call or task is created');
  const path=resolve(temp,'插件验收项目');await mkdir(path);
  const created=await post('/api/workspace/create',{type:'client-request',rpcId:randomUUID(),method:'workspace/create',payload:{args:{request:{path}}}});
  assert.ok(created.result.ok);const workspace=created.result.value.workspace;
  let source=(await snapshot()).templates.find(template=>template.id==='employee-template-architect');
  assert.ok(source);
  // Team librarians follow this same model; no fixture event may reach an external provider.
  const fixtureModules=structuredClone(source.modules);
  fixtureModules.model={mode:'override',provider:'lifecycle-unregistered-provider',model:'fixture'};
  const sourceCategories=[
    ['reference','01-reference'],['requirements-decisions','02-requirements-decisions'],
    ['task-evidence','03-task-evidence'],['incidents-reflections','04-incidents-reflections'],
    ['environment-constraints','05-environment-constraints'],['preferences-capabilities','06-preferences-capabilities'],
  ];
  fixtureModules.knowledge.sources=sourceCategories.map(([category],i)=>({id:`lifecycle-source-${i}`,title:`隔离资料 ${category}`,kind:'text',value:`合成原文 ${i}\n保留否定与版本边界。`,category}));
  fixtureModules.knowledge.organization={version:1,profession:'支付接口与事务一致性',taskScope:'整理回执与幂等边界',conceptRules:'receipt_id 与 order_id 分开；保留否定、版本与未核验状态。',categories:[{id:'receipt-consistency',title:'回执与幂等',description:'区分实体、重试条件及未知状态'}]};
  source=(await command('template.save',{id:source.id,name:source.name,description:source.description,status:source.status,modules:fixtureModules},{expectedVersion:source.version})).result;
  assert.deepEqual((await snapshot()).templates.find(item=>item.id===source.id).modules.knowledge,fixtureModules.knowledge,'public save/reload lost source categories or professional rules');
  const {result:employees}=await command('project.employees.create',{projectId:workspace.workspaceId,employees:[{key:'architect',templateId:source.id,templateVersion:source.version,name:'验收架构师'}]});
  await command('memory.save',{projectId:workspace.workspaceId,employeeId:employees[0].id,scope:'employee',title:'安装卸载验收记忆',content:'此项目采用模块化边界，重新安装后必须保留。',source:{kind:'user-confirmed',reference:'本地隔离验收数据'}});
  const modules=structuredClone(employees[0].modules);
  // An unregistered adapter fails locally before any external model request.
  modules.model={mode:'override',provider:'lifecycle-unregistered-provider',model:'fixture'};
  await command('employee.update',{id:employees[0].id,input:{modules}});
  const {result:team}=await command('team.save',{name:'生命周期验收团队',members:[{memberId:'architect',templateId:source.id}],workflows:[{id:'review',name:'生命周期验收流程',steps:[{id:'plan',name:'方案',memberId:'architect',instruction:'验证运行记录保留',acceptanceCriteria:['保留项目记录']}]}]});
  const {result:projectTeam}=await command('project.team.configure',{projectId:workspace.workspaceId,teamId:team.id,teamVersion:team.version,templateVersions:{[source.id]:source.version}});
  const installedMember=(await snapshot()).employees.find(item=>item.id===projectTeam.members[0].employeeId);
  assert.deepEqual(installedMember.modules.knowledge,fixtureModules.knowledge,'team installation lost detached professional rules');
  const renamedModules=structuredClone(source.modules);
  renamedModules.knowledge.organization.categories[0].title='回执一致性与幂等';
  await command('template.save',{id:source.id,name:source.name,description:source.description,status:source.status,modules:renamedModules},{expectedVersion:source.version});
  const afterCategoryRename=await snapshot();
  assert.equal(afterCategoryRename.templates.find(item=>item.id===source.id).modules.knowledge.organization.categories[0].id,'receipt-consistency','display rename changed the stable category ID');
  assert.deepEqual(afterCategoryRename.employees.find(item=>item.id===installedMember.id).modules.knowledge,fixtureModules.knowledge,'template edit changed the installed employee snapshot');
  report.checks.push('archive API persists all six source categories and professional organization; installed employee keeps a detached copy; category title rename preserves its ID');
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
  const uploadTarget={kind:'project',projectId,employeeId:installedMember.id};
  const uploadedMaterials=[];
  const uploadFixtures=JSON.parse(await readFile(resolve(root,'tests/fixtures/feeding/manifest.json'),'utf8'));
  const beforeFeeding=await digest();
  for(const fixture of uploadFixtures.files){
    const bytes=await readFile(resolve(root,'tests/fixtures/feeding',fixture.name));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),fixture.sha256,'synthetic fixture bytes changed');
    if(fixture.expected==='accepted'){
      const {result:receipt}=await command('knowledge.upload',{target:uploadTarget,file:{name:fixture.name,base64:bytes.toString('base64')}});
      assert.equal(receipt.status,'archived');assert.equal(receipt.version,1);
      const archivedPath=resolve(knowledgeRoot,'projects',projectId,'teams',projectTeam.id,'employees',installedMember.id,'A-sources','01-reference',encodeURIComponent(receipt.sourceId),'v1.json');
      const archived=JSON.parse(await readFile(archivedPath,'utf8'));
      assert.deepEqual(Buffer.from(archived.originalFile.data,'base64'),bytes,'archived original bytes changed');
      assert.equal(archived.originalFile.sha256,fixture.sha256);
      for(const text of fixture.textIncludes)assert.ok(archived.text.includes(text),`archive missed extracted text: ${text}`);
      assert.equal(archived.verified,false);
      uploadedMaterials.push(receipt);
    }else{
      const rejected=await fetch(`${base}/digital-workers/api/command`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie},body:JSON.stringify({action:'knowledge.upload',payload:{target:uploadTarget,file:{name:fixture.name,base64:bytes.toString('base64')}}})});
      assert.equal(rejected.status,400,'unreadable synthetic document was accepted');
      assert.ok((await rejected.json()).error.includes(fixture.errorIncludes));
    }
  }
  const {result:uploadedList}=await command('knowledge.uploads.list',{target:uploadTarget});
  assert.equal(uploadedList.length,uploadedMaterials.length);
  assert.ok(uploadedList.every(item=>item.attachment&&!Object.hasOwn(item.attachment,'data')),'metadata list leaked original base64');
  assert.equal(await digest(),beforeFeeding,'feeding wrote unrelated employee or project state');
  report.checks.push('archive parses synthetic PDF/DOCX/UTF-8 uploads through authenticated command, retains exact original bytes and page/paragraph text in private A, rejects scan/encrypted PDF, lists metadata only and leaves configuration untouched');
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
  const blockedFeeding=await fetch(`${base}/digital-workers/api/command`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie},body:JSON.stringify({action:'knowledge.upload',payload:{target:uploadTarget,file:{name:'disabled.md',base64:Buffer.from('不得在关闭管理员时入库').toString('base64')}}})});
  assert.equal(blockedFeeding.status,400,'closing librarian did not block human uploads');
  report.checks.push('default-on librarian switch persists via authenticated official host route; project override leaves template, employees and memories unchanged and survives reinstall');
  const baseline=afterKnowledgeSwitch;const hash=await digest();
  report.checks.push('tarball installed through DSH; isolated employee, memory, project workflow and failed attempt created without an external model request');
  await pause('installed');
  await stop();
  const memberSources=resolve(knowledgeRoot,'projects',workspace.workspaceId,'teams',projectTeam.id,'employees',installedMember.id,'A-sources');
  for(const [category,folder] of sourceCategories){
    const ids=await readdir(resolve(memberSources,folder));
    assert.ok(ids.length>0,`six-category archive was empty: ${folder}`);
    let found=false;
    for(const id of ids)for(const version of await readdir(resolve(memberSources,folder,id))){
      const record=JSON.parse(await readFile(resolve(memberSources,folder,id,version),'utf8'));
      if(record.provenance===`configuration:text:lifecycle-source-${sourceCategories.findIndex(item=>item[0]===category)}`){
        assert.equal(record.category,category);
        assert.equal(record.content,fixtureModules.knowledge.sources.find(item=>item.category===category).value,'categorization changed the original text');
        found=true;
      }
    }
    assert.ok(found,`configured source did not reach its physical category: ${category}`);
  }
  report.checks.push('installed archive materializes every A category and places configured sources in their actual folders with unchanged original text');
  const knowledgeBefore=await programDigest(knowledgeRoot);
  assert.ok(knowledgeBefore.files>1,'librarian did not archive team/member knowledge');
  await cli('plugin','--profile','web','remove','dsh-plugin-composable-workforce');
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
  assert.deepEqual(await programDigest(knowledgeRoot),knowledgeBefore,'reinstall changed archived knowledge');
  report.checks.push('team librarian archives detached team/member knowledge, creates no extra employee/session, retains knowledge byte-for-byte through ordinary removal and reinstall');
  report.checks.push('reinstall restores identical templates, employee IDs, permissions, memory, workflow snapshot and failed attempt, project brief, work tasks, deliverable versions and review history; no duplicate instances or replayed task');
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
  assert.ok(!(await readFile(patchPath,'utf8')).includes('composable-workforce'),'purge left plugin config');
  assert.equal(await readFile(retained,'utf8'),'用户成果保留');
  assert.equal(await readFile(credentials,'utf8'),'# unrelated native credential fixture\n');
  await start(false);await stop();
  report.checks.push('packaged purge command uses official CLI remove, clears dedicated state/config, preserves user deliverables and shared credentials; native host restarts');
  report.hostAfter=await programDigest(installationRoot);
  assert.deepEqual(report.hostAfter,originalHost,'official host program files changed during plugin lifecycle');
  report.checks.push('official npm installation and dependencies have identical program-file hash before and after install/remove/reinstall/purge');
  report.passed=true;
  console.log('PASS: official install → use → uninstall → native host → reinstall → original data → purge → unchanged official host.');
} finally {
  input?.close();await stop();
  await mkdir(reportDirectory,{recursive:true});
  await writeFile(resolve(reportDirectory,'report.json'),JSON.stringify(report,null,2)+'\n');
  await writeFile(resolve(reportDirectory,'host.log'),redactWebAuth(log));
  await rm(temp,{recursive:true,force:true});
}
