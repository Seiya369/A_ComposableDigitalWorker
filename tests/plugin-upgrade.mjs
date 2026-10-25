/** Real archive/official CLI upgrade; all state and native sessions are disposable fixtures. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { authenticateWeb, redactWebAuth } from '../integration/web-auth.mjs';

const root = process.cwd();
const previous = resolve(process.env.DSH_UPGRADE_FROM_MANIFEST ? resolve(process.env.DSH_UPGRADE_FROM_MANIFEST, '..') : resolve(root, '.local/official-validation-complete/node_modules/@deepseek-ai/dsh'));
const current = resolve(process.env.DSH_INSTALLATION_MANIFEST ? resolve(process.env.DSH_INSTALLATION_MANIFEST, '..') : resolve(root, '.local/official-0.2.1-rc.3/node_modules/@deepseek-ai/dsh'));
const oldArchive = resolve(process.env.DSH_UPGRADE_FROM_ARCHIVE || resolve(root, 'artifacts/dsh-plugin-composable-workforce-0.27.0.tgz'));
const archive = resolve(process.argv[2] || 'artifacts/dsh-plugin-composable-workforce-0.28.0.tgz');
const directory = await mkdtemp(resolve(tmpdir(), 'graph-horses-upgrade-'));
const home = resolve(directory, 'home');
const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' };
const checks = [];
let child;
async function cli(runtime, ...args) {
  const command = spawn(process.execPath, [resolve(runtime, 'lib/bin.js'), ...args], { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; for (const stream of [command.stdout, command.stderr]) stream.on('data', chunk => { log += chunk; });
  const code = await new Promise((done, reject) => { command.once('exit', done); command.once('error', reject); });
  assert.equal(code, 0, redactWebAuth(log));
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exit = new Promise(done => child.once('exit', done)); child.kill('SIGTERM'); await exit;
}
async function start(runtime) {
  const socket = createServer(); await new Promise(done => socket.listen(0, '127.0.0.1', done));
  const port = socket.address().port; await new Promise(done => socket.close(done));
  const base = `http://127.0.0.1:${port}`; let log = ''; let cookie;
  child = spawn(process.execPath, [resolve(runtime, 'lib/bin.js'), '--profile', 'web', '--port', String(port), '--no-open'], { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log = (log + chunk).slice(-40000); });
  for (let attempt = 0; attempt < 160; attempt++) {
    assert.equal(child.exitCode, null, redactWebAuth(log));
    cookie ||= (await authenticateWeb(log, base).catch(() => undefined))?.cookie;
    if (cookie) {
      const response = await fetch(`${base}/digital-workers/api/state`, { headers: { Cookie: cookie } }).catch(() => undefined);
      if (response?.ok) return { base, cookie, state: await response.json() };
    }
    await new Promise(done => setTimeout(done, 250));
  }
  throw Error(redactWebAuth(log));
}
try {
  assert.equal(JSON.parse(await readFile(resolve(previous, 'package.json'), 'utf8')).version, '0.2.1-alpha.2');
  assert.equal(JSON.parse(await readFile(resolve(current, 'package.json'), 'utf8')).version, '0.2.1-rc.3');
  const installArgs = ['--config.auto-install-peers=false', '--config.strict-peer-dependencies=false', '--ignore-scripts'];
  await cli(previous, 'plugin', '--profile', 'web', 'add', oldArchive, ...installArgs);
  let connection = await start(previous);
  const template = connection.state.templates[0];
  const modules = structuredClone(template.modules);
  modules.responsibilities.mission = 'UPGRADE_PRESERVED_CUSTOM_MISSION';
  const response = await fetch(`${connection.base}/digital-workers/api/command`, { method: 'POST', headers: { Cookie: connection.cookie, Origin: connection.base, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'employee.configuration.save', payload: { template: { ...template, name: 'UPGRADE_CUSTOM_ROLE', modules } }, options: { expectedVersion: template.version } }) });
  assert.equal(response.status, 200, await response.text());
  await stop();
  const statePath = resolve(home, 'composable-workforce/state.json');
  const before = await readFile(statePath);
  const profileBefore = JSON.parse(await readFile(resolve(home, 'profiles/web/package.json'), 'utf8'));
  await cli(current, 'plugin', '--profile', 'web', 'add', archive, ...installArgs);
  assert.deepEqual(await readFile(statePath), before, 'Package upgrade must not rewrite user state');
  checks.push('Official CLI upgrades 0.27.0/alpha.2 to 0.28.0/rc.3 without rewriting user state');
  connection = await start(current);
  const saved = connection.state.templates.find(item => item.id === template.id);
  assert.equal(saved.name, 'UPGRADE_CUSTOM_ROLE');
  assert.equal(saved.modules.responsibilities.mission, 'UPGRADE_PRESERVED_CUSTOM_MISSION');
  assert.equal(connection.state.templates.length, 6);
  assert.equal(connection.state.teams.length, 1);
  assert.equal(connection.state.workflowTemplates.length, 2);
  assert.equal(connection.state.runs.length, 0);
  checks.push('Custom role, professional definition, library identities and counts survive real new-host startup; no task starts');
  await stop();
  const profileAfter = JSON.parse(await readFile(resolve(home, 'profiles/web/package.json'), 'utf8'));
  assert.deepEqual(profileAfter.dsh.profile.bundles, profileBefore.dsh.profile.bundles);
  const report = { archiveSha256: createHash('sha256').update(await readFile(archive)).digest('hex'), from: { plugin: '0.27.0', dsh: '0.2.1-alpha.2' }, to: { plugin: '0.28.0', dsh: '0.2.1-rc.3' }, checks, fixture: directory };
  const output = resolve(root, 'artifacts/compatibility-2026-10-26/upgrade'); await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await stop(); }
