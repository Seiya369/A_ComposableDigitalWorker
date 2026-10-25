/** Team-scoped workflow editing and legacy data retention in an isolated official Harness profile. */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCliInstallation } from '../../integration/harness-baseline.mjs';
import { authenticateWeb, redactWebAuth } from '../../integration/web-auth.mjs';
import { installEmployeeSettingsFixture } from './employee-settings-offline.fixture.mjs';
import { exerciseLibraryReordering } from './library-order.checks.mjs';
import { exerciseTeamMemberRemoval } from './team-member-removal.checks.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
process.env.DSH_INSTALLATION_MANIFEST ||= resolve(root, '.local/official-validation-complete/node_modules/@deepseek-ai/dsh/package.json');
const installation = await resolveCliInstallation(root);
const temp = await mkdtemp(resolve(tmpdir(), 'workforce-workflow-basic-ui-'));
const artifacts = process.env.WORKFORCE_WORKFLOW_TEAM_UI_ARTIFACTS ? resolve(process.env.WORKFORCE_WORKFLOW_TEAM_UI_ARTIFACTS) : resolve(root, 'artifacts/workflow-team-validation/ui');
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
  await writeFile(resolve(profile, 'package.json'), JSON.stringify({ name: 'workflow-basic-ui-test', private: true, type: 'module', dependencies: { 'dsh-plugin-composable-workforce': uiArchive ? `file:${uiArchive}` : `link:${root}`, 'dsh-plugin-employee-settings-fixture': '0.0.0', 'dsh-plugin-employee-disabled-fixture': '0.0.0' }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-plugin-composable-workforce', 'dsh-plugin-employee-settings-fixture'] } } }));
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

async function settle() {
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) {
      await new Promise(done => requestAnimationFrame(done));
      const animations = document.getAnimations().filter(animation => animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime));
      if (!animations.length) return;
      await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
    }
  });
}
const hiddenFields = workflow => ({
  description: workflow.description, maxAttempts: workflow.maxAttempts, roles: workflow.roles,
  steps: workflow.steps.map(step => ({ id: step.id, inputs: step.inputs, outputs: step.outputs, timeoutMs: step.timeoutMs, acceptanceCriteria: step.acceptanceCriteria })),
});
const snapshotRow = row => row.evaluate(element => {
  const style = getComputedStyle(element), box = element.getBoundingClientRect(), label = element.querySelector(':scope > span');
  const labelStyle = getComputedStyle(label), icon = element.querySelector('svg').getBoundingClientRect();
  const range = document.createRange(); range.selectNodeContents(label);
  const labelBox = label.getBoundingClientRect(), lineHeight = parseFloat(labelStyle.lineHeight);
  const lines = new Set([...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0).map(rect => Math.floor(((rect.top + rect.bottom) / 2 - labelBox.top) / lineHeight))).size;
  return { name: label.textContent, title: element.title, height: box.height, iconWidth: icon.width, iconHeight: icon.height,
    children: [...element.children].map(child => child.tagName.toLowerCase()), extraStatus: element.querySelectorAll('small,strong,.wf-avatar,.wf-nav-label').length, lines,
    style: { padding: style.padding, gap: style.gap, fontSize: style.fontSize, lineHeight: style.lineHeight, borderRadius: style.borderRadius, whiteSpace: labelStyle.whiteSpace, textOverflow: labelStyle.textOverflow } };
});

try {
  assert.ok(uiArchive, 'Use WORKFORCE_UI_ARCHIVE for exact archive validation');
  await mkdir(artifacts, { recursive: true });
  const base = await startHarness();
  const get = async path => { const response = await fetch(base + path, { headers: { Cookie: cookie } }); assert.ok(response.ok); return response.json(); };
  const command = async (action,payload,options) => { const response = await fetch(base + '/digital-workers/api/command',{method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({action,payload,options})}); assert.ok(response.ok,await response.clone().text());return response.json(); };
  const snapshot=()=>get('/digital-workers/api/state');
  const initial=await snapshot(), modules=structuredClone(initial.templates[0].modules);
  modules.model={mode:'inherit'};modules.knowledge.sources=[];modules.collaboration.allowedTemplateIds=[];
  const employees=[];
  for(const name of ['QA-产品负责人','QA-开发人员','QA-团队外人员'])employees.push((await command('template.save',{name,status:'ready',modules})).result);
  const team=(await command('team.save',{name:'QA-软件团队',knowledgeEnabled:false,members:[{memberId:'lead',templateId:employees[0].id,name:employees[0].name},{memberId:'dev',templateId:employees[1].id,name:employees[1].name,reportsTo:'lead'}]})).result;
  const other=(await command('team.save',{name:'QA-新团队',knowledgeEnabled:false,members:[{memberId:'outsider',templateId:employees[2].id,name:employees[2].name}]})).result;
  const legacy=(await command('workflow.template.save',{name:'QA-既有流程',description:'PRESERVE_DESCRIPTION',maxAttempts:7,roles:[{id:'lead-role',name:employees[0].name,description:'LEAD_ROLE'},{id:'dev-role',name:employees[1].name,description:'DEV_ROLE'}],steps:[{id:'constructor',name:'原分析',roleId:'lead-role',instruction:'原说明',inputs:['原输入'],outputs:['原输出'],timeoutMs:123456,acceptanceCriteria:['  原验收  ','多行一\n多行二']},{id:'legacy-dev',name:'原开发',roleId:'dev-role',instruction:'原开发说明'}]})).result;
  await command('workflow.template.bind',{teamId:team.id,workflowTemplateId:legacy.id,bindings:{'lead-role':'lead','dev-role':'lead'}});
  const rolePresets=process.env.WORKFORCE_ROLE_SKILL_VALIDATION==='1'?JSON.parse(await readFile(resolve(installedPluginRoot,'skills/software-development-presets.json'),'utf8')):undefined;
  const roleFixtures=[];
  if(rolePresets){
    const catalog=await get('/digital-workers/api/capabilities');
    for(const preset of rolePresets.roles){
      const references=[{id:preset.required,usage:'required'},...preset.preferred.map(skill=>({...skill,usage:'preferred'}))].map(reference=>{const skill=catalog.skills.find(skill=>skill.id===reference.id);assert.ok(skill,reference.id);return{...reference,name:skill.name,description:skill.description};});
      const roleModules=structuredClone(modules);roleModules.capabilities.skills=references;
      roleFixtures.push({preset,template:(await command('template.save',{name:preset.name,status:'ready',modules:roleModules})).result});
    }
    metrics.roleSkills={bundled:catalog.skills.filter(skill=>skill.source==='bundled').length,roles:roleFixtures.map(({preset,template})=>({name:template.name,required:preset.required,preferred:preset.preferred.map(skill=>skill.id)}))};
  }
  const baselineState=await snapshot();
  browser=await chromium.launch({headless:true,...(process.env.WORKFORCE_BROWSER_CHANNEL==='bundled'?{}:{channel:process.env.WORKFORCE_BROWSER_CHANNEL||'chrome'})});
  page=await browser.newPage({viewport:{width:1512,height:1050},locale:'zh-CN',colorScheme:'dark',acceptDownloads:true});
  page.on('pageerror',error=>pageErrors.push(error.message));
  const separator=cookie.indexOf('=');await page.context().addCookies([{name:cookie.slice(0,separator),value:cookie.slice(separator+1),url:base,httpOnly:true,sameSite:'Strict'}]);
  await page.goto(base,{waitUntil:'domcontentloaded'});
  for(const name of ['继续','稍后配置']){const button=page.getByRole('button',{name,exact:true});if(await button.waitFor({state:'visible',timeout:2500}).then(()=>true).catch(()=>false))await button.click();}
  await page.getByRole('button',{name:'graph_horses',exact:true}).click();
  if(rolePresets){
    for(const {preset,template} of roleFixtures){
      await page.locator('.wf-sidebar').getByRole('button',{name:template.name,exact:true}).click();await page.getByRole('tab',{name:'能力组合',exact:true}).click();
      const capabilities=page.getByRole('region',{name:'能力组合',exact:true});
      await expect(capabilities.getByRole('region',{name:'必备 Skill',exact:true}).locator('.wf-capability-selection-row')).toHaveCount(1);
      await expect(capabilities.getByRole('region',{name:'必备 Skill',exact:true})).toContainText(preset.required);
      for(const preference of preset.preferred)await expect(capabilities.getByRole('region',{name:'优先 Skill',exact:true})).toContainText(preference.id);
      await expect(capabilities.getByText('当前不可用',{exact:true})).toHaveCount(0);
      const transferred=rootObject(await readDownload(page.locator('.wf-employee-editor')));assert.deepEqual(transferred.modules.capabilities.skills,template.modules.capabilities.skills);
      if(preset.role==='tester')await page.screenshot({path:resolve(artifacts,'qa-code-review-dark.png')});
      if(preset.role==='developer')await page.screenshot({path:resolve(artifacts,'developer-skills-dark.png')});
    }
    check('six-roles-show-one-available-required-skill-and-stage-preferences-with-export-preserved');
  }
  await page.getByRole('navigation',{name:'通用模板类型'}).getByRole('button',{name:/^工作流/}).click();
  const editor=page.locator('.wf-workflow-template-editor'),cards=editor.locator('.wf-workflow-step-card'),nameField=editor.getByRole('textbox',{name:'工作流名称',exact:true}),save=editor.getByRole('button',{name:'保存工作流',exact:true});
  const picker=page.getByRole('dialog',{name:'引入团队',exact:true});
  const selectTeam=async id=>{await editor.getByRole('button',{name:'引入团队',exact:true}).click();await picker.getByRole('combobox',{name:'选择团队',exact:true}).selectOption(id);};
  const owner=card=>card.getByRole('combobox',{name:'负责人',exact:true});
  const selectMember=async(card,name)=>owner(card).selectOption({label:(await owner(card).locator('option').allTextContents()).find(label=>label.startsWith(name+'（'))});
  const saveUi=async action=>{const pending=page.waitForResponse(response=>response.url().endsWith('/digital-workers/api/command')&&response.request().postDataJSON()?.action===action);await save.click();assert.ok((await pending).ok());await expect(save).toBeDisabled();};
  await expect(editor.getByRole('button',{name:'引入团队',exact:true})).toBeVisible();
  await expect(page.locator('.wf-sidebar').getByRole('button',{name:'引入团队',exact:true})).toHaveCount(0);
  await expect(owner(cards.first())).toBeEnabled();
  const inferred=rootObject(await readDownload(editor));
  assert.equal(inferred.team.sourceTeamId,team.id);assert.equal(inferred.team.members[1].reportsTo,'lead');
  assert.deepEqual(inferred.steps,legacy.steps);assert.equal(inferred.roles.find(role=>role.id==='lead-role').memberId,'lead');
  check('legacy-exact-binding-inherits-existing-owner-identity-and-hierarchy');
  await cards.first().getByRole('textbox',{name:'步骤名称',exact:true}).fill('只改步骤名');await saveUi('workflow.template.save');
  const preserved=(await snapshot()).workflowTemplates.find(item=>item.id===legacy.id);
  assert.deepEqual(preserved.steps[0].acceptanceCriteria,legacy.steps[0].acceptanceCriteria);assert.deepEqual(preserved.steps[0].inputs,legacy.steps[0].inputs);assert.equal(preserved.steps[0].timeoutMs,123456);assert.deepEqual(preserved.steps[0].outputs,legacy.steps[0].outputs);assert.equal(preserved.maxAttempts,7);
  assert.equal(preserved.roles.find(role=>role.id==='dev-role').memberId,'lead');
  await selectMember(cards.first(),employees[1].name);await saveUi('workflow.template.save');
  await expect(page.getByText('通用工作流已保存',{exact:true})).toHaveCount(0);
  check('save-notice-removed-and-legacy-hidden-fields-survive-team-upgrade');
  await page.locator('.wf-sidebar').getByRole('button',{name:'新建工作流',exact:true}).click();
  await expect(owner(cards.first())).toBeDisabled();await expect(owner(cards.first()).locator('option')).toHaveCount(1);
  await nameField.fill('QA-团队限定工作流');await cards.first().getByRole('textbox',{name:'步骤名称',exact:true}).fill('需求');await cards.first().getByRole('textbox',{name:'步骤说明',exact:true}).fill('明确目标');await expect(save).toBeDisabled();
  check('new-workflow-cannot-select-or-save-owner-before-team-adoption');
  const beforeAdopt=await snapshot();await selectTeam(team.id);await expect(picker.getByRole('list',{name:'团队组织结构'})).toContainText('上一级：'+employees[0].name);await page.keyboard.press('Escape');await expect(picker).toHaveCount(0);assert.deepEqual(await snapshot(),beforeAdopt);await expect(editor.getByRole('button',{name:'引入团队',exact:true})).toBeFocused();
  await selectTeam(team.id);await picker.getByRole('button',{name:'确认引入',exact:true}).click();await expect(picker).toHaveCount(0);assert.deepEqual(await snapshot(),beforeAdopt);
  assert.deepEqual(await owner(cards.first()).locator('option').allTextContents(),['选择负责人',employees[0].name+'（团队负责人）',employees[1].name+'（上一级：'+employees[0].name+'）']);
  await expect(owner(cards.first()).locator('optgroup,option[value="custom"]')).toHaveCount(0);
  check('team-picker-cancel-focus-roster-preview-and-draft-only-adoption');
  check('assignees-are-exactly-adopted-roster-with-reporting-information');
  await selectMember(cards.first(),employees[0].name);
  const criteria=cards.first().getByRole('textbox',{name:'验收标准',exact:true});await criteria.fill('');await criteria.pressSequentially('资料完整');await criteria.press('Enter');await criteria.pressSequentially('目标清晰');await criteria.press('Enter');await expect(criteria).toHaveValue('资料完整\n目标清晰\n');
  for(const [index,label] of [[1,'开发'],[2,'复核']]){await editor.getByRole('button',{name:'添加步骤',exact:true}).click();await cards.nth(index).getByRole('textbox',{name:'步骤名称',exact:true}).fill(label);await cards.nth(index).getByRole('textbox',{name:'步骤说明',exact:true}).fill(label+'工作');await cards.nth(index).getByRole('textbox',{name:'验收标准',exact:true}).fill(label+'通过');await selectMember(cards.nth(index),employees[1].name);}
  const deliverables=cards.first().getByRole('textbox',{name:'交付内容',exact:true});await deliverables.fill('');await deliverables.pressSequentially('需求基线');await deliverables.press('Enter');await deliverables.pressSequentially('验收清单');await deliverables.press('Enter');await expect(deliverables).toHaveValue('需求基线\n验收清单\n');
  const diagram=editor.getByRole('region',{name:'工作流程图',exact:true});await expect(diagram.locator('.wf-workflow-diagram-node')).toHaveCount(3);
  assert.deepEqual(await diagram.locator('.wf-workflow-diagram-node strong').allTextContents(),['1. 需求','2. 开发','3. 复核']);await cards.nth(2).getByRole('button',{name:'上移步骤 3',exact:true}).click();assert.deepEqual(await diagram.locator('.wf-workflow-diagram-node strong').allTextContents(),['1. 需求','2. 复核','3. 开发']);
  await confirmUi('确定移除步骤“复核”？',false,()=>cards.nth(1).getByRole('button',{name:'移除步骤 2',exact:true}).click());await expect(cards).toHaveCount(3);
  await confirmUi('确定移除步骤“复核”？',true,()=>cards.nth(1).getByRole('button',{name:'移除步骤 2',exact:true}).click());await expect(cards).toHaveCount(2);await expect(diagram.locator('.wf-workflow-diagram-node')).toHaveCount(2);
  await diagram.locator('.wf-workflow-diagram-node').first().click();await expect(cards.first().getByRole('textbox',{name:'步骤名称',exact:true})).toBeFocused();
  check('diagram-follows-live-step-names-owners-order-add-remove-and-node-navigation');
  const rejectTarget=card=>card.getByRole('combobox',{name:'不合格退回到',exact:true});
  const firstStepId=(await readDownload(editor)).data.workflowTemplates[0].steps[0].id;await rejectTarget(cards.nth(1)).selectOption(firstStepId);await expect(diagram.locator('.wf-workflow-diagram-return')).toHaveCount(1);
  await cards.nth(1).getByRole('button',{name:'上移步骤 2',exact:true}).click();await expect(editor.getByRole('alert')).toContainText('退回目标');assert.deepEqual(await diagram.locator('.wf-workflow-diagram-node strong').allTextContents(),['1. 需求','2. 开发']);
  check('rejection-target-is-earlier-step-identity-and-invalid-reorder-is-blocked');
  const draftBundle=await readDownload(editor);assert.equal(draftBundle.data.templates.length,2);assert.equal(rootObject(draftBundle).team.members.length,2);await expect(criteria).toHaveValue('资料完整\n目标清晰\n');
  await saveUi('workflow.template.save');const created=(await snapshot()).workflowTemplates.find(item=>item.name==='QA-团队限定工作流');assert.deepEqual(created.steps[0].acceptanceCriteria,['资料完整','目标清晰']);assert.equal(created.team.members[1].reportsTo,'lead');assert.deepEqual(created.steps[0].outputs,['需求基线','验收清单']);assert.equal(created.steps[1].onRejectStepId,created.steps[0].id);
  check('save-and-export-retain-team-roster-hierarchy-and-keyboard-criteria');
  const importedBefore=await snapshot();await importFile(editor,draftBundle);await expect(save).toBeEnabled();assert.deepEqual(await snapshot(),importedBefore);await expect(owner(cards.first())).toBeEnabled();await expect(owner(cards.first()).locator('option')).toHaveCount(3);
  await saveUi('settings.bundle.save');const imported=(await snapshot()).workflowTemplates.find(item=>item.id===created.id);assert.notEqual(imported.team.members[0].templateId,team.members[0].templateId);assert.equal(imported.team.members[1].reportsTo,imported.team.members[0].memberId);assert.equal(imported.roles.find(role=>role.id===imported.steps[1].roleId).memberId,imported.team.members[1].memberId);
  assert.equal(imported.steps[1].onRejectStepId,imported.steps[0].id);assert.deepEqual(imported.steps[0].outputs,['需求基线','验收清单']);
  check('workflow-import-and-atomic-save-restore-remapped-team-members-owners-and-return-targets');
  const beforeChange=await snapshot();await selectTeam(other.id);await confirmUi(/部分负责人不在新团队/,false,()=>picker.getByRole('button',{name:'确认引入',exact:true}).click());await expect(picker).toBeVisible();assert.deepEqual(await snapshot(),beforeChange);
  await confirmUi(/部分负责人不在新团队/,true,()=>picker.getByRole('button',{name:'确认引入',exact:true}).click());await expect(picker).toHaveCount(0);await expect(save).toBeDisabled();assert.equal(await owner(cards.first()).inputValue(),'');await expect(owner(cards.first()).locator('option')).toHaveCount(2);await expect(diagram).toContainText('待选择负责人');
  for(let i=0;i<2;i++)await selectMember(cards.nth(i),employees[2].name);await saveUi('workflow.template.save');
  check('changing-team-confirms-lost-owners-clears-invalid-choices-and-requires-reassignment');
  await editor.getByRole('button',{name:'添加步骤',exact:true}).click();await cards.nth(2).getByRole('textbox',{name:'步骤名称',exact:true}).fill('返工核查');await cards.nth(2).getByRole('textbox',{name:'步骤说明',exact:true}).fill('核查修改');await selectMember(cards.nth(2),employees[2].name);
  const secondId=(await readDownload(editor)).data.workflowTemplates[0].steps[1].id;await rejectTarget(cards.nth(2)).selectOption(secondId);
  await confirmUi(/引用此步骤的“不合格退回到”将改为本步骤返工/,false,()=>cards.nth(1).getByRole('button',{name:'移除步骤 2',exact:true}).click());await expect(cards).toHaveCount(3);
  await confirmUi(/引用此步骤的“不合格退回到”将改为本步骤返工/,true,()=>cards.nth(1).getByRole('button',{name:'移除步骤 2',exact:true}).click());await expect(cards).toHaveCount(2);await expect(rejectTarget(cards.nth(1))).toHaveValue('');
  await rejectTarget(cards.nth(1)).selectOption((await readDownload(editor)).data.workflowTemplates[0].steps[0].id);await saveUi('workflow.template.save');
  check('removing-a-return-target-confirms-and-clears-references-without-dangling-steps');
  metrics.sections={};
  metrics.headers={};
  for(const size of [{name:'wide-dark',width:1512,height:1050,scheme:'dark'},{name:'wide-light',width:1512,height:1050,scheme:'light'},{name:'narrow-dark',width:712,height:900,scheme:'dark'},{name:'mobile-dark',width:320,height:850,scheme:'dark'}]){
    await page.setViewportSize({width:size.width,height:size.height});await page.emulateMedia({colorScheme:size.scheme});await settle();
    const header=editor.locator('.wf-team-toolbar');const geometry=await header.evaluate(element=>{const box=element.getBoundingClientRect();return{width:box.width,scrollWidth:element.scrollWidth,clientWidth:element.clientWidth,buttons:[...element.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect();return{left:r.left,right:r.right,height:r.height};}),left:box.left,right:box.right};});
    assert.ok(geometry.scrollWidth<=geometry.clientWidth+1,JSON.stringify(geometry));assert.ok(geometry.buttons.every(button=>button.left>=geometry.left-1&&button.right<=geometry.right+1&&button.height>=24));
    await expect(header.getByRole('button',{name:'引入团队',exact:true})).toBeVisible();await expect(editor.getByRole('tab')).toHaveCount(0);metrics.headers[size.name]=geometry;
    await cards.first().getByRole('textbox',{name:'步骤名称',exact:true}).scrollIntoViewIfNeeded();
    const sections=await cards.first().locator('.wf-workflow-step-sections > .wf-field').evaluateAll(elements=>elements.map(element=>{const r=element.getBoundingClientRect();return{left:r.left,top:r.top,width:r.width,height:r.height,scrollWidth:element.scrollWidth,clientWidth:element.clientWidth};}));assert.equal(sections.length,3);assert.ok(sections.every(section=>section.scrollWidth<=section.clientWidth+1));
    if(size.width>=1512){assert.ok(Math.max(...sections.map(section=>section.width))-Math.min(...sections.map(section=>section.width))<=1);assert.ok(sections.every(section=>Math.abs(section.top-sections[0].top)<=1));}else assert.ok(sections[1].top>sections[0].top&&sections[2].top>sections[1].top);
    metrics.sections[size.name]=sections;
    await page.screenshot({path:resolve(artifacts,'workflow-'+size.name+'.png')});
    await diagram.scrollIntoViewIfNeeded();await page.screenshot({path:resolve(artifacts,'diagram-'+size.name+'.png')});
  }
  check('three-equal-columns-and-return-diagram-fit-dark-light-wide-narrow-and-mobile');
  if(process.env.WORKFORCE_LIBRARY_ORDER_VALIDATION==='1')await exerciseLibraryReordering({page,snapshot,command,check,artifacts,metrics});
  const protectedInstances=process.env.WORKFORCE_TEAM_REMOVAL_VALIDATION==='1'?await exerciseTeamMemberRemoval({page,snapshot,command,check,artifacts,metrics,temp}):baselineState;
  const finalState=await snapshot();assert.deepEqual(finalState.runs,baselineState.runs);assert.deepEqual(finalState.employees,protectedInstances.employees);assert.deepEqual(finalState.projectTeams??[],protectedInstances.projectTeams??[]);
  const calls=(await readFile(llmCallsPath,'utf8').catch(error=>error.code==='ENOENT'?'':Promise.reject(error))).trim().split('\n').filter(Boolean);assert.equal(calls.length,0);assert.deepEqual(pageErrors,[]);assert.equal(await hostHash(),baseline);
  check('configuration-does-not-run-models-or-alter-project-instances-or-official-host');
  await stopHarness();assert.deepEqual(await wikiWorkers(),[]);check('isolated-service-and-shared-workers-stop-cleanly');
  await writeFile(resolve(artifacts,'report.json'),JSON.stringify({status:'passed',pluginArchive:metrics.pluginArchive,checks,checkCount:checks.length,modelCalls:0,metrics},null,2));
  console.log('PASS: '+checks.length+' workflow team browser checks.');
} catch (error) {
  if (page) await page.screenshot({ path: resolve(artifacts, 'failure.png') }).catch(() => {});
  await writeFile(resolve(artifacts, 'failure-report.json'), JSON.stringify({ checks, metrics, pageErrors }, null, 2)).catch(() => {});
  console.error(redactWebAuth(error?.stack || String(error))); console.error(redactWebAuth(log.slice(-10000))); process.exitCode = 1;
} finally {
  await browser?.close(); await stopHarness(); await rm(temp, { recursive: true, force: true });
}

