/** Explicit Chat residency, real header layout, and native streaming on an isolated official host. */
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCliInstallation } from '../../integration/harness-baseline.mjs';
import { authenticateWeb, redactWebAuth } from '../../integration/web-auth.mjs';
import { installEmployeeSettingsFixture } from './employee-settings-offline.fixture.mjs';
import { prepareOfficialPluginRuntime } from './official-plugin-runtime.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
process.env.DSH_INSTALLATION_MANIFEST ||= resolve(root, '.local/official-0.2.1-rc.3/node_modules/@deepseek-ai/dsh/package.json');
const installation = await resolveCliInstallation(root), temp = await mkdtemp(resolve(tmpdir(), 'workforce-resident-official-ui-'));
const artifacts = resolve(process.env.WORKFORCE_RESIDENT_UI_ARTIFACTS || resolve(root, 'artifacts/conversation-employee/official-ui'));
const archive = process.env.WORKFORCE_UI_ARCHIVE && resolve(process.env.WORKFORCE_UI_ARCHIVE);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hostHash = async () => sha(Buffer.concat([await readFile(installation.entry), await readFile(installation.manifest)]));
const hostBefore = await hostHash(), checks = [], pageErrors = [];
const delay = ms => new Promise(done => setTimeout(done, ms));
const check = name => { checks.push(name); console.log(`PASS ${name}`); };
let child, browser, page, callsPath, inspectState, log = '', cookie = '';
async function start() {
  const home = resolve(temp, 'harness'), profile = resolve(home, 'profiles/web'), target = resolve(profile, 'node_modules/dsh-plugin-composable-workforce');
  const runtime = await prepareOfficialPluginRuntime({ root, packageDirectory: target, installation, archive });
  const fixture = await installEmployeeSettingsFixture(profile, root, installation); callsPath = fixture.llmCallsPath;
  await writeFile(resolve(profile, 'node_modules/dsh-plugin-employee-settings-fixture/index.js'), `
import { LlmAdapter } from '@deepseek-ai/dsh-llm'; import { appendFile } from 'node:fs/promises';
export const name = 'employee-settings-fixture'; export const inject = ['llm'];
class ResidentAdapter extends LlmAdapter {
  listModels(provider) { return Promise.resolve(['native-default','resident-specialist'].map(id=>({provider,id,name:id}))); }
  resolveModel(provider,id) { return Promise.resolve({provider,id,name:id,context:{contextWindow:262144}}); }
  async *stream(request) {
    const current = request.messages.findLast(message=>message.role==='user'&&message.source?.kind==='user');
    const marker = JSON.stringify(current?.content ?? []);
    const title = request.messages.some(message=>message.source?.kind==='dsh-session-title-llm');
    await appendFile(${JSON.stringify(callsPath)},JSON.stringify({stage:title?'title':'business',marker,provider:request.provider,model:request.model,system:request.system,messages:request.messages,tools:request.tools?.map(tool=>tool.name)})+'\\n');
    if(marker.includes('RESIDENT_SLOW')) await new Promise(done=>setTimeout(done,6000));
    const text='RESIDENT_REPLY:'+request.model;
    yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text};yield {type:'block-end',index:0,block:{type:'text',text}};
    yield {type:'usage',usage:{inputTokens:10,outputTokens:10}};yield {type:'finish',reason:{kind:'stop'}};
  }
}
export function apply(ctx){ctx.llm.registerAdapter(['employee-settings-fixture'],new ResidentAdapter());}
`);
  await writeFile(resolve(profile, 'package.json'), JSON.stringify({ name: 'resident-official-test', private: true, type: 'module', dependencies: { 'dsh-plugin-composable-workforce': `file:${archive || target}`, 'dsh-plugin-employee-settings-fixture': '0.0.0' }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-plugin-composable-workforce', 'dsh-plugin-employee-settings-fixture'] } } }));
  await writeFile(resolve(profile, 'cordis.patch.yml'), `- id: composable-workforce\n  config:\n    statePath: ${JSON.stringify(resolve(temp, 'state.json'))}\n- id: agent-default-model\n  config:\n    provider: employee-settings-fixture\n    model: native-default\n`);
  const socket = createServer(); await new Promise(done => socket.listen(0, '127.0.0.1', done)); const port = socket.address().port; await new Promise(done => socket.close(done));
  const base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [installation.entry, '--profile', 'web', '--port', String(port), '--no-open'], { cwd: temp, env: { PATH: process.env.PATH, HOME: temp, USERPROFILE: temp, XDG_CONFIG_HOME: resolve(temp, 'config'), DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1', NO_PROXY: '127.0.0.1,localhost', LANG: 'en_US.UTF-8', TERM: 'dumb' }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log = (log + chunk).slice(-60000); });
  for (let attempt = 0; attempt < 240; attempt++) {
    assert.equal(child.exitCode, null, redactWebAuth(log)); cookie ||= (await authenticateWeb(log, base).catch(() => undefined))?.cookie || '';
    if (cookie && (await fetch(base + '/digital-workers/api/state', { headers: { Cookie: cookie } }).catch(() => undefined))?.ok) return { base, sdk: Object.fromEntries(Object.entries(runtime.packages).map(([name, item]) => [name, item.version])) };
    await delay(250);
  }
  throw Error('Official host readiness timeout: ' + redactWebAuth(log));
}
try {
  await mkdir(artifacts, { recursive: true }); const { base, sdk } = await start();
  const get = async path => { const response = await fetch(base + path, { headers: { Cookie: cookie } }); assert.ok(response.ok, await response.clone().text()); return response.json(); };
  const post = async (path, body) => { const response = await fetch(base + path, { method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); assert.ok(response.ok, await response.clone().text()); return response.json(); };
  const rpc = async (method, request) => { const result = await post('/api/' + method, { type: 'client-request', rpcId: randomUUID(), method, payload: { args: { request } } }); assert.equal(result.result?.ok, true, JSON.stringify(result)); return result.result.value; };
  const state = () => get('/digital-workers/api/state');
  inspectState = state;
  const command = (action, payload, options) => post('/digital-workers/api/command', { action, payload, options });
  const calls = async () => (await readFile(callsPath, 'utf8').catch(error => error.code === 'ENOENT' ? '' : Promise.reject(error))).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(item => item.stage === 'business');
  const modules = structuredClone((await state()).templates[0].modules);
  modules.model = { mode: 'override', provider: 'employee-settings-fixture', model: 'resident-specialist' };
  modules.responsibilities.mission = 'RESIDENT_SAVED_MISSION：负责产品需求与验收。';
  modules.capabilities.skills = [{ id: 'architecture-analysis', name: '架构分析', description: 'RESIDENT_REQUIRED_SKILL', usage: 'required' }];
  modules.knowledge.sources = []; modules.knowledge.projectMemory = false; modules.knowledge.employeeMemory = false;
  const role = (await command('template.save', { name: 'QA-常驻产品负责人', status: 'ready', modules })).result;
  const chatPath = resolve(temp, 'Chat'); await mkdir(chatPath); const workspace = (await rpc('workspace/create', { path: chatPath })).workspace, projectId = workspace.workspaceId;
  const sessionId = (await rpc('session/create', { workspaceId: projectId })).sessionId, otherId = (await rpc('session/create', { workspaceId: projectId })).sessionId;
  const resident = id => get('/digital-workers/api/conversation-employee?sessionId=' + encodeURIComponent(id));
  const prompt = (id, text) => rpc('session/prompt', { requestId: randomUUID(), sessionId: id, mode: 'queue', content: [{ type: 'text', text }] });
  await prompt(sessionId, 'RESIDENT_BASE_ONE'); await prompt(otherId, 'RESIDENT_BASE_TWO');
  await expect.poll(async () => (await calls()).filter(item => item.marker.includes('RESIDENT_BASE')).length).toBe(2);
  await rpc('session/rename', { sessionId, title: 'QA-显式常驻对话' }); await rpc('session/rename', { sessionId: otherId, title: 'QA-其他Chat对话' });
  assert.equal((await resident(sessionId)).conversationEmployee, null); assert.equal((await state()).employees.length, 0); assert.equal((await state()).runs.length, 0);
  check('default-Chat-native-turns-create-no-resident-binding-employee-or-run');
  browser = await chromium.launch({ headless: true, ...(process.env.WORKFORCE_BROWSER_CHANNEL === 'bundled' ? {} : { channel: process.env.WORKFORCE_BROWSER_CHANNEL || 'chrome' }) });
  page = await browser.newPage({ viewport: { width: 1512, height: 1050 }, colorScheme: 'dark', locale: 'zh-CN' }); page.on('pageerror', error => pageErrors.push(error.message));
  const split = cookie.indexOf('='); await page.context().addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), url: base, httpOnly: true, sameSite: 'Strict' }]);
  await page.goto(base, { waitUntil: 'domcontentloaded' }); await page.getByRole('button', { name: '继续', exact: true }).click();
  const later = page.getByRole('button', { name: '稍后配置', exact: true }); if (await later.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false)) await later.click();
  const openSession = async id => {
    const row = page.locator(`[data-row-key=${JSON.stringify('session:' + id)}]`);
    if (!await row.isVisible()) { const folder = page.locator('[data-row-key^="workspace:"]').filter({ hasText: 'Chat' }).first(); await expect(folder).toBeVisible(); if (await folder.getAttribute('aria-expanded') !== 'true') await folder.click(); }
    await expect(row).toBeVisible(); await row.click(); await expect(page.locator('[data-composer-input][contenteditable=true]')).toBeEditable();
    await expect(page.locator('.wf-conversation-employee-trigger')).toBeVisible(); await expect(page.locator('.wf-conversation-workflow-picker, .wf-conversation-workflow-bar')).toHaveCount(0);
  };
  const trigger = page.locator('.wf-conversation-employee-trigger'), menu = page.locator('.wf-conversation-employee-menu');
  await openSession(sessionId); await expect(trigger).toContainText('常驻此对话 · 原生助手');
  await expect(page.locator('.wf-conversation-employee')).toHaveAttribute('data-contact-aligned', 'true');
  const geometry = await page.evaluate(() => {
    const root = document.querySelector('.wf-conversation-employee'), header = root.closest('header');
    const glyph = node => { const range = document.createRange(); range.selectNodeContents(node); return range.getBoundingClientRect(); };
    const tab = [...header.querySelectorAll('[data-conversation-tabs] [role="tab"]')].at(-1), label = root.querySelector('.wf-conversation-employee-trigger > span');
    return { tabBottom: glyph(tab).bottom, contactBottom: glyph(label).bottom };
  });
  assert.ok(Math.abs(geometry.tabBottom - geometry.contactBottom) < 1, JSON.stringify(geometry));
  await trigger.focus(); await trigger.press('ArrowDown'); await expect(menu).toBeVisible(); await expect(menu.getByRole('radio', { name: '轻咨询', exact: true })).toBeChecked();
  const beforeBrowseCalls = (await calls()).length;
  const option = menu.getByRole('option').filter({ hasText: role.name }); await option.hover();
  await menu.locator('summary').click(); await expect(menu.locator('details')).toHaveAttribute('open', ''); await expect(menu).toContainText('RESIDENT_SAVED_MISSION');
  const popupBounds = await menu.boundingBox(); assert.ok(popupBounds.x >= 8 && popupBounds.x + popupBounds.width <= 1504, JSON.stringify(popupBounds));
  await page.screenshot({ path: resolve(artifacts, 'resident-menu-local-profile.png') });
  assert.equal((await calls()).length, beforeBrowseCalls); assert.equal((await state()).employees.length, 0);
  await menu.locator('[role="listbox"]').press('Escape'); await expect(menu).toHaveCount(0); await expect(trigger).toBeFocused();
  await trigger.click(); await page.locator('[data-composer-input][contenteditable=true]').click(); await expect(menu).toHaveCount(0);
  await trigger.click(); await option.hover(); await menu.locator('[role="listbox"]').press('Enter');
  await expect.poll(async () => (await resident(sessionId)).conversationEmployee?.mode).toBe('consult');
  await expect(trigger).toContainText(role.name + '正在对接'); assert.equal((await state()).employees.length, 1); assert.equal((await state()).runs.length, 0); assert.equal((await resident(otherId)).conversationEmployee, null);
  await page.screenshot({ path: resolve(artifacts, 'resident-header-bound.png') });
  check('explicit-dropdown-aligned-with-native-tabs-browses-local-card-with-zero-model-calls');
  check('explicit-selection-defaults-to-consult-and-affects-only-selected-session');
  const send = async text => { const editor = page.locator('[data-composer-input][contenteditable=true]'); await editor.fill(text); await editor.press('Enter'); await expect.poll(async () => (await calls()).some(item => item.marker.includes(text)), { timeout: 30000 }).toBe(true); await expect.poll(async () => (await resident(sessionId)).busy, { timeout: 30000 }).toBe(false); };
  for (const text of ['RESIDENT_CONSULT_ONE', 'RESIDENT_CONSULT_TWO']) await send(text);
  const consultations = (await calls()).filter(item => /RESIDENT_CONSULT_(ONE|TWO)/.test(item.marker));
  assert.equal(consultations.length, 2);
  for (const call of consultations) { assert.equal(call.model, 'resident-specialist'); assert.match(JSON.stringify(call), /RESIDENT_SAVED_MISSION/); assert.deepEqual(call.tools ?? [], []); assert.doesNotMatch(JSON.stringify(call), /本轮已载入的必备 Skill|RESIDENT_REQUIRED_SKILL/); }
  assert.equal((await state()).runs.filter(run => run.conversationEmployee?.sessionId === sessionId).length, 2);
  await expect.poll(async () => (await state()).runs.filter(run => run.conversationEmployee?.sessionId === sessionId).map(run => ({ status: run.status, error: run.error })), { timeout: 30000 }).toEqual([{ status: 'succeeded', error: undefined }, { status: 'succeeded', error: undefined }]);
  await page.reload({ waitUntil: 'domcontentloaded' }); await expect(trigger).toContainText(role.name + '正在对接');
  check('two-native-streamed-consultations-stay-in-one-session-without-tools-skills-or-rebinding');
  const setMode = async (mode, name) => {
    await menu.getByRole('radio', { name, exact: true }).check();
    await expect.poll(async () => (await resident(sessionId)).conversationEmployee?.mode === mode || await menu.locator('.wf-conversation-employee-error').count() > 0).toBe(true);
    // A run may commit a new global revision just before the user clicks.
    // The Client refreshes without replay; this second check is another user action.
    if ((await resident(sessionId)).conversationEmployee?.mode !== mode) { await expect(menu.locator('.wf-conversation-employee-error')).toBeVisible(); await menu.getByRole('radio', { name, exact: true }).check(); }
    await expect.poll(async () => (await resident(sessionId)).conversationEmployee?.mode).toBe(mode);
  };
  await trigger.click(); await setMode('execute', '执行任务'); await trigger.click();
  await send('RESIDENT_EXECUTE_ONE'); const execution = (await calls()).find(item => item.marker.includes('RESIDENT_EXECUTE_ONE'));
  assert.match(JSON.stringify(execution), /本轮已载入的必备 Skill/); assert.ok(execution.tools?.some(name => name.startsWith('worker_')));
  check('explicit-execute-mode-restores-authorized-tools-and-required-skills');
  await trigger.click(); await setMode('consult', '轻咨询'); await trigger.click();
  await prompt(sessionId, 'RESIDENT_SLOW_ONE'); await expect.poll(async () => (await resident(sessionId)).busy).toBe(true);
  await trigger.click(); await expect(menu.getByRole('radio', { name: '执行任务', exact: true })).toBeDisabled(); await menu.locator('[role="listbox"]').press('Escape');
  await openSession(otherId); await expect(trigger).toContainText('常驻此对话 · 原生助手'); await trigger.click(); await expect(menu.getByRole('radio', { name: '执行任务', exact: true })).toBeEnabled();
  await expect(menu.getByRole('option').filter({ hasText: role.name })).toHaveAttribute('aria-disabled', 'false'); await menu.locator('[role="listbox"]').press('Escape');
  await expect.poll(async () => (await resident(sessionId)).busy, { timeout: 30000 }).toBe(false); await openSession(sessionId);
  check('busy-resident-conversation-does-not-disable-another-Chat-employee-menu');
  const residentEmployeeId = (await resident(sessionId)).conversationEmployee.employeeId;
  await command('employee.update', { id: residentEmployeeId, input: { status: 'paused' } });
  await trigger.click(); await expect(menu).toContainText('常驻员工已暂停');
  await expect(menu.getByRole('radio', { name: '执行任务', exact: true })).toBeDisabled();
  await menu.getByRole('option', { name: '退出常驻，使用原生助手', exact: true }).click(); await expect.poll(async () => (await resident(sessionId)).conversationEmployee).toBe(null);
  await expect(trigger).toContainText('常驻此对话 · 原生助手'); const beforeNative = (await state()).runs.length;
  await send('RESIDENT_NATIVE_AFTER_CLEAR'); assert.equal((await state()).runs.length, beforeNative);
  const native = (await calls()).find(item => item.marker.includes('RESIDENT_NATIVE_AFTER_CLEAR'));
  assert.ok(!native.tools?.some(name => name.startsWith('worker_')));
  const activeContexts = native.messages.filter(message => message.source?.kind === 'runtime-context' && message.source?.form === 'snapshot').at(-1);
  assert.ok(!activeContexts?.source?.sections?.some(section => section.name === 'digital-worker:identity' || section.name === 'composable-workforce:task-context'));
  check('explicit-exit-keeps-history-and-followup-returns-to-native-without-an-employee-run');
  check('paused-resident-remains-visible-and-can-still-be-explicitly-cleared');
  for (const width of [1024, 768]) {
    await page.setViewportSize({ width, height: 1050 }); await expect(trigger).toBeVisible(); const bounds = await trigger.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, JSON.stringify(bounds));
    await trigger.click(); const popup = await menu.boundingBox(); assert.ok(popup.x >= 8 && popup.x + popup.width <= width - 8, JSON.stringify(popup)); await menu.locator('[role="listbox"]').press('Escape');
  }
  await page.setViewportSize({ width: 1512, height: 1050 });
  await page.screenshot({ path: resolve(artifacts, 'resident-dropdown-exited.png') });
  assert.deepEqual(pageErrors, []); assert.equal(await hostHash(), hostBefore);
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify({ status: 'passed', checks, checkCount: checks.length, sdk, pluginArchive: archive ? { sha256: sha(await readFile(archive)) } : undefined, modelCalls: { offline: (await calls()).length, external: 0 }, headerAlignment: geometry, popupBounds, responsiveWidths: [1024, 768], pageErrors, hostUnchanged: true }, null, 2));
  console.log(`PASS ${checks.length} official resident employee checks`);
} catch (error) {
  await mkdir(artifacts, { recursive: true }); await page?.screenshot({ path: resolve(artifacts, 'failure.png') }).catch(() => {});
  await writeFile(resolve(artifacts, 'failure-report.json'), JSON.stringify({ status: 'failed', checks, pageErrors, error: String(error), state: await inspectState?.().catch(() => undefined), hostLog: redactWebAuth(log).slice(-10000), calls: (await readFile(callsPath, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line)) }, null, 2));
  throw error;
} finally {
  await browser?.close(); if (child?.exitCode === null) { child.kill('SIGTERM'); for (let attempt = 0; attempt < 80 && child.exitCode === null; attempt++) await delay(100); if (child.exitCode === null) child.kill('SIGKILL'); }
  await rm(temp, { recursive: true, force: true });
}
