/** Object-scoped configuration transfers against an isolated official Harness profile. */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { resolveCliInstallation } from '../../integration/harness-baseline.mjs';
import { authenticateWeb, redactWebAuth } from '../../integration/web-auth.mjs';
import { installEmployeeSettingsFixture } from './employee-settings-offline.fixture.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
process.env.DSH_INSTALLATION_MANIFEST ||= resolve(root, '.local/official-validation-complete/node_modules/@deepseek-ai/dsh/package.json');
const installation = await resolveCliInstallation(root);
const temp = await mkdtemp(resolve(tmpdir(), 'workforce-object-settings-ui-'));
const artifacts = process.env.WORKFORCE_OBJECT_UI_ARTIFACTS ? resolve(process.env.WORKFORCE_OBJECT_UI_ARTIFACTS) : resolve(root, 'artifacts/object-settings-validation/object-transfer-ui');
const delay = ms => new Promise(done => setTimeout(done, ms));
const hostHash = async () => createHash('sha256').update(await readFile(installation.entry)).update(await readFile(installation.manifest)).digest('hex');
const baseline = await hostHash();
let child, browser, page, cookie = '', log = '', installedPluginRoot = root, llmCallsPath;
const pageErrors = [], checks = [], metrics = {};
const uiArchive = process.env.WORKFORCE_UI_ARCHIVE ? resolve(process.env.WORKFORCE_UI_ARCHIVE) : undefined;
const check = name => { checks.push(name); console.log(`PASS ${name}`); };
const unchangedExcept = (after, before, keys) => assert.deepEqual(Object.fromEntries(Object.entries(after).filter(([key]) => !keys.includes(key))), Object.fromEntries(Object.entries(before).filter(([key]) => !keys.includes(key))));
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
  if (uiArchive) {
    await access(uiArchive);
    await mkdir(packageDirectory, { recursive: true });
    await new Promise((done, reject) => execFile('tar', ['-xzf', uiArchive, '-C', packageDirectory, '--strip-components=1'], error => error ? reject(error) : done()));
    // Runtime peers and test dependencies are resolved from this checkout; the
    // actual plugin executable, iframe and GPL sources come from the archive.
    await symlink(resolve(root, 'node_modules'), resolve(packageDirectory, 'node_modules'), 'dir');
    installedPluginRoot = packageDirectory;
    metrics.pluginArchive = { path: uiArchive, sha256: createHash('sha256').update(await readFile(uiArchive)).digest('hex') };
  } else await symlink(root, packageDirectory, 'dir');
  const fixture = await installEmployeeSettingsFixture(profile, root);
  const { mcpServerPath } = fixture;
  llmCallsPath = fixture.llmCallsPath;
  await writeFile(resolve(profile, 'package.json'), JSON.stringify({ name: 'employee-settings-ui-test', private: true, type: 'module', dependencies: { 'dsh-plugin-composable-workforce': uiArchive ? `file:${uiArchive}` : `link:${root}`, 'dsh-plugin-employee-settings-fixture': '0.0.0', 'dsh-plugin-employee-disabled-fixture': '0.0.0' }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-plugin-composable-workforce', 'dsh-plugin-employee-settings-fixture'] } } }));
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

async function confirmUi(message, accepted, action) {
  const pending = page.waitForEvent('dialog'); const clicked = action(); const dialog = await pending;
  assert.equal(dialog.type(), 'confirm');
  if (message instanceof RegExp) assert.match(dialog.message(), message); else assert.equal(dialog.message(), message);
  if (accepted) await dialog.accept(); else await dialog.dismiss();
  await clicked;
}
async function readDownload(editor) {
  const pending = page.waitForEvent('download'); await editor.getByRole('button', { name: '导出', exact: true }).click();
  const download = await pending; const document = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.match(download.suggestedFilename(), /^graph-horses-template-(employee|team|workflow)-.+\.json$/);
  assert.equal(document.format, 'graph_horses'); assert.equal(document.formatVersion, 1); assert.equal(document.scope, 'template');
  return document;
}
async function importFile(editor, document, name = 'settings.json') {
  await editor.locator('.wf-settings-transfer input[type=file]').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(typeof document === 'string' ? document : JSON.stringify(document)) });
  await expect(editor.locator('.wf-settings-transfer')).not.toHaveAttribute('aria-busy', 'true');
}
const rootObject = bundle => bundle.data[bundle.kind === 'employee' ? 'templates' : bundle.kind === 'team' ? 'teams' : 'workflowTemplates'].find(item => item.id === bundle.root.id);
const readonlyForm = editor => editor.locator('input:not([type=file]),select,textarea').evaluateAll(elements => elements.map(element => ({ label: element.getAttribute('aria-label') || element.labels?.[0]?.textContent, value: element.value, checked: element.type === 'checkbox' ? element.checked : undefined })));

try {
  await mkdir(artifacts, { recursive: true });
  const base = await startHarness();
  const get = async path => { const response = await fetch(`${base}${path}`, { headers: { Cookie: cookie } }); assert.ok(response.ok, await response.clone().text()); return response.json(); };
  const post = async (path, payload) => { const response = await fetch(`${base}${path}`, { method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); assert.ok(response.ok, await response.clone().text()); return response.json(); };
  const command = (action, payload, options) => post('/digital-workers/api/command', { action, payload, ...(options ? { options } : {}) });
  const snapshot = () => get('/digital-workers/api/state');
  const original = await snapshot();
  const modules = structuredClone(original.templates[0].modules);
  modules.model = { mode: 'inherit' }; modules.knowledge.sources = [];
  modules.responsibilities = { mission: 'SOURCE_ROLE_REPLACEMENT', duties: ['SOURCE_DUTY'], boundaries: ['SOURCE_BOUNDARY'] };
  modules.collaboration.allowedTemplateIds = [];
  const { result: dependency } = await command('template.save', { name: 'QA-配置依赖', description: 'DEPENDENCY_RETAINED', status: 'ready', modules });
  const sourceModules = structuredClone(modules); sourceModules.collaboration.allowedTemplateIds = [dependency.id];
  const { result: sourceEmployee } = await command('template.save', { name: 'QA-来源自由职业人', description: 'SOURCE_EMPLOYEE_DESCRIPTION', status: 'ready', modules: sourceModules });
  const targetModules = structuredClone(modules); targetModules.responsibilities = { mission: 'OBSOLETE_ROLE_SHOULD_DISAPPEAR', duties: ['OBSOLETE_DUTY'], boundaries: ['OBSOLETE_BOUNDARY'] };
  const { result: targetEmployee } = await command('template.save', { name: 'QA-目标自由职业人', description: 'OBSOLETE_DESCRIPTION', status: 'ready', modules: targetModules });
  const sourceFlowInput = { name: 'QA-来源工作流', description: 'SOURCE_WORKFLOW_DESCRIPTION', maxAttempts: 2, roles: [{ id: 'source-role', name: '来源负责岗' }], steps: [{ id: 'source-step', name: '来源步骤', roleId: 'source-role', instruction: 'SOURCE_WORKFLOW_TASK', outputs: ['来源结果'], acceptanceCriteria: ['可核对'] }] };
  const { result: sourceWorkflow } = await command('workflow.template.save', sourceFlowInput);
  const { result: targetWorkflow } = await command('workflow.template.save', { ...sourceFlowInput, name: 'QA-目标工作流', description: 'OBSOLETE_WORKFLOW_DESCRIPTION', roles: [{ id: 'obsolete-role', name: '旧岗位' }], steps: [{ id: 'obsolete-step', name: '旧步骤', roleId: 'obsolete-role', instruction: 'OBSOLETE_WORKFLOW_TASK' }] });
  const { result: sourceTeam } = await command('team.save', { name: 'QA-来源团队', description: 'SOURCE_TEAM_DESCRIPTION', knowledgeEnabled: false, members: [{ memberId: 'source-lead', templateId: sourceEmployee.id, name: '来源负责人' }, { memberId: 'source-peer', templateId: dependency.id, name: '来源协作岗', reportsTo: 'source-lead' }], workflows: [{ id: 'source-team-flow', name: sourceWorkflow.name, sourceTemplateId: sourceWorkflow.id, sourceTemplateVersion: sourceWorkflow.version, maxAttempts: 2, steps: sourceWorkflow.steps.map(({ roleId: _, ...step }) => ({ ...step, memberId: 'source-lead' })) }] });
  const { result: targetTeam } = await command('team.save', { name: 'QA-目标团队', description: 'OBSOLETE_TEAM_DESCRIPTION', knowledgeEnabled: true, members: [{ memberId: 'obsolete-member', templateId: targetEmployee.id, name: '旧团队岗位' }], workflows: [] });
  const projectPath = resolve(temp, 'preserved-project'); await mkdir(projectPath);
  const registered = await post('/api/workspace/create', { type: 'client-request', rpcId: randomUUID(), method: 'workspace/create', payload: { args: { request: { path: projectPath } } } });
  assert.equal(registered.result?.ok, true); const projectId = registered.result.value.workspace.workspaceId;
  await expect.poll(async () => (await snapshot()).projects.some(project => project.id === projectId), { timeout: 10000 }).toBe(true);
  await command('team.instantiate', { projectId, teamId: targetTeam.id });
  const sourceRecords = { employee: sourceEmployee, team: sourceTeam, workflow: sourceWorkflow };
  const targets = { employee: targetEmployee, team: targetTeam, workflow: targetWorkflow };
  const sourceBundles = {};
  for (const kind of ['employee', 'team', 'workflow']) sourceBundles[kind] = (await command('bundle.export', { scope: 'template', kind, id: sourceRecords[kind].id })).result;
  const preserved = await snapshot();
  check('isolated-official-profile-and-project-instance-fixtures');

  browser = await chromium.launch({ headless: true, ...(process.env.WORKFORCE_BROWSER_CHANNEL === 'bundled' ? {} : { channel: process.env.WORKFORCE_BROWSER_CHANNEL || 'chrome' }) });
  metrics.browser = { channel: process.env.WORKFORCE_BROWSER_CHANNEL || 'chrome', version: browser.version() };
  page = await browser.newPage({ viewport: { width: 1512, height: 1050 }, locale: 'zh-CN', colorScheme: 'dark' });
  page.on('pageerror', error => pageErrors.push(error.message));
  const separator = cookie.indexOf('='); await page.context().addCookies([{ name: cookie.slice(0, separator), value: cookie.slice(separator + 1), url: base, httpOnly: true, sameSite: 'Strict' }]);
  const requests = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/digital-workers/api/command')) requests.push(request.postDataJSON()); });
  async function openWorkspace(reload = false) {
    if (reload) await page.reload({ waitUntil: 'domcontentloaded' }); else await page.goto(base, { waitUntil: 'domcontentloaded' });
    for (const name of ['继续', '稍后配置']) { const button = page.getByRole('button', { name, exact: true }); if (await button.waitFor({ state: 'visible', timeout: 2500 }).then(() => true).catch(() => false)) await button.click(); }
    if (!await page.getByRole('navigation', { name: '资源库', exact: true }).isVisible().catch(() => false)) await page.getByRole('button', { name: 'graph_horses', exact: true }).click();
    await expect(page.getByRole('navigation', { name: '资源库', exact: true })).toBeVisible();
  }
  await openWorkspace();
  const sections = page.getByRole('navigation', { name: '资源库', exact: true });
  const section = kind => sections.getByRole('button', { name: kind === 'employee' ? /^自由职业人库/ : kind === 'team' ? /^团队/ : /^工作流/ });
  async function choose(kind, record) {
    await section(kind).click();
    const selector = kind === 'workflow' ? '.wf-workflow-nav-item' : kind === 'team' ? '.wf-team-nav-heading' : '.wf-employee-nav-item';
    await page.locator(`.wf-sidebar ${selector}`).filter({ hasText: record.name }).click();
    const editor = page.locator(kind === 'employee' ? '.wf-employee-editor' : kind === 'workflow' ? '.wf-workflow-template-editor' : '.wf-team-editor-compact:not(.wf-workflow-template-editor)');
    await expect(editor).toBeVisible(); return editor;
  }
  const nameField = (editor, kind) => editor.getByRole('textbox', { name: kind === 'employee' ? '员工名称' : kind === 'team' ? '团队名称' : '工作流名称', exact: true });
  const saveButton = (editor, kind) => editor.getByRole('button', { name: kind === 'employee' ? '保存配置' : kind === 'team' ? '保存团队' : '保存工作流', exact: true });
  async function verifyChrome(editor, kind, suffix) {
    const header = editor.locator(kind === 'employee' ? '.wf-editor-hero' : '.wf-team-toolbar');
    const texts = (await header.getByRole('button').allTextContents()).map(value => value.trim()).filter(value => ['移除', '导入', '导出', '保存'].includes(value));
    assert.deepEqual(texts, ['移除', '导入', '导出', '保存']);
    await expect(editor.locator('footer')).toHaveCount(0); await expect(editor.getByRole('button', { name: '还原修改', exact: true })).toHaveCount(0);
    await expect(page.getByRole('group', { name: '配置范围', exact: true })).toHaveCount(0);
    for (const name of ['导入 JSON', '导出 JSON', '刷新 graph_horses']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    await expect(nameField(editor, kind)).toHaveCount(1);
    const geometry = await header.evaluate(element => { const box = element.getBoundingClientRect(); return { width: box.width, height: box.height, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, buttons: [...element.querySelectorAll('button')].map(button => { const rect = button.getBoundingClientRect(); return { name: button.getAttribute('aria-label') || button.textContent.trim(), left: rect.left, right: rect.right, width: rect.width, bottom: rect.bottom, top: rect.top, height: rect.height }; }), left: box.left, right: box.right, top: box.top, bottom: box.bottom }; });
    assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1, `${kind} ${suffix}: header must not overflow horizontally`);
    assert.ok(geometry.buttons.every(button => button.left >= geometry.left - 1 && button.right <= geometry.right + 1 && button.top >= geometry.top - 1 && button.bottom <= geometry.bottom + 1 && button.height >= 24), `${kind} ${suffix}: every action stays readable and reachable: ${JSON.stringify(geometry)}`);
    await page.screenshot({ path: resolve(artifacts, `${kind}-${suffix}.png`) }); return geometry;
  }
  for (const kind of ['employee', 'team', 'workflow']) {
    const target = targets[kind]; let editor = await choose(kind, target);
    const metadataBefore = await snapshot();
    const collection = kind === 'employee' ? 'templates' : kind === 'team' ? 'teams' : 'workflowTemplates';
    metrics[kind] = { rootId: target.id, desktop: await verifyChrome(editor, kind, 'desktop-dark') };
    const remove = editor.getByRole('button', { name: kind === 'employee' ? '移除自由职业人' : kind === 'team' ? '移除团队' : '移除工作流', exact: true });
    await confirmUi(/(确定移除|移除后)/, false, () => remove.click());
    assert.deepEqual(await snapshot(), metadataBefore); check(`${kind}-header-order-no-global-controls-remove-cancel`);
    await nameField(editor, kind).fill(`QA-${kind}-PREIMPORT_OLD_VALUE`);
    if (kind === 'employee') await editor.getByRole('tab', { name: '岗位定义', exact: true }).click();
    const preImportForm = await readonlyForm(editor); const beforeInvalid = await snapshot(); const invalidRequestStart = requests.length;
    const invalidDependency = structuredClone(sourceBundles[kind]);
    if (kind === 'employee') rootObject(invalidDependency).modules.collaboration.allowedTemplateIds = ['missing-template'];
    else if (kind === 'team') rootObject(invalidDependency).members[0].templateId = 'missing-template';
    else rootObject(invalidDependency).steps[0].roleId = 'missing-role';
    const credential = structuredClone(sourceBundles[kind]);
    if (!credential.data.templates.length) credential.data.templates = [structuredClone(sourceEmployee), structuredClone(dependency)];
    credential.data.templates[0].modules.knowledge.sources = [{ id: 'bad-credential', title: '不应导入的地址', kind: 'url', value: 'https://example.invalid/data?api_key=TEST_ONLY_SECRET' }];
    const wrongKind = sourceBundles[kind === 'employee' ? 'team' : 'employee'];
    for (const [label, bad] of [['invalid-json', '{broken'], ['wrong-kind', wrongKind], ['oversized', 'x'.repeat(1_048_577)], ['invalid-dependency', invalidDependency], ['credential-url', credential]]) {
      await importFile(editor, bad, `${label}.json`); await expect(editor.locator('.wf-settings-transfer-error')).toBeVisible();
      assert.deepEqual(await readonlyForm(editor), preImportForm, `${kind}/${label}: the entire preexisting draft survives`);
      assert.deepEqual(await snapshot(), beforeInvalid); assert.equal(requests.length, invalidRequestStart, `${kind}/${label}: no command is sent`);
    }
    check(`${kind}-five-invalid-imports-preserve-draft-and-zero-writes`);
    await importFile(editor, sourceBundles[kind]); await expect(nameField(editor, kind)).toHaveValue(sourceRecords[kind].name);
    assert.deepEqual(await snapshot(), beforeInvalid); assert.equal(requests.length, invalidRequestStart);
    if (kind === 'employee') {
      await expect(editor.getByLabel('岗位角色', { exact: true })).toHaveValue('SOURCE_ROLE_REPLACEMENT');
      await expect(editor.getByLabel('工作职责', { exact: true })).toHaveValue('SOURCE_DUTY');
      await expect(editor.getByLabel('工作规范与边界', { exact: true })).toHaveValue('SOURCE_BOUNDARY');
    } else if (kind === 'team') {
      await expect(editor.getByLabel('团队岗位', { exact: true })).toHaveCount(2);
      assert.deepEqual(await editor.getByLabel('团队岗位', { exact: true }).evaluateAll(elements => elements.map(element => element.value)), ['来源负责人', '来源协作岗']);
      await expect(editor.getByRole('switch', { name: '资料管理员', exact: true })).toHaveAttribute('aria-checked', 'false');
    } else {
      await expect(editor.getByLabel('工作流说明', { exact: true })).toHaveCount(0);
      await expect(editor.getByLabel('流程岗位名称', { exact: true })).toHaveCount(0);
      await expect(editor.getByLabel('负责人', { exact: true }).locator('option:checked')).toHaveText('来源负责岗');
      await expect(editor.getByLabel('步骤说明', { exact: true })).toHaveValue('SOURCE_WORKFLOW_TASK');
    }
    const imported = await readDownload(editor); assert.equal(imported.root.id, target.id); assert.equal(rootObject(imported).version, target.version); assert.equal(rootObject(imported).createdAt, target.createdAt);
    if (kind === 'workflow') { assert.equal(rootObject(imported).description, 'SOURCE_WORKFLOW_DESCRIPTION'); assert.deepEqual(rootObject(imported).roles.map(role => role.name), ['来源负责岗']); }
    const oldPreview = (await command('bundle.preview', { document: imported, target: { scope: 'template' } })).result;
    assert.equal(oldPreview.kind, kind); assert.equal(oldPreview.name, sourceRecords[kind].name);
    check(`${kind}-legacy-v1-import-replaces-form-and-new-export-old-preview-compatible`);
    await confirmUi('当前配置尚未保存，确定放弃修改？', false, () => section(kind === 'team' ? 'employee' : 'team').click());
    await expect(nameField(editor, kind)).toHaveValue(sourceRecords[kind].name); assert.deepEqual(await snapshot(), beforeInvalid);
    await confirmUi('当前配置尚未保存，确定放弃修改？', true, () => section(kind === 'team' ? 'employee' : 'team').click());
    editor = await choose(kind, target); await expect(nameField(editor, kind)).toHaveValue(target.name); assert.deepEqual(await snapshot(), beforeInvalid);
    check(`${kind}-navigation-cancel-retains-and-confirmed-discard-never-saves`);
    await importFile(editor, sourceBundles[kind]);
    await nameField(editor, kind).fill(`QA-${kind}-IMPORTED_EDIT_ONE`);
    const edited = await readDownload(editor); assert.equal(rootObject(edited).name, `QA-${kind}-IMPORTED_EDIT_ONE`); assert.equal(edited.root.id, target.id);
    if (kind !== 'workflow') {
      const withLocal = structuredClone(edited); withLocal.data.templates[0].modules.knowledge.sources.push({ id: 'local-only-declaration', title: '本地专业声明', kind: 'project-file', value: 'docs/local-professional-declaration.md' });
      await importFile(editor, withLocal); await nameField(editor, kind).fill(`QA-${kind}-IMPORTED_EDIT_ONE`);
      const portable = await readDownload(editor); assert.ok(portable.data.templates.every(template => template.modules.knowledge.sources.every(source => source.kind !== 'project-file')));
    }
    const beforeSave = await snapshot();
    const responsePending = page.waitForResponse(response => response.url().endsWith('/digital-workers/api/command') && response.request().postDataJSON()?.action === 'settings.bundle.save');
    await saveButton(editor, kind).click(); const savedResponse = await responsePending; assert.ok(savedResponse.ok(), await savedResponse.text());
    assert.equal(savedResponse.request().postDataJSON().options.expectedVersion, target.version);
    const savedPayload = savedResponse.request().postDataJSON().payload.bundle; assert.equal(savedPayload.root.id, target.id);
    await expect(saveButton(editor, kind)).toBeDisabled();
    const afterSave = await snapshot(); const savedRoot = afterSave[collection].find(item => item.id === target.id);
    assert.equal(savedRoot.name, `QA-${kind}-IMPORTED_EDIT_ONE`); assert.equal(savedRoot.version, target.version + 1); assert.equal(savedRoot.createdAt, target.createdAt);
    unchangedExcept(afterSave, beforeSave, ['revision', 'templates', 'teams', 'workflowTemplates']);
    for (const key of ['templates', 'teams', 'workflowTemplates']) for (const item of beforeSave[key] ?? []) if (!(key === collection && item.id === target.id)) assert.deepEqual(afterSave[key].find(value => value.id === item.id), item, 'Every unrelated preexisting configuration remains identical');
    if (kind !== 'workflow') assert.ok(savedPayload.data.templates.some(template => template.modules.knowledge.sources.some(source => source.kind === 'project-file' && source.value === 'docs/local-professional-declaration.md')));
    check(`${kind}-edited-import-explicit-atomic-save-retains-id-version-createdAt-and-unrelated-state`);
    await nameField(editor, kind).fill(`QA-${kind}-IMPORTED_EDIT_TWO`);
    const second = page.waitForResponse(response => response.url().endsWith('/digital-workers/api/command') && ['template.save', 'employee.configuration.save', 'team.save', 'workflow.template.save'].includes(response.request().postDataJSON()?.action));
    await saveButton(editor, kind).click(); assert.ok((await second).ok()); await expect(saveButton(editor, kind)).toBeDisabled();
    const afterSecond = await snapshot(); const secondRoot = afterSecond[collection].find(item => item.id === target.id); assert.equal(secondRoot.name, `QA-${kind}-IMPORTED_EDIT_TWO`); assert.equal(secondRoot.version, target.version + 2);
    for (const key of ['templates', 'teams', 'workflowTemplates']) assert.equal(afterSecond[key]?.length, afterSave[key]?.length);
    targets[kind] = secondRoot;
    check(`${kind}-second-edit-save-clears-staged-dependencies-without-duplicates`);
    await page.emulateMedia({ colorScheme: 'light' }); await page.setViewportSize({ width: 860, height: 760 });
    metrics[kind].narrowLight = await verifyChrome(editor, kind, 'narrow-light');
    await page.emulateMedia({ colorScheme: 'dark' }); await page.setViewportSize({ width: 1512, height: 1050 });
  }
  // A dependency collision must roll back earlier dependency inserts and the root.
  let editor = await choose('team', targets.team);
  await importFile(editor, sourceBundles.team); const stagedTeam = await readDownload(editor);
  assert.ok(stagedTeam.data.templates.length >= 2);
  const intruder = stagedTeam.data.templates.at(-1);
  await command('template.save', { id: intruder.id, name: 'QA-外部冲突配置', description: 'EXTERNAL_COLLISION_PRESERVED', status: intruder.status, modules: intruder.modules });
  const beforeCollision = await snapshot(); const conflictPending = page.waitForResponse(response => response.url().endsWith('/digital-workers/api/command') && response.request().postDataJSON()?.action === 'settings.bundle.save');
  await saveButton(editor, 'team').click(); assert.equal((await conflictPending).status(), 409);
  assert.deepEqual(await snapshot(), beforeCollision); await expect(nameField(editor, 'team')).toHaveValue(sourceTeam.name); await expect(saveButton(editor, 'team')).toBeEnabled();
  for (const dependency of stagedTeam.data.templates.slice(0, -1)) assert.equal((await snapshot()).templates.some(item => item.id === dependency.id), false);
  check('dependency-conflict-rolls-back-all-earlier-inserts-and-retains-draft');
  await importFile(editor, sourceBundles.team);
  const retryPending = page.waitForResponse(response => response.url().endsWith('/digital-workers/api/command') && response.request().postDataJSON()?.action === 'settings.bundle.save');
  await saveButton(editor, 'team').click(); assert.ok((await retryPending).ok()); await expect(saveButton(editor, 'team')).toBeDisabled();
  assert.deepEqual((await snapshot()).templates.find(item => item.id === intruder.id), beforeCollision.templates.find(item => item.id === intruder.id));
  check('reimport-after-collision-remaps-fresh-dependencies-and-retry-succeeds');

  // Optimistic concurrency retains the imported draft and the external edit.
  editor = await choose('workflow', targets.workflow); await importFile(editor, sourceBundles.workflow);
  const externalWorkflow = targets.workflow;
  await command('workflow.template.save', { id: externalWorkflow.id, name: 'QA-工作流外部更新', description: externalWorkflow.description, roles: externalWorkflow.roles, steps: externalWorkflow.steps, maxAttempts: externalWorkflow.maxAttempts }, { expectedVersion: externalWorkflow.version });
  const beforeStale = await snapshot(); const stalePending = page.waitForResponse(response => response.url().endsWith('/digital-workers/api/command') && response.request().postDataJSON()?.action === 'settings.bundle.save');
  await saveButton(editor, 'workflow').click(); assert.equal((await stalePending).status(), 409);
  assert.deepEqual(await snapshot(), beforeStale); await expect(nameField(editor, 'workflow')).toHaveValue(sourceWorkflow.name); await expect(saveButton(editor, 'workflow')).toBeEnabled();
  check('stale-root-version-rejected-atomically-with-imported-draft-retained');
  await confirmUi('当前配置尚未保存，确定放弃修改？', true, () => section('team').click());
  await openWorkspace(true);
  const latestWorkflow = (await snapshot()).workflowTemplates.find(item => item.id === externalWorkflow.id);
  editor = await choose('workflow', latestWorkflow); await expect(nameField(editor, 'workflow')).toHaveValue(latestWorkflow.name);
  await importFile(editor, sourceBundles.workflow);
  const recoveredPending = page.waitForResponse(response => response.url().endsWith('/digital-workers/api/command') && response.request().postDataJSON()?.action === 'settings.bundle.save');
  await saveButton(editor, 'workflow').click(); assert.ok((await recoveredPending).ok()); await expect(saveButton(editor, 'workflow')).toBeDisabled();
  check('reload-current-version-and-import-retry-succeeds');

  // A browser fixture controls readonly/busy transitions without mutating DSH.
  // It uses the exact source component files shipped in the frozen package.
  const fixtureEntry = resolve(temp, 'object-settings-race.tsx');
  const fixtureHtml = resolve(temp, 'object-settings-race.html');
  const fixtureJs = resolve(temp, 'object-settings-race.js');
  await writeFile(fixtureEntry, `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TeamEditor } from ${JSON.stringify(resolve(installedPluginRoot, 'src/ui/TeamEditor.tsx'))};
import { ObjectSettingsTransfer } from ${JSON.stringify(resolve(installedPluginRoot, 'src/ui/ObjectSettingsTransfer.tsx'))};
const input = window.__settingsFixture;
window.__imports = 0; window.__fakeSaves = 0;
const originalText = File.prototype.text;
File.prototype.text = function() { if (!this.name.startsWith('delayed-')) return originalText.call(this); return new Promise(resolve => { window.__releaseFile = () => resolve(JSON.stringify(input.document)); }); };
function App() {
  const [disabled,setDisabled]=useState(false),[alternate,setAlternate]=useState(false),[mounted,setMounted]=useState(true),[draftName,setDraftName]=useState('UNTOUCHED_FIXTURE_DRAFT');
  const target=alternate?input.alternate:input.target;
  return <><button id="disable" onClick={()=>setDisabled(true)}>Readonly</button><button id="enable" onClick={()=>setDisabled(false)}>Editable</button><button id="target" onClick={()=>setAlternate(value=>!value)}>Other target</button><button id="unmount" onClick={()=>setMounted(false)}>Unmount team</button><button id="mount" onClick={()=>setMounted(true)}>Remount team</button><input id="draft-name" readOnly value={draftName}/><ObjectSettingsTransfer state={input.state} kind="employee" root={target} disabled={disabled} onImport={bundle=>{window.__imports++;setDraftName(bundle.data.templates.find(item=>item.id===bundle.root.id).name)}} />{mounted&&<TeamEditor templates={input.state.templates} settingsState={input.state} busy={disabled} onDirty={()=>{}} onSelectMember={()=>{}} onAddEmployee={()=>{}} onSave={async()=>{window.__fakeSaves++;return true}} />}</>;
}
createRoot(document.getElementById('root')).render(<App/>);
`);
  await build({ entryPoints: [fixtureEntry], outfile: fixtureJs, bundle: true, format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic', nodePaths: [resolve(root, 'node_modules')], loader: { '.css': 'empty' }, logLevel: 'silent' });
  await writeFile(fixtureHtml, '<!doctype html><html><meta charset="utf-8"><div id="root"></div><script src="./object-settings-race.js"></script></html>');
  const fixturePage = await browser.newPage({ acceptDownloads: true });
  await fixturePage.addInitScript(value => { window.__settingsFixture = value; }, { state: await snapshot(), target: targets.employee, alternate: dependency, document: sourceBundles.employee });
  await fixturePage.goto(`file://${fixtureHtml}`); await expect(fixturePage.locator('#draft-name')).toHaveValue('UNTOUCHED_FIXTURE_DRAFT');
  const fixtureTransfer = fixturePage.locator('#root > .wf-settings-transfer');
  for (const mode of ['readonly-toggle', 'target-change']) {
    await fixtureTransfer.locator('input[type=file]').setInputFiles({ name: `delayed-${mode}.json`, mimeType: 'application/json', buffer: Buffer.from('{}') });
    await expect.poll(() => fixturePage.evaluate(() => typeof window.__releaseFile)).toBe('function');
    if (mode === 'readonly-toggle') { await fixturePage.locator('#disable').click(); await fixturePage.locator('#enable').click(); } else await fixturePage.locator('#target').click();
    await fixturePage.evaluate(() => { window.__releaseFile(); delete window.__releaseFile; });
    await expect(fixtureTransfer).not.toHaveAttribute('aria-busy', 'true');
    assert.equal(await fixturePage.evaluate(() => window.__imports), 0); await expect(fixturePage.locator('#draft-name')).toHaveValue('UNTOUCHED_FIXTURE_DRAFT');
    check(`late-file-read-${mode}-cannot-overwrite-current-draft`);
  }
  const fixtureTeam = fixturePage.locator('.wf-team-editor');
  await fixtureTeam.locator('.wf-settings-transfer input[type=file]').setInputFiles({ name: 'team-config.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(sourceBundles.team)) });
  await expect(fixtureTeam.getByRole('textbox', { name: '团队名称', exact: true })).toHaveValue(sourceTeam.name);
  const fixtureDownload = async () => { const pending = fixturePage.waitForEvent('download'); await fixtureTeam.getByRole('button', { name: '导出', exact: true }).click(); return JSON.parse(await readFile(await (await pending).path(), 'utf8')); };
  const beforeRemount = await fixtureDownload(); await fixturePage.locator('#unmount').click(); await expect(fixtureTeam).toHaveCount(0); await fixturePage.locator('#mount').click();
  await expect(fixtureTeam.getByRole('textbox', { name: '团队名称', exact: true })).toHaveValue(sourceTeam.name);
  const afterRemount = await fixtureDownload(); assert.equal(afterRemount.root.id, beforeRemount.root.id);
  // A new, unsaved root has no persisted creation time. Only those two local
  // synthetic timestamps may be regenerated by a fresh component mount.
  const initialNewRoot = rootObject(beforeRemount);
  const normalizedRemountData = { ...afterRemount.data, teams: afterRemount.data.teams.map(team => team.id === afterRemount.root.id ? { ...team, createdAt: initialNewRoot.createdAt, updatedAt: initialNewRoot.updatedAt } : team) };
  assert.deepEqual(normalizedRemountData, beforeRemount.data); assert.equal(await fixturePage.evaluate(() => window.__fakeSaves), 0);
  check('new-team-imported-draft-remount-preserves-root-id-and-complete-dependencies');
  await fixturePage.close();

  const finalState = await snapshot();
  unchangedExcept(finalState, preserved, ['revision', 'templates', 'teams', 'workflowTemplates']);
  const modelCalls = (await readFile(llmCallsPath, 'utf8').catch(error => error.code === 'ENOENT' ? '' : Promise.reject(error))).trim().split('\n').filter(Boolean);
  assert.equal(modelCalls.length, 0); check('all-transfers-zero-model-calls-and-project-execution-state-identical');
  assert.deepEqual(pageErrors, []); assert.equal(await hostHash(), baseline); check('no-browser-errors-and-official-host-entry-manifest-unchanged');
  await stopHarness();
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify({ status: 'passed', pluginArchive: metrics.pluginArchive, officialHarness: installation.manifest, hostEntryAndManifestSha256: baseline, browser: metrics.browser, checks, checkCount: checks.length, modelCalls: 0, metrics }, null, 2));
  console.log(`PASS: ${checks.length} object settings transfer browser checks.`);
} catch (error) {
  if (page) await page.screenshot({ path: resolve(artifacts, 'failure.png') }).catch(() => {});
  await writeFile(resolve(artifacts, 'failure-report.json'), JSON.stringify({ checks, metrics, pageErrors }, null, 2)).catch(() => {});
  console.error(redactWebAuth(error?.stack || String(error))); console.error(redactWebAuth(log.slice(-10000))); process.exitCode = 1;
} finally {
  await browser?.close(); await stopHarness(); await rm(temp, { recursive: true, force: true });
}
