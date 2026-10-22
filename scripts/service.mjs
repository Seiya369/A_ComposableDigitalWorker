import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, mkdir, readFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticateWeb, webLaunchUrl } from '../integration/web-auth.mjs';

// A transient launchd job survives the invoking terminal. It does not install a login item.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const label = `local.composable-workforce.${createHash('sha256').update(root).digest('hex').slice(0, 12)}`;
const logDirectory = resolve(root, '.local/service');
const port = Number(process.env.WORKFORCE_PORT || '3080');
const base = `http://127.0.0.1:${port}`;
const action = process.argv[2] || 'status';
if (process.platform !== 'darwin') throw new Error('此后台启动命令适用于 macOS；其他系统请在独立终端使用 npm start。');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('WORKFORCE_PORT 必须是 1024–65535 的整数。');
if (!['start', 'stop', 'status', 'open'].includes(action)) throw new Error('用法：node scripts/service.mjs start|stop|status|open');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const launchctl = (...args) => {
  const result = spawnSync('/bin/launchctl', args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  return result;
};
const registered = () => launchctl('list', label).status === 0;
async function listening() {
  return new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = connected => { socket.destroy(); resolve(connected); };
    socket.setTimeout(800);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}
async function healthy() {
  try {
    const home = resolve(process.env.WORKFORCE_HOME || resolve(root, '.local/harness'));
    const profile = JSON.parse(await readFile(resolve(home, 'profiles/web/package.json'), 'utf8'));
    const auth = await authenticateWeb(await readFile(resolve(logDirectory, 'stdout.log'), 'utf8'), base);
    if (!profile.dsh?.profile?.bundles?.includes('dsh-plugin-composable-workforce')) {
      const response = await fetch(base, { headers: { Cookie: auth.cookie }, signal: AbortSignal.timeout(1200) });
      return response.ok && (response.headers.get('content-type') || '').includes('text/html');
    }
    const response = await fetch(`${base}/digital-workers/api/state`, { headers: { Cookie: auth.cookie }, signal: AbortSignal.timeout(1200) });
    if (!response.ok) return false;
    const state = await response.json();
    return Array.isArray(state.projects) && Array.isArray(state.templates);
  } catch { return false; }
}
async function stop() {
  if (!registered()) { console.log('本项目没有已注册的后台服务。'); return; }
  const result = launchctl('remove', label);
  if (result.status !== 0) throw new Error(`无法停止后台服务：${result.stderr.trim()}`);
  for (let i = 0; i < 50; i++) {
    if (!registered() && !await listening()) { console.log('后台服务已停止，项目数据保留。'); return; }
    await pause(100);
  }
  throw new Error('已请求停止，但服务尚未退出；请稍后检查 npm run service:status。');
}

if (action === 'status') {
  const running = await healthy();
  console.log(JSON.stringify({ registered: registered(), healthy: running, url: base, logs: logDirectory }, null, 2));
  process.exitCode = running ? 0 : 1;
} else if (action === 'open') {
  if (!await healthy()) throw new Error('请先执行 npm run service:start。');
  const url = webLaunchUrl(await readFile(resolve(logDirectory, 'stdout.log'), 'utf8'), base);
  const opened = spawnSync('/usr/bin/open', [url], { stdio: 'ignore' });
  if (opened.status !== 0) throw new Error('无法打开默认浏览器。');
  console.log(`已打开并授权本机浏览器：${base}`);
} else if (action === 'stop') {
  await stop();
} else {
  if (await listening()) {
    if (registered() && await healthy()) { console.log(`后台服务已运行：${base}`); process.exit(0); }
    throw new Error(`端口 ${port} 已被其他服务占用，未修改或停止该进程。`);
  }
  if (registered()) {
    // A registered but exited job from an earlier failed start can be replaced.
    const result = launchctl('remove', label);
    if (result.status !== 0) throw new Error(`无法清理已退出的服务：${result.stderr.trim()}`);
  }
  await access(resolve(root, 'lib/index.js'));
  await access(resolve(root, 'scripts/start-harness.mjs'));
  await mkdir(logDirectory, { recursive: true, mode: 0o700 });
  // Pass only launch configuration; credentials remain in the existing Harness service.
  const environment = [`PATH=${process.env.PATH || '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'}`, `WORKFORCE_PORT=${port}`];
  for (const key of ['DSH_SOURCE_PATH', 'DSH_INSTALLATION_MANIFEST', 'WORKFORCE_HOME', 'DSH_HOME']) {
    if (process.env[key]) environment.push(`${key}=${resolve(process.env[key])}`);
  }
  const submitted = launchctl('submit', '-l', label,
    '-o', resolve(logDirectory, 'stdout.log'), '-e', resolve(logDirectory, 'stderr.log'),
    '--', '/usr/bin/env', ...environment, process.execPath, resolve(root, 'scripts/start-harness.mjs'));
  if (submitted.status !== 0) throw new Error(`后台启动失败：${submitted.stderr.trim()}`);
  for (let i = 0; i < 60; i++) {
    if (await healthy()) { console.log(`后台服务已就绪：${base}\n首次访问：npm run service:open\n日志：${logDirectory}\n停止：npm run service:stop`); process.exit(0); }
    await pause(250);
  }
  throw new Error(`服务已提交，但尚未就绪。请检查 ${resolve(logDirectory, 'stderr.log')}。`);
}
