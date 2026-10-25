/** Real pointer/keyboard ordering against the production UI and its persisted HTTP API. */
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

export async function exerciseLibraryReordering({ page, snapshot, command, check, artifacts, metrics }) {
  await page.setViewportSize({ width: 1512, height: 1050 });
  const initial = await snapshot(), modules = structuredClone(initial.templates.find(row => row.status !== 'archived').modules);
  modules.knowledge.sources = [];
  const extraEmployees = [];
  for (const name of ['SORT-可见甲', 'SORT-隐藏', 'SORT-可见乙']) extraEmployees.push((await command('template.save', { name, modules, status: 'draft' })).result);
  for (const suffix of ['甲', '乙']) await command('team.save', { name: `SORT-团队${suffix}`, knowledgeEnabled: false, members: [{ memberId: `root-${suffix}`, templateId: extraEmployees[0].id }, { memberId: `child-${suffix}`, templateId: extraEmployees[1].id, reportsTo: `root-${suffix}` }] });
  for (const suffix of ['甲', '乙']) await command('workflow.template.save', { name: `SORT-工作流${suffix}`, roles: [{ id: 'role', name: '负责人' }], steps: [{ id: 'step', name: '执行', roleId: 'role', instruction: '只检查排序，不执行模型' }] });
  const baseline = await snapshot();
  const nav = page.getByRole('navigation', { name: '资源库' });
  const sidebar = page.locator('.wf-sidebar');
  const rows = () => sidebar.locator('[data-library-order-id]');
  const row = id => sidebar.locator(`[data-library-order-id="${id}"]`);
  const domIds = () => rows().evaluateAll(elements => elements.map(element => element.dataset.libraryOrderId));
  const stateIds = (state, kind) => (kind === 'employee' ? state.templates.filter(row => row.status !== 'archived') : kind === 'team' ? state.teams : state.workflowTemplates ?? []).map(row => row.id);
  const reorderResponse = () => page.waitForResponse(response => response.url().endsWith('/digital-workers/api/command') && response.request().postDataJSON()?.action === 'library.reorder');
  const switchTo = async kind => {
    if (!(await nav.isVisible())) await page.getByRole('button', { name: 'graph_horses', exact: true }).click();
    await nav.getByRole('button', { name: kind === 'employee' ? /^自由职业人库/ : kind === 'team' ? /^团队/ : /^工作流/ }).click();
    await expect(rows().first()).toBeVisible();
  };
  const reload = async kind => { await page.reload({ waitUntil: 'domcontentloaded' }); await switchTo(kind); };
  const drag = async (sourceId, targetId, after = false) => {
    await row(sourceId).scrollIntoViewIfNeeded(); const source = await row(sourceId).boundingBox();
    await row(targetId).scrollIntoViewIfNeeded(); const target = await row(targetId).boundingBox();
    assert.ok(source && target);
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2 + 8, { steps: 3 });
    await page.mouse.move(target.x + target.width / 2, target.y + (after ? target.height - 3 : 3), { steps: 16 });
    await expect(row(targetId)).toHaveClass(after ? /wf-library-order-after/ : /wf-library-order-before/);
    const response = reorderResponse(); await page.mouse.up();
    assert.ok((await response).ok());
    await expect(sidebar).not.toHaveAttribute('aria-busy', 'true');
  };
  const assertUnchanged = (before, after) => {
    const canonical = rows => [...rows ?? []].sort((a, b) => a.id.localeCompare(b.id));
    for (const key of ['templates', 'teams', 'workflowTemplates']) assert.deepEqual(canonical(after[key]), canonical(before[key]), `${key}: only array positions may change`);
    for (const key of ['projects', 'projectTeams', 'employees', 'runs', 'workflowRuns', 'memories', 'workState']) assert.deepEqual(after[key], before[key], `${key}: ordering must not change instances or execution`);
  };
  await reload('employee');
  let ids = stateIds(await snapshot(), 'employee');
  const employeeName = page.locator('.wf-employee-editor').getByRole('textbox', { name: '员工名称', exact: true });
  const selectedName = await employeeName.inputValue();
  const selectedEmployeeId = await sidebar.locator('.wf-employee-nav-item.is-active').getAttribute('data-library-order-id');
  assert.ok(selectedEmployeeId);
  // Move adjacent visible rows: every part of the compact row is a mouse drag target.
  await drag(ids[1], ids[0]); [ids[0], ids[1]] = [ids[1], ids[0]];
  await expect.poll(domIds).toEqual(ids); await expect(employeeName).toHaveValue(selectedName); await expect(row(selectedEmployeeId)).toHaveClass(/is-active/);
  await reload('employee'); await expect.poll(domIds).toEqual(ids);
  check('employee-pointer-drag-persists-after-refresh-without-misclick-or-entity-version-change');

  // A filtered move substitutes only the matching slots; the hidden row stays exactly in place.
  await page.getByRole('textbox', { name: '搜索员工', exact: true }).fill('SORT-可见');
  const filteredBefore = await snapshot(), filteredIds = [extraEmployees[0].id, extraEmployees[2].id];
  await expect.poll(domIds).toEqual(filteredIds);
  await drag(filteredIds[1], filteredIds[0]);
  const filteredAfter = await snapshot();
  const fullBefore = stateIds(filteredBefore, 'employee'), fullAfter = stateIds(filteredAfter, 'employee');
  const visible = new Set(filteredIds), reverse = [...filteredIds].reverse(); let slot = 0;
  assert.deepEqual(fullAfter, fullBefore.map(id => visible.has(id) ? reverse[slot++] : id));
  assert.equal(fullAfter.indexOf(extraEmployees[1].id), fullBefore.indexOf(extraEmployees[1].id));
  await page.getByRole('textbox', { name: '搜索员工', exact: true }).fill('');
  await expect.poll(domIds).toEqual(fullAfter);
  check('search-filtered-drag-preserves-hidden-record-and-archived-slots');

  // Ordering is separate from saving an employee draft.
  await employeeName.fill(`${selectedName} 未保存草稿`);
  await expect(page.locator('.wf-employee-editor').getByText('未保存', { exact: true })).toBeVisible();
  ids = await domIds(); const beforeDraft = await snapshot(); await drag(ids[1], ids[0]);
  await expect(employeeName).toHaveValue(`${selectedName} 未保存草稿`);
  assertUnchanged(beforeDraft, await snapshot());
  const activeEmployeeId = await sidebar.locator('.wf-employee-nav-item.is-active').getAttribute('data-library-order-id');
  const leaveId = ids.find(id => id !== activeEmployeeId); assert.ok(leaveId);
  const discard = page.waitForEvent('dialog'); const leave = row(leaveId).click();
  const dialog = await discard; assert.match(dialog.message(), /尚未保存/); await dialog.accept(); await leave;
  check('list-ordering-preserves-unsaved-employee-draft-without-saving-it');

  ids = await domIds();
  const source = row(ids[1]); await source.focus();
  let response = reorderResponse(); await source.press('Alt+ArrowUp'); assert.ok((await response).ok());
  await expect(row(ids[1])).toBeFocused();
  assert.equal((await snapshot()).templates.filter(row => row.status !== 'archived')[0].id, ids[1]);
  check('keyboard-alt-arrows-save-order-and-retain-focus');

  // Escape and dropping outside the list are no-ops, including the subsequent click.
  const cancelBefore = await snapshot(); const activeName = await employeeName.inputValue();
  await page.evaluate(() => {
    window.libraryOrderEscapeBubbles = 0;
    window.libraryOrderEscapeProbe = event => { if (event.key === 'Escape') window.libraryOrderEscapeBubbles++; };
    document.addEventListener('keydown', window.libraryOrderEscapeProbe);
  });
  for (const escape of [true, false]) {
    const item = await rows().nth(1).boundingBox(); assert.ok(item);
    await page.mouse.move(item.x + 20, item.y + item.height / 2); await page.mouse.down();
    await page.mouse.move(item.x + 20, item.y + item.height / 2 + 10, { steps: 3 });
    if (escape) await page.keyboard.press('Escape'); else await page.mouse.move(1000, 40, { steps: 12 });
    await page.mouse.up();
  }
  assert.deepEqual(await snapshot(), cancelBefore); await expect(employeeName).toHaveValue(activeName);
  assert.equal(await page.evaluate(() => window.libraryOrderEscapeBubbles), 0, 'a drag cancellation must not reach a surrounding dialog Escape handler');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.libraryOrderEscapeBubbles), 1, 'Escape outside a drag must keep its normal propagation');
  await page.evaluate(() => { document.removeEventListener('keydown', window.libraryOrderEscapeProbe); delete window.libraryOrderEscapeProbe; delete window.libraryOrderEscapeBubbles; });
  check('escape-and-outside-drop-cancel-without-selecting-row-or-mutating-state');

  // Simulate a different editor writing between the read and the drag CAS.
  const conflictId = `sort-conflict-${randomUUID()}`;
  await command('template.save', { id: conflictId, name: 'SORT-并发新员工', modules, status: 'draft' });
  const conflictBefore = await snapshot();
  response = reorderResponse(); await rows().nth(1).press('Alt+ArrowUp'); assert.equal((await response).status(), 409);
  await expect(page.getByRole('alert')).toContainText('刷新');
  await expect.poll(domIds).toEqual(stateIds(conflictBefore, 'employee'));
  assert.deepEqual(await snapshot(), conflictBefore);
  response = reorderResponse(); await rows().nth(1).press('Alt+ArrowUp'); assert.ok((await response).ok());
  check('stale-revision-shows-conflict-refreshes-order-and-can-be-retried');

  await switchTo('team'); ids = await domIds();
  const selectedTeam = sidebar.locator('.wf-team-nav-heading.is-active');
  const selectedTeamId = await selectedTeam.getAttribute('data-library-order-id');
  const teamBefore = await snapshot(); await drag(ids[1], ids[0]);
  [ids[0], ids[1]] = [ids[1], ids[0]];
  await expect.poll(domIds).toEqual(ids); assert.equal(await selectedTeam.getAttribute('data-library-order-id'), selectedTeamId);
  assertUnchanged(teamBefore, await snapshot());
  await expect(sidebar.locator('button[data-member-drop]')).toHaveCount(0);
  await reload('team'); await expect.poll(domIds).toEqual(ids);
  check('team-root-drag-persists-with-readonly-member-tree-and-reporting-hierarchy-intact');

  await switchTo('workflow'); ids = await domIds();
  const workflowName = page.locator('.wf-workflow-template-editor').getByRole('textbox', { name: '工作流名称', exact: true });
  const originalWorkflowName = await workflowName.inputValue();
  const originalWorkflowId = await sidebar.locator('.wf-workflow-nav-item.is-active').getAttribute('data-library-order-id');
  assert.ok(originalWorkflowId);
  await workflowName.fill(`${originalWorkflowName} 未保存草稿`);
  const flowBefore = await snapshot(); await drag(ids[1], ids[0]);
  [ids[0], ids[1]] = [ids[1], ids[0]];
  await expect.poll(domIds).toEqual(ids); await expect(workflowName).toHaveValue(`${originalWorkflowName} 未保存草稿`);
  assertUnchanged(flowBefore, await snapshot());
  const leaveFlow = page.waitForEvent('dialog'); const switchPromise = switchTo('team'); const flowDialog = await leaveFlow;
  assert.match(flowDialog.message(), /尚未保存/); await flowDialog.accept(); await switchPromise;
  await reload('workflow'); await expect.poll(domIds).toEqual(ids); await row(originalWorkflowId).click(); await expect(workflowName).toHaveValue(originalWorkflowName);
  check('workflow-pointer-order-persists-and-keeps-unsaved-editor-separate');

  const after = await snapshot();
  const withoutConflict = { ...after, templates: after.templates.filter(row => row.id !== conflictId) };
  assertUnchanged(baseline, withoutConflict);
  metrics.libraryOrdering = { employeeOrder: stateIds(after, 'employee'), teamOrder: stateIds(after, 'team'), workflowOrder: stateIds(after, 'workflow'), expectedRevisionRequired: true, unchangedEntityVersions: true, keyboard: 'Alt+ArrowUp / Alt+ArrowDown' };
  await page.screenshot({ path: resolve(artifacts, 'library-order-workflow.png') });
}
