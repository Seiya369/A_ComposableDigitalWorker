/** Isolated official-DSH fixture for manual/CUA UI acceptance. No browser control or model request. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCliInstallation } from '../../integration/harness-baseline.mjs';
import { authenticateWeb, redactWebAuth } from '../../integration/web-auth.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
process.env.DSH_INSTALLATION_MANIFEST ||= resolve(root, '.local/official-validation-complete/node_modules/@deepseek-ai/dsh/package.json');
const installation = await resolveCliInstallation(root);
const temp = await mkdtemp(resolve(tmpdir(), 'graph-horses-ui-'));
const home = resolve(temp, 'harness');
const profile = resolve(home, 'profiles/web');
const statePath = resolve(temp, 'workforce.json');
const logPath = resolve(root, '.local/graph-horses-fixture.log');
const metadataPath = resolve(root, '.local/graph-horses-fixture.json');
const delay = ms => new Promise(done => setTimeout(done, ms));
let child, log = '', cookie = '';
try {
  await access(resolve(root, 'lib/client.js'));
  await mkdir(resolve(profile, 'node_modules'), { recursive: true });
  // Official development-profile linking; the release lifecycle separately installs the archive.
  await symlink(root, resolve(profile, 'node_modules/dsh-plugin-composable-workforce'), 'dir');
  await writeFile(resolve(profile, 'package.json'), JSON.stringify({
    name: 'graph-horses-ui-fixture', private: true, type: 'module',
    dependencies: { 'dsh-plugin-composable-workforce': `link:${root}` },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-plugin-composable-workforce'] } },
  }, null, 2));
  await writeFile(resolve(profile, 'cordis.patch.yml'), `- id: composable-workforce\n  config:\n    statePath: ${JSON.stringify(statePath)}\n`);
  const server = createServer();
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const port = process.env.WORKFORCE_PORT ? Number(process.env.WORKFORCE_PORT) : server.address().port;
  await new Promise(done => server.close(done));
  const base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [installation.entry, '--profile', 'web', '--port', String(port), '--no-open'], { cwd: root, env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log = (log + chunk).slice(-50000); });
  let ready = false;
  for (let i = 0; i < 160; i++) {
    assert.equal(child.exitCode, null, redactWebAuth(log));
    if (!cookie) cookie = (await authenticateWeb(log, base).catch(() => undefined))?.cookie || '';
    if (cookie && (await fetch(`${base}/digital-workers/api/state`, { headers: { Cookie: cookie } }).catch(() => null))?.ok) { ready = true; break; }
    await delay(250);
  }
  assert.ok(ready, redactWebAuth(log));
  await writeFile(logPath, log, { mode: 0o600 });
  const post = async (path, body) => {
    const response = await fetch(`${base}${path}`, { method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.ok(response.ok, await response.clone().text()); return response.json();
  };
  const command = (action, payload) => post('/digital-workers/api/command', { action, payload });
  const projects = [];
  for (const name of ['QA-项目甲', 'QA-项目乙']) {
    const path = resolve(temp, name); await mkdir(path);
    const response = await post('/api/workspace/create', { type: 'client-request', rpcId: randomUUID(), method: 'workspace/create', payload: { args: { request: { path } } } });
    assert.ok(response.result.ok); projects.push(response.result.value.workspace);
  }
  const state = await (await fetch(`${base}/digital-workers/api/state`, { headers: { Cookie: cookie } })).json();
  const architect = state.templates.find(item => item.id === 'employee-template-architect');
  const { result: bundle } = await command('bundle.export', { scope: 'template', kind: 'employee', id: architect.id });
  const samplePath = resolve(temp, 'horse-template.json');
  await writeFile(samplePath, JSON.stringify(bundle, null, 2));
  const badPath = resolve(temp, 'invalid.json'); await writeFile(badPath, '{broken');
  const metadata = { base, home, statePath, logPath, samplePath, badPath, projects, installation: installation.manifest };
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  console.log(JSON.stringify(metadata, null, 2));
  console.log('Ready for CUA. Send SIGTERM or SIGINT to remove the isolated profile.');
  await new Promise(done => { process.once('SIGTERM', done); process.once('SIGINT', done); });
} finally {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    for (let i = 0; i < 50 && child.exitCode === null; i++) await delay(100);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  await rm(temp, { recursive: true, force: true });
  await rm(logPath, { force: true });
  await rm(metadataPath, { force: true });
}
