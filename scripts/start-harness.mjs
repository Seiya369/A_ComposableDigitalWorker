import { access, mkdir, readFile, writeFile, symlink, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { checkHost } from '../integration/check-host.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const harness=resolve(process.env.DSH_SOURCE_PATH || resolve(root,'../deepseek-harness'));
const home=resolve(process.env.WORKFORCE_HOME || resolve(root,'.local/harness'));
const profile=resolve(home,'profiles/web');
const existingHome=resolve(process.env.DSH_HOME || resolve(homedir(),'.dsh'));
await access(resolve(harness,'apps/cli/lib/bin.js'));
let initialized=false;
try { await access(resolve(profile,'package.json')); initialized=true; }
catch(error) {if(error.code!=='ENOENT')throw error;}
// Initialize only once. Subsequent launches honor pnpm/DSH installation and
// removal decisions, and preserve all profile edits and other plugin bundles.
if (!initialized) {
await access(resolve(root,'lib/index.js'));
await checkHost(resolve(harness,'apps/cli/package.json'));
await mkdir(resolve(profile,'node_modules'),{recursive:true});
const link=resolve(profile,'node_modules/dsh-plugin-composable-workforce');
try { if(await realpath(link)!==await realpath(root)) throw new Error('Local profile points to a different workforce plugin.'); }
catch(error) {if(error.code!=='ENOENT')throw error;await symlink(root,link,'dir');}
await writeFile(resolve(profile,'package.json'),JSON.stringify({name:'composable-workforce-local-profile',private:true,type:'module',dependencies:{'dsh-plugin-composable-workforce':`link:${root}`},dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','dsh-plugin-composable-workforce']}}},null,2)+'\n');
const q=value=>JSON.stringify(value);
let patch=`- id: composable-workforce\n  config:\n    statePath: ${q(resolve(root,'.local/workforce.json'))}\n    bootstrapProjectPath: ${q(root)}\n`;
try {
  await access(resolve(existingHome,'settings.yaml'));
  patch+=`- id: settings\n  config:\n    path: ${q(resolve(existingHome,'settings.yaml'))}\n`;
} catch(error) {if(error.code!=='ENOENT')throw error;}
try {
  await access(resolve(existingHome,'.credentials.yaml'));
  patch+=`- id: credentials\n  config:\n    dshHome: ${q(existingHome)}\n`;
} catch(error) {if(error.code!=='ENOENT')throw error;}
await writeFile(resolve(profile,'cordis.patch.yml'),patch);
}
const manifest=JSON.parse(await readFile(resolve(profile,'package.json'),'utf8'));
const installed=manifest.dsh?.profile?.bundles?.includes('dsh-plugin-composable-workforce') ?? false;
if(installed)await checkHost(resolve(harness,'apps/cli/package.json'));
const port=process.env.WORKFORCE_PORT || '3080';
console.log(`Starting Harness ${installed?'with':'without'} the employee plugin at http://127.0.0.1:${port}`);
const child=spawn(process.execPath,[resolve(harness,'apps/cli/lib/bin.js'),'--profile','web','--port',port,'--no-open'],{cwd:root,env:{...process.env,DSH_HOME:home},stdio:'inherit'});
process.on('SIGINT',()=>child.kill('SIGINT'));
process.on('SIGTERM',()=>child.kill('SIGTERM'));
child.on('exit',(code)=>process.exit(code ?? 1));
