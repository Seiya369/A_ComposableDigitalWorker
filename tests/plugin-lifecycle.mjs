/** Install an actual tarball through DSH, uninstall, restart, and reinstall.
 * WORKFORCE_LIFECYCLE_UI=1 pauses each phase for CUA inspection; enter next to continue.
 * All profiles, workspaces and memory are temporary. No model request is sent.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { checkHost } from '../integration/check-host.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const harness=resolve(process.env.DSH_SOURCE_PATH||resolve(root,'../deepseek-harness'));
const tarball=resolve(process.argv[2]||resolve(root,'artifacts/dsh-plugin-composable-workforce-0.2.0.tgz'));
await access(tarball);
await checkHost(resolve(harness,'apps/cli/package.json'));
const temp=await mkdtemp(resolve(tmpdir(),'workforce-plugin-lifecycle-'));
const home=resolve(temp,'harness');
const profile=resolve(home,'profiles/web');
const statePath=resolve(home,'composable-workforce/state.json');
const env={...process.env,DSH_HOME:home,DSH_SOURCE_PATH:harness,WORKFORCE_HOME:home,DSH_TELEMETRY_DISABLED:'1'};
const delay=ms=>new Promise(done=>setTimeout(done,ms));
const report={tarball,tarballSha256:createHash('sha256').update(await readFile(tarball)).digest('hex'),host:await checkHost(resolve(harness,'apps/cli/package.json')),checks:[]};
const input=process.env.WORKFORCE_LIFECYCLE_UI==='1'?createInterface({input:process.stdin,output:process.stdout}):undefined;
let child;
let log='';
async function pause(phase) {
  console.log(JSON.stringify({phase,base,home,statePath},null,2));
  if(input)await new Promise(done=>{console.log('CUA inspection ready. Enter next to continue.');input.once('line',done)});
}
async function cli(...args) {
  const proc=spawn(process.execPath,[resolve(harness,'apps/cli/lib/bin.js'),...args],{cwd:temp,env,stdio:['ignore','pipe','pipe']});
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
  log='';
  // Exercise the real local launcher too: it must honor removal, not rebuild the profile.
  const manifest=await readFile(resolve(profile,'package.json'),'utf8');
  const patch=await readFile(resolve(profile,'cordis.patch.yml'),'utf8');
  child=spawn(process.execPath,[resolve(root,'scripts/start-harness.mjs')],{cwd:root,env:{...env,WORKFORCE_PORT:String(port)},stdio:['ignore','pipe','pipe']});
  for(const stream of[child.stdout,child.stderr])stream.on('data',chunk=>{log=(log+chunk).slice(-40000)});
  for(let i=0;i<160;i++){
    assert.equal(child.exitCode,null,log);
    const response=await fetch(installed?`${base}/digital-workers/api/state`:base,{signal:AbortSignal.timeout(700)}).catch(()=>null);
    if(response?.ok && (response.headers.get('content-type')||'').includes(installed?'application/json':'text/html')){
      assert.equal(await readFile(resolve(profile,'package.json'),'utf8'),manifest,'launcher rewrote installation state');
      assert.equal(await readFile(resolve(profile,'cordis.patch.yml'),'utf8'),patch,'launcher rewrote profile configuration');
      return;
    }
    await delay(250);
  }
  throw new Error(`Harness did not start: ${log}`);
}
async function post(path,body) {
  const response=await fetch(`${base}${path}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify(body)});
  assert.ok(response.ok,await response.clone().text());return response.json();
}
const command=(action,payload)=>post('/digital-workers/api/command',{action,payload});
const snapshot=async()=>{const response=await fetch(`${base}/digital-workers/api/state`);assert.ok(response.ok);return response.json()};
const digest=async()=>createHash('sha256').update(await readFile(statePath)).digest('hex');
const install=()=>cli('plugin','--profile','web','add',tarball,'--config.auto-install-peers=false','--config.strict-peer-dependencies=false','--ignore-scripts');

try {
  await install();
  const packagePath=resolve(profile,'node_modules/dsh-plugin-composable-workforce');
  assert.notEqual(await realpath(packagePath),await realpath(root),'must install the archive, not link the checkout');
  const installed=JSON.parse(await readFile(resolve(packagePath,'package.json'),'utf8'));
  assert.equal(installed.version,'0.2.0');
  assert.ok(!(await readFile(resolve(packagePath,'cordis.patch.yml'),'utf8')).includes('disabled: true'));
  await start(true);
  const path=resolve(temp,'插件验收项目');await mkdir(path);
  const created=await post('/api/workspace.create',{type:'client-request',rpcId:randomUUID(),method:'workspace.create',payload:{path}});
  assert.ok(created.result.ok);const workspace=created.result.value.workspace;
  const source=(await snapshot()).templates.find(template=>template.id==='employee-template-architect');
  assert.ok(source);
  const {result:employees}=await command('project.employees.create',{projectId:workspace.workspaceId,employees:[{key:'architect',templateId:source.id,templateVersion:source.version,name:'验收架构师'}]});
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
  const baseline=await snapshot();const hash=await digest();
  report.checks.push('tarball installed through DSH; isolated employee, memory, project workflow and failed attempt created without an external model request');
  await pause('installed');
  await stop();
  await cli('plugin','--profile','web','remove','dsh-plugin-composable-workforce','--config.auto-install-peers=false');
  const removed=JSON.parse(await readFile(resolve(profile,'package.json'),'utf8'));
  assert.ok(!removed.dsh.profile.bundles.includes('dsh-plugin-composable-workforce'));
  assert.equal(await digest(),hash,'uninstall modified employee data');
  await start(false);
  const missing=await fetch(`${base}/digital-workers/api/state`);
  assert.ok(missing.status===404||!(missing.headers.get('content-type')||'').includes('application/json'),'plugin API still active after uninstall');
  assert.equal(await digest(),hash);
  report.checks.push('uninstall removes bundle and API; restart does not reinstall; profile config and employee data unchanged; native host serves normally');
  await pause('uninstalled');
  await stop();
  await install();
  await start(true);
  assert.deepEqual(await snapshot(),baseline,'reinstall changed persistent employee/project/memory state');
  assert.equal(await digest(),hash);
  report.checks.push('reinstall restores identical templates, employee IDs, permissions, memory, workflow snapshot and attempt; no duplicate instances or replayed failed task');
  await pause('reinstalled');
  report.passed=true;
  console.log('PASS: install → use → uninstall → native host → reinstall → original data.');
} finally {
  input?.close();await stop();
  await mkdir(resolve(root,'artifacts/lifecycle'),{recursive:true});
  await writeFile(resolve(root,'artifacts/lifecycle/report.json'),JSON.stringify(report,null,2)+'\n');
  await writeFile(resolve(root,'artifacts/lifecycle/host.log'),log);
  await rm(temp,{recursive:true,force:true});
}
