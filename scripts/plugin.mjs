/** Forward local profile lifecycle operations to the host's package manager. */
import { access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkHost } from '../integration/check-host.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const harness=resolve(process.env.DSH_SOURCE_PATH||resolve(root,'../deepseek-harness'));
const home=resolve(process.env.WORKFORCE_HOME||resolve(root,'.local/harness'));
const action=process.argv[2];
if(!['install','uninstall'].includes(action))throw new Error('用法：node scripts/plugin.mjs install [archive.tgz] | uninstall');
await access(resolve(harness,'apps/cli/lib/bin.js'));
let args;
if(action==='install'){
  await checkHost(resolve(harness,'apps/cli/package.json'));
  const tarball=resolve(process.argv[3]||resolve(root,'artifacts/dsh-plugin-composable-workforce-0.2.0.tgz'));
  await access(tarball);
  // Host peers are supplied by Harness's module fallback, not a second installed host graph.
  args=['add',tarball,'--config.auto-install-peers=false','--config.strict-peer-dependencies=false','--ignore-scripts'];
}else{
  await access(resolve(home,'profiles/web/package.json'));
  args=['remove','dsh-plugin-composable-workforce','--config.auto-install-peers=false'];
}
const result=spawnSync(process.execPath,[resolve(harness,'apps/cli/lib/bin.js'),'plugin','--profile','web',...args],{cwd:root,env:{...process.env,DSH_HOME:home},stdio:'inherit'});
if(result.error)throw result.error;
if(result.status!==0)process.exit(result.status??1);
console.log(`${action==='install'?'插件已安装':'插件已卸载，员工与项目记忆已保留'}。重启 Harness 并刷新页面后生效。`);
