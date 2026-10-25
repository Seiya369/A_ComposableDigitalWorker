/** Handover/removal through the packaged UI and public API in the runner's temporary official profile. */
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function exerciseTeamMemberRemoval({ page, snapshot, command, check, artifacts, metrics, temp }) {
  await page.setViewportSize({ width: 1512, height: 1050 });
  const modules = structuredClone((await snapshot()).templates.find(item => item.status === 'ready').modules);
  modules.model = { mode: 'inherit' }; modules.knowledge.sources = [];
  const template = (await command('template.save', { name: 'REMOVE-专业岗位', status: 'ready', modules })).result;
  const members = [
    { memberId: 'product', templateId: template.id, name: 'REMOVE-产品负责人' },
    { memberId: 'architect', templateId: template.id, name: 'REMOVE-架构师', reportsTo: 'product' },
    { memberId: 'developer', templateId: template.id, name: 'REMOVE-开发人员', reportsTo: 'architect' },
  ];
  const team = (await command('team.save', { name: 'REMOVE-交接团队', knowledgeEnabled: false, members })).result;
  const flow = (await command('workflow.template.save', {
    name: 'REMOVE-独立流程快照', description: '保持独立原件', maxAttempts: 7,
    team: { sourceTeamId: team.id, sourceTeamVersion: team.version, name: team.name, members },
    roles: [{ id: 'reviewer', name: '架构', memberId: 'architect' }, { id: 'implementer', name: '开发', memberId: 'developer' }],
    steps: [
      { id: 'plan', name: '技术方案', roleId: 'reviewer', instruction: '交付技术方案', outputs: ['设计文档'], acceptanceCriteria: ['通过方案核验'], timeoutMs: 12345 },
      { id: 'implement', name: '开发实现', roleId: 'implementer', instruction: '完成实现', onRejectStepId: 'plan' },
      { id: 'review', name: '技术复核', roleId: 'reviewer', instruction: '复核变更', onRejectStepId: 'implement' },
    ],
  })).result;
  const bound = (await command('workflow.template.bind', { teamId: team.id, workflowTemplateId: flow.id, bindings: { reviewer: 'architect', implementer: 'developer' } })).result;
  // Create a native workspace only under this test's disposable directory. The
  // plugin then installs a real detached project team through its public API.
  const projectPath = resolve(temp, 'REMOVE-隔离项目'); await mkdir(projectPath);
  const base = new URL(page.url()).origin;
  const response = await page.request.post(`${base}/api/workspace/create`, { headers: { Origin: base }, data: { type: 'client-request', rpcId: randomUUID(), method: 'workspace/create', payload: { args: { request: { path: projectPath } } } } });
  assert.ok(response.ok(), 'Native temporary workspace creation succeeds');
  const created = await response.json(); assert.equal(created.result?.ok, true);
  const projectId = created.result.value.workspace.workspaceId;
  const installed = (await command('project.team.configure', { projectId, teamId: bound.id, teamVersion: bound.version, templateVersions: { [template.id]: template.version } })).result;
  const architectId = installed.members.find(member => member.memberId === 'architect').employeeId;
  await command('memory.save', { projectId, employeeId: architectId, scope: 'employee', title: 'REMOVE-保留私有记忆', content: 'KEEP_PROJECT_PRIVATE_MEMORY', source: { kind: 'user-confirmed', reference: '隔离回归测试明确确认' } });
  const baseline = await snapshot();
  const savedTeam = state => state.teams.find(item => item.id === bound.id);
  const assertProtected = state => {
    for (const key of ['projects', 'projectTeams', 'employees', 'runs', 'workflowRuns', 'memories', 'workState']) assert.deepEqual(state[key], baseline[key], `${key}: template handover must preserve installed project records`);
    assert.deepEqual(state.workflowTemplates.find(item => item.id === flow.id), flow, 'Independent global adopted team snapshot remains frozen');
  };
  const nav = page.getByRole('navigation', { name: '资源库', exact: true });
  const selectTeam = async () => {
    await nav.getByRole('button', { name: /^团队/ }).click();
    await page.locator('.wf-sidebar').getByRole('button', { name: bound.name, exact: true }).click();
  };
  // Reload picks up API-created templates without touching the user's real profile.
  await page.reload({ waitUntil: 'domcontentloaded' });
  if (!(await nav.isVisible())) await page.getByRole('button', { name: 'graph_horses', exact: true }).click();
  await selectTeam();
  const editor = page.locator('.wf-team-editor'), rows = editor.locator('.wf-team-member-row');
  const remove = editor.getByRole('button', { name: '移除岗位 REMOVE-架构师', exact: true });
  const dialog = page.getByRole('dialog', { name: '移除团队岗位', exact: true });
  await expect(remove).toBeEnabled(); await remove.click();
  await expect(dialog).toBeVisible(); await expect(dialog.getByLabel('步骤接手人', { exact: true })).toHaveValue('product');
  await expect(dialog.getByRole('list', { name: '需要交接的步骤', exact: true }).getByRole('listitem')).toHaveCount(2);
  await dialog.getByLabel('步骤接手人', { exact: true }).selectOption('developer');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(rows).toHaveCount(3); await expect(remove).toBeFocused();
  assert.deepEqual(savedTeam(await snapshot()), bound); assertProtected(await snapshot());
  check('referenced-team-position-opens-explicit-handover-dialog-and-cancel-preserves-live-template-and-project');

  await remove.click(); await dialog.getByLabel('步骤接手人', { exact: true }).selectOption('developer');
  await page.screenshot({ path: resolve(artifacts, 'team-member-handover-dark.png') });
  await dialog.getByRole('button', { name: '确认移除', exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(rows).toHaveCount(2);
  await expect(rows.nth(1).getByLabel('上一级', { exact: true })).toHaveValue('product');
  const save = editor.getByRole('button', { name: '保存团队', exact: true }); await expect(save).toBeEnabled();
  assert.deepEqual(savedTeam(await snapshot()), bound, 'Confirmation is a local draft until the header save'); assertProtected(await snapshot());
  check('confirmed-position-removal-stays-draft-and-reparents-direct-reports-to-original-manager');

  const pending = page.waitForResponse(item => item.url().endsWith('/digital-workers/api/command') && item.request().postDataJSON()?.action === 'team.save');
  await save.click(); assert.ok((await pending).ok()); await expect(save).toBeDisabled();
  const after = await snapshot(), updated = savedTeam(after);
  assert.equal(updated.version, bound.version + 1);
  assert.deepEqual(updated.members, [members[0], { ...members[2], reportsTo: 'product' }]);
  assert.deepEqual(updated.workflows, bound.workflows.map(workflow => ({ ...workflow, steps: workflow.steps.map(step => ({ ...step, memberId: step.memberId === 'architect' ? 'developer' : step.memberId })) })));
  assertProtected(after);
  await page.reload({ waitUntil: 'domcontentloaded' });
  if (!(await nav.isVisible())) await page.getByRole('button', { name: 'graph_horses', exact: true }).click();
  await selectTeam(); await expect(rows).toHaveCount(2); await expect(rows.nth(1).getByLabel('上一级', { exact: true })).toHaveValue('product');
  assert.deepEqual(savedTeam(await snapshot()), updated); assertProtected(await snapshot());
  check('saved-handover-persists-after-refresh-with-step-identities-return-targets-and-installed-project-snapshots-intact');
  metrics.teamMemberRemoval = { projectId, projectTeamId: installed.id, sourceTeamId: bound.id, versionBefore: bound.version, versionAfter: updated.version, handedOverSteps: 2, projectSnapshotsUnchanged: true, globalWorkflowSnapshotUnchanged: true };
  await page.screenshot({ path: resolve(artifacts, 'team-member-handover-saved-dark.png') });
  return baseline;
}
