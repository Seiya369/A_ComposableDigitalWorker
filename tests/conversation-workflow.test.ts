import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkforceStore } from '../src/domain/store.js';
import { resolveConversationWorkflow } from '../src/domain/conversation-workflow.js';
import { captureWorkflowTeam } from '../src/domain/workflow-team.js';
import { validateState } from '../src/domain/validation.js';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'conversation-workflow-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'state.json'); const store = await WorkforceStore.open(file);
  const project = await store.saveProject({ name: '软件项目', rootPath: root });
  await mkdir(join(root, 'other')); const other = await store.saveProject({ name: '其他项目', rootPath: join(root, 'other') });
  const base = store.snapshot().templates[0]!;
  const product = await store.saveTemplate({ name: '产品负责人', modules: base.modules, status: 'ready' });
  const developer = await store.saveTemplate({ name: '开发人员', modules: base.modules, status: 'draft' });
  const tester = await store.saveTemplate({ name: '测试负责人', modules: base.modules, status: 'ready' });
  const team = await store.saveTeam({ name: '软件团队', members: [
    { memberId: 'architect', templateId: base.id, reportsTo: 'product' },
    { memberId: 'developer', templateId: developer.id, reportsTo: 'architect' },
    { memberId: 'tester', templateId: tester.id, reportsTo: 'product' },
    { memberId: 'product', templateId: product.id },
  ] });
  const roles = team.members.map(member => ({ id: member.memberId, name: member.memberId, memberId: member.memberId }));
  const workflow = await store.saveWorkflowTemplate({ name: '软件交付', team: captureWorkflowTeam(team, store.snapshot().templates), roles, steps: [
    { id: 'requirements', name: '需求', roleId: 'product', instruction: '澄清需求并规划任务', outputs: ['需求基线'], acceptanceCriteria: ['范围明确'] },
    { id: 'design', name: '设计', roleId: 'architect', instruction: '设计架构与分配开发任务', outputs: ['架构设计'], acceptanceCriteria: ['决策可追溯'] },
    { id: 'test', name: '验证', roleId: 'tester', instruction: '验证实现', outputs: ['测试报告'], acceptanceCriteria: ['关键场景通过'], onRejectStepId: 'design' },
  ] });
  const alternate = await store.saveWorkflowTemplate({ name: '快速交付', team: workflow.team, roles, steps: [workflow.steps[0]!] });
  const select = (sessionId = 'session-a', template = workflow, projectId = project.id) => store.selectConversationWorkflow({ projectId, sessionId,
    workflowTemplateId: template.id, workflowTemplateVersion: template.version, templateVersions: Object.fromEntries(store.snapshot().templates.map(entry => [entry.id, entry.version])) }, { expectedRevision: store.snapshot().revision });
  const step = (stepId: string, sessionId = 'session-a') => {
    const view = resolveConversationWorkflow(store.snapshot(), project.id, sessionId);
    return store.selectConversationWorkflowStep({ projectId: project.id, sessionId, stepId, instanceVersion: view.instanceVersion! }, { expectedRevision: store.snapshot().revision });
  };
  const run = async (output = '可审查交付文档', sessionId = 'session-a', parentRunId?: string, employeeId?: string) => {
    const view = resolveConversationWorkflow(store.snapshot(), project.id, sessionId);
    let created = await store.createRun({ projectId: project.id, employeeId: employeeId ?? view.owner!.id, request: '完成当前步骤',
      conversationWorkflow: { instanceId: view.instanceId!, stepId: view.currentStepId! }, ...(parentRunId ? { parentRunId } : {}) });
    created = await store.updateRun(created.id, { status: 'running' });
    return store.updateRun(created.id, { status: 'awaiting-review', ...(output ? { output } : {}) });
  };
  return { file, store, project, other, base, product, developer, tester, team, workflow, alternate, select, step, run };
}

test('workflow selection installs the frozen roster atomically and preserves existing project installations', async t => {
  const f = await fixture(t);
  const existing = await f.store.configureProjectTeam({ projectId: f.project.id, teamId: f.team.id, teamVersion: f.team.version,
    templateVersions: Object.fromEntries(f.store.snapshot().templates.map(entry => [entry.id, entry.version])) });
  const before = f.store.snapshot(); const view = await f.select(); const after = f.store.snapshot();
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.employees.length, before.employees.length + 4);
  assert.deepEqual(after.projectTeams?.find(entry => entry.id === existing.id), existing);
  assert.deepEqual(after.employees.slice(0, before.employees.length), before.employees);
  assert.deepEqual(after.templates, before.templates); assert.deepEqual(after.teams, before.teams); assert.deepEqual(after.runs, before.runs);
  const installed = after.projectTeams!.find(entry => entry.id === view.projectTeamId)!;
  assert.notEqual(installed.id, existing.id); assert.equal(installed.teamTemplateId, `conversation-workflow:${f.workflow.id}`);
  const employees = installed.members.map(member => after.employees.find(employee => employee.id === member.employeeId)!);
  assert.ok(employees.every(employee => employee.status === 'active'));
  assert.equal(employees.find(employee => employee.templateId === f.developer.id)!.managerId, employees.find(employee => employee.templateId === f.base.id)!.id);
  assert.equal(view.steps[0]!.instruction, f.workflow.steps[0]!.instruction);
  assert.deepEqual(view.steps[0]!.outputs, ['需求基线']); assert.deepEqual(view.steps[0]!.acceptanceCriteria, ['范围明确']);
  assert.equal(view.steps[0]!.status, 'current'); assert.ok(view.steps.slice(1).every(step => step.status === 'pending'));
  assert.equal(view.owner!.templateId, f.product.id); assert.equal(view.activeEmployeeIds.length, 4);
  assert.deepEqual((await WorkforceStore.open(f.file)).snapshot(), after);
});

test('the first non-null choice unifies prior None conversations while preserving other projects', async t => {
  const f = await fixture(t);
  const untouched = f.store.snapshot();
  for (const sessionId of ['session-a', 'session-b', 'future-session']) {
    assert.equal(resolveConversationWorkflow(untouched, f.project.id, sessionId).instanceId, null);
  }
  assert.deepEqual(f.store.snapshot(), untouched, 'reading an unconfigured project must not install or select a workflow');
  const none = (sessionId: string, projectId = f.project.id) => f.store.selectConversationWorkflow({ projectId, sessionId, workflowTemplateId: null }, { expectedRevision: f.store.snapshot().revision });
  await none('session-a'); await none('session-b');
  assert.equal(f.store.snapshot().conversationWorkflows!.defaults.length, 0);
  assert.deepEqual(f.store.snapshot().employees, untouched.employees);
  const other = await f.select('other-default', f.alternate, f.other.id);
  await none('other-none', f.other.id);
  const before = f.store.snapshot();
  const first = await f.select(); const after = f.store.snapshot();
  for (const sessionId of ['session-a', 'session-b', 'future-session']) {
    assert.equal(resolveConversationWorkflow(after, f.project.id, sessionId).instanceId, first.instanceId, sessionId);
  }
  assert.equal(resolveConversationWorkflow(after, f.project.id, 'session-b').selection, 'inherit');
  assert.equal(resolveConversationWorkflow(after, f.other.id, 'other-default').instanceId, other.instanceId);
  assert.equal(resolveConversationWorkflow(after, f.other.id, 'other-none').instanceId, null);
  assert.deepEqual(after.conversationWorkflows!.selections.filter(entry => entry.projectId === f.other.id), before.conversationWorkflows!.selections.filter(entry => entry.projectId === f.other.id));
  assert.deepEqual(after.conversationWorkflows!.defaults.filter(entry => entry.projectId === f.other.id), before.conversationWorkflows!.defaults.filter(entry => entry.projectId === f.other.id));
  assert.deepEqual(after.conversationWorkflows!.instances.filter(entry => entry.projectId === f.other.id), before.conversationWorkflows!.instances.filter(entry => entry.projectId === f.other.id));
  assert.deepEqual(after.runs, before.runs, 'selection cannot start model execution');
  assert.deepEqual((await WorkforceStore.open(f.file)).snapshot(), after);
});

test('after the project default is established, workflow and None choices remain local and installation is reused', async t => {
  const f = await fixture(t);
  const first = await f.select(); const inherited = resolveConversationWorkflow(f.store.snapshot(), f.project.id, 'session-b');
  assert.equal(inherited.instanceId, first.instanceId); assert.equal(inherited.selection, 'inherit');
  const alternate = await f.select('session-b', f.alternate);
  assert.notEqual(alternate.instanceId, first.instanceId);
  await f.store.selectConversationWorkflow({ projectId: f.project.id, sessionId: 'local-none', workflowTemplateId: null }, { expectedRevision: f.store.snapshot().revision });
  assert.equal(resolveConversationWorkflow(f.store.snapshot(), f.project.id, 'local-none').instanceId, null);
  assert.equal(resolveConversationWorkflow(f.store.snapshot(), f.project.id, 'session-c').instanceId, first.instanceId);
  assert.equal(resolveConversationWorkflow(f.store.snapshot(), f.other.id, 'another-project').instanceId, null);
  const beforeRepeat = f.store.snapshot(); await f.select('session-b', f.alternate);
  assert.equal(f.store.snapshot().employees.length, beforeRepeat.employees.length);
  assert.equal(f.store.snapshot().conversationWorkflows!.instances.length, 2);
  assert.deepEqual(f.store.snapshot().conversationWorkflows!.defaults, beforeRepeat.conversationWorkflows!.defaults);
  assert.deepEqual(f.store.snapshot().runs, beforeRepeat.runs);
  const read = await WorkforceStore.open(f.file);
  assert.equal(resolveConversationWorkflow(read.snapshot(), f.project.id, 'session-b').instanceId, alternate.instanceId);
  assert.equal(resolveConversationWorkflow(read.snapshot(), f.project.id, 'session-c').instanceId, first.instanceId);
  assert.equal(resolveConversationWorkflow(read.snapshot(), f.project.id, 'local-none').instanceId, null);
});

test('existing project defaults, local overrides and accepted progress survive reopening and selecting again', async t => {
  const f = await fixture(t); const first = await f.select();
  const delivery = await f.run('已验收的需求基线');
  await f.store.reviewRun(delivery.id, { decision: 'accepted', reviewer: '用户', note: '保留历史验收' });
  const alternate = await f.select('local-alternate', f.alternate);
  await f.store.selectConversationWorkflow({ projectId: f.project.id, sessionId: 'local-none', workflowTemplateId: null }, { expectedRevision: f.store.snapshot().revision });
  const before = f.store.snapshot(); const read = await WorkforceStore.open(f.file);
  assert.deepEqual(read.snapshot(), before, 'opening existing data cannot reapply the first-selection rule');
  await read.selectConversationWorkflow({ projectId: f.project.id, sessionId: 'another-inherited-chat', workflowTemplateId: f.workflow.id }, { expectedRevision: before.revision });
  const after = read.snapshot();
  assert.equal(resolveConversationWorkflow(after, f.project.id, 'local-alternate').instanceId, alternate.instanceId);
  assert.equal(resolveConversationWorkflow(after, f.project.id, 'local-none').instanceId, null);
  assert.equal(resolveConversationWorkflow(after, f.project.id, 'future-chat').instanceId, first.instanceId);
  assert.equal(resolveConversationWorkflow(after, f.project.id, 'future-chat').currentStepId, 'design');
  assert.deepEqual(after.conversationWorkflows!.defaults, before.conversationWorkflows!.defaults);
  assert.deepEqual(after.conversationWorkflows!.instances, before.conversationWorkflows!.instances);
  assert.deepEqual(after.projectTeams, before.projectTeams);
  assert.deepEqual(after.employees, before.employees);
  assert.deepEqual(after.runs, before.runs, 'selecting an existing workflow neither starts work nor erases accepted deliveries');
});

test('current step is shared but clicking never marks any earlier step completed; roster follows owner descendants', async t => {
  const f = await fixture(t); const initial = await f.select();
  const selected = await f.step('design', 'session-inherited');
  assert.equal(selected.owner!.templateId, f.base.id);
  assert.equal(selected.activeEmployeeIds.length, 2);
  const state = f.store.snapshot();
  assert.deepEqual(new Set(selected.activeEmployeeIds.map(id => state.employees.find(employee => employee.id === id)!.templateId)), new Set([f.base.id, f.developer.id]));
  assert.deepEqual(selected.steps.map(step => step.status), ['pending', 'current', 'pending']);
  assert.equal(resolveConversationWorkflow(state, f.project.id, 'session-a').currentStepId, 'design');
  assert.deepEqual(state.conversationWorkflows!.instances[0]!.completions, []);
  assert.deepEqual(state.employees.map(employee => employee.modules), initial.activeEmployeeIds.map(id => state.employees.find(employee => employee.id === id)!.modules));
});

test('selection CAS, employee versions and project ownership reject without partial installation', async t => {
  const f = await fixture(t); const before = await readFile(f.file, 'utf8');
  const input = { projectId: f.project.id, sessionId: 'session-a', workflowTemplateId: f.workflow.id,
    workflowTemplateVersion: f.workflow.version, templateVersions: Object.fromEntries(f.store.snapshot().templates.map(entry => [entry.id, entry.version])) };
  await assert.rejects(f.store.selectConversationWorkflow(input), /版本/);
  await assert.rejects(f.store.selectConversationWorkflow(input, { expectedRevision: f.store.snapshot().revision - 1 }), /更新/);
  await assert.rejects(f.store.selectConversationWorkflow({ ...input, workflowTemplateVersion: 99 }, { expectedRevision: f.store.snapshot().revision }), /更新/);
  await assert.rejects(f.store.selectConversationWorkflow({ ...input, templateVersions: {} }, { expectedRevision: f.store.snapshot().revision }), /更新/);
  await assert.rejects(f.store.selectConversationWorkflow({ ...input, projectId: 'missing-project' }, { expectedRevision: f.store.snapshot().revision }), /项目不存在/);
  assert.equal(await readFile(f.file, 'utf8'), before);
  const view = await f.select(); const selectedBefore = await readFile(f.file, 'utf8');
  await assert.rejects(f.store.selectConversationWorkflow({ ...input, projectId: f.other.id }, { expectedRevision: f.store.snapshot().revision }), /其他项目/);
  await assert.rejects(f.store.selectConversationWorkflowStep({ projectId: f.project.id, sessionId: 'session-a', stepId: 'test', instanceVersion: view.instanceVersion! - 1 }, { expectedRevision: f.store.snapshot().revision }), /进度已更新/);
  await assert.rejects(f.step('foreign-step'), /不属于/);
  assert.equal(await readFile(f.file, 'utf8'), selectedBefore);
});

test('source edits update references and removing a definition leaves its history unavailable in the menu', async t => {
  const f = await fixture(t); const first = await f.select();
  await f.store.saveWorkflowTemplate({ ...f.workflow, name: '新的定义', steps: [{ ...f.workflow.steps[0]!, instruction: '全新要求' }] }, { expectedVersion: f.workflow.version });
  await f.store.saveTemplate({ ...f.base, name: '新架构师' }, { expectedVersion: f.base.version });
  const selected = await f.select('session-b');
  assert.equal(selected.name, '新的定义'); assert.equal(selected.steps.length, 1); assert.equal(selected.steps[0]!.instruction, '全新要求');
  assert.equal(selected.instanceId, first.instanceId); assert.ok(selected.workflowTemplateVersion! > first.workflowTemplateVersion!);
  const before = f.store.snapshot(); await f.store.deleteWorkflowTemplate(f.workflow.id);
  const retained = resolveConversationWorkflow(f.store.snapshot(), f.project.id, 'session-a');
  assert.equal(retained.instanceId, first.instanceId); assert.ok(!retained.choices.some(choice => choice.id === f.workflow.id));
  assert.deepEqual(f.store.snapshot().projectTeams, before.projectTeams); assert.match(retained.unavailableReason!, /从库中移除/);
  await assert.rejects(f.select('session-c'), /不存在/);
});

test('workflow team knowledge gate is frozen; old snapshots only recover an exact source version and otherwise stay off', async t => {
  const f = await fixture(t);
  const off = await f.store.saveWorkflowTemplate({ ...f.workflow, id: 'off-workflow', team: { ...f.workflow.team!, knowledgeEnabled: false } });
  const installed = await f.select('off-session', off);
  assert.equal(f.store.snapshot().projectTeams!.find(team => team.id === installed.projectTeamId)!.knowledgeEnabled, false);
  const legacyTeam = structuredClone(f.workflow.team!); delete legacyTeam.knowledgeEnabled;
  const legacyExact = await f.store.saveWorkflowTemplate({ ...f.workflow, id: 'legacy-exact', team: legacyTeam });
  const exact = await f.select('exact-session', legacyExact);
  assert.equal(f.store.snapshot().projectTeams!.find(team => team.id === exact.projectTeamId)!.knowledgeEnabled, true);
  await f.store.saveTeam({ ...f.team, knowledgeEnabled: false }, { expectedVersion: f.team.version });
  assert.equal(f.store.snapshot().projectTeams!.find(team => team.id === exact.projectTeamId)!.knowledgeEnabled, true, 'changing a source team cannot mutate installed gates');
  const legacyStale = await f.store.saveWorkflowTemplate({ ...f.workflow, id: 'legacy-stale', team: legacyTeam });
  const stale = await f.select('stale-session', legacyStale);
  assert.equal(f.store.snapshot().projectTeams!.find(team => team.id === stale.projectTeamId)!.knowledgeEnabled, false);
  await f.store.deleteTeam(f.team.id);
  const legacyMissing = await f.store.saveWorkflowTemplate({ ...f.workflow, id: 'legacy-missing', team: legacyTeam });
  const missing = await f.select('missing-session', legacyMissing);
  assert.equal(f.store.snapshot().projectTeams!.find(team => team.id === missing.projectTeamId)!.knowledgeEnabled, false);
  const explicit = await f.store.saveWorkflowTemplate({ ...f.workflow, id: 'explicit-on', team: { ...legacyTeam, knowledgeEnabled: true } });
  const enabled = await f.select('explicit-session', explicit);
  assert.equal(f.store.snapshot().projectTeams!.find(team => team.id === enabled.projectTeamId)!.knowledgeEnabled, true, 'an explicit frozen switch remains authoritative after source removal');
  const before = await readFile(f.file, 'utf8');
  await assert.rejects(f.store.saveWorkflowTemplate({ ...f.workflow, id: 'invalid-switch', team: { ...legacyTeam, knowledgeEnabled: 'false' as unknown as boolean } }), /布尔/);
  assert.equal(await readFile(f.file, 'utf8'), before);
});

test('ordinary delivery or child review does not complete a step; accepted owner delivery advances with retained evidence', async t => {
  const f = await fixture(t); let view = await f.select();
  const parent = await f.run();
  assert.equal(resolveConversationWorkflow(f.store.snapshot(), f.project.id, 'session-a').currentStepId, 'requirements');
  const child = await f.run('完成子任务', 'session-a', parent.id, view.activeEmployeeIds.find(id => id !== view.owner!.id)!);
  await f.store.reviewRun(child.id, { decision: 'accepted', reviewer: '用户' });
  assert.deepEqual(f.store.snapshot().conversationWorkflows!.instances[0]!.completions, []);
  await f.store.reviewRun(parent.id, { decision: 'accepted', reviewer: '用户', note: '需求基线已核对' }, { expectedVersion: parent.version });
  view = resolveConversationWorkflow(f.store.snapshot(), f.project.id, 'session-b');
  assert.equal(view.currentStepId, 'design'); assert.deepEqual(view.steps.map(step => step.status), ['completed', 'current', 'pending']);
  const completed = f.store.snapshot().conversationWorkflows!.instances[0]!.completions;
  assert.equal(completed.length, 1); assert.equal(completed[0]!.runId, parent.id);
  const missing = await f.run(''); const before = await readFile(f.file, 'utf8');
  await assert.rejects(f.store.reviewRun(missing.id, { decision: 'accepted', reviewer: '用户' }), /缺少/);
  assert.equal(await readFile(f.file, 'utf8'), before);
});

test('active attempts block shared step switches, while stale/off-owner/cross-project admission is rejected', async t => {
  const f = await fixture(t); const view = await f.select();
  const request = { projectId: f.project.id, employeeId: view.owner!.id, request: '处理需求', conversationWorkflow: { instanceId: view.instanceId!, stepId: 'requirements' } };
  const before = await readFile(f.file, 'utf8');
  await assert.rejects(f.store.createRun({ ...request, employeeId: view.activeEmployeeIds.find(id => id !== view.owner!.id)! }), /负责人/);
  await assert.rejects(f.store.createRun({ ...request, conversationWorkflow: { instanceId: view.instanceId!, stepId: 'design' } }), /已经切换/);
  await assert.rejects(f.store.createRun({ ...request, projectId: f.other.id }), /其他项目/);
  assert.equal(await readFile(f.file, 'utf8'), before);
  const run = await f.store.createRun(request);
  await assert.rejects(f.step('design', 'session-b'), /仍在执行/);
  await f.store.updateRun(run.id, { status: 'cancelled' });
  assert.equal((await f.step('design', 'session-b')).currentStepId, 'design');
});

test('delegation inherits the frozen workflow link and blocks progression until live children settle', async t => {
  const f = await fixture(t); const view = await f.select(); const parent = await f.run();
  const child = await f.store.createRun({ projectId: f.project.id, employeeId: view.activeEmployeeIds.find(id => id !== view.owner!.id)!, request: '处理下级任务', parentRunId: parent.id });
  assert.deepEqual(child.conversationWorkflow, parent.conversationWorkflow);
  const before = await readFile(f.file, 'utf8');
  await assert.rejects(f.store.createRun({ projectId: f.project.id, employeeId: child.employeeId, request: '伪造新流程', parentRunId: parent.id,
    conversationWorkflow: { instanceId: view.instanceId!, stepId: 'design' } }), /保留原/);
  await assert.rejects(f.store.reviewRun(parent.id, { decision: 'accepted', reviewer: '用户' }), /委派结束/);
  await assert.rejects(f.step('design'), /仍在执行/);
  assert.equal(await readFile(f.file, 'utf8'), before);
  await f.store.updateRun(child.id, { status: 'cancelled' });
  await f.store.reviewRun(parent.id, { decision: 'accepted', reviewer: '用户' });
  assert.equal(resolveConversationWorkflow(f.store.snapshot(), f.project.id, 'session-a').currentStepId, 'design');
});

test('rejected verification returns to the configured step and invalidates downstream completion without erasing reviews', async t => {
  const f = await fixture(t); await f.select();
  const requirement = await f.run(); await f.store.reviewRun(requirement.id, { decision: 'accepted', reviewer: '用户' });
  const design = await f.run(); await f.store.reviewRun(design.id, { decision: 'accepted', reviewer: '用户' });
  const rejected = await f.run(); await f.store.reviewRun(rejected.id, { decision: 'rejected', reviewer: '用户', note: '实现不符合架构' });
  const state = f.store.snapshot(); const view = resolveConversationWorkflow(state, f.project.id, 'session-a');
  assert.equal(view.currentStepId, 'design'); assert.deepEqual(view.steps.map(step => step.status), ['completed', 'current', 'pending']);
  assert.ok(state.conversationWorkflows!.instances[0]!.completions.find(entry => entry.runId === design.id)!.invalidatedAt);
  assert.equal(state.runs.find(run => run.id === design.id)!.acceptance!.decision, 'accepted');
  assert.equal(state.runs.find(run => run.id === rejected.id)!.acceptance!.decision, 'rejected');
  const revised = await f.run(); await f.store.reviewRun(revised.id, { decision: 'accepted', reviewer: '用户' });
  assert.equal(resolveConversationWorkflow(f.store.snapshot(), f.project.id, 'session-a').currentStepId, 'test');
});

test('out-of-order clicks cannot bypass pending work or review the wrong current step', async t => {
  const f = await fixture(t); await f.select(); await f.step('test');
  const testRun = await f.run(); await f.store.reviewRun(testRun.id, { decision: 'accepted', reviewer: '用户' });
  assert.equal(resolveConversationWorkflow(f.store.snapshot(), f.project.id, 'session-a').currentStepId, 'requirements');
  const old = await f.run(); await f.step('design');
  await assert.rejects(f.store.reviewRun(old.id, { decision: 'accepted', reviewer: '用户' }), /先返回/);
  assert.equal(f.store.snapshot().runs.find(run => run.id === old.id)!.status, 'awaiting-review');
  await f.step('requirements'); await f.store.reviewRun(old.id, { decision: 'accepted', reviewer: '用户' });
  const design = await f.run(); await f.store.reviewRun(design.id, { decision: 'accepted', reviewer: '用户' });
  const done = resolveConversationWorkflow(f.store.snapshot(), f.project.id, 'session-a');
  assert.equal(done.currentStepId, undefined); assert.equal(done.owner, undefined); assert.ok(done.steps.every(step => step.status === 'completed'));
});

test('persisted validation rejects fabricated completion, duplicate installs, cross-project selections and legacy mixed runners', async t => {
  const f = await fixture(t); await f.select(); const good = f.store.snapshot(); validateState(good);
  const fake = structuredClone(good); fake.conversationWorkflows!.instances[0]!.completions.push({ stepId: 'requirements', runId: 'no-evidence', acceptedAt: new Date().toISOString() });
  assert.throws(() => validateState(fake), /已验收交付/);
  const duplicate = structuredClone(good); duplicate.conversationWorkflows!.instances.push({ ...duplicate.conversationWorkflows!.instances[0]!, id: 'duplicate' });
  assert.throws(() => validateState(duplicate), /重复安装/);
  const cross = structuredClone(good); cross.conversationWorkflows!.selections[0]!.projectId = f.other.id;
  assert.throws(() => validateState(cross), /跨项目/);
  const legacy = structuredClone(good); delete legacy.conversationWorkflows; validateState(legacy);
  const run = await f.run(); const mixed = f.store.snapshot(); mixed.runs.find(entry => entry.id === run.id)!.workTaskId = 'fake-task';
  assert.throws(() => validateState(mixed), /任务|混用/);
});


test('workflow menus reference exactly the library and shared definition edits update all project bindings', async t => {
  const f = await fixture(t); const first = await f.select(); const elsewhere = await f.select('second-project', f.workflow, f.other.id);
  const before = f.store.snapshot();
  const changed = await f.store.saveWorkflowTemplate({ ...f.workflow, name: '统一的新名称', steps: f.workflow.steps.map((step, i) => i === 0 ? { ...step, instruction: '新版步骤说明', outputs: ['新版交付内容'] } : step) }, { expectedRevision: before.revision, expectedVersion: f.workflow.version });
  const state = f.store.snapshot();
  for (const projectId of [f.project.id, f.other.id]) {
    const view = resolveConversationWorkflow(state, projectId, projectId === f.project.id ? 'session-a' : 'second-project');
    assert.deepEqual(view.choices.map(item => [item.id, item.name, item.version]), state.workflowTemplates!.map(item => [item.id, item.name, item.version]));
    assert.equal(view.name, changed.name); assert.equal(view.steps[0]!.instruction, '新版步骤说明'); assert.deepEqual(view.steps[0]!.outputs, ['新版交付内容']);
    assert.equal(view.workflowTemplateVersion, changed.version); assert.equal(view.currentStepId, 'requirements');
  }
  assert.deepEqual(state.employees, before.employees, 'definition changes reuse the existing roster without copying employees');
  assert.deepEqual(state.runs, before.runs); assert.deepEqual(state.conversationWorkflows!.defaults, before.conversationWorkflows!.defaults);
  assert.equal(state.conversationWorkflows!.instances.find(item => item.id === first.instanceId)!.version, first.instanceVersion! + 1);
  assert.equal(state.conversationWorkflows!.instances.find(item => item.id === elsewhere.instanceId)!.version, elsewhere.instanceVersion! + 1);
  await assert.rejects(f.store.selectConversationWorkflowStep({ projectId: f.project.id, sessionId: 'session-a', stepId: 'design', instanceVersion: first.instanceVersion! }, { expectedRevision: state.revision }), /已更新/);
});

test('reference renaming preserves accepted history while changed requirements require revalidation', async t => {
  const f = await fixture(t); await f.select(); const run = await f.run(); await f.store.reviewRun(run.id, { decision: 'accepted', reviewer: '用户', note: '需求验收' });
  const before = f.store.snapshot(); const renamed = await f.store.saveWorkflowTemplate({ ...f.workflow, name: '新名称' });
  assert.deepEqual(f.store.snapshot().conversationWorkflows!.instances[0]!.completions, before.conversationWorkflows!.instances[0]!.completions);
  await f.store.saveWorkflowTemplate({ ...renamed, steps: renamed.steps.map((step, i) => i ? step : { ...step, acceptanceCriteria: ['新的可验证条件'] }) });
  const state = f.store.snapshot(); assert.ok(state.conversationWorkflows!.instances[0]!.completions[0]!.invalidatedAt);
  assert.deepEqual(state.runs, before.runs, 'accepted deliverables remain immutable history');
  await assert.rejects(f.store.saveWorkflowTemplate({ ...state.workflowTemplates!.find(item => item.id === renamed.id)!, steps: renamed.steps.slice(1) }), /已有交付/);
});

test('referenced definitions cannot change during execution and failed updates leave no partial state', async t => {
  const f = await fixture(t); const view = await f.select();
  await f.store.createRun({ projectId: f.project.id, employeeId: view.owner!.id, request: '运行中任务', conversationWorkflow: { instanceId: view.instanceId!, stepId: view.currentStepId! } });
  const before = await readFile(f.file, 'utf8');
  await assert.rejects(f.store.saveWorkflowTemplate({ ...f.workflow, name: '运行中改名' }), /正在执行/);
  await assert.rejects(f.store.deleteWorkflowTemplate(f.workflow.id), /正在执行/);
  assert.equal(await readFile(f.file, 'utf8'), before);
});

test('legacy project-only workflows are adopted once into the library without touching progress or deliveries', async t => {
  const f = await fixture(t); await f.select(); const delivery = await f.run(); await f.store.reviewRun(delivery.id, { decision: 'accepted', reviewer: '用户' });
  const before = f.store.snapshot(); const old = structuredClone(before); const instance = old.conversationWorkflows!.instances[0]!;
  const team = old.projectTeams!.find(team => team.id === instance.projectTeamId)!; const workflow = team.workflows.find(flow => flow.id === instance.workflowId)!;
  instance.workflowTemplateId = 'legacy-project-only'; delete instance.definitionSource; team.teamTemplateId = 'conversation-workflow:legacy-project-only'; workflow.templateWorkflowId = 'legacy-project-only'; workflow.name = '旧项目专用流程';
  await writeFile(f.file, JSON.stringify(old)); const migrated = await WorkforceStore.open(f.file); const state = migrated.snapshot();
  assert.equal(state.workflowTemplates!.filter(item => item.id === 'legacy-project-only').length, 1);
  assert.deepEqual(state.employees, old.employees); assert.deepEqual(state.runs, old.runs); assert.deepEqual(state.projectTeams, old.projectTeams);
  assert.deepEqual(state.conversationWorkflows!.instances[0]!.completions, instance.completions);
  assert.equal(state.conversationWorkflows!.instances[0]!.currentStepId, instance.currentStepId);
  assert.deepEqual(resolveConversationWorkflow(state, f.project.id, 'session-a').choices.map(item => item.id), state.workflowTemplates!.map(item => item.id));
  assert.deepEqual((await WorkforceStore.open(f.file)).snapshot(), state, 'opening again must not duplicate or reapply adoption');
});

test('removing a library definition removes its menu reference without erasing or resurrecting project history', async t => {
  const f = await fixture(t); await f.select(); const run = await f.run(); const before = f.store.snapshot(); await f.store.deleteWorkflowTemplate(f.workflow.id);
  const after = (await WorkforceStore.open(f.file)).snapshot(); const view = resolveConversationWorkflow(after, f.project.id, 'session-a');
  assert.ok(!view.choices.some(choice => choice.id === f.workflow.id)); assert.match(view.unavailableReason!, /从库中移除/);
  assert.deepEqual(after.runs, before.runs); assert.deepEqual(after.projectTeams, before.projectTeams); assert.deepEqual(after.employees, before.employees);
  await assert.rejects(f.store.createRun({ projectId: f.project.id, employeeId: view.steps[0]!.employeeId, request: '不能继续路由', conversationWorkflow: { instanceId: view.instanceId!, stepId: 'requirements' } }), /从库中移除/);
  assert.equal(after.runs[0]!.id, run.id);
});
