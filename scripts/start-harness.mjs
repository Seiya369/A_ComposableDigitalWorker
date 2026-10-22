import { access, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { isSeq, parseDocument } from 'yaml';
import { checkHost } from '../integration/check-host.mjs';
import { resolveCliInstallation } from '../integration/harness-baseline.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const cli=await resolveCliInstallation(root);
const home=resolve(process.env.WORKFORCE_HOME || resolve(root,'.local/harness'));
const profile=resolve(home,'profiles/web');
const existingHome=resolve(process.env.DSH_HOME || resolve(homedir(),'.dsh'));
let initialized=false;
try { await access(resolve(profile,'package.json')); initialized=true; }
catch(error) {if(error.code!=='ENOENT')throw error;}
// Initialize only once. Subsequent launches honor pnpm/DSH installation and
// removal decisions, and preserve all profile edits and other plugin bundles.
if (!initialized) {
await access(resolve(root,'lib/index.js'));
await checkHost(cli.manifest);
const installed=spawnSync(process.execPath,[cli.entry,'plugin','--profile','web','add',root,'--config.auto-install-peers=false','--config.strict-peer-dependencies=false','--ignore-scripts'],{cwd:root,env:{...process.env,DSH_HOME:home},stdio:'inherit'});
if(installed.error)throw installed.error;
if(installed.status!==0)throw new Error('官方 CLI 无法初始化本地开发 profile。');
const q=value=>JSON.stringify(value);
let patch=`- id: composable-workforce\n  config:\n    statePath: ${q(resolve(home,'composable-workforce/state.json'))}\n    bootstrapProjectPath: ${q(root)}\n`;
try {
  await access(resolve(existingHome,'settings.yaml'));
  patch+=`- id: settings\n  config:\n    path: ${q(resolve(existingHome,'settings.yaml'))}\n`;
} catch(error) {if(error.code!=='ENOENT')throw error;}
try {
  await access(resolve(existingHome,'.credentials.yaml'));
  patch+=`- id: credentials\n  config:\n    dshHome: ${q(existingHome)}\n`;
} catch(error) {if(error.code!=='ENOENT')throw error;}
const patchFile=resolve(profile,'cordis.patch.yml');
const originalPatch=await readFile(patchFile,'utf8').catch(error=>{if(error.code!=='ENOENT')throw error;return '[]\n'});
const patchDocument=parseDocument(originalPatch);
if(patchDocument.errors.length||!isSeq(patchDocument.contents))throw new Error('官方 CLI 创建的 profile patch 不是有效数组。');
for(const entry of parseDocument(patch).toJSON())patchDocument.add(entry);
await writeFile(patchFile,patchDocument.toString());
}
const manifest=JSON.parse(await readFile(resolve(profile,'package.json'),'utf8'));
const installed=manifest.dsh?.profile?.bundles?.includes('dsh-plugin-composable-workforce') ?? false;
if(installed)await checkHost(cli.manifest);
const port=process.env.WORKFORCE_PORT || '3080';
console.log(`Starting Harness ${installed?'with':'without'} the employee plugin at http://127.0.0.1:${port}`);
const child=spawn(process.execPath,[cli.entry,'--profile','web','--port',port,'--no-open'],{cwd:root,env:{...process.env,DSH_HOME:home},stdio:'inherit'});
process.on('SIGINT',()=>child.kill('SIGINT'));
process.on('SIGTERM',()=>child.kill('SIGTERM'));
child.on('exit',(code)=>process.exit(code ?? 1));
