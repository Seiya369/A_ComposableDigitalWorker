/** Official profile install/remove plus an explicit, plugin-only purge. */
import { access, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkHost } from '../integration/check-host.mjs';
import { resolveCliInstallation } from '../integration/harness-baseline.mjs';
import { applyPurge, planPurge, pluginName } from './purge-profile.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [action, ...args] = process.argv.slice(2);
if (!['install', 'uninstall', 'remove', 'purge'].includes(action)) throw new Error('用法：node scripts/plugin.mjs install [archive.tgz] | uninstall | purge [--dry-run] [--host-stopped] [--owned-state-path /absolute/state.json] [--home /dsh/home] [--profile web] [--service-root /checkout]');
const options = {}; let archive;
for (let index = 0; index < args.length; index++) {
  const key = args[index];
  if (['--dry-run', '--host-stopped'].includes(key)) options[key] = true;
  else if (['--home', '--profile', '--owned-state-path', '--service-root'].includes(key)) {
    if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${key} 缺少参数。`);
    options[key] = args[++index];
  } else if (action === 'install' && !key.startsWith('--') && !archive) archive = key;
  else throw new Error(`未知参数：${key}`);
}
const home = resolve(options['--home'] || process.env.WORKFORCE_HOME || resolve(root, '.local/harness'));
const profile = options['--profile'] || 'web';
if (!/^[a-zA-Z0-9_-]+$/.test(profile)) throw new Error('profile 名称无效。');
const cli = await resolveCliInstallation(root);
const run = (...values) => {
  const result = spawnSync(process.execPath, [cli.entry, 'plugin', '--profile', profile, ...values], { cwd: process.cwd(), env: { ...process.env, DSH_HOME: home }, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`官方插件 CLI 失败（${result.status ?? 1}），未清理业务数据。`);
};
if (action === 'install') {
  await checkHost(cli.manifest);
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const tarball = resolve(archive || resolve(root, `artifacts/${pluginName}-${manifest.version}.tgz`));
  await access(tarball);
  run('add', tarball, '--config.auto-install-peers=false', '--config.strict-peer-dependencies=false', '--ignore-scripts');
  console.log('插件已安装。重启目标 Harness 并刷新页面后生效。');
} else {
  await access(resolve(home, 'profiles', profile, 'package.json'));
  const plan = action === 'purge' ? await planPurge({ home, profile, ownedStatePath: options['--owned-state-path'], serviceRoot: options['--service-root'] }) : undefined;
  if (options['--dry-run']) {
    console.log(JSON.stringify({ action, home, profile, files: plan?.files.map(file => file.path) || [], knowledgeRoots: plan?.knowledgeTrees?.filter(tree => !tree.absent).map(tree => tree.root) || [], configRows: plan?.patches.map(patch => ({ path: patch.path, rows: patch.count })) || [], serviceRoot: plan?.serviceRoot, logs: plan?.logs || [] }, null, 2));
  } else {
    if (action === 'purge' && !options['--host-stopped']) throw new Error('先停止目标 Harness，再传 --host-stopped 执行完整清理；可先用 --dry-run 查看精确清理范围。');
    if (plan?.serviceRoot && process.platform === 'darwin') {
      const label = `local.composable-workforce.${createHash('sha256').update(plan.serviceRoot).digest('hex').slice(0, 12)}`;
      const registered = spawnSync('/bin/launchctl', ['list', label], { encoding: 'utf8' });
      if (registered.status === 0) {
        const stopped = spawnSync('/bin/launchctl', ['remove', label], { encoding: 'utf8' });
        if (stopped.status !== 0) throw new Error(`无法移除本插件创建的服务：${stopped.stderr.trim()}`);
      }
    }
    const manifest = JSON.parse(await readFile(resolve(home, 'profiles', profile, 'package.json'), 'utf8'));
    if (manifest.dependencies?.[pluginName] || manifest.dsh?.profile?.bundles?.includes(pluginName)) run('remove', pluginName, '--config.auto-install-peers=false');
    if (plan) console.log(JSON.stringify(await applyPurge(plan), null, 2));
    console.log(action === 'purge' ? '本插件的依赖、bundle、专属配置、状态、知识库及指定的本地服务日志已清理。用户项目、成果及原生会话历史保留。重启 Harness 并刷新页面后生效。' : '插件已卸载，配置、员工、项目记忆与知识库已保留。重启 Harness 并刷新页面后生效。');
  }
}
