/**
 * Native project staffing regression, isolated from the user's profile/data.
 * Prerequisites: npm run setup && npm run build; installed Playwright browser.
 * Run manually: node tests/ui/project-staffing.e2e.mjs
 * CUA-only fixture: WORKFORCE_FIXTURE_ONLY=1 WORKFORCE_PORT=3198 node tests/ui/project-staffing.e2e.mjs
 * No model request is made. The temporary Harness and folders are removed on exit.
 */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installWorkflowFixture, seedWorkflowFixture } from './workflow-offline.fixture.mjs';
import { resolveCliInstallation } from '../../integration/harness-baseline.mjs';
import { authenticateWeb, redactWebAuth } from '../../integration/web-auth.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
process.env.DSH_INSTALLATION_MANIFEST ||= resolve(root, '.local/official-validation/node_modules/@deepseek-ai/dsh/package.json');
const installation = await resolveCliInstallation(root);
const delay = ms => new Promise(done => setTimeout(done, ms));
const temp = await mkdtemp(resolve(tmpdir(), 'workforce-staffing-ui-'));
const artifactDir = resolve(root, process.env.WORKFORCE_UI_ARTIFACT_DIR || 'artifacts/ui');
let processHandle;
let browser;
let page;
let serviceLog = '';
let cookie = '';

async function availablePort() {
  const server = createServer();
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  await new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
  return address.port;
}

async function startHarness() {
  await access(resolve(root, 'lib/index.js'));
  await access(installation.entry);
  const home = resolve(temp, 'harness');
  const profile = resolve(home, 'profiles/web');
  await mkdir(resolve(profile, 'node_modules'), { recursive: true });
  await symlink(root, resolve(profile, 'node_modules/dsh-plugin-composable-workforce'), 'dir');
  const workflowFixture = process.env.WORKFORCE_WORKFLOW_FIXTURE === '1';
  if (workflowFixture) await installWorkflowFixture(profile, root);
  await writeFile(resolve(profile, 'package.json'), JSON.stringify({
    name: 'workforce-project-staffing-test', private: true, type: 'module',
    dependencies: { 'dsh-plugin-composable-workforce': `link:${root}` },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-plugin-composable-workforce', ...(workflowFixture ? ['dsh-plugin-workflow-ui-fixture'] : [])] } },
  }, null, 2));
  await writeFile(resolve(profile, 'cordis.patch.yml'), `- id: composable-workforce\n  config:\n    statePath: ${JSON.stringify(resolve(temp, 'workforce.json'))}\n`);
  const port = process.env.WORKFORCE_PORT ? Number(process.env.WORKFORCE_PORT) : await availablePort();
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, 'WORKFORCE_PORT must be a valid TCP port');
  const base = `http://127.0.0.1:${port}`;
  processHandle = spawn(process.execPath, [installation.entry, '--profile', 'web', '--port', String(port), '--no-open'], {
    cwd: root, env: { ...process.env, DSH_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [processHandle.stdout, processHandle.stderr]) stream.on('data', chunk => { serviceLog = (serviceLog + chunk.toString()).slice(-20000); });
  for (let i = 0; i < 120; i++) {
    if (processHandle.exitCode !== null) throw new Error(`Temporary Harness exited: ${redactWebAuth(serviceLog)}`);
    if (!cookie) {
      const auth = await authenticateWeb(serviceLog, base).catch(() => undefined);
      if (!auth) { await delay(250); continue; }
      cookie = auth.cookie;
    }
    const ready = await fetch(`${base}/digital-workers/api/state`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(500) }).then(r => r.ok).catch(() => false);
    if (ready) return base;
    await delay(250);
  }
  throw new Error(`Temporary Harness did not become ready: ${redactWebAuth(serviceLog)}`);
}

try {
  await mkdir(artifactDir, { recursive: true });
  const base = await startHarness();
  const post = async (path, body) => {
    const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, Cookie: cookie }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
    return response.json();
  };
  const command = (action, payload) => post('/digital-workers/api/command', { action, payload });
  const snapshot = async () => (await fetch(`${base}/digital-workers/api/state`, { headers: { Cookie: cookie } })).json();
  const native = async (method, payload) => {
    const [namespace, verb] = method.split('.');
    const endpoint = `${namespace}/${verb}`;
    const response = await post(`/api/${endpoint}`, { type: 'client-request', rpcId: randomUUID(), method: endpoint, payload: { args: { request: payload } } });
    if (!response.result?.ok) throw new Error(`Native ${method}: ${JSON.stringify(response.result)}`);
    return response.result.value;
  };
  const projectPathA = resolve(temp, 'QA-项目甲');
  const projectPathB = resolve(temp, 'QA-项目乙');
  await Promise.all([mkdir(projectPathA), mkdir(projectPathB)]);
  const { workspace: workspaceA } = await native('workspace.create', { path: projectPathA });
  const { workspace: workspaceB } = await native('workspace.create', { path: projectPathB });
  const state = await snapshot();
  const original = state.templates.find(item => item.id === 'employee-template-architect');
  assert.ok(original);
  const sourceModules = structuredClone(original.modules);
  // Team knowledge jobs must never reach a paid provider during this UI regression.
  sourceModules.model = { mode: 'override', provider: 'workforce-ui-offline-unregistered', model: 'offline' };
  sourceModules.permissions.readPaths = ['src/**'];
  sourceModules.permissions.writePaths = ['docs/architecture/**'];
  const { result: template } = await command('template.save', { name: 'QA-架构员工模板', description: '项目配置回归测试模板', status: 'ready', modules: sourceModules });
  const { result: draft } = await command('template.save', { name: 'QA-尚未发布模板', status: 'draft', modules: sourceModules });
  const { result: archived } = await command('template.save', { name: 'QA-归档模板', status: 'archived', modules: sourceModules });
  const { result: otherEmployees } = await command('project.employees.create', { projectId: workspaceB.workspaceId, employees: [{ key: 'other', templateId: template.id, templateVersion: template.version, name: 'QA-乙项目专属架构师' }] });
  await command('memory.save', { projectId: workspaceB.workspaceId, scope: 'employee', employeeId: otherEmployees[0].id, title: 'QA-乙项目私有记忆', content: 'FOREIGN_PROJECT_PRIVATE_MEMORY', source: { kind: 'user-confirmed', reference: '隔离回归测试的明确输入' } });

  if (process.env.WORKFORCE_FIXTURE_ONLY === '1') {
    const workflow = process.env.WORKFORCE_WORKFLOW_FIXTURE === '1' ? await seedWorkflowFixture(command, state, workspaceA) : undefined;
    // This mode creates only a local API fixture; all browser interaction remains with CUA.
    console.log(JSON.stringify({ base, home: resolve(temp, 'harness'), statePath: resolve(temp, 'workforce.json'), workspaceA, workspaceB, ...(workflow ? { workflow } : { template }), otherEmployeeId: otherEmployees[0].id }, null, 2));
    console.log('Fixture ready. Send SIGTERM or SIGINT to stop the temporary Harness and remove its data.');
    await new Promise(done => { process.once('SIGTERM', done); process.once('SIGINT', done); });
  } else {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1480, height: 1050 }, locale: 'zh-CN', colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const split = cookie.indexOf('=');
  await page.context().addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split+1), url: base, httpOnly: true, sameSite: 'Strict' }]);
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'graph_horses', exact: true }).waitFor();
  await page.getByRole('button', { name: '继续', exact: true }).click();
  const later = page.getByRole('button', { name: '稍后配置', exact: true });
  if (await later.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) await later.click();

  // Build the team workflow through the same UI a user edits.
  const { result: team } = await command('team.save', { name: 'QA-应用开发团队', members: [
    { memberId: 'lead', templateId: template.id },
    { memberId: 'designer', templateId: draft.id, reportsTo: 'lead' },
  ] });
  const { result: legacy } = await command('employee.create', { projectId: workspaceA.workspaceId, templateId: template.id, name: 'QA-既有架构师' });
  await command('memory.save', { projectId: workspaceA.workspaceId, scope: 'employee', employeeId: legacy.id, title: 'QA-既有员工记忆', content: 'KEEP_EXISTING_MEMORY', source: { kind: 'user-confirmed', reference: '测试确认' } });
  await page.getByRole('button', { name: 'graph_horses', exact: true }).click();
  await page.getByRole('navigation', { name: '通用模板类型', exact: true }).getByRole('button', { name: /^团队/ }).click();
  await page.getByRole('button', { name: /QA-应用开发团队/ }).click();
  const saveTeamThroughUi = async () => {
    const saved = page.waitForResponse(response => response.url().endsWith('/digital-workers/api/command') && response.request().postDataJSON()?.action === 'team.save');
    await page.getByRole('button', { name: '保存团队', exact: true }).click();
    assert.ok((await saved).ok());
    await expect(page.getByRole('status')).toContainText('团队模板已保存');
  };
  const templateLibrarian = page.getByRole('checkbox', { name: '资料管理员', exact: true });
  await expect(templateLibrarian).toBeChecked();
  await expect(templateLibrarian).toHaveAccessibleDescription('自动整理团队与员工知识，模型跟随团队负责人。关闭后停止知识归档与读取，保留已有知识和任务记录。');
  await page.screenshot({ path: resolve(artifactDir, 'librarian-template-enabled.png') });
  await templateLibrarian.focus();
  await page.keyboard.press('Space');
  await expect(templateLibrarian).not.toBeChecked();
  await saveTeamThroughUi();
  assert.equal((await snapshot()).teams.find(item => item.id === team.id).knowledgeEnabled, false);
  await templateLibrarian.check();
  await page.getByRole('tab', { name: '工作流', exact: true }).click();
  await page.getByRole('button', { name: '添加工作流', exact: true }).click();
  await page.getByLabel('工作流名称', { exact: true }).fill('QA-应用交付流程');
  await page.getByLabel('步骤名称', { exact: true }).fill('架构方案');
  await page.getByLabel('步骤任务', { exact: true }).fill('完成架构方案并交付');
  await page.getByLabel('负责员工', { exact: true }).selectOption('lead');
  await page.getByRole('button', { name: '添加步骤', exact: true }).click();
  await page.getByLabel('步骤名称', { exact: true }).nth(1).fill('界面设计');
  await page.getByLabel('步骤任务', { exact: true }).nth(1).fill('依据方案完成界面设计');
  await page.getByLabel('负责员工', { exact: true }).nth(1).selectOption('designer');
  await saveTeamThroughUi();
  assert.equal((await snapshot()).teams.find(item => item.id === team.id).knowledgeEnabled, true);
  await page.getByRole('treeitem', { name: '新会话', exact: true }).first().click();

  const openProject = async (workspace, configured = false) => {
    await page.getByRole('treeitem').filter({ hasText: workspace.title }).first().hover();
    await page.getByRole('button', { name: `在“${workspace.title}”中新建会话`, exact: true }).click();
    await page.getByRole('button', { name: '配置项目团队', exact: true }).click();
    const configuration = page.getByRole('dialog', { name: '配置团队', exact: true });
    await expect(configuration).toBeVisible();
    if (configured) {
      await configuration.getByRole('radio', { name: team.name, exact: true }).check();
      await configuration.getByRole('button', { name: '查看团队', exact: true }).click();
      await page.getByRole('button', { name: /^项目团队/ }).first().click();
      await expect(page.getByTestId('project-staffing')).toBeVisible();
      return;
    }
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: '岗位定义', exact: true })).toHaveCount(0);
  };
  await openProject(workspaceA);
  const chooser = page.getByRole('dialog', { name: '配置团队', exact: true });
  await expect(chooser.getByRole('button', { name: '确认配置', exact: true })).toBeDisabled();
  await chooser.getByRole('radio', { name: team.name, exact: true }).check();
  await expect(chooser).toContainText('2 位员工 · 1 个工作流');
  await chooser.getByRole('radio', { name: '软件开发团', exact: true }).check();
  await expect(chooser.getByRole('radio', { name: team.name, exact: true })).not.toBeChecked();
  await chooser.getByRole('radio', { name: team.name, exact: true }).check();
  const box = await chooser.boundingBox();
  assert.ok(box && box.width <= 530 && box.height < 600, 'team chooser should be a compact dialog');
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    await page.screenshot({ path: resolve(artifactDir, `project-team-${theme}.png`) });
  }
  const creation = page.waitForResponse(response => response.url().endsWith('/digital-workers/api/command') && response.request().postDataJSON()?.action === 'project.team.configure');
  await chooser.getByRole('button', { name: '确认配置', exact: true }).click();
  assert.ok((await creation).ok());
  const overview = page.getByTestId('project-staffing');
  await expect(overview).toBeVisible();
  await expect(overview).toContainText('QA-既有架构师');
  await expect(overview).toContainText('待启用');
  await expect(overview).not.toContainText('QA-乙项目专属架构师');
  await overview.getByText('QA-应用交付流程 · 2 个步骤', { exact: true }).click();
  await expect(overview).toContainText('完成架构方案并交付');
  const after = await snapshot();
  const installed = after.projectTeams.find(item => item.projectId === workspaceA.workspaceId);
  assert.equal(installed.members.length, 2);
  assert.equal(installed.workflows.length, 1);
  assert.equal(installed.members.find(member => member.memberId === 'lead').employeeId, legacy.id);
  assert.equal(installed.workflows[0].steps[0].employeeId, legacy.id);
  assert.equal(after.employees.filter(employee => employee.projectId === workspaceA.workspaceId).length, 2);
  assert.deepEqual(after.templates.find(item => item.id === template.id), template);
  assert.deepEqual(after.employees.find(item => item.id === legacy.id).modules, legacy.modules);
  assert.equal(after.memories.filter(memory => memory.employeeId === legacy.id).length, 1);
  const projectLibrarian = overview.getByRole('checkbox', { name: '资料管理员', exact: true });
  await expect(projectLibrarian).toBeChecked();
  await projectLibrarian.click();
  await expect(page.getByRole('status')).toContainText('资料管理员已关闭');
  await expect(projectLibrarian).not.toBeChecked();
  await page.screenshot({ path: resolve(artifactDir, 'project-librarian-disabled.png') });
  const disabledKnowledge = await snapshot();
  assert.equal(disabledKnowledge.projectTeams.find(item => item.id === installed.id).knowledgeEnabled, false);
  assert.equal(disabledKnowledge.teams.find(item => item.id === team.id).knowledgeEnabled, true);
  assert.deepEqual(disabledKnowledge.employees, after.employees);
  assert.deepEqual(disabledKnowledge.memories, after.memories);
  assert.deepEqual(disabledKnowledge.runs, after.runs);
  await projectLibrarian.click();
  await expect(page.getByRole('status')).toContainText('资料管理员已启用');
  assert.equal((await snapshot()).projectTeams.find(item => item.id === installed.id).knowledgeEnabled, true);
  await page.screenshot({ path: resolve(artifactDir, 'project-team-installed.png') });
  await overview.getByTestId(`project-employee-${legacy.id}`).getByRole('button', { name: '岗位配置' }).click();
  await expect(page.getByRole('tab', { name: '岗位定义', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭数字员工', exact: true }).click();
  await openProject(workspaceA, true);
  await expect(overview).toBeVisible();
  assert.deepEqual((await snapshot()).employees, after.employees);
  await page.getByRole('button', { name: '关闭数字员工', exact: true }).click();

  const beforeCancellation = (await snapshot()).projectTeams.find(item => item.id === installed.id);
  await command('project.team.cancel', { projectId: workspaceA.workspaceId, teams: [{ id: installed.id, version: beforeCancellation.version ?? 1 }] });
  const cancelled = await snapshot();
  assert.equal(cancelled.projectTeams.find(item => item.id === installed.id).status, 'cancelled');
  assert.ok(cancelled.employees.filter(employee => employee.projectId === workspaceA.workspaceId).every(employee => employee.status === 'paused'));
  assert.deepEqual(cancelled.memories, after.memories);
  await openProject(workspaceA);
  await chooser.getByRole('radio', { name: team.name, exact: true }).check();
  await chooser.getByRole('button', { name: '确认配置', exact: true }).click();
  await expect(overview).toBeVisible();
  const restored = await snapshot();
  assert.deepEqual(restored.projectTeams.find(item => item.id === installed.id).members, installed.members);
  assert.deepEqual(restored.employees.map(employee => [employee.id, employee.status]), after.employees.map(employee => [employee.id, employee.status]));
  assert.deepEqual(restored.memories, after.memories);
  await page.getByRole('button', { name: '关闭数字员工', exact: true }).click();

  // Selecting the same platform team in a second project creates independent workflow/employee IDs.
  await openProject(workspaceB);
  await chooser.getByRole('radio', { name: team.name, exact: true }).check();
  await chooser.getByRole('button', { name: '确认配置', exact: true }).click();
  await expect(overview).toBeVisible();
  await expect(overview).not.toContainText('QA-既有架构师');
  const finalState = await snapshot();
  const second = finalState.projectTeams.find(item => item.projectId === workspaceB.workspaceId);
  assert.notEqual(second.id, installed.id);
  assert.notEqual(second.workflows[0].id, installed.workflows[0].id);
  assert.ok(second.members.every(member => !installed.members.some(original => original.employeeId === member.employeeId)));
  await expect(projectLibrarian).toBeChecked();
  await projectLibrarian.click();
  await expect(page.getByRole('status')).toContainText('资料管理员已关闭');
  const independentlyDisabled = await snapshot();
  assert.equal(independentlyDisabled.projectTeams.find(item => item.id === second.id).knowledgeEnabled, false);
  assert.equal(independentlyDisabled.projectTeams.find(item => item.id === installed.id).knowledgeEnabled, true);
  assert.equal(independentlyDisabled.teams.find(item => item.id === team.id).knowledgeEnabled, true);
  await page.getByRole('button', { name: /^项目记忆/ }).first().click();
  await expect(page.getByRole('heading', { name: 'QA-既有员工记忆', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'QA-乙项目私有记忆', exact: true })).toBeVisible();
  // Keep the existing project panel smoke on the isolated installed-team fixture.
  {
  const prefix = 'QA-UI';
  const instance = finalState.employees.find(employee => employee.id === second.members[0].employeeId);
  await page.getByRole('button',{name:/^项目记忆/}).click();
  await page.getByRole('button',{name:'新建记忆',exact:true}).click();
  await page.getByLabel('记忆标题',{exact:true}).fill(prefix+'-记忆');
  await page.getByLabel('记忆内容',{exact:true}).fill('确认项目记忆能够保存并被继续编辑。');
  await page.getByLabel('记忆归属',{exact:true}).selectOption(instance.id);
  await page.getByLabel('确认来源',{exact:true}).fill(prefix+'：界面测试确认');
  await page.getByRole('button',{name:'确认并保存',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('记忆已确认并保存');
  await page.getByRole('button',{name:`编辑记忆：${prefix}-记忆`,exact:true}).click();
  await page.getByLabel('记忆内容',{exact:true}).fill('记忆更新已由用户确认。');
  await page.getByLabel('确认来源',{exact:true}).fill(prefix+'：界面测试再次确认');
  await page.getByRole('button',{name:'确认并保存',exact:true}).click();
  await expect(page.locator('.wf-memory-card').filter({hasText:prefix})).toContainText('记忆更新已由用户确认。');
  console.log('Memory create and update verified');
  await page.screenshot({path:resolve(artifactDir, 'project-memory.png')});
  page.once('dialog', async dialog => { assert.equal(dialog.message(), `删除记忆“${prefix}-记忆”？`); await dialog.accept(); });
  await page.getByRole('button',{name:`删除记忆：${prefix}-记忆`,exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('记忆已删除');
  await page.getByRole('button',{name:/^任务与交付/}).click();
  await page.screenshot({path:resolve(artifactDir, 'project-runs.png')});
  await page.setViewportSize({width:820,height:1000});
  await page.getByRole('button',{name:/^项目团队/}).first().click();
  await page.screenshot({path:resolve(artifactDir, 'project-responsive.png')});
  const panel=page.getByRole('dialog');
  const bounds=await panel.boundingBox();if(!bounds||bounds.x<0||bounds.x+bounds.width>821)throw new Error('Responsive modal overflows viewport');
  }
  if (process.env.WORKFORCE_WORKFLOW_FIXTURE === '1') {
    const target = (await snapshot()).employees.find(employee => employee.id === second.members[0].employeeId);
    const modules = structuredClone(target.modules);
    modules.model = { mode: 'override', provider: 'workflow-fixture', model: 'offline' };
    modules.capabilities.skills = [];
    await command('employee.update', { id: target.id, input: { modules } });
    await page.getByRole('button', { name: '关闭数字员工', exact: true }).click();
    await page.setViewportSize({ width: 1480, height: 1050 });
    await page.getByRole('treeitem').filter({ hasText: workspaceB.title }).first().hover();
    await page.getByRole('button', { name: `在“${workspaceB.title}”中新建会话`, exact: true }).click();
    const input = page.locator('[data-composer-input]');
    await expect(input).toBeFocused();
    await input.pressSequentially('@');
    await page.getByText(target.name, { exact: true }).first().click();
    await input.press('End');
    await input.pressSequentially('验证新版员工执行与原生会话导航');
    const dispatched = page.waitForResponse(response => response.url().endsWith('/digital-workers/api/run') && response.request().method() === 'POST');
    await input.press('Enter');
    const response = await dispatched;
    assert.equal(response.status(), 202);
    const { run } = await response.json();
    await expect.poll(async () => (await snapshot()).runs.find(item => item.id === run.id)?.status).toBe('awaiting-review');
    const finished = (await snapshot()).runs.find(item => item.id === run.id);
    assert.equal(finished.employeeId, target.id);
    assert.equal(finished.projectId, workspaceB.workspaceId);
    assert.equal(finished.usage.outputTokens, 8);
    await expect(page.locator('.wf-native-dock')).toContainText('待验收', { timeout: 15000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.wf-native-dock')).toContainText('待验收', { timeout: 15000 });
    await page.screenshot({ path: resolve(artifactDir, 'native-mention-offline.png') });
    console.log('PASS: native @ selection and dispatch; offline adapter; settled usage; session navigation and reload.');
  }
  if (process.env.WORKFORCE_WORKFLOW_FIXTURE !== '1') {
    await page.getByRole('button', { name: '关闭数字员工', exact: true }).click();
    await page.setViewportSize({ width: 1480, height: 1050 });
    const { result: legacyMembers } = await command('team.instantiate', { projectId: workspaceA.workspaceId, teamId: team.id });
    await openProject(workspaceA, true);
    const legacySection = overview.getByRole('region', { name: '历史团队 1', exact: true });
    const legacyLibrarian = legacySection.getByRole('checkbox', { name: '资料管理员', exact: true });
    await expect(legacyLibrarian).toBeChecked();
    const beforeLegacyToggle = await snapshot();
    await legacyLibrarian.click();
    await expect(page.getByRole('status')).toContainText('资料管理员已关闭');
    const legacyDisabled = await snapshot();
    assert.ok(legacyMembers.every(member => legacyDisabled.employees.find(item => item.id === member.id).legacyTeamKnowledgeEnabled === false));
    assert.equal(legacyDisabled.projectTeams.find(item => item.id === installed.id).knowledgeEnabled, true);
    assert.equal(legacyDisabled.projectTeams.find(item => item.id === second.id).knowledgeEnabled, false);
    assert.equal(legacyDisabled.employees.length, beforeLegacyToggle.employees.length);
    assert.deepEqual(legacyDisabled.memories, beforeLegacyToggle.memories);
    assert.deepEqual(legacyDisabled.runs, beforeLegacyToggle.runs);
    await page.screenshot({ path: resolve(artifactDir, 'project-legacy-librarian-disabled.png') });
  }
  assert.deepEqual(errors, []);
  console.log('PASS: official composer team entry; compact single-choice dialog; workflow authoring; default-on librarian checkbox; keyboard toggle; template persistence; independent project knowledge switches; employee/memory/run preservation; project workflow mappings; no duplicate installation; independent second project.');
  }
} catch (error) {
  if (page) {
    await page.screenshot({ path: resolve(artifactDir, 'project-staffing-failure.png') }).catch(() => undefined);
    await writeFile(resolve(artifactDir, 'project-staffing-failure.aria.txt'), await page.locator('body').ariaSnapshot());
  }
  await writeFile(resolve(artifactDir, 'project-staffing-service.log'), redactWebAuth(serviceLog));
  throw error;
} finally {
  await browser?.close();
  if (processHandle && processHandle.exitCode === null) {
    processHandle.kill('SIGTERM');
    for (let i = 0; i < 40 && processHandle.exitCode === null; i++) await delay(100);
    if (processHandle.exitCode === null) processHandle.kill('SIGKILL');
  }
  await rm(temp, { recursive: true, force: true });
}
