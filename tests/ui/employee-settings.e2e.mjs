/**
 * Run after npm run build: node tests/ui/employee-settings.e2e.mjs
 * Role layout only: WORKFORCE_ROLE_LAYOUT_ONLY=1 node tests/ui/employee-settings.e2e.mjs
 * Uses the pristine official npm DSH and a throwaway profile with no user credentials.
 * Only the test-owned offline LlmAdapter can compile the seeded employee's knowledge.
 */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCliInstallation } from '../../integration/harness-baseline.mjs';
import { authenticateWeb, redactWebAuth } from '../../integration/web-auth.mjs';
import { installEmployeeSettingsFixture, seedEmployeeSettingsFixture } from './employee-settings-offline.fixture.mjs';
import { prepareOfficialPluginRuntime } from './official-plugin-runtime.mjs';
import { switchDshLocale } from './locale-switch.checks.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
process.env.DSH_INSTALLATION_MANIFEST ||= resolve(root, '.local/official-validation-complete/node_modules/@deepseek-ai/dsh/package.json');
const installation = await resolveCliInstallation(root);
const temp = await mkdtemp(resolve(tmpdir(), 'workforce-employee-settings-ui-'));
const artifacts = resolve(process.env.WORKFORCE_EMPLOYEE_UI_ARTIFACTS || resolve(root, 'artifacts/ui'));
const delay = ms => new Promise(done => setTimeout(done, ms));
const hostHash = async () => createHash('sha256').update(await readFile(installation.entry)).update(await readFile(installation.manifest)).digest('hex');
const baseline = await hostHash();
let child, browser, page, cookie = '', log = '', installedPluginRoot = root, llmCallsPath;
const pageErrors = [];
const metrics = {};
const roleLayoutOnly = process.env.WORKFORCE_ROLE_LAYOUT_ONLY === '1';
const uiArchive = process.env.WORKFORCE_UI_ARCHIVE ? resolve(process.env.WORKFORCE_UI_ARCHIVE) : undefined;

async function settleVisualState() {
  await page.evaluate(async () => {
    // Native responsive/theme transitions temporarily retain the previous view.
    for (let pass = 0; pass < 3; pass++) {
      await new Promise(done => requestAnimationFrame(done));
      const animations = document.getAnimations().filter(animation => animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime));
      if (!animations.length) return;
      await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
    }
  });
}

async function availablePort() {
  const server = createServer();
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const address = server.address(); assert.ok(address && typeof address === 'object');
  await new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
  return address.port;
}
async function wikiWorkers() {
  const rows = await new Promise((done, reject) => execFile('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }, (error, stdout) => error ? reject(error) : done(stdout)));
  return rows.split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return match && Number(match[2]) === child?.pid && match[3].includes(resolve(installedPluginRoot, 'lib/llm-wiki/engine.cjs')) ? [Number(match[1])] : [];
  });
}
async function stopHarness() {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  for (let count = 0; count < 50 && child.exitCode === null; count++) await delay(100);
  if (child.exitCode === null) { child.kill('SIGKILL'); await delay(250); }
}
async function startHarness() {
  await access(resolve(root, 'lib/client.js'));
  const home = resolve(temp, 'harness'); const profile = resolve(home, 'profiles/web');
  await mkdir(resolve(profile, 'node_modules'), { recursive: true });
  const packageDirectory = resolve(profile, 'node_modules/dsh-plugin-composable-workforce');
  metrics.officialRuntime = await prepareOfficialPluginRuntime({ root, packageDirectory, installation, archive: uiArchive });
  installedPluginRoot = packageDirectory;
  if (uiArchive) metrics.pluginArchive = { path: uiArchive, sha256: createHash('sha256').update(await readFile(uiArchive)).digest('hex') };
  const fixture = await installEmployeeSettingsFixture(profile, root, installation);
  const { mcpServerPath } = fixture;
  llmCallsPath = fixture.llmCallsPath;
  const pluginVersion = JSON.parse(await readFile(resolve(packageDirectory, 'package.json'), 'utf8')).version;
  await writeFile(resolve(profile, 'package.json'), JSON.stringify({ name: 'employee-settings-ui-test', private: true, type: 'module', dependencies: { 'dsh-plugin-composable-workforce': uiArchive ? `file:${uiArchive}` : pluginVersion, 'dsh-plugin-employee-settings-fixture': '0.0.0', 'dsh-plugin-employee-disabled-fixture': '0.0.0' }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-plugin-composable-workforce', 'dsh-plugin-employee-settings-fixture'] } } }));
  await writeFile(resolve(profile, 'cordis.patch.yml'), `- id: composable-workforce\n  config:\n    statePath: ${JSON.stringify(resolve(temp, 'workforce.json'))}\n- id: agent-default-model\n  config:\n    provider: employee-settings-fixture\n    model: offline\n- insert:\n    - id: employee-fixture-mcp\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: employee-fixture__docs\n        transport: stdio\n        command: ${JSON.stringify(process.execPath)}\n        args: [${JSON.stringify(mcpServerPath)}]\n    - id: disabled-fixture-mcp\n      name: '@deepseek-ai/dsh-mcp-client'\n      disabled: true\n      config:\n        serverName: disabled-fixture\n        transport: stdio\n        command: ${JSON.stringify(process.execPath)}\n        args: [${JSON.stringify(mcpServerPath)}]\n`);
  const port = await availablePort(); const base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [installation.entry, '--profile', 'web', '--port', String(port), '--no-open'], {
    cwd: temp,
    // Deliberately do not inherit API keys, user HOME, project variables or configured providers.
    env: { PATH: process.env.PATH, HOME: temp, USERPROFILE: temp, XDG_CONFIG_HOME: resolve(temp, 'config'), DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1', NO_PROXY: '127.0.0.1,localhost', LANG: 'en_US.UTF-8', TERM: 'dumb' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log = (log + chunk.toString()).slice(-50000); });
  for (let attempt = 0; attempt < 180; attempt++) {
    if (child.exitCode !== null) throw new Error(`Temporary official Harness exited: ${redactWebAuth(log)}`);
    if (!cookie) cookie = (await authenticateWeb(log, base).catch(() => undefined))?.cookie || '';
    if (cookie && (await fetch(`${base}/digital-workers/api/state`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(1000) }).catch(() => null))?.ok) return base;
    await delay(250);
  }
  throw new Error(`Temporary Harness did not become ready: ${redactWebAuth(log)}`);
}

async function verifyRoleLayout(editor, discardDraft) {
  const panel = editor.locator('.wf-module-content[data-module="responsibilities"]');
  const form = panel.locator('.wf-role-definition');
  const textareas = form.locator('textarea');
  await expect(textareas).toHaveCount(3);
  const readGeometry = () => panel.evaluate(element => {
    const box = element.getBoundingClientRect(); const style = getComputedStyle(element);
    const form = element.querySelector('.wf-role-definition'); const formBox = form.getBoundingClientRect();
    const aiButton = [...form.querySelectorAll('button')].find(button => button.textContent.trim() === 'AI智填');
    const aiBox = aiButton?.getBoundingClientRect(); const firstTextarea = form.querySelector('textarea').getBoundingClientRect();
    const fields = [...form.querySelectorAll(':scope > .wf-field')].map(field => {
      const rect = field.getBoundingClientRect(); const textarea = field.querySelector('textarea'); const textRect = textarea.getBoundingClientRect();
      return { height: rect.height, textareaHeight: textRect.height, textareaBottom: textRect.bottom, top: rect.top, clientHeight: textarea.clientHeight, scrollHeight: textarea.scrollHeight };
    });
    return { availableHeight: element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom), contentTop: box.top + element.clientTop + parseFloat(style.paddingTop), contentBottom: box.top + element.clientTop + element.clientHeight - parseFloat(style.paddingBottom), formTop: formBox.top, formHeight: formBox.height, fields, aiAlignment: aiBox ? { rightDelta: aiBox.right - firstTextarea.right, bottom: aiBox.bottom, textareaTop: firstTextarea.top } : undefined };
  });
  async function verifyGeometry(name) {
    await expect(form).toBeVisible();
    await panel.evaluate(element => { element.scrollTop = 0; });
    const geometry = await readGeometry();
    const equal = (values, label) => assert.ok(Math.max(...values) - Math.min(...values) <= 2, `${name}: ${label} should be equal within 2px: ${JSON.stringify(geometry)}`);
    equal(geometry.fields.map(field => field.height), 'three field groups');
    equal(geometry.fields.map(field => field.textareaHeight), 'three textareas');
    if (geometry.availableHeight >= 328) {
      assert.ok(Math.abs(geometry.formHeight - geometry.availableHeight) <= 2, `${name}: form must fill available panel height: ${JSON.stringify(geometry)}`);
      assert.ok(Math.abs(geometry.fields[2].textareaBottom - geometry.contentBottom) <= 2, `${name}: last textarea must reach padded content bottom: ${JSON.stringify(geometry)}`);
    } else {
      assert.ok(geometry.formHeight >= 328 && geometry.formHeight > geometry.availableHeight, `${name}: short window retains a usable form with outer scrolling`);
      assert.ok(await panel.evaluate(element => element.scrollHeight > element.clientHeight), `${name}: short window must allow outer panel scrolling`);
    }
    assert.ok(Math.abs(geometry.formTop - geometry.contentTop) <= 2, `${name}: form starts at padded content top`);
    assert.ok(Math.abs(geometry.fields[2].textareaBottom - (geometry.formTop + geometry.formHeight)) <= 2, `${name}: last textarea must reach form bottom: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.fields.every(field => field.textareaHeight >= 40), `${name}: each textarea remains usable`);
    assert.ok(geometry.aiAlignment && Math.abs(geometry.aiAlignment.rightDelta) <= 1 && geometry.aiAlignment.bottom <= geometry.aiAlignment.textareaTop, `${name}: AI智填 aligns with the right edge of the first textarea on its label line: ${JSON.stringify(geometry.aiAlignment)}`);
    return geometry;
  }
  const original = await textareas.evaluateAll(elements => elements.map(element => element.value));
  const geometry = { desktop: await verifyGeometry('desktop') };
  await page.screenshot({ path: resolve(artifacts, 'employee-role-layout-desktop.png') });
  const longText = Array.from({ length: 80 }, (_, index) => `第 ${index + 1} 行：岗位规范、工作职责与可检查的边界说明。`).join('\n');
  for (let index = 0; index < 3; index++) await textareas.nth(index).fill(longText);
  await textareas.evaluateAll(elements => { for (const element of elements) element.scrollTop = 0; });
  const parentTop = await panel.evaluate(element => element.scrollTop);
  const scrollResults = [];
  for (let index = 0; index < 3; index++) {
    const textarea = textareas.nth(index);
    assert.ok(await textarea.evaluate(element => element.scrollHeight > element.clientHeight + 100), 'long text must overflow inside each textarea');
    await textarea.hover(); await page.mouse.wheel(0, 480);
    await expect.poll(() => textarea.evaluate(element => element.scrollTop), { timeout: 3000 }).toBeGreaterThan(0);
    const positions = await textareas.evaluateAll(elements => elements.map(element => element.scrollTop));
    assert.ok(positions.every((top, other) => other === index || top === 0), `textarea ${index + 1} scroll must not move another textarea: ${positions}`);
    assert.equal(await panel.evaluate(element => element.scrollTop), parentTop, 'textarea scroll must not move the panel');
    scrollResults.push(positions[index]);
    await textarea.evaluate(element => { element.scrollTop = 0; });
  }
  await page.screenshot({ path: resolve(artifacts, 'employee-role-layout-long-content.png') });
  for (let index = 0; index < 3; index++) await textareas.nth(index).fill(original[index]);
  const responsive = [{ name: 'narrow', width: 860, height: 760 }, { name: 'short', width: 1512, height: 440 }];
  for (const size of responsive) {
    await page.setViewportSize({ width: size.width, height: size.height });
    geometry[size.name] = await verifyGeometry(size.name);
    for (let index = 0; index < 3; index++) {
      const textarea = textareas.nth(index); const marker = `【${size.name}-${index + 1} 可编辑】`;
      await textarea.focus(); await textarea.press('End'); await page.keyboard.insertText(marker);
      await expect(textarea).toHaveValue(original[index] + marker);
      await textarea.fill(original[index]);
    }
    await page.screenshot({ path: resolve(artifacts, `employee-role-layout-${size.name}.png`) });
  }
  await discardDraft();
  await page.setViewportSize({ width: 1512, height: 1050 });
  return { geometry, individualScrollOffsets: scrollResults };
}

const navRowLayouts = rows => rows.evaluateAll(elements => elements.map(element => {
  const box = element.getBoundingClientRect(); const style = getComputedStyle(element);
  const label = element.querySelector(':scope > span'); const labelStyle = getComputedStyle(label);
  const range = document.createRange(); range.selectNodeContents(label);
  const labelBox = label.getBoundingClientRect(); const lineHeight = parseFloat(labelStyle.lineHeight);
  const fragments = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
  const lineCount = new Set(fragments.map(rect => Math.floor(((rect.top + rect.bottom) / 2 - labelBox.top) / lineHeight))).size;
  const icon = element.querySelector(':scope > svg');
  const iconBox = icon.getBoundingClientRect();
  return { name: label.textContent, title: element.getAttribute('title'), height: box.height,
    children: [...element.children].map(child => child.tagName.toLowerCase()), lineCount, fragmentCount: fragments.length,
    extraStatus: element.querySelectorAll('.wf-avatar, .wf-nav-label, small, .wf-small-dot').length,
    icon: { width: icon.getAttribute('width'), height: icon.getAttribute('height'), renderedWidth: Math.round(iconBox.width * 1000) / 1000, renderedHeight: Math.round(iconBox.height * 1000) / 1000, path: icon.querySelector('path').getAttribute('d') },
    style: { display: style.display, alignItems: style.alignItems, minHeight: style.minHeight, padding: style.padding, gap: style.gap,
      borderRadius: style.borderRadius, fontSize: style.fontSize, lineHeight: style.lineHeight, fontWeight: style.fontWeight,
      whiteSpace: labelStyle.whiteSpace, textOverflow: labelStyle.textOverflow, overflow: labelStyle.overflow } };
}));

try {
  await mkdir(artifacts, { recursive: true });
  const base = await startHarness();
  const get = async path => { const response = await fetch(`${base}${path}`, { headers: { Cookie: cookie } }); assert.ok(response.ok, await response.clone().text()); return response.json(); };
  const post = async (path, payload) => { const response = await fetch(`${base}${path}`, { method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); assert.ok(response.ok, await response.clone().text()); return response.json(); };
  const command = (action, payload) => post('/digital-workers/api/command', { action, payload });
  const snapshot = () => get('/digital-workers/api/state');
  const { employee, peer, team } = await seedEmployeeSettingsFixture(command, await snapshot());
  const { result: teamWithWorkflow } = await command('team.save', { id: team.id, name: team.name, description: 'TEAM_DESCRIPTION_PRESERVED_UI', knowledgeEnabled: true, members: team.members,
    workflows: [{ id: 'retained-workflow', name: '保留工作流', maxAttempts: 2, steps: [{ id: 'lead-review', name: '资料核验', memberId: 'lead', instruction: 'OFFLINE_ONLY_KEEP_WORKFLOW', outputs: ['核验记录'], acceptanceCriteria: ['注明依据'] }] }] });
  Object.assign(team, teamWithWorkflow);
  const target = { scope: 'template', employeeId: employee.id, library: 'employee' };
  const library = (value = target) => get(`/digital-workers/api/knowledge?${new URLSearchParams(value)}`);
  const wikiLibrary = (value = target) => get(`/digital-workers/api/knowledge/wiki?${new URLSearchParams(value)}`);
  const llmCalls = async () => (await readFile(llmCallsPath, 'utf8').catch(error => error.code === 'ENOENT' ? '' : Promise.reject(error))).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const sharedTarget = { ...target, library: 'team', teamId: team.id };
  const peerTarget = { ...target, employeeId: peer.id };
  const privateMarker = 'PRIVATE_ARCHITECT_SOURCE_417';
  const teamMarker = 'TEAM_SHARED_SOURCE_629';
  const peerMarker = 'PRIVATE_PEER_SOURCE_853';
  const privateDocument = Buffer.from(`# 架构项目资料\n${privateMarker}\n\n模块划分依据职责边界。\n模块划分：将系统拆分为职责明确的组成部分。\n职责边界：每个模块负责的范围。\n交付验收：核对交付结果是否达标。\n验收标准：交付前约定的判定条件。\n交付验收依据验收标准。\n适用版本：UI 离线验证。\n`);
  if (!roleLayoutOnly) {
    await post('/digital-workers/api/knowledge/upload', { target: sharedTarget, files: [{ name: '团队共享规则.md', content: `# 团队约定\n${teamMarker}\n团队资料仅在团队库整理。`, category: 'environment/constraint' }] });
    await post('/digital-workers/api/knowledge/upload', { target: peerTarget, files: [{ name: '第二员工资料.md', content: `# 第二员工\n${peerMarker}\nISOLATED_CONCEPTS_UI_916\n独立概念甲：用于描述甲类职责。\n独立概念乙：用于描述乙类职责。\n两者没有已记录的语义关系，仅供第二员工使用。` }] });
  }

  // Use the installed Chrome by default; "bundled" selects Playwright's exact
  // Chromium build when investigating browser/input compatibility.
  browser = await chromium.launch({ headless: true, ...(process.env.WORKFORCE_BROWSER_CHANNEL === 'bundled' ? { args: ['--enable-unsafe-swiftshader'] } : { channel: process.env.WORKFORCE_BROWSER_CHANNEL || 'chrome' }) });
  metrics.browser = { channel: process.env.WORKFORCE_BROWSER_CHANNEL || 'chrome', version: browser.version() };
  page = await browser.newPage({ viewport: { width: 1512, height: 1050 }, locale: 'zh-CN', colorScheme: 'dark' });
  page.on('pageerror', error => pageErrors.push(error.message));
  const acceptDialog = dialog => dialog.accept();
  page.on('dialog', acceptDialog);
  const confirmUiAction = async (message, accepted, action) => {
    page.off('dialog', acceptDialog);
    let dialog;
    try {
      const pendingDialog = page.waitForEvent('dialog');
      const clicked = action();
      dialog = await pendingDialog;
      assert.equal(dialog.type(), 'confirm'); assert.equal(dialog.message(), message);
      if (accepted) await dialog.accept(); else await dialog.dismiss();
      dialog = undefined;
      await clicked;
    } finally { await dialog?.dismiss().catch(() => {}); page.on('dialog', acceptDialog); }
  };
  const verifyRemovalColors = async (controls, context) => {
    const colors = await controls.evaluateAll(elements => {
      const scope = elements[0]?.closest('.wf-root') ?? document.body;
      const hostToken = getComputedStyle(scope).getPropertyValue('--dsw-alias-state-error-primary').trim();
      const probe = document.createElement('span');
      probe.setAttribute('aria-hidden', 'true');
      probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;color:var(--dsw-alias-state-error-primary)';
      scope.append(probe);
      const themeColor = getComputedStyle(probe).color;
      probe.remove();
      return { hostToken, themeColor, dark: matchMedia('(prefers-color-scheme: dark)').matches,
        controls: elements.map(element => ({ name: element.getAttribute('aria-label') || element.textContent.trim(), color: getComputedStyle(element).color, iconColor: element.querySelector('svg') ? getComputedStyle(element.querySelector('svg')).color : undefined })) };
    });
    assert.ok(colors.hostToken && /^rgb\(\d+, \d+, \d+\)$/.test(colors.themeColor), `${context}: the official host supplies a valid theme error token`);
    if (colors.dark) assert.equal(colors.themeColor, 'rgb(242, 90, 90)', `${context}: pinned official dark theme uses its original red`);
    assert.ok(colors.controls.length > 0 && colors.controls.every(control => control.color === colors.themeColor && (!control.iconColor || control.iconColor === colors.themeColor)), `${context}: removal buttons and icons use the exact original host theme red: ${JSON.stringify(colors)}`);
    (metrics.removalColors ??= {})[context] = colors;
    return colors;
  };
  const separator = cookie.indexOf('=');
  await page.context().addCookies([{ name: cookie.slice(0, separator), value: cookie.slice(separator + 1), url: base, httpOnly: true, sameSite: 'Strict' }]);
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  const continueButton = page.getByRole('button', { name: '继续', exact: true });
  await expect(continueButton).toBeVisible({ timeout: 20000 }); await continueButton.click();
  const later = page.getByRole('button', { name: '稍后配置', exact: true });
  if (await later.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) await later.click();
  await page.getByRole('button', { name: 'graph_horses', exact: true }).click();
  await page.getByRole('navigation', { name: '资源库', exact: true }).getByRole('button', { name: /^自由职业人库/ }).click();
  await page.locator('.wf-sidebar').getByRole('button', { name: new RegExp(employee.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
  const editor = page.locator('.wf-employee-editor');
  const discardEmployeeDraft = async () => {
    const before = await snapshot();
    const fieldsBefore = await editor.locator('.wf-role-definition textarea').evaluateAll(elements => elements.map(element => element.value));
    const peerRow = page.locator('.wf-sidebar').getByRole('button', { name: peer.name, exact: true });
    const employeeRow = page.locator('.wf-sidebar').getByRole('button', { name: employee.name, exact: true });
    await employeeRow.click();
    assert.deepEqual(await editor.locator('.wf-role-definition textarea').evaluateAll(elements => elements.map(element => element.value)), fieldsBefore, 'Reselecting the same employee keeps its current draft');
    await confirmUiAction('当前配置尚未保存，确定放弃修改？', false, () => peerRow.click());
    assert.deepEqual(await editor.locator('.wf-role-definition textarea').evaluateAll(elements => elements.map(element => element.value)), fieldsBefore, 'Cancelling navigation keeps the role draft');
    assert.deepEqual(await snapshot(), before, 'Cancelling navigation never saves or discards durable records');
    await confirmUiAction('当前配置尚未保存，确定放弃修改？', true, () => peerRow.click());
    await employeeRow.click();
    await editor.getByRole('tab', { name: '岗位定义', exact: true }).click();
    const saved = before.templates.find(template => template.id === employee.id);
    await expect(editor.getByLabel('员工名称', { exact: true })).toHaveValue(saved.name);
    await expect(editor.getByLabel('岗位角色', { exact: true })).toHaveValue(saved.modules.responsibilities.mission);
    await expect(editor.getByLabel('工作职责', { exact: true })).toHaveValue(saved.modules.responsibilities.duties.join('\n'));
    await expect(editor.getByLabel('工作规范与边界', { exact: true })).toHaveValue(saved.modules.responsibilities.boundaries.join('\n'));
    await expect(editor.getByRole('button', { name: '保存配置', exact: true })).toBeDisabled();
    assert.deepEqual(await snapshot(), before, 'Confirming discard changes no saved record');
  };
  await expect(editor.getByRole('tab')).toHaveCount(4);
  assert.deepEqual(await editor.getByRole('tab').allTextContents(), ['模型配置', '岗位定义', '能力组合', '认知记忆']);
  await expect(editor.getByRole('tab', { name: '模型配置', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(editor.locator('.wf-module-content')).toHaveAttribute('data-module', 'model');
  metrics.defaultEmployeeModule = { initial: 'model' };
  await expect(editor.getByRole('tab', { name: '权限', exact: true })).toHaveCount(0);
  await expect(editor.getByRole('tab', { name: '交付标准', exact: true })).toHaveCount(0);
  await expect(editor.locator('.wf-employee-title-row').getByRole('button', { name: '保存配置', exact: true })).toBeVisible();
  await expect(editor.locator('.wf-editor-actions')).toHaveCount(0);
  await expect(editor.getByRole('button', { name: '还原修改', exact: true })).toHaveCount(0);
  assert.deepEqual(await editor.locator('.wf-employee-actions').getByRole('button').allTextContents(), ['移除', '导入', '导出', '保存']);
  const header = await page.locator('.wf-graph-header').boundingBox();
  const title = await editor.locator('.wf-employee-title-row').boundingBox();
  assert.ok(header && header.height <= 72, `Global header should be compact: ${JSON.stringify(header)}`);
  assert.ok(title && title.height <= 52, `Employee title should be compact: ${JSON.stringify(title)}`);
  metrics.headerHeight = header.height; metrics.titleHeight = title.height;
  const employeeRows = page.locator('.wf-sidebar > .wf-employee-nav-item');
  await expect(employeeRows).toHaveCount(2);
  const employeeList = await navRowLayouts(employeeRows);
  assert.deepEqual(employeeList.map(row => row.name).sort(), [employee.name, peer.name].sort());
  assert.ok(employeeList.every(row => row.title === row.name && row.children.join(',') === 'svg,span' && row.lineCount === 1 && row.extraStatus === 0 && row.height >= 31 && row.height <= 34 && row.icon.width === '14' && row.icon.height === '14' && Math.abs(row.icon.renderedWidth - 14) <= .1 && Math.abs(row.icon.renderedHeight - 14) <= .1 && row.style.whiteSpace === 'nowrap' && row.style.textOverflow === 'ellipsis'), `Employee rows use one compact name line, an actual 14px icon, full-name tooltip and no avatar or status row: ${JSON.stringify(employeeList)}`);
  await page.screenshot({ path: resolve(artifacts, 'employee-list-compact-desktop.png') });
  await expect(page.getByRole('group', { name: '配置范围', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '刷新 graph_horses', exact: true })).toHaveCount(0);
  await page.getByRole('navigation', { name: '资源库', exact: true }).getByRole('button', { name: /^团队/ }).click();
  const teamHeading = page.locator('.wf-sidebar').getByRole('button', { name: team.name, exact: true });
  if (await teamHeading.getAttribute('aria-expanded') !== 'true') await teamHeading.click();
  const teamMemberList = page.locator(`[id=${JSON.stringify(await teamHeading.getAttribute('aria-controls'))}]`);
  const referenceRow = teamMemberList.locator('.wf-team-nav-member').first();
  await expect(referenceRow).toBeVisible();
  const [teamReference] = await navRowLayouts(referenceRow);
  assert.ok(Math.abs(teamReference.icon.renderedWidth - 14) <= .1 && Math.abs(teamReference.icon.renderedHeight - 14) <= .1, `Read-only team icons retain their actual 14px size: ${JSON.stringify(teamReference.icon)}`);
  for (const row of employeeList) {
    assert.ok(Math.abs(row.height - teamReference.height) <= 1, 'Employee and team-member rows share the same compact height');
    assert.deepEqual(row.style, teamReference.style, 'Employee rows reuse the team-member typography, spacing and single-line truncation');
    assert.deepEqual(row.icon, teamReference.icon, 'Employee rows reuse the same team-member person icon');
  }
  metrics.employeeList = { rows: employeeList, teamReference };
  await page.screenshot({ path: resolve(artifacts, 'employee-list-team-reference.png') });
  const teamEditor = page.locator('.wf-team-editor');
  const teamMembers = teamMemberList.locator('.wf-team-nav-member');
  const chartMembers = teamEditor.locator('.wf-team-org-node');
  const teamName = teamEditor.getByRole('textbox', { name: '团队名称', exact: true });
  const librarian = teamEditor.getByRole('switch', { name: '资料管理员', exact: true });
  const memberRows = teamEditor.locator('.wf-team-member-row');
  const savedTeam = async () => (await snapshot()).teams.find(item => item.id === team.id);
  const saveTeamUi = async () => {
    const response = page.waitForResponse(response => response.url().endsWith('/digital-workers/api/command') && response.request().postDataJSON()?.action === 'team.save');
    await teamEditor.getByRole('button', { name: '保存团队', exact: true }).click();
    assert.ok((await response).ok());
    await expect(teamEditor.getByRole('button', { name: '保存团队', exact: true })).toBeDisabled();
    return savedTeam();
  };
  await expect(teamEditor.locator('.wf-team-identity > span')).toHaveText('组织结构');
  await expect(teamEditor.getByRole('tab')).toHaveCount(0);
  await expect(teamEditor.locator('.wf-team-tabs, .wf-team-settings, .wf-librarian')).toHaveCount(0);
  await expect(teamEditor.getByRole('button', { name: '团队设置', exact: true })).toHaveCount(0);
  await expect(page.getByRole('group', { name: '配置范围', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '刷新 graph_horses', exact: true })).toHaveCount(0);
  for (const label of ['导入 JSON', '导出 JSON']) await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
  for (const label of ['导入', '导出']) await expect(teamEditor.locator('.wf-team-toolbar').getByRole('button', { name: label, exact: true })).toBeVisible();
  await expect(teamMembers).toHaveCount(2); await expect(chartMembers).toHaveCount(2);
  const readonlyState = elements => elements.map(element => ({ tag: element.tagName, tabIndex: element.tabIndex, interactive: element.matches('button, a, [role], [tabindex], [draggable="true"], [data-movable], [data-team-drop], [data-member-drop]'), childrenInteractive: element.querySelectorAll('button, a, input, select, textarea, [tabindex]').length }));
  for (const rows of [teamMembers, chartMembers]) {
    const states = await rows.evaluateAll(readonlyState);
    assert.ok(states.every(row => row.tag === 'DIV' && row.tabIndex === -1 && !row.interactive && row.childrenInteractive === 0), `Team members remain static, nonfocusable display elements: ${JSON.stringify(states)}`);
  }
  await expect(teamMemberList.getByRole('button')).toHaveCount(0);
  const initialTeam = await savedTeam();
  await referenceRow.click(); await chartMembers.first().click();
  await expect(page.locator('.wf-employee-editor')).toHaveCount(0);
  assert.deepEqual(await savedTeam(), initialTeam, 'Clicking read-only sidebar and chart members never opens or edits an employee');
  await teamHeading.click(); await expect(teamHeading).toHaveAttribute('aria-expanded', 'false'); await expect(referenceRow).toBeHidden();
  await teamHeading.click(); await expect(teamHeading).toHaveAttribute('aria-expanded', 'true'); await expect(referenceRow).toBeVisible();
  await expect(librarian).toHaveAttribute('aria-checked', 'true');
  const teamSwitchGeometry = async scheme => {
    const expectedColor = scheme === 'dark' ? 'rgb(173, 176, 182)' : 'rgb(105, 117, 133)';
    await expect.poll(() => librarian.evaluate(element => getComputedStyle(element).color)).toBe(expectedColor);
    const geometry = await librarian.evaluate(element => { const style = getComputedStyle(element); const track = element.querySelector('.wf-librarian-switch-track').getBoundingClientRect(); const label = element.querySelector(':scope > span:last-child').getBoundingClientRect(); return { color: style.color, fontSize: style.fontSize, height: element.getBoundingClientRect().height, trackWidth: track.width, trackHeight: track.height, switchBeforeText: track.right <= label.left, inToolbar: !!element.closest('.wf-team-toolbar') }; });
    assert.ok(geometry.inToolbar && geometry.switchBeforeText && geometry.fontSize === '12px' && geometry.height <= 28 && Math.abs(geometry.trackHeight - 11.2) < .1 && Math.abs(geometry.trackWidth - 18.2) < .1, `The librarian uses the compact gray employee-style header switch: ${JSON.stringify(geometry)}`);
    return geometry;
  };
  const teamSectionNavigation = page.getByRole('navigation', { name: '资源库', exact: true });
  const returnToTeam = async () => {
    await teamSectionNavigation.getByRole('button', { name: /^团队/ }).click();
    await teamHeading.click();
    if (await teamHeading.getAttribute('aria-expanded') !== 'true') await teamHeading.click();
    await expect(teamName).toHaveValue(team.name);
  };
  const discardTeamDraft = async () => {
    await confirmUiAction('当前配置尚未保存，确定放弃修改？', true, () => teamSectionNavigation.getByRole('button', { name: /^自由职业人库/ }).click());
    await returnToTeam();
    await expect(teamEditor.getByRole('button', { name: '保存团队', exact: true })).toBeDisabled();
  };
  const verifyTeamCompact = async (context, columnCount) => {
    const toolbar = teamEditor.locator('.wf-team-toolbar');
    await expect(toolbar.getByRole('button', { name: '移除团队', exact: true })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: '保存团队', exact: true })).toBeVisible();
    await expect(teamEditor.locator('footer, .wf-editor-actions')).toHaveCount(0);
    for (const name of ['还原修改', '添加员工']) await expect(teamEditor.getByRole('button', { name, exact: true })).toHaveCount(0);
    await expect(teamEditor.getByLabel('引入职业人 Horse', { exact: true })).toHaveCount(0);
    await expect(teamEditor.getByLabel('选择要引进人员', { exact: true })).toHaveValue('');
    await expect(teamEditor.getByLabel('选择要引进人员', { exact: true }).locator('option').first()).toHaveText('选择要引进人员');
    await expect(teamEditor.locator('.wf-team-member-add > .wf-field, .wf-team-member-add .wf-field-label')).toHaveCount(0);
    assert.deepEqual(await memberRows.first().locator('.wf-field-label').allTextContents(), ['团队岗位', '上一级']);
    const geometry = await teamEditor.evaluate(element => {
      const toolbar = element.querySelector('.wf-team-toolbar').getBoundingClientRect();
      const grid = element.querySelector('.wf-team-member-grid');
      return { toolbarHeight: toolbar.height, columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        cards: [...grid.children].map(card => { const box = card.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, height: box.height, width: box.width }; }),
        actions: [...element.querySelectorAll('.wf-team-toolbar .wf-object-header-actions > button')].map(button => ({ text: button.textContent.trim(), height: button.getBoundingClientRect().height })) };
    });
    assert.equal(geometry.columns, columnCount, `${context}: member cards use the intended column count`);
    assert.ok(geometry.cards.length === 2 && geometry.cards.every(card => card.height <= 90), `${context}: member cards remain compact: ${JSON.stringify(geometry)}`);
    if (columnCount === 2) assert.ok(Math.abs(geometry.cards[0].top - geometry.cards[1].top) <= 1 && geometry.cards[0].right < geometry.cards[1].left && Math.abs(geometry.cards[0].width - geometry.cards[1].width) <= 1 && geometry.toolbarHeight <= 72, `${context}: equal-width cards share one compact row`);
    else assert.ok(Math.abs(geometry.cards[0].left - geometry.cards[1].left) <= 1 && geometry.cards[0].bottom < geometry.cards[1].top, `${context}: narrow member cards stack without overlap`);
    const danger = toolbar.getByRole('button', { name: '移除团队', exact: true }).or(memberRows.getByRole('button', { name: /^移除岗位/ }));
    await verifyRemovalColors(danger, `team-${context}`);
    return geometry;
  };
  const switchGeometry = { dark: await teamSwitchGeometry('dark') };
  const compactGeometry = { dark: await verifyTeamCompact('dark', 2) };
  await teamName.fill(team.name + '（草稿）'); await librarian.click();
  await expect(librarian).toHaveAttribute('aria-checked', 'false');
  assert.deepEqual(await savedTeam(), initialTeam, 'Name and librarian changes remain draft until 保存团队');
  await confirmUiAction('当前配置尚未保存，确定放弃修改？', false, () => teamSectionNavigation.getByRole('button', { name: /^自由职业人库/ }).click());
  await expect(teamName).toHaveValue(team.name + '（草稿）'); await expect(librarian).toHaveAttribute('aria-checked', 'false');
  assert.deepEqual(await savedTeam(), initialTeam, 'Cancelling navigation retains the complete team draft and saved record');
  await discardTeamDraft();
  await expect(teamName).toHaveValue(team.name); await expect(librarian).toHaveAttribute('aria-checked', 'true');
  await teamName.fill(team.name + '（已保存）'); await librarian.click();
  const disabledTeam = await saveTeamUi();
  assert.equal(disabledTeam.name, team.name + '（已保存）'); assert.equal(disabledTeam.knowledgeEnabled, false);
  for (const key of ['members', 'workflows', 'description']) assert.deepEqual(disabledTeam[key], initialTeam[key], `Saving the compact switch preserves ${key}`);
  await teamName.fill(team.name); await librarian.click();
  const restoredTeam = await saveTeamUi();
  assert.equal(restoredTeam.name, team.name); assert.equal(restoredTeam.knowledgeEnabled, true);
  for (const key of ['members', 'workflows', 'description']) assert.deepEqual(restoredTeam[key], initialTeam[key]);
  const referencedRoleRemoval = memberRows.nth(0).getByRole('button', { name: /^移除岗位/ });
  await expect(referencedRoleRemoval).toBeEnabled();
  await referencedRoleRemoval.click();
  const removalDialog = page.getByRole('dialog', { name: '移除团队岗位', exact: true });
  await expect(removalDialog).toBeVisible();
  await expect(removalDialog.getByLabel('步骤接手人', { exact: true })).toBeVisible();
  await removalDialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(removalDialog).toHaveCount(0);
  assert.deepEqual(await savedTeam(), restoredTeam, 'Cancelling workflow handover preserves the team, workflow, and all saved fields');
  await memberRows.nth(1).getByLabel('团队岗位', { exact: true }).fill('QA-团队岗位草稿');
  await memberRows.nth(1).getByLabel('上一级', { exact: true }).selectOption('');
  await expect(teamEditor.locator('.wf-team-org-node[title="QA-团队岗位草稿 · 第 1 级"]')).toHaveCount(1);
  const removePeer = memberRows.nth(1).getByRole('button', { name: /^移除岗位/ });
  await confirmUiAction('确定移除团队岗位“QA-团队岗位草稿”？', false, () => removePeer.click());
  await expect(memberRows).toHaveCount(2); await expect(memberRows.nth(1).getByLabel('团队岗位', { exact: true })).toHaveValue('QA-团队岗位草稿');
  assert.deepEqual(await savedTeam(), restoredTeam, 'Cancelling role removal retains draft members and every saved team field');
  await confirmUiAction('确定移除团队岗位“QA-团队岗位草稿”？', true, () => removePeer.click());
  await expect(memberRows).toHaveCount(1);
  assert.deepEqual(await savedTeam(), restoredTeam, 'Confirmed role removal stays draft until the header save');
  const removedPeerTeam = await saveTeamUi();
  assert.deepEqual(removedPeerTeam.members, restoredTeam.members.filter(member => member.memberId !== 'peer'));
  for (const key of ['workflows', 'description', 'knowledgeEnabled']) assert.deepEqual(removedPeerTeam[key], restoredTeam[key]);
  await teamEditor.getByLabel('选择要引进人员', { exact: true }).selectOption(peer.id);
  await teamEditor.getByRole('button', { name: '引入团队', exact: true }).click(); await expect(memberRows).toHaveCount(2);
  await memberRows.nth(1).getByLabel('上一级', { exact: true }).selectOption('lead');
  assert.deepEqual(await savedTeam(), removedPeerTeam, 'Importing and reporting edits remain draft after a confirmed removal was saved');
  await discardTeamDraft();
  await expect(memberRows).toHaveCount(1);
  const { result: resetMemberTeam } = await command('team.save', { ...removedPeerTeam, members: initialTeam.members });
  assert.deepEqual(resetMemberTeam.members, initialTeam.members);
  await teamSectionNavigation.getByRole('button', { name: /^自由职业人库/ }).click();
  await page.locator('.wf-sidebar').getByRole('button', { name: '新建自由职业人', exact: true }).click();
  await expect(editor.getByRole('tab', { name: '模型配置', exact: true })).toHaveAttribute('aria-selected', 'true');
  await editor.getByLabel('员工名称', { exact: true }).fill('QA-Team-New-Employee');
  await editor.getByRole('tab', { name: '岗位定义', exact: true }).click();
  await editor.getByLabel('岗位角色', { exact: true }).fill('验证从职业人库新建后引入团队。');
  await editor.getByLabel('工作职责', { exact: true }).fill('检查成员配置、引入与保存。');
  const newEmployeeSaved = page.waitForResponse(response => response.url().endsWith('/digital-workers/api/command') && response.request().postDataJSON()?.action === 'employee.configuration.save');
  await editor.getByRole('button', { name: '保存配置', exact: true }).click(); assert.ok((await newEmployeeSaved).ok());
  await expect(editor.getByRole('button', { name: '保存配置', exact: true })).toBeDisabled();
  const newTemplate = (await snapshot()).templates.find(item => item.name === 'QA-Team-New-Employee');
  assert.ok(newTemplate);
  await returnToTeam();
  await expect(memberRows).toHaveCount(2);
  await expect(memberRows.nth(1).getByLabel('团队岗位', { exact: true })).toHaveValue(peer.name);
  await expect(memberRows.nth(1).getByLabel('上一级', { exact: true })).toHaveValue('lead');
  await teamEditor.getByLabel('选择要引进人员', { exact: true }).selectOption(newTemplate.id);
  await teamEditor.getByRole('button', { name: '引入团队', exact: true }).click(); await expect(memberRows).toHaveCount(3);
  assert.deepEqual(await savedTeam(), resetMemberTeam, 'Newly created employees are only draft team members until 保存团队');
  const withNewMember = await saveTeamUi();
  assert.ok(withNewMember.members.some(member => member.templateId === newTemplate.id));
  await expect(teamMembers).toHaveCount(3);
  await confirmUiAction('确定移除团队岗位“QA-Team-New-Employee”？', true, () => memberRows.last().getByRole('button', { name: /^移除岗位/ }).click());
  assert.deepEqual(await savedTeam(), withNewMember, 'Removing an imported role still requires the header save');
  const cleanedTeam = await saveTeamUi();
  assert.deepEqual(cleanedTeam.members, initialTeam.members); assert.deepEqual(cleanedTeam.workflows, initialTeam.workflows);
  await command('template.archive', { id: newTemplate.id });
  await teamEditor.locator('.wf-team-content').evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: resolve(artifacts, 'team-page-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' }); await settleVisualState(); switchGeometry.light = await teamSwitchGeometry('light'); compactGeometry.light = await verifyTeamCompact('light', 2);
  await page.screenshot({ path: resolve(artifacts, 'team-page-light.png') });
  await page.setViewportSize({ width: 860, height: 900 }); await page.emulateMedia({ colorScheme: 'dark' }); await settleVisualState();
  switchGeometry.narrow = await teamSwitchGeometry('dark'); compactGeometry.narrow = await verifyTeamCompact('narrow', 1); await page.screenshot({ path: resolve(artifacts, 'team-page-narrow.png') });
  await page.setViewportSize({ width: 1512, height: 440 });
  switchGeometry.short = await teamSwitchGeometry('dark'); compactGeometry.short = await verifyTeamCompact('short', 2); await expect(teamEditor.getByRole('button', { name: '保存团队', exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(artifacts, 'team-page-short.png') });
  await page.setViewportSize({ width: 1512, height: 1050 });
  metrics.teamPage = { staticSidebarAndChart: true, collapsibleTeamHeading: true, noTabsGearOrLargeLibrarian: true, subtitle: '组织结构', globalScopeAndToolsRemoved: true, objectImportExportRetained: true, switchDraftSaveDiscard: true, navigationCancelRetainsDraft: true, memberRemovalCancelAndConfirmedSave: true, memberNameImportRemoveReportingDiscarded: true, workflowAndDescriptionPreserved: true, newEmployeeCreatedInLibraryAndImported: true, switchGeometry, compactGeometry };
  if (!roleLayoutOnly) await expect.poll(async () => (await library(sharedTarget)).status.state, { timeout: 20000 }).toBe('ready');
  await page.getByRole('navigation', { name: '资源库', exact: true }).getByRole('button', { name: /^自由职业人库/ }).click();
  await expect(page.getByRole('group', { name: '配置范围', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '刷新 graph_horses', exact: true })).toHaveCount(0);
  metrics.teamPage.objectHeadersWithoutGlobalScopeAndTools = true;
  await page.locator('.wf-sidebar').getByRole('button', { name: employee.name, exact: true }).click();
  await expect(editor.getByRole('tab', { name: '模型配置', exact: true })).toHaveAttribute('aria-selected', 'true');
  await editor.getByRole('tab', { name: '岗位定义', exact: true }).click();
  metrics.roleLayout = await verifyRoleLayout(editor, discardEmployeeDraft);

  if (roleLayoutOnly) {
    assert.deepEqual(pageErrors, [], 'No uncaught browser errors');
    assert.equal(await hostHash(), baseline, 'Official host entry and manifest unchanged');
    await writeFile(resolve(artifacts, 'employee-role-layout-result.json'), JSON.stringify({ status: 'passed', officialHarness: installation.manifest, hostEntryAndManifestSha256: baseline, metrics, checks: ['equal-field-groups', 'equal-textareas', 'fill-available-panel-height', 'three-independent-scrolls', 'narrow-editable', 'short-window-editable', 'no-page-errors'] }, null, 2));
    console.log('PASS: employee role definition fills its panel equally, scrolls independently, and stays editable in narrow and short windows.');
  } else {

  const rolePanel = editor.locator('.wf-module-content[data-module="responsibilities"]');
  const roleFields = rolePanel.locator('textarea');
  const aiFill = rolePanel.getByRole('button', { name: 'AI智填', exact: true });
  const roleValues = () => roleFields.evaluateAll(elements => elements.map(element => element.value));
  const roleCalls = async () => (await llmCalls()).filter(call => call.stage === 'role-draft');
  const roleEndpoint = '**/digital-workers/api/employee-role-draft';
  const roleStateBefore = structuredClone(await snapshot());
  let roleRequests = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/digital-workers/api/employee-role-draft')) roleRequests++; });
  await expect(aiFill).toBeEnabled();
  await editor.getByRole('tab', { name: '模型配置', exact: true }).click();
  const reasoningOption = editor.locator('.wf-model-option').filter({ hasText: '岗位智填验证模型' }).getByRole('radio');
  await expect(reasoningOption).toHaveValue(JSON.stringify(['employee-settings-fixture', 'offline-role-reasoning']));
  await reasoningOption.check();
  await editor.getByLabel('推理强度', { exact: true }).selectOption('high');
  await editor.getByRole('tab', { name: '岗位定义', exact: true }).click();
  const firstRoleResponse = page.waitForResponse(response => response.url().endsWith('/digital-workers/api/employee-role-draft'));
  await aiFill.click();
  assert.ok((await firstRoleResponse).ok());
  await expect(roleFields.nth(0)).toHaveValue(employee.name + '：负责将需求转化为可核验的岗位成果。');
  await expect(roleFields.nth(1)).toHaveValue('澄清目标与输入条件。\n完成专业分析并提交可检查的结果。');
  await expect(roleFields.nth(2)).toHaveValue('重要决定由用户确认。\n资料不足时说明不确定性，不编造事实。');
  assert.deepEqual(await roleCalls(), [{ stage: 'role-draft', name: employee.name, provider: 'employee-settings-fixture', model: 'offline-role-reasoning', reasoningEffort: 'high' }], 'One request uses the unsaved employee model and reasoning selection');
  assert.deepEqual(await snapshot(), roleStateBefore, 'AI filling only changes the editor draft, never saved employees, runs or sessions');
  const generatedValues = await roleValues();
  await page.screenshot({ path: resolve(artifacts, 'employee-role-ai-filled.png') });
  const saveRole = page.waitForResponse(response => response.url().endsWith('/digital-workers/api/command') && response.request().postDataJSON()?.action === 'employee.configuration.save');
  await editor.getByRole('button', { name: '保存配置', exact: true }).click();
  assert.ok((await saveRole).ok());
  await expect(editor.getByRole('button', { name: '保存配置', exact: true })).toBeDisabled();
  const roleStateSaved = await snapshot();
  const roleSaved = roleStateSaved.templates.find(item => item.id === employee.id);
  assert.equal(roleSaved.modules.responsibilities.mission, generatedValues[0]);
  assert.equal(roleSaved.modules.responsibilities.duties.join('\n'), generatedValues[1]);
  assert.equal(roleSaved.modules.responsibilities.boundaries.join('\n'), generatedValues[2]);
  assert.equal(roleSaved.modules.model.reasoningEffort, 'high');

  const employeeName = editor.getByRole('textbox', { name: '员工名称', exact: true });
  await employeeName.fill('');
  const requestsBeforeEmpty = roleRequests;
  await expect(aiFill).toBeDisabled();
  await delay(100);
  assert.equal(roleRequests, requestsBeforeEmpty, 'An empty employee name cannot submit a role request');
  await employeeName.fill('ROLE_DRAFT_ERROR_UI');
  const failedRole = page.waitForResponse(response => response.url().endsWith('/digital-workers/api/employee-role-draft'));
  await aiFill.click();
  assert.equal((await failedRole).status(), 503);
  await expect(rolePanel.getByRole('alert')).toBeVisible();
  await expect(rolePanel).not.toContainText('OFFLINE_ROLE_DRAFT_ERROR_PRIVATE_DETAIL');
  assert.deepEqual(await roleValues(), generatedValues, 'A failed role model response preserves all previous fields');
  await employeeName.fill(employee.name);
  await aiFill.click();
  await expect(aiFill).toBeEnabled();
  await expect(rolePanel.getByRole('alert')).toHaveCount(0);
  assert.deepEqual(await roleValues(), generatedValues, 'The user can retry the same draft after failure');
  await discardEmployeeDraft();

  // Hold real offline-model responses after dispatch. Editing the input while a
  // response is in flight must invalidate it, even if the transport returns late.
  const staleResults = [];
  for (const changeKind of ['name', 'model', 'responsibility', 'employee']) {
    await editor.getByRole('tab', { name: '岗位定义', exact: true }).click();
    await employeeName.fill(`ROLE_DRAFT_SLOW_UI_${changeKind}`);
    const before = await roleValues(); const beforeRequests = roleRequests;
    let releaseResponse;
    const responseGate = new Promise(done => { releaseResponse = done; });
    let modelResponded;
    const dispatched = new Promise(done => { modelResponded = done; });
    const holdRole = async route => {
      const response = await route.fetch();
      modelResponded();
      await responseGate;
      await route.fulfill({ response }).catch(() => {});
    };
    await page.route(roleEndpoint, holdRole);
    const buttonBox = await aiFill.boundingBox(); assert.ok(buttonBox);
    await page.mouse.click(buttonBox.x + buttonBox.width / 2, buttonBox.y + buttonBox.height / 2);
    await expect(aiFill).toBeDisabled();
    await page.mouse.click(buttonBox.x + buttonBox.width / 2, buttonBox.y + buttonBox.height / 2);
    assert.equal(roleRequests, beforeRequests + 1, 'A second click while pending never sends another model request');
    const cancelledRequest = page.waitForEvent('requestfailed', { predicate: request => request.url().endsWith('/digital-workers/api/employee-role-draft'), timeout: 5000 });
    if (changeKind === 'name') await employeeName.fill(employee.name);
    if (changeKind === 'model') {
      await editor.getByRole('tab', { name: '模型配置', exact: true }).click();
      const plainOption = editor.locator('.wf-model-option').filter({ hasText: '离线验证模型' }).getByRole('radio');
      await expect(plainOption).toHaveValue(JSON.stringify(['employee-settings-fixture', 'offline']));
      await plainOption.check();
      await editor.getByRole('tab', { name: '岗位定义', exact: true }).click();
    }
    if (changeKind === 'responsibility') await roleFields.nth(1).fill('用户手动调整的工作职责');
    if (changeKind === 'employee') {
      await page.locator('.wf-sidebar').getByRole('button', { name: new RegExp(peer.name) }).click();
      await expect(editor.getByRole('tab', { name: '模型配置', exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(editor.locator('.wf-module-content')).toHaveAttribute('data-module', 'model');
      metrics.defaultEmployeeModule.afterPeerSwitch = 'model';
      await editor.getByRole('tab', { name: '岗位定义', exact: true }).click();
    }
    const expected = changeKind === 'employee' ? await roleValues() : changeKind === 'responsibility' ? [before[0], '用户手动调整的工作职责', before[2]] : before;
    await dispatched;
    releaseResponse();
    await page.unroute(roleEndpoint, holdRole);
    assert.ok((await cancelledRequest).failure(), `Changing ${changeKind} aborts the in-flight browser request`);
    await delay(150);
    assert.deepEqual(await roleValues(), expected, `A late result cannot overwrite a changed ${changeKind} draft`);
    await expect(aiFill).toBeEnabled();
    staleResults.push(changeKind);
    if (changeKind === 'employee') {
      await page.locator('.wf-sidebar').getByRole('button', { name: new RegExp(employee.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
      await expect(editor.getByRole('tab', { name: '模型配置', exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(editor.locator('.wf-module-content')).toHaveAttribute('data-module', 'model');
      metrics.defaultEmployeeModule.afterReturnSwitch = 'model';
      await editor.getByRole('tab', { name: '岗位定义', exact: true }).click();
      assert.deepEqual(await roleValues(), generatedValues, 'Confirming the employee switch discards its unsaved role draft');
      await expect(editor.getByRole('button', { name: '保存配置', exact: true })).toBeDisabled();
    } else {
      await discardEmployeeDraft();
    }
  }
  const defaultRole = await post('/digital-workers/api/employee-role-draft', { name: '继承默认模型验证', model: { mode: 'inherit' } });
  assert.ok(defaultRole.responsibilities.mission.startsWith('继承默认模型验证：'));
  assert.deepEqual((await roleCalls()).at(-1), { stage: 'role-draft', name: '继承默认模型验证', provider: 'employee-settings-fixture', model: 'offline' });
  const beforeMissingModel = (await roleCalls()).length;
  const missingRoleModel = await fetch(`${base}/digital-workers/api/employee-role-draft`, { method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: employee.name, model: { mode: 'override', provider: 'employee-settings-fixture' } }) });
  assert.equal(missingRoleModel.status, 400);
  assert.equal((await roleCalls()).length, beforeMissingModel, 'Missing explicit models fail before model dispatch');
  assert.deepEqual(await snapshot(), roleStateSaved, 'Retries, errors, cancellations and default-model drafts never change saved state, runs or sessions');
  metrics.roleAi = { draftOnlyUntilSave: true, persistedAfterExplicitSave: true, unsavedModel: 'offline-role-reasoning', reasoningEffort: 'high', nativeCallsPerGeneration: 1, defaultRoute: 'offline', emptyNameNoRequests: true, missingModelNoCalls: true, failurePreservesFieldsAndRetries: true, pendingDoubleClickBlocked: true, lateResultsIsolated: staleResults };

  await editor.getByRole('tab', { name: '能力组合', exact: true }).click();
  const capabilities = editor.getByRole('region', { name: '能力组合', exact: true });
  assert.deepEqual(await capabilities.locator('.wf-capability-group h3').allTextContents(), ['必备 Skill（每次任务）', '优先 Skill', '优先插件', '优先 MCP']);
  await expect(capabilities.locator('textarea, select, details')).toHaveCount(0);
  const required = editor.getByRole('region', { name: '必备 Skill', exact: true });
  const preferred = editor.getByRole('region', { name: '优先 Skill', exact: true });
  await expect(required).toContainText('architecture-analysis');
  await expect(preferred).toContainText('architecture-design');
  await expect(required.locator('.wf-capability-source')).toHaveText('随包提供');
  await expect(preferred.locator('.wf-capability-source')).toHaveText('随包提供');
  assert.equal((await snapshot()).templates.find(item => item.id === employee.id).modules.capabilities.skills[0].name, '架构分析', 'Rendering a canonical name does not rewrite saved aliases');
  await preferred.getByRole('button', { name: '移除 architecture-design', exact: true }).click();
  await expect(preferred.locator('.wf-capability-selection-row')).toHaveCount(0);
  await required.getByRole('button', { name: '添加必备 Skill', exact: true }).click();
  let picker = page.getByRole('dialog', { name: '添加必备 Skill', exact: true });
  await picker.getByRole('button', { name: '添加 architecture-design', exact: true }).click();
  await expect(required).toContainText('architecture-design');
  await required.getByRole('button', { name: '移除 architecture-design', exact: true }).click();
  await preferred.getByRole('button', { name: '添加优先 Skill', exact: true }).click();
  picker = page.getByRole('dialog', { name: '添加优先 Skill', exact: true });
  await picker.getByRole('button', { name: '添加 architecture-design', exact: true }).click();
  const pluginGroup = capabilities.getByRole('region', { name: '优先插件', exact: true });
  await pluginGroup.getByRole('button', { name: '添加优先插件', exact: true }).click();
  picker = page.getByRole('dialog', { name: '添加优先插件', exact: true });
  await picker.getByRole('searchbox', { name: '搜索已安装能力', exact: true }).fill('dsh-plugin-employee-settings-fixture');
  const catalog = await get('/digital-workers/api/capabilities');
  const pluginOption = catalog.plugins.find(item => item.id === 'dsh-plugin-employee-settings-fixture');
  assert.ok(pluginOption?.available, JSON.stringify(catalog));
  await picker.getByRole('button', { name: `添加 ${pluginOption.name}`, exact: true }).click();
  await expect(pluginGroup.locator('.wf-capability-selection-row')).toHaveCount(1);
  await pluginGroup.getByRole('button', { name: `移除 ${pluginOption.name}`, exact: true }).click();
  await pluginGroup.getByRole('button', { name: '添加优先插件', exact: true }).click();
  picker = page.getByRole('dialog', { name: '添加优先插件', exact: true });
  await picker.getByRole('searchbox', { name: '搜索已安装能力', exact: true }).fill(pluginOption.id);
  await picker.getByRole('button', { name: `添加 ${pluginOption.name}`, exact: true }).click();
  const mcpGroup = capabilities.getByRole('region', { name: '优先 MCP', exact: true });
  await mcpGroup.getByRole('button', { name: '添加优先 MCP', exact: true }).click();
  picker = page.getByRole('dialog', { name: '添加优先 MCP', exact: true });
  await expect(picker.getByRole('button', { name: '接入说明 disabled-fixture', exact: true })).toBeEnabled();
  await picker.getByRole('button', { name: '接入说明 disabled-fixture', exact: true }).click();
  await expect(picker.getByRole('region', { name: 'MCP 接入说明', exact: true })).toContainText('cordis.patch.yml');
  await picker.getByRole('button', { name: '返回 MCP 列表', exact: true }).click();
  await picker.getByRole('button', { name: '添加 employee-fixture__docs', exact: true }).click();
  await mcpGroup.getByRole('button', { name: '移除 employee-fixture__docs', exact: true }).click();
  await mcpGroup.getByRole('button', { name: '添加优先 MCP', exact: true }).click();
  picker = page.getByRole('dialog', { name: '添加优先 MCP', exact: true });
  await picker.getByRole('searchbox', { name: '搜索已安装能力', exact: true }).fill('employee-fixture__docs');
  await picker.getByRole('button', { name: '添加 employee-fixture__docs', exact: true }).click();
  await mcpGroup.getByRole('button', { name: '添加优先 MCP', exact: true }).click();
  picker = page.getByRole('dialog', { name: '添加优先 MCP', exact: true });
  await expect(picker.getByRole('button', { name: '已添加 employee-fixture__docs', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(mcpGroup.getByRole('button', { name: '添加优先 MCP', exact: true })).toBeFocused();
  const returnToEmployee = async () => {
    await page.getByRole('button', { name: 'graph_horses', exact: true }).click();
    await page.getByRole('navigation', { name: '资源库', exact: true }).getByRole('button', { name: /^自由职业人库/ }).click();
    await page.locator('.wf-sidebar').getByRole('button', { name: new RegExp(employee.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
    await editor.getByRole('tab', { name: '能力组合', exact: true }).click();
    await expect(pluginGroup).toContainText(pluginOption.name);
    await expect(mcpGroup).toContainText('employee-fixture__docs');
    await expect(editor.getByRole('button', { name: '保存配置', exact: true })).toBeEnabled();
  };
  await pluginGroup.getByRole('button', { name: '添加优先插件', exact: true }).click();
  picker = page.getByRole('dialog', { name: '添加优先插件', exact: true });
  await picker.getByRole('searchbox', { name: '搜索已安装能力', exact: true }).fill('dsh-plugin-employee-disabled-fixture');
  await picker.getByRole('button', { name: '去启用 dsh-plugin-employee-disabled-fixture', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '添加优先插件', exact: true })).toHaveCount(0);
  await expect(page.getByRole('switch', { name: '启用 dsh-plugin-employee-disabled-fixture', exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(artifacts, 'employee-settings-native-plugin-detail.png') });
  await returnToEmployee();
  await mcpGroup.getByRole('button', { name: '添加优先 MCP', exact: true }).click();
  picker = page.getByRole('dialog', { name: '添加优先 MCP', exact: true });
  await picker.getByRole('button', { name: '去配置 bundle-disabled-fixture', exact: true }).click();
  await expect(page.getByRole('switch', { name: '启用 dsh-plugin-employee-settings-fixture', exact: true })).toBeVisible();
  await returnToEmployee();
  await pluginGroup.getByRole('button', { name: '添加优先插件', exact: true }).click();
  picker = page.getByRole('dialog', { name: '添加优先插件', exact: true });
  await picker.getByRole('button', { name: '在 DSH 中添加插件', exact: true }).click();
  await expect(page.getByRole('button', { name: '添加插件', exact: true })).toBeVisible();
  await returnToEmployee();
  const saved = page.waitForResponse(response => response.url().endsWith('/digital-workers/api/command') && response.request().postDataJSON()?.action === 'employee.configuration.save');
  await editor.getByRole('button', { name: '保存配置', exact: true }).click();
  assert.ok((await saved).ok());
  await expect(editor.getByRole('button', { name: '保存配置', exact: true })).toBeDisabled();
  const savedEmployee = (await snapshot()).templates.find(item => item.id === employee.id);
  assert.equal(savedEmployee.modules.capabilities.skills.find(item => item.id === 'architecture-analysis').usage, 'required');
  assert.equal(savedEmployee.modules.capabilities.skills.find(item => item.id === 'architecture-design').usage, 'preferred');
  assert.equal(savedEmployee.modules.capabilities.skills.find(item => item.id === 'architecture-analysis').name, '架构分析', 'Untouched legacy alias is preserved');
  assert.equal(savedEmployee.modules.capabilities.skills.find(item => item.id === 'architecture-design').name, 'architecture-design', 'Reselection stores the real DSH name');
  assert.equal(savedEmployee.modules.capabilities.plugins[0].id, 'dsh-plugin-employee-settings-fixture');
  assert.equal(savedEmployee.modules.capabilities.mcps[0].id, 'employee-fixture__docs');
  assert.deepEqual(savedEmployee.modules.capabilities.tools, employee.modules.capabilities.tools, 'Legacy tool preferences survive the UI replacement');
  await editor.getByRole('tab', { name: '岗位定义', exact: true }).click();
  await editor.getByRole('tab', { name: '能力组合', exact: true }).click();
  await expect(mcpGroup).toContainText('employee-fixture__docs');
  await expect(pluginGroup).toContainText(pluginOption.name);
  await expect(required.locator('.wf-capability-source')).toHaveText('随包提供');
  await expect(preferred.locator('.wf-capability-source')).toHaveText('随包提供');
  await verifyRemovalColors(capabilities.getByRole('button', { name: /^移除 / }), 'capabilities-dark');
  await page.screenshot({ path: resolve(artifacts, 'employee-settings-capabilities-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  await settleVisualState();
  await verifyRemovalColors(capabilities.getByRole('button', { name: /^移除 / }), 'capabilities-light');
  await page.screenshot({ path: resolve(artifacts, 'employee-settings-capabilities-light.png') });
  await page.setViewportSize({ width: 680, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(mcpGroup.getByRole('button', { name: '添加优先 MCP', exact: true })).toBeVisible();
  await mcpGroup.getByRole('button', { name: '添加优先 MCP', exact: true }).click();
  picker = page.getByRole('dialog', { name: '添加优先 MCP', exact: true });
  const pickerBounds = await picker.boundingBox(); assert.ok(pickerBounds && pickerBounds.width <= 680);
  await page.screenshot({ path: resolve(artifacts, 'employee-settings-capability-picker-narrow.png') });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1512, height: 1050 });

  await editor.getByRole('tab', { name: '认知记忆', exact: true }).click();
  const knowledge = editor.getByRole('region', { name: '认知记忆', exact: true });
  const categories = knowledge.locator('.wf-knowledge-category');
  await expect(categories).toHaveCount(4);
  assert.deepEqual(await categories.locator('strong').allTextContents(), ['专业知识', '任务档案', '复盘经验', '工作约束']);
  await expect(knowledge.getByRole('group', { name: '认知分类', exact: true }).getByRole('button')).toHaveCount(1);
  assert.deepEqual(await categories.evaluateAll(elements => elements.map(element => ({ tag: element.tagName, focusable: element.hasAttribute('tabindex') }))), Array.from({ length: 4 }, () => ({ tag: 'DIV', focusable: false })));
  await expect(categories.getByRole('switch')).toHaveCount(3);
  await expect(categories.getByRole('button', { name: '上传资料', exact: true })).toHaveCount(1);
  assert.deepEqual(await categories.getByRole('switch').allTextContents(), Array.from({ length: 3 }, () => '自动归档'));
  await expect(categories.locator('small, p, .wf-knowledge-category-description')).toHaveCount(0);
  await expect(knowledge.locator('.wf-knowledge-toolbar, .wf-knowledge-navigation, .wf-knowledge-processing, .wf-knowledge-settings')).toHaveCount(0);
  await expect(knowledge.locator('select, details')).toHaveCount(0);
  const verifyKnowledgeGeometry = async name => {
    const flow = knowledge.locator('.wf-knowledge-flow');
    await expect(flow).toHaveText('影子员工资料管理：A 原始资料 > B 知识重组 > C 概念综述');
    await expect(flow).toBeVisible();
    await settleVisualState();
    const sizes = await knowledge.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const browserElement = element.querySelector('.wf-knowledge-browser');
      const browser = browserElement.getBoundingClientRect();
      const flow = element.querySelector('.wf-knowledge-flow');
      const flowBox = flow.getBoundingClientRect();
      const flowStyle = getComputedStyle(flow);
      const flowRange = document.createRange(); flowRange.selectNodeContents(flow);
      const flowLayout = { top: flowBox.top, bottom: flowBox.bottom, height: flowBox.height, fontSize: flowStyle.fontSize, lineHeight: flowStyle.lineHeight,
        lineCount: flowRange.getClientRects().length, followsGraph: browserElement.nextElementSibling === flow, gap: parseFloat(getComputedStyle(element).rowGap) || 0 };
      const cardBoxes = [...element.querySelectorAll('.wf-knowledge-category')].map(card => card.getBoundingClientRect());
      const categoryFontSizes = [...element.querySelectorAll('.wf-knowledge-category > strong')].map(label => getComputedStyle(label).fontSize);
      const archiveFontSizes = [...element.querySelectorAll('.wf-knowledge-archive > span:last-child')].map(label => getComputedStyle(label).fontSize);
      const switchTrackHeights = [...element.querySelectorAll('.wf-knowledge-switch-track')].map(track => track.getBoundingClientRect().height);
      const archiveLayouts = [...element.querySelectorAll('.wf-knowledge-archive')].map(group => {
        const card = group.closest('.wf-knowledge-category'); const cardBox = card.getBoundingClientRect(); const cardStyle = getComputedStyle(card);
        const trackBox = group.querySelector('.wf-knowledge-switch-track').getBoundingClientRect();
        const labelBox = group.querySelector(':scope > span:last-child').getBoundingClientRect(); const groupBox = group.getBoundingClientRect();
        const innerRight = cardBox.right - parseFloat(cardStyle.borderRightWidth) - parseFloat(cardStyle.paddingRight);
        return { trackLeft: trackBox.left, trackRight: trackBox.right, labelLeft: labelBox.left, labelRight: labelBox.right, groupRight: groupBox.right, cardInnerRight: innerRight, rightGap: innerRight - groupBox.right };
      });
      return { height: rect.height, bottom: rect.bottom, mainHeight: browser.height, mainBottom: browser.bottom, cardHeights: cardBoxes.map(card => card.height), mainTop: browser.top, categoriesBottom: Math.max(...cardBoxes.map(card => card.bottom)), categoryFontSizes, archiveFontSizes, switchTrackHeights, archiveLayouts, flow: flowLayout };
    });
    assert.ok(sizes.cardHeights.every(height => height >= 32 && height <= 54), `${name}: category cards remain compact: ${JSON.stringify(sizes)}`);
    assert.ok(sizes.mainHeight >= sizes.height - 66 - sizes.flow.height - sizes.flow.gap, `${name}: knowledge display receives remaining space after its single-line footer: ${JSON.stringify(sizes)}`);
    assert.ok(sizes.categoriesBottom <= sizes.mainTop, `${name}: all four categories appear above the graph: ${JSON.stringify(sizes)}`);
    assert.deepEqual(sizes.categoryFontSizes, Array(4).fill('14px'), `${name}: all category names use the larger readable text`);
    assert.deepEqual(sizes.archiveFontSizes, Array(3).fill('12px'), `${name}: archive prompts use readable supporting text`);
    assert.ok(sizes.switchTrackHeights.length === 3 && sizes.switchTrackHeights.every(height => Math.abs(height - 11.2) <= .1), `${name}: switches use the requested reduced track height: ${JSON.stringify(sizes.switchTrackHeights)}`);
    assert.ok(sizes.archiveLayouts.length === 3 && sizes.archiveLayouts.every(layout => layout.trackRight <= layout.labelLeft && Math.abs(layout.rightGap) <= 1), `${name}: each archive control keeps its switch left of the text and aligns the full group with the card's inner right edge: ${JSON.stringify(sizes.archiveLayouts)}`);
    assert.ok(sizes.flow.followsGraph && sizes.flow.top >= sizes.mainBottom - 1 && sizes.flow.bottom <= sizes.bottom + 1, `${name}: the visible flow explanation directly follows the graph: ${JSON.stringify(sizes.flow)}`);
    assert.equal(sizes.flow.lineCount, 1, `${name}: the flow explanation remains on one line`);
    assert.ok(sizes.flow.height >= 17 && sizes.flow.height <= 20, `${name}: the flow explanation stays compact`);
    assert.equal(sizes.flow.fontSize, '11px');
    assert.equal(sizes.flow.lineHeight, '18px');
    return sizes;
  };
  metrics.knowledgeLayout = { desktop: await verifyKnowledgeGeometry('desktop') };
  await expect.poll(async () => (await library()).status.state, { timeout: 20000 }).toBe('ready');
  const archiveEndpoint = '**/digital-workers/api/knowledge/archive-policy';
  const taskArchive = knowledge.getByRole('switch', { name: '任务档案自动归档', exact: true });
  const automatic = knowledge.getByRole('switch');
  const beforeArchivePolicy = await library();
  const callsBeforeArchivePolicy = (await llmCalls()).length;
  const sourcesBeforeArchivePolicy = beforeArchivePolicy.sources.map(source => ({ id: source.id, version: source.version, hash: source.hash }));
  let releasePolicy;
  const policyRelease = new Promise(done => { releasePolicy = done; });
  let policyCommitted;
  const policyCommit = new Promise(done => { policyCommitted = done; });
  const delayedPolicy = async route => { const response = await route.fetch(); policyCommitted(); await policyRelease; await route.fulfill({ response }); };
  await page.route(archiveEndpoint, delayedPolicy);
  await taskArchive.click();
  await policyCommit;
  await expect(taskArchive).toHaveAttribute('aria-busy', 'true');
  await expect(taskArchive).toHaveAttribute('aria-checked', 'true');
  for (const control of await automatic.all()) await expect(control).toBeDisabled();
  releasePolicy();
  await expect(taskArchive).toHaveAttribute('aria-checked', 'false');
  await expect(taskArchive).toBeEnabled();
  await page.unroute(archiveEndpoint, delayedPolicy);
  const reopenEmployee = async name => {
    await page.getByRole('button', { name: 'graph_horses', exact: true }).click();
    await page.getByRole('navigation', { name: '资源库', exact: true }).getByRole('button', { name: /^自由职业人库/ }).click();
    await page.locator('.wf-sidebar').getByRole('button', { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
    await editor.getByRole('tab', { name: '认知记忆', exact: true }).click();
  };
  await page.reload({ waitUntil: 'domcontentloaded' });
  await reopenEmployee(employee.name);
  await expect(taskArchive).toHaveAttribute('aria-checked', 'false');
  const afterArchivePolicy = await library();
  assert.equal(afterArchivePolicy.archivePolicy.categories['task-evidence'], false);
  assert.deepEqual(afterArchivePolicy.sources.map(source => ({ id: source.id, version: source.version, hash: source.hash })), sourcesBeforeArchivePolicy, 'Disabling automatic archive never deletes original evidence');
  assert.deepEqual(afterArchivePolicy.snapshot, beforeArchivePolicy.snapshot, 'Disabling automatic archive preserves published knowledge');
  const offlinePolicy = route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '离线保存测试，请重试' }) });
  await page.route(archiveEndpoint, offlinePolicy);
  await taskArchive.click();
  await expect(knowledge.getByRole('alert')).toContainText('离线保存测试');
  await expect(taskArchive).toHaveAttribute('aria-checked', 'false');
  await expect(taskArchive).toBeEnabled();
  assert.equal((await library()).archivePolicy.categories['task-evidence'], false, 'A failed request must never announce a saved change');
  await page.unroute(archiveEndpoint, offlinePolicy);
  await knowledge.getByRole('alert').getByRole('button', { name: '重试', exact: true }).click();
  await expect(knowledge.getByRole('alert')).toHaveCount(0);
  await taskArchive.click();
  await expect(taskArchive).toHaveAttribute('aria-checked', 'true');

  // A committed response arriving after an employee switch must not overwrite the new library.
  let releaseLatePolicy;
  const latePolicyRelease = new Promise(done => { releaseLatePolicy = done; });
  let latePolicyCommitted;
  const latePolicyCommit = new Promise(done => { latePolicyCommitted = done; });
  const delayedLatePolicy = async route => { const response = await route.fetch(); latePolicyCommitted(); await latePolicyRelease; await route.fulfill({ response }); };
  await page.route(archiveEndpoint, delayedLatePolicy);
  const latePolicyResponse = page.waitForResponse(response => response.url().endsWith('/digital-workers/api/knowledge/archive-policy'));
  await taskArchive.click(); await latePolicyCommit;
  await page.locator('.wf-sidebar').getByRole('button', { name: new RegExp(peer.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
  await editor.getByRole('tab', { name: '认知记忆', exact: true }).click();
  await expect(taskArchive).toHaveAttribute('aria-checked', 'true');
  releaseLatePolicy();
  assert.ok((await latePolicyResponse).ok());
  await settleVisualState();
  await page.unroute(archiveEndpoint, delayedLatePolicy);
  await expect(taskArchive).toHaveAttribute('aria-checked', 'true');
  assert.equal((await library(peerTarget)).archivePolicy.categories['task-evidence'], true);
  await page.locator('.wf-sidebar').getByRole('button', { name: new RegExp(employee.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
  await editor.getByRole('tab', { name: '认知记忆', exact: true }).click();
  await expect(taskArchive).toHaveAttribute('aria-checked', 'false');
  await taskArchive.click();
  await expect(taskArchive).toHaveAttribute('aria-checked', 'true');
  assert.equal((await llmCalls()).length, callsBeforeArchivePolicy, 'Changing archive controls makes zero native LLM calls');
  metrics.archivePolicy = { controls: 3, persistedAfterReload: true, pendingDisabled: true, offlineRetainsState: true, lateResponseIsolated: true, originalsAndKnowledgePreserved: true, modelCalls: 0 };
  const iframe = knowledge.locator('iframe[title="Wiki知识图谱"]');
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
  const wiki = page.frameLocator('iframe[title="Wiki知识图谱"]');
  const graph = wiki.getByRole('region', { name: 'Wiki知识图谱', exact: true });
  const network = wiki.getByRole('region', { name: '知识网络', exact: true });
  const reader = wiki.getByRole('complementary', { name: '知识文章阅读', exact: true });
  const sourceReader = wiki.getByRole('complementary', { name: '原始资料阅读', exact: true });
  const toolbar = graph.locator('.wiki-toolbar');
  const verifyKnowledgeActionColors = async scheme => {
    await expect.poll(() => graph.evaluate(element => element.ownerDocument.documentElement.dataset.theme)).toBe(scheme);
    const statsColor = await graph.locator('.wiki-stats').evaluate(element => getComputedStyle(element).color);
    const actionColors = await categories.locator('.wf-knowledge-upload, .wf-knowledge-archive > span:last-child').evaluateAll(elements => elements.map(element => getComputedStyle(element).color));
    assert.deepEqual(actionColors, Array(4).fill(statsColor), `${scheme}: upload and all three automatic archive prompts use the exact graph-statistics gray`);
    return { statistics: statsColor, actions: actionColors };
  };
  metrics.knowledgeActionColors = { dark: await verifyKnowledgeActionColors('dark') };
  const groupMode = toolbar.getByRole('button', { name: '知识分组', exact: true });
  const categoryMode = toolbar.getByRole('button', { name: '节点类别', exact: true });
  const camera = () => network.evaluate(element => ['ratio', 'x', 'y'].map(key => element.getAttribute('data-camera-' + key)));
  const selectedGraphNode = () => network.getAttribute('data-selected-node').then(value => value || '');
  const visibleWorldPositions = () => network.locator('button[data-node-id]').evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.nodeId, x: node.dataset.x, y: node.dataset.y })));
  const fitGeometry = () => network.evaluate(element => {
    const { width, height } = element.getBoundingClientRect();
    return { width, height, nodes: [...element.querySelectorAll('button[data-node-id]')].map(node => ({ id: node.dataset.nodeId,
      x: Number.parseFloat(node.dataset.screenX), y: Number.parseFloat(node.dataset.screenY) })) };
  });
  const assertViewportFit = async (label, retainedWorld) => {
    await network.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    const insideViewport = geometry => geometry.nodes.length > 0 && geometry.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y)
      && node.x >= 8 && node.x <= geometry.width - 8 && node.y >= 8 && node.y <= geometry.height - 8);
    await expect.poll(async () => {
      const geometry = await fitGeometry();
      return insideViewport(geometry);
    }, { message: `${label}: all visible semantic nodes fit the live viewport with an 8px safety margin` }).toBe(true);
    // Fitting animates Sigma's camera. Being inside the viewport can become
    // true before that animation stops, so do not target a moving screen point.
    const settled = await network.evaluate(element => new Promise(done => {
      const began = performance.now(); let previous = '', unchangedSince = began, stableFrames = 0;
      const sample = () => {
        const signature = JSON.stringify([
          ...['ratio', 'x', 'y'].map(key => element.getAttribute('data-camera-' + key)),
          ...[...element.querySelectorAll('button[data-node-id]')].map(node => [node.dataset.nodeId, node.dataset.screenX, node.dataset.screenY]),
        ]);
        const now = performance.now();
        if (signature === previous) stableFrames++; else { previous = signature; unchangedSince = now; stableFrames = 0; }
        if (stableFrames >= 4 && now - unchangedSince >= 100) { done(true); return; }
        if (now - began >= 2000) { done(false); return; }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }));
    assert.equal(settled, true, `${label}: live camera and node screen coordinates settle before further input`);
    assert.ok(insideViewport(await fitGeometry()), `${label}: every node remains inside the viewport after fitting settles`);
    const afterWorld = await visibleWorldPositions();
    for (const node of retainedWorld) assert.deepEqual(afterWorld.find(value => value.id === node.id), node, `${label}: fitting preserves the exact dragged world coordinate of ${node.id}`);
    (metrics.wikiFitChecks ??= []).push({ label, ...await fitGeometry(), worldCoordinatesPreserved: true });
  };
  const openPage = async title => {
    let button = network.getByRole('button', { name: `阅读知识 ${title}`, exact: true }).first();
    if (!await button.count()) {
      button = reader.getByRole('button', { name: `阅读知识 ${title}`, exact: true }).first();
      if (!await button.count()) {
        const directory = wiki.getByRole('navigation', { name: '知识文章目录', exact: true });
        await expect(directory).toBeVisible();
        button = directory.getByRole('button', { name: `阅读知识 ${title}`, exact: true });
      }
    }
    await expect(button).toBeAttached();
    await button.focus(); await button.press('Enter');
    await expect(reader).toBeVisible();
    await expect(network).toBeVisible();
  };
  const unclassifiedWiki = await wikiLibrary();
  assert.equal(unclassifiedWiki.graph.kind, 'semantic');
  assert.deepEqual(unclassifiedWiki.graph.nodes, []); assert.deepEqual(unclassifiedWiki.graph.edges, []);
  assert.ok(unclassifiedWiki.pages.some(item => item.type === 'synthesis' && item.title === '知识主题：可删除配置资料'));
  await expect(graph.locator('.wiki-stats')).toHaveText('0 概念 · 0 语义关系');
  for (const name of ['文章', '类型', '社区']) await expect(toolbar.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(groupMode).toHaveAttribute('aria-pressed', 'true');
  await expect(categoryMode).toHaveAttribute('aria-pressed', 'false');
  await expect(wiki.getByRole('navigation', { name: '知识文章目录', exact: true })).toBeVisible();
  await expect(network.getByRole('button', { name: '阅读知识 知识主题：可删除配置资料', exact: true })).toHaveCount(0);
  await openPage(unclassifiedWiki.pages.find(item => item.type === 'overview').title);
  await expect(reader).toContainText('可阅读本次离线验证资料');
  await openPage('知识主题：可删除配置资料');
  await expect(reader).toContainText('CONFIGURED_DELETE_UI_713');
  const unclassifiedEvidence = unclassifiedWiki.pages.find(item => item.type === 'synthesis').citations[0];
  await reader.getByRole('button', { name: `查看资料 可删除配置资料 第 ${unclassifiedEvidence.startLine} 至 ${unclassifiedEvidence.endLine} 行`, exact: true }).click();
  await expect(sourceReader).toContainText('CONFIGURED_DELETE_UI_713');
  await graph.getByRole('button', { name: '关闭文章', exact: true }).click();
  await expect(reader).toHaveCount(0);
  await expect(sourceReader).toHaveCount(0);
  metrics.wikiToolbar = { articleEntryRemoved: true, categoryLabel: '节点类别', groupLabel: '知识分组', defaultMode: 'community', emptyGraphReadingDirectory: true, emptyGraphOverviewAndEvidenceReadable: true };

  // Deleting a configured source must rebase only that edit and preserve another unsaved field.
  await editor.getByRole('tab', { name: '岗位定义', exact: true }).click();
  const mission = editor.locator('.wf-role-definition textarea').first();
  const originalMission = await mission.inputValue();
  const editedMission = originalMission + '【删除资料时保留未保存岗位修改】';
  await mission.fill(editedMission);
  await editor.getByRole('tab', { name: '认知记忆', exact: true }).click();
  await knowledge.getByRole('button', { name: '上传资料', exact: true }).click();
  const materials = knowledge.getByRole('dialog', { name: '专业资料', exact: true });
  await expect(materials.getByRole('button', { name: /^删除 / }).first()).toBeVisible();
  await verifyRemovalColors(materials.getByRole('button', { name: /^删除 / }), 'materials-dark');
  await page.emulateMedia({ colorScheme: 'light' }); await settleVisualState();
  await verifyRemovalColors(materials.getByRole('button', { name: /^删除 / }), 'materials-light');
  await page.emulateMedia({ colorScheme: 'dark' }); await settleVisualState();
  await expect(materials.getByRole('button', { name: '增加专业资料', exact: true })).toBeEnabled();
  await materials.getByRole('button', { name: '查看 可删除配置资料', exact: true }).click();
  await expect(materials.getByRole('article', { name: '原始资料阅读', exact: true })).toContainText('CONFIGURED_DELETE_UI_713');
  await materials.getByRole('button', { name: '返回资料列表', exact: true }).click();
  let releaseRemoval;
  const removalRelease = new Promise(done => { releaseRemoval = done; });
  let removalCommitted;
  const removalCommit = new Promise(done => { removalCommitted = done; });
  const delayedRemoval = async route => {
    const response = await route.fetch();
    removalCommitted();
    await removalRelease;
    await route.fulfill({ response });
  };
  await page.route('**/digital-workers/api/knowledge/remove', delayedRemoval);
  const configuredRemoved = page.waitForResponse(response => response.url().endsWith('/digital-workers/api/knowledge/remove'));
  await materials.getByRole('button', { name: '删除 可删除配置资料', exact: true }).click();
  await removalCommit;
  // A successful deletion must reach the employee draft even after this subpage unmounts.
  await materials.getByRole('button', { name: '关闭专业资料', exact: true }).click();
  await editor.getByRole('tab', { name: '岗位定义', exact: true }).click();
  releaseRemoval();
  const configuredResponse = await configuredRemoved;
  await page.unroute('**/digital-workers/api/knowledge/remove', delayedRemoval);
  assert.ok(configuredResponse.ok(), await configuredResponse.text());
  assert.ok(configuredResponse.request().postDataJSON().employeeVersion > 0);
  await expect(materials).toHaveCount(0);
  await expect(editor).toBeVisible();
  await expect(mission).toHaveValue(editedMission);
  const rebasedSave = page.waitForResponse(response => response.url().endsWith('/digital-workers/api/command') && response.request().postDataJSON()?.action === 'employee.configuration.save');
  await editor.getByRole('button', { name: '保存配置', exact: true }).click();
  assert.ok((await rebasedSave).ok(), 'Saving the preserved draft uses the version returned by deletion');
  await expect(editor.getByRole('button', { name: '保存配置', exact: true })).toBeDisabled();
  let currentEmployee = (await snapshot()).templates.find(item => item.id === employee.id);
  assert.equal(currentEmployee.modules.responsibilities.mission, editedMission);
  assert.deepEqual(currentEmployee.modules.knowledge.sources, []);
  await mission.fill(originalMission + '【还原测试】');
  await discardEmployeeDraft();
  await expect(mission).toHaveValue(editedMission);
  await editor.getByRole('tab', { name: '认知记忆', exact: true }).click();
  assert.ok(!(await library()).sources.some(source => source.text.includes('CONFIGURED_DELETE_UI_713')));

  // The + control uploads original bytes and refreshes the simple list.
  await knowledge.getByRole('button', { name: '上传资料', exact: true }).click();
  const uploaded = page.waitForResponse(response => response.url().endsWith('/digital-workers/api/knowledge/upload'));
  await materials.getByLabel('上传专业资料', { exact: true }).setInputFiles({ name: '架构专属资料.md', mimeType: 'text/markdown', buffer: privateDocument });
  const uploadResponse = await uploaded; assert.ok(uploadResponse.ok());
  assert.deepEqual(Buffer.from(uploadResponse.request().postDataJSON().files[0].base64, 'base64'), privateDocument);
  await expect(materials.getByRole('button', { name: '查看 架构专属资料.md', exact: true })).toBeVisible();
  await materials.getByRole('button', { name: '查看 架构专属资料.md', exact: true }).click();
  await expect(materials.getByRole('article', { name: '原始资料阅读', exact: true })).toContainText(privateMarker);
  await materials.getByRole('button', { name: '返回资料列表', exact: true }).click();
  await expect.poll(async () => (await library()).status.state, { timeout: 20000 }).toBe('ready');
  const initialReady = await library();
  const callsBeforeDuplicate = (await llmCalls()).length;
  const duplicateUpload = page.waitForResponse(response => response.url().endsWith('/digital-workers/api/knowledge/upload'));
  await materials.getByLabel('上传专业资料', { exact: true }).setInputFiles({ name: '架构专属资料.md', mimeType: 'text/markdown', buffer: privateDocument });
  assert.ok((await duplicateUpload).ok());
  const duplicateReady = await library();
  assert.equal(duplicateReady.status.state, 'ready', 'Uploading identical original bytes must finish without compilation');
  assert.equal(duplicateReady.snapshot.version, initialReady.snapshot.version, 'Identical upload must not publish a new knowledge snapshot');
  assert.deepEqual(duplicateReady.sources.map(source => ({ id: source.id, version: source.version, hash: source.hash })), initialReady.sources.map(source => ({ id: source.id, version: source.version, hash: source.hash })), 'Identical original bytes must not advance A source versions');
  assert.equal((await llmCalls()).length, callsBeforeDuplicate, 'Identical upload must make zero native LLM calls');
  metrics.incremental = { duplicateUpload: { modelCalls: 0, snapshotVersionUnchanged: true, sourceVersionsUnchanged: true } };
  await materials.getByRole('button', { name: '刷新专业资料', exact: true }).click();
  await expect(materials.getByRole('status').first()).toContainText('已整理');
  await page.screenshot({ path: resolve(artifacts, 'employee-settings-materials.png') });
  await materials.getByRole('button', { name: '关闭专业资料', exact: true }).click();

  const privateTitle = '知识主题：架构专属资料.md';
  const partition = graph.getByRole('button', { name: '阅读知识 模块划分', exact: true }).first();
  const boundary = graph.getByRole('button', { name: '阅读知识 职责边界', exact: true }).first();
  await expect(partition).toBeAttached();
  await expect(boundary).toBeAttached();
  const privateWiki = await wikiLibrary();
  const callsBeforeGraphInteraction = (await llmCalls()).length;
  assert.equal(privateWiki.schemaVersion, 1);
  assert.equal(privateWiki.engine.name, 'llm_wiki');
  assert.equal(privateWiki.graph.kind, 'semantic');
  assert.equal(privateWiki.pages.length, 7, 'all concept, entity, source, overview and B article pages remain readable');
  assert.equal(privateWiki.graph.nodes.length, 4, 'the main graph contains only extracted semantic objects');
  assert.equal(privateWiki.graph.nodes.find(node => node.label === '模块划分').type, 'entity');
  assert.equal(privateWiki.graph.nodes.find(node => node.label === '职责边界').type, 'concept');
  assert.ok(['entity', 'concept', 'source', 'overview', 'synthesis'].every(type => privateWiki.pages.some(item => item.type === type)), 'Wiki contains actual entity/concept/source/overview/article pages');
  assert.ok(privateWiki.graph.nodes.every(node => ['entity', 'concept'].includes(node.type) && node.linkCount === 1));
  assert.equal(privateWiki.graph.edges.length, 2); assert.ok(privateWiki.graph.edges.every(edge => edge.weight === 1 && edge.relations.length === 1 && edge.relations[0].predicate === '依据'));
  assert.equal(privateWiki.graph.communities.reduce((total, community) => total + community.nodeCount, 0), 4);
  await expect(graph.locator('.wiki-stats')).toHaveText('3 概念 · 1 实体 · 2 语义关系');
  const partitionId = privateWiki.graph.nodes.find(node => node.label === '模块划分').id;
  const boundaryId = privateWiki.graph.nodes.find(node => node.label === '职责边界').id;
  const architectureIds = [partitionId, boundaryId].sort();
  const architectureEdgeId = privateWiki.graph.edges.find(edge => [edge.source, edge.target].includes(partitionId)).id;
  const assertCircularWorldLayout = async (label, expectedRingCounts) => {
    await expect.poll(async () => {
      const points = await visibleWorldPositions();
      return points.length === expectedRingCounts.reduce((sum, count) => sum + count, 0)
        && points.every(point => point.x !== undefined && point.y !== undefined && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)));
    }).toBe(true);
    const points = (await visibleWorldPositions()).map(point => ({ id: point.id, x: Number(point.x), y: Number(point.y) }));
    assert.ok(points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)), `${label}: initial graph coordinates are finite`);
    const rings = [];
    for (const point of points) {
      const radius = Math.hypot(point.x, point.y);
      let ring = rings.find(item => Math.abs(item.radius - radius) < 1e-6);
      if (!ring) { ring = { radius, nodes: [] }; rings.push(ring); }
      ring.nodes.push({ ...point, angle: (Math.atan2(point.y, point.x) + Math.PI * 2) % (Math.PI * 2) });
    }
    rings.sort((a, b) => a.radius - b.radius);
    assert.deepEqual(rings.map(ring => ring.nodes.length), expectedRingCounts, `${label}: all real nodes occupy the expected concentric rings`);
    assert.ok(Math.abs(rings.at(-1).radius - 100) < 1e-6, `${label}: outer ring is centered at the original world origin`);
    for (const ring of rings) {
      const angles = ring.nodes.map(node => node.angle).sort((a, b) => a - b);
      const expectedGap = Math.PI * 2 / angles.length;
      ring.gaps = angles.map((angle, index) => (angles[(index + 1) % angles.length] - angle + Math.PI * 2) % (Math.PI * 2));
      if (angles.length > 1) assert.ok(ring.gaps.every(gap => Math.abs(gap - expectedGap) < 1e-6), `${label}: each ring has evenly spaced nodes`);
    }
    (metrics.circularLayout ??= []).push({ label, center: { x: 0, y: 0 }, rings });
  };
  const assertRightRelationContext = async (view, rootId, label, collapsed) => {
    await expect(graph.locator('.wiki-focus-relations')).toHaveCount(0);
    const section = wiki.locator('.wiki-reader .wiki-semantic-links');
    await expect(section).toHaveCount(1);
    await expect(section).toHaveAttribute('aria-label', '语义关系');
    await expect(section).toHaveAttribute('data-relation-root', rootId);
    const context = section.locator('details.wiki-relation-context');
    if (collapsed !== undefined) assert.equal(await context.getAttribute('open') === null, collapsed, `${label}: context disclosure has the intended initial state`);
    const expected = view.graph.edges.flatMap(edge => (edge.relations ?? [])
      .filter(relation => relation.sourceId === rootId || relation.targetId === rootId)
      .map(relation => ({ edge, relation })));
    await expect(context.locator('details.wiki-relation-details')).toHaveCount(expected.length);
    const name = id => view.pages.find(page => page.id === id)?.title ?? view.graph.nodes.find(node => node.id === id)?.label;
    for (const { edge, relation } of expected) {
      const detail = context.locator(`details.wiki-relation-details[data-relation-id="${relation.id}"]`);
      const triple = `${name(relation.sourceId)} → ${relation.predicate} → ${name(relation.targetId)}`;
      await expect(detail).toHaveAttribute('data-edge-id', edge.id);
      await expect(detail.locator(':scope > summary')).toHaveText(triple);
      await expect(detail.locator(':scope > summary')).toHaveAttribute('aria-label', `查看关系 ${triple}`);
    }
    return context;
  };
  const assertArchitectureFocus = async label => {
    assert.equal(await selectedGraphNode(), partitionId, `${label}: concept focus survives reading navigation`);
    assert.deepEqual(JSON.parse(await network.getAttribute('data-highlighted-nodes')).sort(), architectureIds, `${label}: only the selected concept and its actual one-hop neighbor are highlighted`);
    assert.deepEqual(JSON.parse(await network.getAttribute('data-highlighted-edges')), [architectureEdgeId]);
    await expect(network.getByRole('button', { name: '阅读知识 交付验收', exact: true })).toHaveAttribute('data-dimmed', 'true');
    await expect(network.getByRole('button', { name: '阅读知识 验收标准', exact: true })).toHaveAttribute('data-dimmed', 'true');
    await expect(network.getByRole('button', { name: /^阅读知识 / })).toHaveCount(4);
  };
  const verifyGroupedOverview = async label => {
    await expect(network).toHaveAttribute('data-layout-kind', 'semantic-network');
    await expect(network).toHaveAttribute('data-group-count', '2');
    const groups = network.locator('.wiki-group');
    await expect(groups).toHaveCount(0);
    await expect(network.locator('.wiki-group-title')).toHaveCount(0);
    await expect(network.locator('.wiki-focus-relations')).toHaveCount(0);
    const realComponents = privateWiki.graph.communities.map(community => community.nodeCount);
    assert.deepEqual(realComponents, [2, 2], `${label}: two real disconnected pairs remain unbridged without visual boxes`);
    assert.equal(privateWiki.graph.edges.length, 2);
    const positions = await network.evaluate(element => {
      const box = element.getBoundingClientRect();
      return { width: box.width, height: box.height, nodes: [...element.querySelectorAll('button[data-node-id]')].map(node => ({ x: Number(node.getAttribute('data-screen-x')), y: Number(node.getAttribute('data-screen-y')) })) };
    });
    assert.equal(positions.nodes.length, 4);
    assert.ok(positions.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y) && node.x >= 0 && node.x <= positions.width && node.y >= 0 && node.y <= positions.height), `${label}: all disconnected semantic groups fit on one canvas: ${JSON.stringify(positions)}`);
    return { realComponentSizes: realComponents, visualBoxes: 0, ...positions };
  };
  await expect.poll(async () => (await partition.getAttribute('data-screen-x')) !== null).toBe(true);
  await assertCircularWorldLayout('initial four-node official Wiki', [4]);
  metrics.groupedOverview = { desktop: await verifyGroupedOverview('desktop') };
  await expect(groupMode).toHaveAttribute('aria-pressed', 'true');
  const groupsLegend = graph.getByRole('group', { name: '知识分组', exact: true });
  await expect(groupsLegend).toBeVisible();
  await expect(graph.getByRole('group', { name: '节点类别', exact: true })).toHaveCount(0);
  await categoryMode.click();
  await expect(categoryMode).toHaveAttribute('aria-pressed', 'true');
  const types = graph.getByRole('group', { name: '节点类别', exact: true });
  await expect(types.getByRole('button')).toHaveCount(2);
  await expect(types.getByRole('button', { name: '隐藏概念', exact: true })).toBeVisible();
  await expect(types.getByRole('button', { name: '隐藏实体', exact: true })).toBeVisible();
  for (const name of ['隐藏来源', '隐藏原始资料', '隐藏概览', '隐藏文章', '隐藏综合']) await expect(graph.getByRole('button', { name, exact: true })).toHaveCount(0);
  await groupMode.click();
  await expect(groupMode).toHaveAttribute('aria-pressed', 'true');
  await expect(groupsLegend).toBeVisible();
  for (const page of privateWiki.pages.filter(item => !['entity', 'concept'].includes(item.type))) await expect(network.getByRole('button', { name: `阅读知识 ${page.title}`, exact: true })).toHaveCount(0);
  await openPage('模块划分');
  await assertArchitectureFocus('concept details');
  const conceptRelations = await assertRightRelationContext(privateWiki, partitionId, 'concept details', false);
  const architectureRelation = conceptRelations.locator('details.wiki-relation-details');
  await expect(architectureRelation).not.toHaveAttribute('open', '');
  await expect(architectureRelation.locator(':scope > summary')).toBeVisible();
  await expect(architectureRelation.getByRole('button', { name: '查看资料 架构专属资料.md 第 4 至 4 行', exact: true })).toBeHidden();
  await expect(reader).toContainText('将系统拆分为职责明确的组成部分');
  await expect(reader.getByRole('button', { name: `阅读知识 ${privateTitle}`, exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(artifacts, 'employee-settings-concept-details.png') });
  await reader.getByRole('button', { name: `阅读知识 ${privateTitle}`, exact: true }).click();
  await assertArchitectureFocus('B article');
  const articleRelations = await assertRightRelationContext(privateWiki, partitionId, 'B article', true);
  await articleRelations.locator(':scope > summary').focus(); await articleRelations.locator(':scope > summary').press('Enter');
  await expect(articleRelations).toHaveAttribute('open', '');
  await expect(articleRelations.locator('details.wiki-relation-details > summary')).toHaveText('模块划分 → 依据 → 职责边界');
  await expect(reader).toContainText(privateMarker);
  await expect(reader).toContainText('适用范围：仅用于本次离线 UI 验证。');
  await expect(reader).toContainText('未经独立核验，仍为候选知识。');
  await expect(reader.getByRole('button', { name: '返回图谱知识 模块划分', exact: true })).toBeVisible();
  await reader.getByRole('button', { name: '定位图谱 模块划分', exact: true }).click();
  await assertArchitectureFocus('B article locate action');
  await expect(reader).toContainText(privateMarker);
  assert.ok((await network.getAttribute('data-focus-request')).startsWith(partitionId + ':'), 'article context can locate its original semantic node');
  await expect(network).toBeVisible();
  await page.screenshot({ path: resolve(artifacts, 'employee-settings-wiki-article.png') });
  const articleEvidence = privateWiki.pages.find(item => item.type === 'synthesis').citations[0];
  // The scripts-only Wiki is an OOPIF. Use its real keyboard activation after
  // scrolling a long article; the exact concept/relation citations below also
  // retain mouse coverage for the same source-reader action.
  const fullArticleCitation = reader.getByRole('button', { name: `查看资料 架构专属资料.md 第 ${articleEvidence.startLine} 至 ${articleEvidence.endLine} 行`, exact: true });
  await fullArticleCitation.focus(); await fullArticleCitation.press('Enter');
  await assertArchitectureFocus('exact A source');
  const sourceRelations = await assertRightRelationContext(privateWiki, partitionId, 'exact A source');
  if (await sourceRelations.getAttribute('open') === null) await sourceRelations.locator(':scope > summary').click();
  await expect(sourceRelations.locator('details.wiki-relation-details > summary')).toBeVisible();
  await expect(sourceReader).toContainText(privateMarker);
  await expect(sourceReader).toContainText('适用版本：UI 离线验证。');
  await page.screenshot({ path: resolve(artifacts, 'employee-settings-source-right-relations.png') });
  await sourceReader.getByRole('button', { name: '返回图谱知识 模块划分', exact: true }).click();
  await expect(reader).toContainText('将系统拆分为职责明确的组成部分');
  await assertArchitectureFocus('return from exact A source');
  await reader.getByRole('button', { name: '查看资料 架构专属资料.md 第 5 至 5 行', exact: true }).click();
  await expect(sourceReader).toContainText(privateMarker);
  await expect(sourceReader).toContainText('模块划分：将系统拆分为职责明确的组成部分。');
  await expect(network).toBeVisible();
  await openPage('模块划分');
  const evidenceContext = await assertRightRelationContext(privateWiki, partitionId, 'relation evidence', false);
  const evidenceDetail = evidenceContext.locator('details.wiki-relation-details');
  await expect(evidenceDetail).not.toHaveAttribute('open', '');
  const relationSummary = evidenceDetail.locator(':scope > summary');
  await relationSummary.focus(); await relationSummary.press('Enter');
  await expect(evidenceDetail).toHaveAttribute('open', '');
  await expect(reader).toContainText('模块划分依据职责边界');
  await expect(reader).not.toContainText('模型推断');
  await expect(evidenceDetail).toContainText('原文明确');
  await page.screenshot({ path: resolve(artifacts, 'employee-settings-relation-evidence.png') });
  await relationSummary.press('Space'); await expect(evidenceDetail).not.toHaveAttribute('open', '');
  await relationSummary.press('Enter');
  await evidenceDetail.getByRole('button', { name: '查看资料 架构专属资料.md 第 4 至 4 行', exact: true }).click();
  await expect(sourceReader).toContainText('模块划分依据职责边界。');
  await assertRightRelationContext(privateWiki, partitionId, 'exact relationship evidence source');
  await expect(network).toBeVisible();
  await openPage('模块划分');
  await expect(reader.getByRole('button', { name: `阅读知识 ${privateTitle}`, exact: true })).toBeVisible();
  await openPage(privateTitle);
  await expect(reader).toContainText(privateMarker);
  await expect(reader.getByRole('heading', { name: '原始资料要点', exact: true })).toBeVisible();
  await expect(network).toBeVisible();
  const search = graph.getByRole('searchbox', { name: '搜索知识', exact: true });
  const cameraBeforeSearch = await camera();
  await search.fill('职责边界'); await search.press('Enter');
  await expect(reader).toContainText('每个模块负责的范围');
  await expect.poll(selectedGraphNode).toBe(boundaryId);
  await expect.poll(camera).not.toEqual(cameraBeforeSearch);
  assert.ok((await network.getAttribute('data-focus-request')).startsWith(boundaryId + ':'), 'search Enter issues a real camera focus request');
  assert.deepEqual(JSON.parse(await network.getAttribute('data-highlighted-nodes')).sort(), architectureIds, 'search retains a true one-hop context');
  await expect(network.getByRole('button', { name: /^阅读知识 / })).toHaveCount(2);
  await search.fill('不存在的知识');
  await expect(graph).toContainText('未找到');
  await search.fill('');
  await expect.poll(selectedGraphNode).toBe('');
  await expect(network.getByRole('button', { name: /^阅读知识 / })).toHaveCount(4);
  await search.fill('交付验收'); await search.press('Enter');
  await expect(reader).toContainText('核对交付结果是否达标');
  const beforeBackToFull = await visibleWorldPositions();
  await graph.getByRole('button', { name: '适配图谱', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect.poll(selectedGraphNode).toBe('');
  await expect(graph).toHaveAttribute('data-exploration-root', '');
  await expect(graph).toHaveAttribute('data-exploration-depth', '0');
  await expect(network.getByRole('button', { name: /^阅读知识 / })).toHaveCount(4);
  await expect(reader).toHaveCount(0);
  await assertViewportFit('back to full graph clears search and fits real nodes', beforeBackToFull);
  await openPage('模块划分');
  await expect(groupMode).toHaveAttribute('aria-pressed', 'true');
  await categoryMode.click();
  await expect(categoryMode).toHaveAttribute('aria-pressed', 'true');
  const hideEntity = types.getByRole('button', { name: '隐藏实体', exact: true });
  await hideEntity.focus(); await hideEntity.press('Enter');
  const showEntity = types.getByRole('button', { name: '显示实体', exact: true });
  await expect(showEntity).toHaveAttribute('aria-pressed', 'false');
  await expect(network.getByRole('button', { name: '阅读知识 模块划分', exact: true })).toHaveCount(0);
  await expect(network.getByRole('button', { name: '阅读知识 职责边界', exact: true })).toHaveCount(1);
  await expect(network.getByRole('button', { name: /^阅读知识 / })).toHaveCount(3);
  await showEntity.focus(); await showEntity.press('Enter');
  await expect(hideEntity).toHaveAttribute('aria-pressed', 'true');
  await expect(network.getByRole('button', { name: '阅读知识 模块划分', exact: true })).toHaveCount(1);
  await graph.getByRole('button', { name: '关闭文章', exact: true }).click();
  const fitGraph = async () => {
    const retainedWorld = await visibleWorldPositions();
    await graph.getByRole('button', { name: '适配图谱', exact: true }).click();
    await assertViewportFit('fit graph uses current coordinates and viewport', retainedWorld);
  };
  const cameraBeforeZoom = await camera();
  await graph.getByRole('button', { name: '放大图谱', exact: true }).click();
  await expect.poll(async () => Math.abs(Number((await camera())[0]) - Number(cameraBeforeZoom[0]) / 1.2)).toBeLessThan(.0001);
  const cameraAfterZoom = await camera();
  await graph.getByRole('button', { name: '缩小图谱', exact: true }).click();
  await expect.poll(async () => Math.abs(Number((await camera())[0]) - Number(cameraAfterZoom[0]) * 1.2)).toBeLessThan(.0001);
  await fitGraph();
  // A scripts-only sandbox is an out-of-process frame in Chromium. Resolve its
  // local rectangle through the iframe border box for reliable mouse targeting.
  const networkBounds = async () => {
    const frame = await iframe.boundingBox(); assert.ok(frame);
    const local = await network.evaluate(element => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; });
    return { x: frame.x + local.x, y: frame.y + local.y, width: local.width, height: local.height };
  };
  const canvasBounds = await networkBounds();
  metrics.wikiPointerGeometry = { frame: await iframe.boundingBox(), reportedNetworkBox: await network.boundingBox(), resolvedNetworkBox: canvasBounds, versionBefore: await graph.getAttribute('data-version'), spaceBefore: await graph.getAttribute('data-space-id') };
  await network.evaluate(element => {
    const nonce = String(Date.now());
    element.dataset.pointerNonce = nonce;
    document.documentElement.dataset.pointerNonce = nonce;
    const records = [];
    const capture = event => {
      if (event.type === 'mousemove' && !event.buttons) return;
      const target = event.target;
      records.push({ type: event.type, x: event.clientX, y: event.clientY, buttons: event.buttons, tag: target?.tagName, className: typeof target?.className === 'string' ? target.className : '' });
      document.documentElement.dataset.pointerTrace = JSON.stringify(records.slice(-24));
    };
    for (const type of ['mousedown', 'mousemove', 'mouseup']) document.addEventListener(type, capture, { capture: true });
  });
  await graph.getByRole('button', { name: '放大图谱', exact: true }).click();
  await fitGraph();
  metrics.wikiPointerGeometry.control = await network.evaluate(element => {
    const rect = element.getBoundingClientRect(); const hit = document.elementFromPoint(rect.left + 100, rect.top + 100);
    return { elementNonce: element.dataset.pointerNonce, documentNonce: document.documentElement.dataset.pointerNonce, trace: document.documentElement.dataset.pointerTrace,
      href: location.href, target: { tag: hit?.tagName, className: typeof hit?.className === 'string' ? hit.className : '' } };
  });
  const cameraBeforePan = await camera();
  const mouseCanvas = network.locator('canvas.sigma-mouse');
  await mouseCanvas.dragTo(mouseCanvas, { sourcePosition: { x: 100, y: 100 }, targetPosition: { x: 170, y: 145 } });
  metrics.wikiPointerGeometry.trace = await network.evaluate(element => ({ elementNonce: element.dataset.pointerNonce, documentNonce: document.documentElement.dataset.pointerNonce, trace: document.documentElement.dataset.pointerTrace,
    cameraPanning: element.dataset.cameraPanningEnabled, captorEnabled: element.dataset.captorEnabled, captorDown: element.dataset.captorDown, sigmaEvent: element.dataset.sigmaEvent }));
  metrics.wikiPointerGeometry.versionAfter = await graph.getAttribute('data-version');
  metrics.wikiPointerGeometry.spaceAfter = await graph.getAttribute('data-space-id');
  await expect.poll(camera).not.toEqual(cameraBeforePan);
  await fitGraph();
  const nodePosition = () => partition.evaluate(element => [element.getAttribute('data-x'), element.getAttribute('data-y')]);
  const positionBeforeDrag = await nodePosition();
  const screen = await partition.evaluate(element => ({ x: Number(element.getAttribute('data-screen-x')), y: Number(element.getAttribute('data-screen-y')) }));
  const dragCanvas = await mouseCanvas.boundingBox();
  assert.ok(dragCanvas && screen.x >= 0 && screen.y >= 0 && screen.x + 72 <= dragCanvas.width && screen.y + 30 <= dragCanvas.height, 'The settled node and drag destination are inside the actual renderer canvas');
  await mouseCanvas.dragTo(mouseCanvas, { sourcePosition: { x: screen.x, y: screen.y }, targetPosition: { x: screen.x + 72, y: screen.y + 30 } });
  await expect.poll(nodePosition).not.toEqual(positionBeforeDrag);
  metrics.wikiGraph = { kind: privateWiki.graph.kind, pages: privateWiki.pages.length, nodes: privateWiki.graph.nodes.length, edges: privateWiki.graph.edges.length, semanticRelations: privateWiki.graph.edges.reduce((total, edge) => total + edge.relations.length, 0), graphTypes: [...new Set(privateWiki.graph.nodes.map(node => node.type))], readingPageTypes: [...new Set(privateWiki.pages.map(page => page.type))], semanticDegrees: privateWiki.graph.nodes.map(node => node.linkCount), namedPredicate: '依据', exactRelationEvidenceLine: 4, sourceMouseAndKeyboardActivation: true, conceptToArticleNavigation: true, emptyGraphOverviewNavigation: true, nonsemanticPagesExcludedFromGraph: true, search: true, searchCameraFocus: true, oneHopHighlight: true, focusRetainedThroughArticleAndEvidence: true, clearsFocusForSearchAndSpace: true, allKnowledgeRestoresOverview: true, visualGroupsAreNotSemanticObjects: true, nodeCategoryAndKnowledgeGroup: true, zoom: true, pan: true, drag: true, sameScreenReading: true, sandbox: 'allow-scripts' };
  const retainedCamera = await camera();
  const retainedPosition = await nodePosition();
  await openPage('模块划分');
  await openPage(privateTitle);
  await expect(reader).toContainText(privateMarker);
  await expect(network).toBeVisible();
  await graph.getByRole('button', { name: '关闭文章', exact: true }).click();
  await expect.poll(nodePosition).toEqual(retainedPosition);
  await expect.poll(camera).toEqual(retainedCamera);
  metrics.wikiGraph.retainsViewAfterReading = true;
  await graph.getByRole('button', { name: '适配图谱', exact: true }).click();

  const privateLibrary = await library(); const sharedLibrary = await library(sharedTarget);
  assert.equal((await llmCalls()).length, callsBeforeGraphInteraction, 'grouped layout, one-hop focus, search, article reading and evidence navigation make zero model calls');
  assert.deepEqual(privateLibrary.snapshot, initialReady.snapshot, 'graph interactions never regenerate or rewrite published knowledge');
  metrics.wikiGraph.modelCalls = 0;
  metrics.wikiGraph.publishedSnapshotUnchanged = true;
  assert.equal(privateLibrary.compiler.role, 'employee-shadow'); assert.equal(sharedLibrary.compiler.role, 'team-librarian');
  assert.ok(privateLibrary.sources.some(source => source.text.includes(privateMarker)));
  assert.ok(!sharedLibrary.sources.some(source => source.text.includes(privateMarker)));
  assert.ok(sharedLibrary.sources.some(source => source.text.includes(teamMarker)));
  assert.ok(!privateLibrary.sources.some(source => source.text.includes(teamMarker)));
  assert.equal(privateLibrary.sources.find(source => source.text.includes(privateMarker)).original.sha256, createHash('sha256').update(privateDocument).digest('hex'));
  assert.equal(privateLibrary.snapshot.conceptGraph.schemaVersion, 1);
  assert.deepEqual(privateLibrary.snapshot.conceptGraph.concepts.map(concept => concept.name), ['模块划分', '职责边界', '交付验收', '验收标准']);
  assert.deepEqual(privateLibrary.snapshot.conceptGraph.relations.map(relation => relation.predicate), ['依据', '依据']);
  assert.equal(privateLibrary.snapshot.conceptGraph.relations[0].citations[0].startLine, 4);
  assert.deepEqual(sharedLibrary.snapshot.conceptGraph.concepts, [], 'Private concepts never enter the shared library');
  await expect.poll(async () => (await library(peerTarget)).status.state, { timeout: 20000 }).toBe('ready');
  const allWiki = await Promise.all([wikiLibrary(), wikiLibrary(peerTarget), wikiLibrary(sharedTarget)]);
  assert.equal(new Set(allWiki.map(view => view.spaceId)).size, 3);
  for (const [index, marker] of [privateMarker, peerMarker, teamMarker].entries()) {
    assert.ok(JSON.stringify(allWiki[index]).includes(marker));
    assert.ok(allWiki.every((view, other) => index === other || !JSON.stringify(view).includes(marker)), 'Shared engine never mixes spaces');
  }
  const isolatedWiki = allWiki[1]; assert.equal(isolatedWiki.graph.kind, 'semantic');
  assert.equal(isolatedWiki.graph.nodes.length, 2); assert.deepEqual(isolatedWiki.graph.edges, []); assert.ok(isolatedWiki.graph.nodes.every(node => node.type === 'concept' && node.linkCount === 0));
  assert.equal(allWiki[2].graph.kind, 'semantic'); assert.deepEqual(allWiki[2].graph.nodes, []); assert.deepEqual(allWiki[2].graph.edges, []);
  assert.ok(allWiki[2].pages.some(item => item.type === 'synthesis'), 'unclassified B articles remain readable without inventing semantic nodes or links');
  await expect(categoryMode).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.wf-sidebar').getByRole('button', { name: new RegExp(peer.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
  await editor.getByRole('tab', { name: '认知记忆', exact: true }).click();
  await expect(graph.locator('.wiki-stats')).toHaveText('2 概念 · 0 语义关系');
  await expect(groupMode).toHaveAttribute('aria-pressed', 'true');
  await expect(categoryMode).toHaveAttribute('aria-pressed', 'false');
  await expect(groupsLegend).toBeVisible();
  await expect.poll(selectedGraphNode).toBe('');
  await expect(network).toHaveAttribute('data-group-count', '2');
  await expect(network.getByRole('button', { name: '阅读知识 独立概念甲', exact: true })).toHaveCount(1);
  await expect(network.getByRole('button', { name: '阅读知识 独立概念乙', exact: true })).toHaveCount(1);
  await expect(network.getByRole('button', { name: /^查看关系 / })).toHaveCount(0);
  await openPage('独立概念甲');
  const isolatedContext = await assertRightRelationContext(isolatedWiki, isolatedWiki.graph.nodes.find(node => node.label === '独立概念甲').id, 'isolated concept', false);
  await expect(isolatedContext.locator('.wiki-no-relations')).toHaveText('暂无已确认关系');
  await openPage('知识主题：第二员工资料.md');
  await expect(reader).toContainText(peerMarker); await expect(reader).toContainText('两者没有已记录的语义关系');
  await graph.getByRole('button', { name: '关闭文章', exact: true }).click();
  await categoryMode.click();
  await expect(categoryMode).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.wf-sidebar').getByRole('button', { name: new RegExp(employee.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
  await editor.getByRole('tab', { name: '认知记忆', exact: true }).click();
  await expect(graph.locator('.wiki-stats')).toHaveText('3 概念 · 1 实体 · 2 语义关系');
  await expect(groupMode).toHaveAttribute('aria-pressed', 'true');
  await expect(categoryMode).toHaveAttribute('aria-pressed', 'false');
  await expect(groupsLegend).toBeVisible();
  metrics.wikiToolbar.spaceSwitchRestoresDefaultGroupMode = true;
  await expect.poll(selectedGraphNode).toBe('');
  const workerPids = await wikiWorkers();
  assert.equal(workerPids.length, 1, 'Two employees and one team reuse one managed LLM Wiki process');
  metrics.sharedWiki = { spaces: allWiki.length, engineProcesses: workerPids.length, distinctSpaceIds: true, sourceIsolation: true, isolatedConcepts: { nodes: 2, relations: 0, noInventedLinks: true, articlesReadable: true } };
  const rebuilt = page.waitForResponse(response => response.url().endsWith('/digital-workers/api/knowledge/upload') && response.request().postDataJSON()?.retry === true);
  const callsBeforeRetry = (await llmCalls()).length;
  await graph.getByRole('button', { name: '重新整理图谱', exact: true }).click();
  assert.ok((await rebuilt).ok());
  assert.equal((await library()).status.state, 'ready');
  assert.equal((await library()).snapshot.version, privateLibrary.snapshot.version, 'Retrying unchanged inputs must keep the published snapshot');
  assert.equal((await llmCalls()).length, callsBeforeRetry, 'Retrying unchanged inputs must make zero native LLM calls');
  metrics.incremental.unchangedRetry = { modelCalls: 0, snapshotVersionUnchanged: true };
  await expect(partition).toBeVisible();

  await knowledge.getByRole('button', { name: '上传资料', exact: true }).click();
  const beforeAdditional = await library();
  const callsBeforeAdditional = (await llmCalls()).length;
  const extraUpload = page.waitForResponse(response => response.url().endsWith('/digital-workers/api/knowledge/upload'));
  await materials.getByLabel('上传专业资料', { exact: true }).setInputFiles({ name: '临时删除资料.md', mimeType: 'text/markdown', buffer: Buffer.from('UPLOAD_DELETE_UI_724') });
  assert.ok((await extraUpload).ok());
  await expect.poll(async () => (await library()).status.state, { timeout: 20000 }).toBe('ready');
  const afterAdditional = await library();
  const expandedWiki = await wikiLibrary();
  assert.ok(expandedWiki.pages.length > privateWiki.pages.length, 'the reading index includes new A/B/C pages');
  assert.deepEqual(expandedWiki.graph, privateWiki.graph, 'additional reading pages must not alter semantic nodes, relations, degree or communities');
  const extraSource = afterAdditional.sources.find(source => source.text.includes('UPLOAD_DELETE_UI_724'));
  assert.ok(extraSource);
  for (const entry of beforeAdditional.snapshot.entries) assert.deepEqual(afterAdditional.snapshot.entries.find(item => item.id === entry.id), entry, 'An unrelated new source must retain old B entries exactly');
  for (const overview of beforeAdditional.snapshot.overview) assert.deepEqual(afterAdditional.snapshot.overview.find(item => item.id === overview.id), overview, 'An unrelated new source must retain old C overview exactly');
  for (const concept of beforeAdditional.snapshot.conceptGraph.concepts) assert.deepEqual(afterAdditional.snapshot.conceptGraph.concepts.find(item => item.id === concept.id), concept, 'An unrelated new source must retain old concepts exactly');
  const additionalCalls = (await llmCalls()).slice(callsBeforeAdditional);
  assert.deepEqual(additionalCalls.map(call => call.stage), ['analysis', 'generation'], 'One changed source uses the two native compilation stages');
  for (const call of additionalCalls) {
    assert.deepEqual(call.sourceIds, [extraSource.id], 'Only the new A source is sent in full to both native model stages');
    assert.deepEqual(call.dependencySources, [], 'Unrelated original materials are not resent as dependency excerpts');
    assert.equal(call.previousIncluded, false, 'No stage receives the entire previous knowledge snapshot');
  }
  assert.ok(afterAdditional.snapshot.entries.some(entry => entry.citations.some(citation => citation.sourceId === extraSource.id)));
  await materials.getByRole('button', { name: '刷新专业资料', exact: true }).click();
  const callsBeforeDelete = (await llmCalls()).length;
  const extraRemoved = page.waitForResponse(response => response.url().endsWith('/digital-workers/api/knowledge/remove'));
  await materials.getByRole('button', { name: '删除 临时删除资料.md', exact: true }).click();
  assert.ok((await extraRemoved).ok());
  await expect.poll(async () => (await library()).status.state, { timeout: 20000 }).toBe('ready');
  const afterDelete = await library();
  assert.deepEqual(afterDelete.snapshot.entries, beforeAdditional.snapshot.entries, 'Deleting a standalone new source withdraws only its derived B entry');
  assert.deepEqual(afterDelete.snapshot.overview, beforeAdditional.snapshot.overview, 'Deleting a standalone new source withdraws only its derived overview');
  assert.deepEqual(afterDelete.snapshot.conceptGraph, beforeAdditional.snapshot.conceptGraph, 'Deleting unrelated material keeps the prior concepts and relations exactly');
  assert.equal((await llmCalls()).length, callsBeforeDelete, 'Deletion without remaining shared support is deterministic and makes zero model calls');
  metrics.incremental.unrelatedAddition = { changedSourceCount: 1, modelCalls: additionalCalls.length, previousSnapshotIncluded: false, unmodifiedKnowledgeRetainedExactly: true, semanticGraphIndependentOfReadingPageCount: true };
  metrics.incremental.standaloneDeletion = { modelCalls: 0, derivedKnowledgeWithdrawn: true, unmodifiedKnowledgeRetainedExactly: true };
  await expect(materials.getByRole('button', { name: '查看 临时删除资料.md', exact: true })).toHaveCount(0);
  await materials.getByRole('button', { name: '刷新专业资料', exact: true }).click();
  await expect(materials.getByRole('button', { name: '查看 临时删除资料.md', exact: true })).toHaveCount(0);
  const rejected = page.waitForResponse(response => response.url().endsWith('/digital-workers/api/knowledge/upload'));
  await materials.getByLabel('上传专业资料', { exact: true }).setInputFiles({ name: '损坏文本.md', mimeType: 'text/markdown', buffer: Buffer.from([0xff, 0xfe, 0xfd]) });
  assert.equal((await rejected).status(), 400);
  await expect(materials.getByRole('alert')).toContainText('UTF-8');
  assert.equal((await library()).sources.length, privateLibrary.sources.length);
  await expect.poll(async () => (await library()).status.state, { timeout: 20000 }).toBe('ready');
  await materials.getByRole('button', { name: '刷新专业资料', exact: true }).click();
  await expect(materials.getByRole('alert')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(materials).toHaveCount(0);
  await expect(partition).toBeVisible();
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    await settleVisualState();
    metrics.knowledgeActionColors[scheme] = await verifyKnowledgeActionColors(scheme);
    await fitGraph();
    metrics.groupedOverview[scheme] = await verifyGroupedOverview(scheme);
    await page.screenshot({ path: resolve(artifacts, `employee-settings-knowledge-${scheme}.png`), animations: 'disabled' });
    if (scheme === 'dark') await knowledge.getByRole('group', { name: '认知分类', exact: true }).screenshot({ path: resolve(artifacts, 'employee-settings-archive-cards-dark.png'), animations: 'disabled' });
  }
  await page.setViewportSize({ width: 860, height: 1050 });
  await page.emulateMedia({ colorScheme: 'dark' });
  const bounds = await knowledge.boundingBox();
  assert.ok(bounds && bounds.width <= 860 && bounds.height > 300);
  metrics.knowledgeLayout.narrow = await verifyKnowledgeGeometry('narrow');
  await fitGraph();
  metrics.groupedOverview.narrow = await verifyGroupedOverview('narrow');
  await page.screenshot({ path: resolve(artifacts, 'employee-settings-knowledge-narrow.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 1512, height: 440 });
  metrics.knowledgeLayout.short = await verifyKnowledgeGeometry('short');
  await fitGraph();
  metrics.groupedOverview.short = await verifyGroupedOverview('short');
  await page.screenshot({ path: resolve(artifacts, 'employee-settings-knowledge-short.png'), animations: 'disabled' });

  // Archive only a dedicated QA record in this throwaway official profile.
  // Existing project instances must remain independent of the library status.
  await page.setViewportSize({ width: 1512, height: 1050 });
  const archiveProjectPath = resolve(temp, 'QA-归档项目');
  await mkdir(archiveProjectPath);
  const workspaceCreated = await post('/api/workspace/create', { type: 'client-request', rpcId: randomUUID(), method: 'workspace/create', payload: { args: { request: { path: archiveProjectPath } } } });
  assert.equal(workspaceCreated.result?.ok, true, 'The official workspace API registers only the throwaway QA project');
  const archiveProject = workspaceCreated.result.value.workspace;
  assert.ok((await snapshot()).projects.some(project => project.id === archiveProject.workspaceId));
  const archiveModules = structuredClone(peer.modules);
  archiveModules.knowledge.sources = [];
  const { result: archiveTemplate } = await command('template.save', { name: 'QA-归档职业人', description: 'ARCHIVE_RECORD_PRESERVED_UI', status: 'ready', modules: archiveModules });
  const { result: archiveInstance } = await command('employee.create', { projectId: archiveProject.workspaceId, templateId: archiveTemplate.id });
  const roleCallsBeforeArchive = (await llmCalls()).length;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await reopenEmployee(employee.name);
  const archiveRow = page.locator('.wf-sidebar > .wf-employee-nav-item').filter({ hasText: archiveTemplate.name });
  await expect(archiveRow).toHaveCount(1);
  await page.locator('.wf-sidebar').getByRole('button', { name: '新建自由职业人', exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('button', { name: '移除自由职业人', exact: true })).toBeDisabled();
  assert.deepEqual(await editor.locator('.wf-employee-actions').getByRole('button').allTextContents(), ['移除', '导入', '导出', '保存']);
  await archiveRow.click();
  await expect(editor.getByLabel('员工名称', { exact: true })).toHaveValue(archiveTemplate.name);
  const archiveButton = editor.getByRole('button', { name: '移除自由职业人', exact: true });
  await verifyRemovalColors(archiveButton, 'employee-archive-dark');
  await page.emulateMedia({ colorScheme: 'light' }); await settleVisualState();
  await verifyRemovalColors(archiveButton, 'employee-archive-light');
  await page.emulateMedia({ colorScheme: 'dark' }); await settleVisualState();
  const archiveActions = editor.locator('.wf-employee-title-row .wf-employee-actions');
  assert.deepEqual(await archiveActions.getByRole('button').allTextContents(), ['移除', '导入', '导出', '保存']);
  await expect(archiveButton).toHaveAttribute('title', '从自由职业人库移除，保留配置记录和已有项目实例');
  await expect(archiveButton.locator('svg')).toHaveAttribute('width', '14');
  await expect(page.locator('.wf-sidebar').getByRole('button', { name: '移除自由职业人', exact: true })).toHaveCount(0);
  const archiveGeometry = async () => archiveActions.evaluate(element => {
    const buttons = [...element.querySelectorAll('button')].map(button => { const rect = button.getBoundingClientRect(); return { text: button.textContent, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }; });
    const editor = element.closest('.wf-employee-editor').getBoundingClientRect();
    return { buttons, editor: { left: editor.left, right: editor.right } };
  });
  const archiveDesktop = await archiveGeometry();
  assert.ok(archiveDesktop.buttons[0].right <= archiveDesktop.buttons[1].left && Math.abs(archiveDesktop.buttons[0].top - archiveDesktop.buttons[1].top) <= 1, 'Removal precedes import, export and save in the title actions');
  await page.screenshot({ path: resolve(artifacts, 'employee-archive-header-desktop.png') });
  await page.setViewportSize({ width: 860, height: 760 });
  await settleVisualState();
  const archiveNarrow = await archiveGeometry();
  assert.ok(archiveNarrow.buttons.every(button => button.left >= archiveNarrow.editor.left && button.right <= archiveNarrow.editor.right), 'All title actions stay inside the editor on narrow screens');
  for (const label of ['移除自由职业人', '导入', '导出', '保存配置']) await expect(archiveActions.getByRole('button', { name: label, exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(artifacts, 'employee-archive-header-narrow.png') });
  await page.setViewportSize({ width: 1512, height: 1050 });

  const archiveDraftName = 'QA-归档职业人（未保存草稿）';
  await editor.getByLabel('员工名称', { exact: true }).fill(archiveDraftName);
  await editor.getByRole('tab', { name: '岗位定义', exact: true }).click();
  await editor.getByLabel('工作职责', { exact: true }).fill('ARCHIVE_UNSAVED_DUTIES_MUST_NOT_PERSIST_UI');
  const beforeArchive = await snapshot();
  let archiveRequests = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/digital-workers/api/command') && request.postDataJSON()?.action === 'template.archive') archiveRequests++; });
  const archiveConfirmation = '移除后将从自由职业人库隐藏，配置记录和已创建的项目实例会保留。确定移除？\n当前未保存修改不会保存。';
  page.off('dialog', acceptDialog);
  const cancelDialog = page.waitForEvent('dialog');
  const cancelledClick = archiveButton.click();
  const cancellation = await cancelDialog;
  assert.equal(cancellation.type(), 'confirm'); assert.equal(cancellation.message(), archiveConfirmation);
  await cancellation.dismiss(); await cancelledClick;
  assert.equal(archiveRequests, 0, 'Cancelling archive sends no mutation request');
  assert.deepEqual(await snapshot(), beforeArchive, 'Cancelling archive preserves the entire saved state');
  await expect(editor.getByLabel('员工名称', { exact: true })).toHaveValue(archiveDraftName);
  await expect(editor.getByLabel('工作职责', { exact: true })).toHaveValue('ARCHIVE_UNSAVED_DUTIES_MUST_NOT_PERSIST_UI');
  await expect(editor.getByRole('button', { name: '保存配置', exact: true })).toBeEnabled();

  const archivedResponse = page.waitForResponse(response => response.url().endsWith('/digital-workers/api/command') && response.request().postDataJSON()?.action === 'template.archive');
  const confirmDialog = page.waitForEvent('dialog');
  const confirmedClick = archiveButton.click();
  const confirmation = await confirmDialog;
  assert.equal(confirmation.message(), archiveConfirmation);
  await confirmation.accept(); await confirmedClick;
  const archived = await archivedResponse;
  assert.ok(archived.ok());
  assert.deepEqual(archived.request().postDataJSON(), { action: 'template.archive', payload: { id: archiveTemplate.id }, options: { expectedVersion: archiveTemplate.version } }, 'Archiving targets the saved id and version, with no draft fields');
  page.on('dialog', acceptDialog);
  await expect(archiveRow).toHaveCount(0);
  const fallbackTemplate = beforeArchive.templates.find(template => template.id !== archiveTemplate.id && template.status !== 'archived');
  await expect(editor.getByLabel('员工名称', { exact: true })).toHaveValue(fallbackTemplate.name);
  await editor.getByRole('tab', { name: '岗位定义', exact: true }).click();
  await expect(editor.getByLabel('岗位角色', { exact: true })).toHaveValue(fallbackTemplate.modules.responsibilities.mission);
  await expect(editor.getByLabel('工作职责', { exact: true })).toHaveValue(fallbackTemplate.modules.responsibilities.duties.join('\n'));
  await expect(editor.getByLabel('工作规范与边界', { exact: true })).toHaveValue(fallbackTemplate.modules.responsibilities.boundaries.join('\n'));
  await expect(editor.getByRole('button', { name: '保存配置', exact: true })).toBeDisabled();
  const afterArchive = await snapshot();
  const retainedTemplate = afterArchive.templates.find(template => template.id === archiveTemplate.id);
  assert.ok(retainedTemplate, 'Archived templates remain in durable records');
  assert.equal(retainedTemplate.status, 'archived'); assert.equal(retainedTemplate.version, archiveTemplate.version + 1);
  assert.deepEqual({ ...retainedTemplate, status: archiveTemplate.status, version: archiveTemplate.version, updatedAt: archiveTemplate.updatedAt }, archiveTemplate, 'Archive preserves the original name, modules, description and creation time rather than saving the draft');
  assert.deepEqual({ ...afterArchive, revision: beforeArchive.revision, templates: afterArchive.templates.map(template => template.id === archiveTemplate.id ? archiveTemplate : template) }, beforeArchive, 'Only archive status, template version, timestamp and state revision can change');
  assert.deepEqual(afterArchive.employees.find(employee => employee.id === archiveInstance.id), archiveInstance, 'The existing project instance is retained byte for byte');
  await page.screenshot({ path: resolve(artifacts, 'employee-archive-hidden-library.png') });

  const rejectedInstance = await fetch(`${base}/digital-workers/api/command`, { method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'employee.create', payload: { projectId: archiveProject.workspaceId, templateId: archiveTemplate.id } }) });
  assert.equal(rejectedInstance.status, 400);
  assert.equal((await rejectedInstance.json()).error, '归档模板不能添加到项目');
  assert.deepEqual(await snapshot(), afterArchive, 'Rejecting a new project copy leaves every saved record unchanged');
  await page.getByRole('treeitem').filter({ hasText: archiveProject.title }).first().hover();
  await page.getByRole('button', { name: `在“${archiveProject.title}”中新建会话`, exact: true }).click();
  await page.getByRole('button', { name: '工作流：无', exact: true }).click();
  await expect(page.getByRole('listbox', { name: '项目工作流', exact: true }).getByRole('option').first()).toHaveText('无');
  await expect(page.getByRole('dialog', { name: '配置团队', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '项目工作区', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('选择具体项目', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '引入通用模板', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'graph_horses', exact: true }).click();
  const libraryNavigation = page.getByRole('navigation', { name: '资源库', exact: true });
  await expect(libraryNavigation).toBeVisible();
  await expect(libraryNavigation.getByRole('button')).toHaveCount(3);
  await libraryNavigation.getByRole('button', { name: /^自由职业人库/ }).click();
  assert.deepEqual((await snapshot()).employees.find(employee => employee.id === archiveInstance.id), archiveInstance, 'Removing the legacy project workspace preserves the existing project employee byte for byte');
  await page.screenshot({ path: resolve(artifacts, 'employee-archive-library-without-legacy-workspace.png') });
  metrics.teamPage.nativeWorkflowMenuHasNoLegacyWorkspaceAndLibraryHasThreePages = true;
  await expect(archiveRow).toHaveCount(0);
  assert.equal((await llmCalls()).length, roleCallsBeforeArchive, 'Archiving and retaining configuration never invokes a model');
  metrics.employeeArchive = { savedTemplateId: archiveTemplate.id, retainedProjectEmployeeId: archiveInstance.id, headerButtonOrder: archiveDesktop.buttons.map(button => button.text), desktop: archiveDesktop, narrow: archiveNarrow, newEmployeeRemoveDisabledAndLegacyProjectUiAbsent: true, cancelledWithoutRequestOrMutation: true, cancelledDraftRetained: true, confirmationMentionsDiscardedDraft: true, savedIdAndVersionUsed: true, recordAndModulesPreserved: true, unrelatedStateAndProjectInstanceUnchanged: true, hiddenFromLibraryAndLegacyInstallerRemoved: true, newProjectCopyRejectedWithoutMutation: true, modelCalls: 0 };

  // Confirm team removal only on a dedicated QA team, with the existing QA
  // project instance already present so its retention is verified exactly.
  const { result: removableTeam } = await command('team.save', { name: 'QA-移除测试团队', description: 'TEAM_DELETE_PRESERVE_OTHER_RECORDS_UI', knowledgeEnabled: false, members: [{ memberId: 'removable-peer', templateId: peer.id, name: peer.name }], workflows: [] });
  await teamSectionNavigation.getByRole('button', { name: /^团队/ }).click();
  const removableTeamHeading = page.locator('.wf-sidebar').getByRole('button', { name: removableTeam.name, exact: true });
  await removableTeamHeading.click();
  await expect(teamName).toHaveValue(removableTeam.name);
  const removeTeamButton = teamEditor.locator('.wf-team-toolbar').getByRole('button', { name: '移除团队', exact: true });
  await verifyRemovalColors(removeTeamButton, 'remove-team-dark');
  await page.emulateMedia({ colorScheme: 'light' }); await settleVisualState();
  await verifyRemovalColors(removeTeamButton, 'remove-team-light');
  await page.emulateMedia({ colorScheme: 'dark' }); await settleVisualState();
  const removalDraftName = 'QA-移除测试团队（未保存）';
  await teamName.fill(removalDraftName);
  const beforeTeamRemoval = await snapshot();
  let teamRemovalRequests = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/digital-workers/api/command') && request.postDataJSON()?.action === 'team.delete') teamRemovalRequests++; });
  const removalConfirmation = `确定移除团队“${removalDraftName}”？已有项目员工不会被修改。`;
  await confirmUiAction(removalConfirmation, false, () => removeTeamButton.click());
  assert.equal(teamRemovalRequests, 0);
  assert.deepEqual(await snapshot(), beforeTeamRemoval, 'Cancelling team removal makes no request and preserves all saved records');
  await expect(teamName).toHaveValue(removalDraftName);
  await expect(teamEditor.getByRole('button', { name: '保存团队', exact: true })).toBeEnabled();
  await page.screenshot({ path: resolve(artifacts, 'team-page-removal-cancelled.png') });
  const removedTeamResponse = page.waitForResponse(response => response.url().endsWith('/digital-workers/api/command') && response.request().postDataJSON()?.action === 'team.delete');
  await confirmUiAction(removalConfirmation, true, () => removeTeamButton.click());
  const removedTeam = await removedTeamResponse;
  assert.ok(removedTeam.ok()); assert.equal(teamRemovalRequests, 1);
  assert.deepEqual(removedTeam.request().postDataJSON(), { action: 'team.delete', payload: { id: removableTeam.id }, options: { expectedVersion: removableTeam.version } });
  await expect(removableTeamHeading).toHaveCount(0);
  const afterTeamRemoval = await snapshot();
  assert.deepEqual({ ...afterTeamRemoval, revision: beforeTeamRemoval.revision }, { ...beforeTeamRemoval, teams: beforeTeamRemoval.teams.filter(team => team.id !== removableTeam.id) }, 'Team removal changes only the selected saved team; templates, workflows and existing project instances remain identical');
  assert.deepEqual(afterTeamRemoval.employees.find(employee => employee.id === archiveInstance.id), archiveInstance);
  assert.equal((await llmCalls()).length, roleCallsBeforeArchive, 'Removing the QA team never invokes a model');
  await page.screenshot({ path: resolve(artifacts, 'team-page-removal-confirmed.png') });
  metrics.teamRemoval = { teamId: removableTeam.id, cancelledWithoutRequestOrMutation: true, cancelledDraftRetained: true, savedIdAndVersionUsed: true, removedOnlySavedTeam: true, allOtherRecordsAndExistingProjectInstancePreserved: true, modelCalls: 0 };

  // Add an independent, evidenced chain only after all original 4-node/2-edge,
  // source-version and three-space isolation assertions have completed.
  await reopenEmployee(employee.name);
  const chainMarker = 'EXPLORATION_CHAIN_UI_826';
  const chainDocument = `# 关联探索专业资料\n${chainMarker}\n链路甲：关联探索的起点。\n链路乙：关联探索的第一层邻居。\n链路丙：关联探索中的实体桥接点。\n链路丁：关联探索的末端。\n孤立戊：没有已记录关联的独立概念。\n链路甲依据链路乙。\n链路乙驱动链路丙。\n链路丙产出链路丁。\n`;
  const uploadExplorationDocument = async content => {
    await knowledge.getByRole('button', { name: '上传资料', exact: true }).click();
    const uploaded = page.waitForResponse(response => response.url().endsWith('/digital-workers/api/knowledge/upload') && response.request().postDataJSON()?.files?.some(file => file.name === '关联探索资料.md'));
    await materials.getByLabel('上传专业资料', { exact: true }).setInputFiles({ name: '关联探索资料.md', mimeType: 'text/markdown', buffer: Buffer.from(content) });
    assert.ok((await uploaded).ok());
    await expect.poll(async () => (await library()).status.state, { timeout: 20000 }).toBe('ready');
    await materials.getByRole('button', { name: '刷新专业资料', exact: true }).click();
    await materials.getByRole('button', { name: '关闭专业资料', exact: true }).click();
    const published = await wikiLibrary();
    await expect(graph).toHaveAttribute('data-version', String(published.version));
    return published;
  };
  const originalSemanticGraph = (await wikiLibrary()).graph;
  const chainWiki = await uploadExplorationDocument(chainDocument);
  const semanticNode = ({ community: _community, ...node }) => node;
  for (const node of originalSemanticGraph.nodes) assert.deepEqual(semanticNode(chainWiki.graph.nodes.find(item => item.id === node.id)), semanticNode(node), 'Adding an unrelated chain preserves every existing semantic node independently of presentation community numbering');
  for (const edge of originalSemanticGraph.edges) assert.deepEqual(chainWiki.graph.edges.find(item => item.id === edge.id), edge, 'Adding an unrelated chain preserves existing evidenced relations');
  const chainLabels = ['链路甲', '链路乙', '链路丙', '链路丁', '孤立戊'];
  const chainNodes = chainLabels.map(label => { const node = chainWiki.graph.nodes.find(node => node.label === label); assert.ok(node, `Published semantic node ${label}`); return node; });
  const [alpha, beta, gamma, delta, isolated] = chainNodes;
  assert.equal(gamma.type, 'entity');
  assert.equal(isolated.linkCount, 0);
  assert.equal(chainWiki.graph.nodes.length, originalSemanticGraph.nodes.length + 5);
  assert.equal(chainWiki.graph.edges.length, originalSemanticGraph.edges.length + 3);
  const chainIds = new Set(chainNodes.map(node => node.id));
  const chainEdges = chainWiki.graph.edges.filter(edge => chainIds.has(edge.source) && chainIds.has(edge.target));
  assert.deepEqual(chainEdges.map(edge => [edge.source, edge.target].sort()).sort(), [[alpha.id, beta.id], [beta.id, gamma.id], [gamma.id, delta.id]].map(pair => pair.sort()).sort(), 'Only the three actual undirected topology connections exist');
  assert.deepEqual(chainEdges.flatMap(edge => edge.relations.map(relation => [relation.sourceId, relation.targetId, relation.predicate])).sort(), [[alpha.id, beta.id, '依据'], [beta.id, gamma.id, '驱动'], [gamma.id, delta.id, '产出']].sort(), 'Evidence-bearing semantic predicates retain their original direction');
  assert.ok(chainEdges.every(edge => edge.relations.length === 1 && edge.relations[0].basis === 'explicit' && edge.relations[0].citations.length > 0));
  const fullIds = chainWiki.graph.nodes.map(node => node.id).sort();
  const exploredIds = () => network.getAttribute('data-exploration-nodes').then(value => JSON.parse(value || '[]').sort());
  const highlightedIds = () => network.getAttribute('data-highlighted-nodes').then(value => JSON.parse(value || '[]').sort());
  const expand = reader.locator('.wiki-expand');
  const backToFull = graph.getByRole('button', { name: '适配图谱', exact: true });
  const readExploration = async () => ({ root: await graph.getAttribute('data-exploration-root'), depth: await graph.getAttribute('data-exploration-depth'), explored: await exploredIds(), selected: await selectedGraphNode() });
  const assertExploration = async (ids, depth, label) => {
    await expect(graph).toHaveAttribute('data-exploration-depth', String(depth));
    await expect(graph).toHaveAttribute('data-exploration-root', alpha.id);
    await expect.poll(exploredIds).toEqual(ids.slice().sort());
    assert.deepEqual(await highlightedIds(), ids.slice().sort(), `${label}: highlighted nodes are exactly the explored real set`);
    const expectedEdges = chainEdges.filter(edge => ids.includes(edge.source) && ids.includes(edge.target)).map(edge => edge.id).sort();
    assert.deepEqual(JSON.parse(await network.getAttribute('data-highlighted-edges')).sort(), expectedEdges, `${label}: only real induced edges are highlighted`);
    await expect(network.getByRole('button', { name: '阅读知识 孤立戊', exact: true })).toHaveAttribute('data-dimmed', 'true');
    await expect(network.locator('button[data-node-id]')).toHaveCount(fullIds.length);
    await expect(reader.locator('header > span')).toHaveText('链路甲');
    await expect(reader.locator('.wiki-markdown')).toContainText('关联探索的起点。');
    await assertRightRelationContext(chainWiki, alpha.id, label, false);
  };
  await backToFull.click();
  await expect(network.locator('button[data-node-id]')).toHaveCount(fullIds.length);
  await assertCircularWorldLayout('nine-node evidenced chain with isolated background', [3, 6]);
  assert.deepEqual(await network.locator('button[data-node-id]').evaluateAll(nodes => nodes.map(node => node.dataset.nodeId).sort()), fullIds);
  await expect(network.locator('.wiki-group')).toHaveCount(0);
  await expect.poll(exploredIds).toEqual([]);
  await openPage('链路甲');
  assert.deepEqual(await highlightedIds(), [alpha.id, beta.id].sort(), 'A selected starting concept initially highlights one real hop');
  await expect(graph).toHaveAttribute('data-exploration-depth', '0');
  await expect(expand).toHaveText('展开关联'); await expect(expand).toBeEnabled();
  const stableWorldPositions = await network.locator('button[data-node-id]').evaluateAll(nodes => nodes.map(node => [node.dataset.nodeId, node.dataset.x, node.dataset.y]));
  const callsBeforeExploration = (await llmCalls()).length;
  const knowledgeBeforeExploration = await library();
  const businessBeforeExploration = await snapshot();
  await graph.getByRole('button', { name: '放大图谱', exact: true }).click();
  const beforeFirstFit = await camera();
  await expand.click();
  await assertExploration([alpha.id, beta.id], 1, 'first fit');
  await expect.poll(camera).not.toEqual(beforeFirstFit);
  await expect(reader.getByText('关联知识 1', { exact: true })).toBeVisible();
  await expand.click();
  await assertExploration([alpha.id, beta.id, gamma.id], 2, 'second expansion');
  await expect(reader.getByText('关联知识 2', { exact: true })).toBeVisible();
  const retainedExploration = await readExploration();
  await groupMode.click();
  await categoryMode.click();
  assert.deepEqual(await readExploration(), retainedExploration, 'Color-mode changes preserve the exploration and semantic root');
  await network.getByRole('button', { name: '阅读知识 链路丁', exact: true }).focus();
  assert.deepEqual(await highlightedIds(), [alpha.id, beta.id, gamma.id].sort(), 'Hover/focus cannot replace an explicit exploration set');
  await expand.focus();
  const chainArticleTitle = '知识主题：关联探索资料.md';
  await reader.getByRole('button', { name: `阅读知识 ${chainArticleTitle}`, exact: true }).click();
  assert.deepEqual(await readExploration(), retainedExploration, 'Related B article retains exploration and selected semantic root');
  await assertRightRelationContext(chainWiki, alpha.id, 'explored B article', true);
  await expect(reader).toContainText(chainMarker);
  await reader.getByRole('button', { name: '返回图谱知识 链路甲', exact: true }).click();
  await assertExploration([alpha.id, beta.id, gamma.id], 2, 'return before relationship-linked article');
  const chainRelationContext = await assertRightRelationContext(chainWiki, alpha.id, 'relationship-linked B article', false);
  const chainRelationDetail = chainRelationContext.locator('details.wiki-relation-details');
  await chainRelationDetail.locator(':scope > summary').click();
  await chainRelationDetail.getByRole('button', { name: chainArticleTitle, exact: true }).click();
  assert.deepEqual(await readExploration(), retainedExploration, 'An article opened from relationship evidence retains the original root and explored set');
  await expect(reader.locator('header > span')).toHaveText(chainArticleTitle);
  await assertRightRelationContext(chainWiki, alpha.id, 'relationship evidence B article', true);
  const chainArticle = chainWiki.pages.find(page => page.type === 'synthesis' && page.title === chainArticleTitle);
  const evidence = chainArticle.citations[0];
  const sourceButton = reader.getByRole('button', { name: `查看资料 关联探索资料.md 第 ${evidence.startLine} 至 ${evidence.endLine} 行`, exact: true });
  await sourceButton.focus(); await sourceButton.press('Enter');
  await expect(sourceReader).toContainText(chainMarker);
  assert.deepEqual(await readExploration(), retainedExploration, 'Evidence reading retains explored IDs and root');
  await assertRightRelationContext(chainWiki, alpha.id, 'explored original source');
  await sourceReader.getByRole('button', { name: '返回图谱知识 链路甲', exact: true }).click();
  await assertExploration([alpha.id, beta.id, gamma.id], 2, 'return to root article');
  await expand.click();
  await assertExploration([alpha.id, beta.id, gamma.id, delta.id], 3, 'third expansion');
  await expect(expand).toHaveText('已展开全部关联'); await expect(expand).toBeDisabled();
  await expect(reader.getByText('关联知识 3', { exact: true })).toBeVisible();
  metrics.rightRelationshipReader = { leftOverlayCount: 0, originalDirectionTriple: '模块划分 → 依据 → 职责边界', evidenceInitiallyCollapsed: true,
    keyboardEnterAndSpace: true, exactEvidenceLine: 4, originalRootRetainedThroughArticleAndSource: true,
    relationshipLinkedArticlePreservesExploration: true, rootOneHopListDoesNotBecomeExpandedGraph: true };
  assert.deepEqual(await network.locator('button[data-node-id]').evaluateAll(nodes => nodes.map(node => [node.dataset.nodeId, node.dataset.x, node.dataset.y])), stableWorldPositions, 'Expanding changes focus and camera, never the global graph topology or world layout');
  await page.screenshot({ path: resolve(artifacts, 'knowledge-exploration-chain-expanded.png'), animations: 'disabled' });
  await openPage('孤立戊');
  await expect(expand).toHaveText('暂无关联'); await expect(expand).toBeDisabled();
  await expect(graph).toHaveAttribute('data-exploration-depth', '0');
  await openPage('模块划分');
  await expect(expand).toHaveText('展开关联'); await expect(expand).toBeEnabled();
  await expand.click();
  await expect(expand).toHaveText('已展开全部关联'); await expect(expand).toBeDisabled();
  await backToFull.click();
  await expect(reader).toHaveCount(0); await expect.poll(selectedGraphNode).toBe('');
  await expect.poll(exploredIds).toEqual([]);
  await expect(graph).toHaveAttribute('data-exploration-root', '');
  await expect(graph).toHaveAttribute('data-exploration-depth', '0');
  await expect(search).toHaveValue('');
  await expect(network.locator('button[data-node-id]')).toHaveCount(fullIds.length);
  await assertViewportFit('back to full graph resets exploration without moving semantic nodes', stableWorldPositions.map(([id, x, y]) => ({ id, x, y })));
  assert.deepEqual(await highlightedIds(), []);
  await expect(network.locator('button[data-node-id][data-dimmed="true"]')).toHaveCount(0);

  // A hidden entity in the middle is a real barrier, never a license to bridge B to D.
  await categoryMode.click();
  await types.getByRole('button', { name: '隐藏实体', exact: true }).click();
  await openPage('链路甲'); await expand.click();
  await expect.poll(exploredIds).toEqual([alpha.id, beta.id].sort());
  await expect(expand).toHaveText('已展开全部关联'); await expect(expand).toBeDisabled();
  await expect(network.getByRole('button', { name: '阅读知识 链路丙', exact: true })).toHaveCount(0);
  await expect(network.getByRole('button', { name: '阅读知识 链路丁', exact: true })).toHaveAttribute('data-dimmed', 'true');
  await types.getByRole('button', { name: '显示实体', exact: true }).click();
  await expect.poll(exploredIds).toEqual([]); await expect.poll(selectedGraphNode).toBe('');
  await expect(graph).toHaveAttribute('data-exploration-depth', '0');
  await search.fill('链路甲'); await search.press('Enter');
  await expand.click();
  await expect.poll(exploredIds).toEqual([alpha.id, beta.id].sort());
  await expect(expand).toBeDisabled();
  await expect(network.locator('button[data-node-id]')).toHaveCount(2);
  await search.fill('链路');
  await expect.poll(exploredIds).toEqual([]); await expect.poll(selectedGraphNode).toBe('');
  await backToFull.click();
  assert.equal((await llmCalls()).length, callsBeforeExploration, 'All expansion, filter, article and evidence interactions invoke no model');
  assert.deepEqual((await library()).snapshot, knowledgeBeforeExploration.snapshot, 'Exploration never rewrites knowledge');
  assert.deepEqual(await snapshot(), businessBeforeExploration, 'Exploration is presentation-only and saves no employee or project data');

  await openPage('链路甲'); await expand.click(); await expand.click();
  const oldVersion = chainWiki.version;
  const republishedWiki = await uploadExplorationDocument(chainDocument + '资料版本：第二版，用于验证发布绑定重置。\n');
  assert.notEqual(republishedWiki.version, oldVersion);
  await expect.poll(exploredIds).toEqual([]); await expect.poll(selectedGraphNode).toBe('');
  await expect(graph).toHaveAttribute('data-exploration-depth', '0');
  await expect(reader).toHaveCount(0);
  await openPage('链路甲'); await expand.click(); await expand.click();
  const chainSpace = republishedWiki.spaceId;
  await page.locator('.wf-sidebar').getByRole('button', { name: new RegExp(peer.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
  await editor.getByRole('tab', { name: '认知记忆', exact: true }).click();
  await expect(graph).not.toHaveAttribute('data-space-id', chainSpace);
  await expect.poll(exploredIds).toEqual([]); await expect.poll(selectedGraphNode).toBe('');
  await reopenEmployee(employee.name);
  await expect(graph).toHaveAttribute('data-space-id', chainSpace);
  await expect.poll(exploredIds).toEqual([]); await expect.poll(selectedGraphNode).toBe('');
  await expect(graph).toHaveAttribute('data-exploration-depth', '0');
  metrics.exploration = { marker: chainMarker, graphNodes: chainWiki.graph.nodes.length, graphEdges: chainWiki.graph.edges.length,
    chainLabels, typedBridge: gamma.label, isolatedBackground: true, firstFitThenBfs: [[alpha.id, beta.id], [alpha.id, beta.id, gamma.id], [alpha.id, beta.id, gamma.id, delta.id]],
    exhaustedDisabled: true, isolatedDisabled: true, pairFirstFitEnabled: true, backgroundRetained: true, articleAndEvidenceRetained: true,
    hoverAndColorModeRetained: true, hiddenBridgeNotBypassed: true, searchRespected: true, backToFullResets: true,
    versionReset: { before: oldVersion, after: republishedWiki.version }, spaceReset: true, modelCallsDuringInteraction: 0, knowledgeAndBusinessStateUnchanged: true };
  if (process.env.WORKFORCE_LOCALE_UI === '1') {
    const beforeLocaleChecks = await snapshot();
    const { verifyLocaleLibrary } = await import('./locale-library.checks.mjs');
    try { metrics.locale = await verifyLocaleLibrary({ page, artifacts, switchLocale: locale => switchDshLocale(page, locale), exploration: true }); }
    finally { await switchDshLocale(page, 'zh'); }
    assert.deepEqual(await snapshot(), beforeLocaleChecks, 'Language checks must preserve all saved plugin records');
  }
  assert.deepEqual(pageErrors, [], 'No uncaught browser errors');
  assert.equal(await hostHash(), baseline, 'Official host entry and manifest unchanged');
  await stopHarness();
  await expect.poll(() => workerPids.every(pid => { try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } }), { timeout: 5000 }).toBe(true);
  metrics.sharedWiki.noProcessAfterShutdown = true;
  await writeFile(resolve(artifacts, 'employee-settings-result.json'), JSON.stringify({ status: 'passed', officialHarness: installation.manifest, hostEntryAndManifestSha256: baseline, offlineProvider: 'employee-settings-fixture', metrics, checks: ['four-tabs', 'team-compact-header-and-card-grid', 'team-role-removal-confirmation-and-save', 'team-removal-confirmation-preserves-other-records', 'consistent-danger-colors-dark-light', 'employee-archive-header-location-and-scope', 'employee-archive-cancel-preserves-saved-state-and-draft', 'employee-archive-retains-record-modules-and-project-instance', 'employee-archive-hidden-and-rejects-new-project-copy', 'team-organization-heading-without-tabs-settings-or-large-card', 'team-sidebar-and-org-members-readonly', 'team-librarian-compact-draft-save-discard', 'team-name-and-workflow-data-preserved', 'team-member-naming-import-removal-reporting', 'team-library-created-employee-draft-import-save-and-remove', 'object-headers-without-global-scope-and-tools', 'model-before-role-default-model-tab-and-employee-switch', 'role-ai-label-alignment-responsive', 'role-ai-unsaved-model-and-reasoning', 'role-ai-draft-only-and-explicit-save', 'role-ai-error-preserves-fields-and-retry', 'role-ai-pending-double-click-blocked', 'role-ai-late-input-and-employee-isolation', 'role-ai-default-route-and-missing-model-validation', 'knowledge-actions-muted-theme-colors', 'header-save', 'compact-spacing', 'skill-tool-preferences-persist', 'four-top-category-controls', 'archive-policy-pending-and-persistence', 'archive-policy-offline-retains-state', 'archive-policy-late-response-isolation', 'raw-md-ingestion', 'configured-source-delete-and-draft-rebase', 'uploaded-source-delete', 'offline-two-stage-knowledge-compilation', 'semantic-concept-entity-graph', 'semantic-degrees-and-relation-statistics', 'nonsemantic-pages-excluded-from-graph', 'concept-and-relation-evidence', 'wiki-search-grouping-zoom-pan-drag', 'same-screen-article-reading', 'articles-readable-with-empty-semantic-graph', 'graph-toolbar-without-article-entry', 'knowledge-group-default-and-space-reset', 'node-category-includes-concept-and-entity', 'empty-graph-overview-directory-navigation', 'graph-view-retained-after-reading', 'unboxed-global-overview-keeps-disconnected-components', 'no-community-boxes-or-synthetic-semantic-bridges', 'one-hop-focus-survives-article-and-evidence', 'search-enter-moves-camera', 'clear-search-space-clear-focus', 'back-to-full-graph-restores-overview', 'unchanged-retry-zero-model-calls', 'identical-upload-zero-model-calls', 'unrelated-addition-preserves-knowledge', 'reading-page-count-independent', 'standalone-deletion-withdraws-without-model', 'exact-version-citations', 'two-employees-one-team-isolation', 'one-shared-engine-process', 'no-worker-after-shutdown', 'iframe-scripts-only-sandbox', 'malformed-utf8-rejected', 'dark-light-narrow-short', 'knowledge-exploration-real-chain-and-isolated-background', 'knowledge-exploration-first-fit-then-one-hop-bfs', 'knowledge-exploration-exhaustion-pair-and-isolated-controls', 'knowledge-exploration-reader-evidence-hover-and-color-preservation', 'knowledge-exploration-respects-hidden-entity-bridge-and-search', 'knowledge-exploration-version-space-and-root-reset', 'knowledge-exploration-readonly-zero-model-calls', 'initial-single-and-concentric-ring-world-layout', 'right-reader-only-relationship-triples', 'relationship-evidence-disclosure-keyboard-and-exact-source', 'root-relationships-retained-through-article-source-and-exploration', 'no-page-errors'] }, null, 2));
  console.log('PASS: isolated official DSH employee settings, shared LLM Wiki process, semantic concept/entity graph, full article reading, source isolation, evidence, graph interactions and responsive themes.');
  }
} catch (error) {
  if (page) await page.screenshot({ path: resolve(artifacts, 'employee-settings-failure.png') }).catch(() => {});
  await writeFile(resolve(artifacts, 'employee-settings-failure-metrics.json'), JSON.stringify({ metrics, pageErrors }, null, 2)).catch(() => {});
  console.error(redactWebAuth(error?.stack || String(error)));
  console.error(redactWebAuth(log.slice(-12000)));
  process.exitCode = 1;
} finally {
  await browser?.close();
  await stopHarness();
  await rm(temp, { recursive: true, force: true });
}
