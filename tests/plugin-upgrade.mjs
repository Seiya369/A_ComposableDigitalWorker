/** Real archive/official CLI upgrade; all state and native sessions are disposable fixtures. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { authenticateWeb, redactWebAuth } from '../integration/web-auth.mjs';

const root = process.cwd();
const packageVersion = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).version;
const previous = resolve(process.env.DSH_UPGRADE_FROM_MANIFEST ? resolve(process.env.DSH_UPGRADE_FROM_MANIFEST, '..') : resolve(root, '.local/official-validation-complete/node_modules/@deepseek-ai/dsh'));
const current = resolve(process.env.DSH_INSTALLATION_MANIFEST ? resolve(process.env.DSH_INSTALLATION_MANIFEST, '..') : resolve(root, '.local/official-0.2.1-rc.3/node_modules/@deepseek-ai/dsh'));
const oldArchive = resolve(process.env.DSH_UPGRADE_FROM_ARCHIVE || resolve(root, 'artifacts/dsh-plugin-composable-workforce-0.27.0.tgz'));
const archive = resolve(process.argv[2] || `artifacts/dsh-plugin-composable-workforce-${packageVersion}.tgz`);
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
  checks.push('Official CLI upgrades 0.27.0/alpha.2 to the current rc.3 plugin without rewriting user state');
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
  const tool = resolve(home, 'profiles/web/node_modules/dsh-plugin-composable-workforce/lib/upgrade-software-defaults.js');
  const upgrade = spawn(process.execPath, [tool, '--state', statePath, '--host-stopped'], { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let upgradeLog = ''; for (const stream of [upgrade.stdout, upgrade.stderr]) stream.on('data', chunk => { upgradeLog += chunk; });
  assert.equal(await new Promise((done, reject) => { upgrade.once('exit', done); upgrade.once('error', reject); }), 0, upgradeLog);
  connection = await start(current);
  assert.equal(connection.state.workflowTemplates.length, 1);
  assert.equal(connection.state.workflowTemplates[0].steps.length, 11);
  assert.equal(connection.state.workflowTemplates[0].steps.find(step => step.id === 'deployment').roleId, 'operator');
  const newTeam = connection.state.teams[0];
  assert.equal(newTeam.members.find(member => member.memberId === 'product').reportsTo, undefined);
  assert.equal(newTeam.members.find(member => member.memberId === 'architect').reportsTo, 'product');
  assert.equal(newTeam.members.find(member => member.memberId === 'developer').reportsTo, 'architect');
  for (const role of ['designer', 'tester', 'operator']) assert.equal(newTeam.members.find(member => member.memberId === role).reportsTo, 'product');
  const preserved = connection.state.templates.find(item => item.id === template.id);
  assert.equal(preserved.name, 'UPGRADE_CUSTOM_ROLE');
  assert.equal(preserved.modules.responsibilities.mission, 'UPGRADE_PRESERVED_CUSTOM_MISSION');
  const wiki = await fetch(`${connection.base}/digital-workers/api/knowledge/wiki?scope=template&employeeId=${encodeURIComponent(template.id)}&library=employee`, { headers: { Cookie: connection.cookie } });
  assert.equal(wiki.status, 200); const graph = await wiki.json();
  assert.equal(graph.graph.nodes.length, 9); assert.equal(graph.graph.edges.length, 10);
  checks.push('Packaged explicit default upgrade preserves custom roles, changes untouched hierarchy and removes unused defect workflow');
  checks.push('Real upgraded archive generates and persists the grounded professional graph without an employee run');
  await stop();
  const backupNames = (await readdir(resolve(statePath, '..'))).filter(name => name.includes('.before-defaults-'));
  assert.equal(backupNames.length, 2, 'upgrade creates its payload and ownership sidecar');
  const userBackup = `${statePath}.user-copy.json`; await writeFile(userBackup, 'USER_BACKUP_KEEP');
  const purge = spawn(process.execPath, [resolve(home, 'profiles/web/node_modules/dsh-plugin-composable-workforce/scripts/plugin.mjs'), 'purge', '--home', home, '--profile', 'web', '--host-stopped'], {
    cwd: directory, env: { ...env, DSH_INSTALLATION_MANIFEST: resolve(current, 'package.json') }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let purgeLog = ''; for (const stream of [purge.stdout, purge.stderr]) stream.on('data', chunk => { purgeLog += chunk; });
  assert.equal(await new Promise((done, reject) => { purge.once('exit', done); purge.once('error', reject); }), 0, purgeLog);
  await assert.rejects(access(statePath));
  for (const name of backupNames) await assert.rejects(access(resolve(statePath, '..', name)));
  assert.equal(await readFile(userBackup, 'utf8'), 'USER_BACKUP_KEEP');
  checks.push('Packaged complete cleanup removes upgrade-owned backup and sidecar while preserving an unmarked user backup');
  const report = { archiveSha256: createHash('sha256').update(await readFile(archive)).digest('hex'), from: { plugin: '0.27.0', dsh: '0.2.1-alpha.2' }, to: { plugin: packageVersion, dsh: '0.2.1-rc.3' }, checks, fixture: directory };
  const output = resolve(root, 'artifacts/compatibility-2026-10-26/upgrade'); await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await stop(); }
