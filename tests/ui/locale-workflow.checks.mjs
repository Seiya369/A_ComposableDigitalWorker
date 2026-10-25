import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';

/** Run after an owner delivery is awaiting review in the isolated official host. */
export async function verifyLocaleWorkflow({ page, artifacts, switchLocale }) {
  await mkdir(artifacts, { recursive: true });
  const trigger = page.locator('.wf-conversation-workflow-trigger');
  const steps = page.locator('.wf-conversation-workflow-step');
  const selectedRow = page.locator('[data-row-key^="session:"][aria-selected="true"]');
  const rowKey = await selectedRow.getAttribute('data-row-key');
  assert.ok(rowKey?.startsWith('session:'), 'locale checks require a selected native conversation');
  const sessionId = rowKey.slice('session:'.length);
  const details = async (stepId) => {
    const query = new URLSearchParams({ sessionId, ...(stepId ? { stepId } : {}) });
    const response = await page.request.get(`${new URL(page.url()).origin}/digital-workers/api/conversation-workflow/details?${query}`);
    assert.ok(response.ok(), await response.text()); return response.json();
  };
  const before = await details();
  const originalVisibleStepNames = await page.locator('.wf-conversation-workflow-step-label').allTextContents();
  assert.ok(before.currentStepId && before.name && before.selectedStep?.latestDelivery?.status === 'awaiting-review', 'run locale checks after a current owner delivery becomes reviewable');
  const inspectedId = before.steps.find(step => step.id !== before.currentStepId)?.id ?? before.currentStepId;
  const inspected = await details(inspectedId);
  const dialog = () => page.locator('dialog.wf-conversation-details');
  const instruction = () => dialog().locator('details.wf-conversation-details-instruction:not([data-requirement])');
  const instructionSummary = () => instruction().locator(':scope > summary');
  const instructionBody = () => instruction().locator('.wf-conversation-details-requirements dd');
  const requirements = () => instruction().locator('..').locator(':scope > .wf-conversation-details-requirements');
  const businessWrites = [];
  const requestListener = request => {
    if (request.method() !== 'POST') return;
    const path = new URL(request.url()).pathname;
    if (path === '/digital-workers/api/conversation-workflow/review') businessWrites.push('review');
    if (path === '/digital-workers/api/command') {
      const action = request.postDataJSON()?.action;
      if (typeof action === 'string' && action.startsWith('conversation.workflow.')) businessWrites.push(action);
    }
  };
  page.on('request', requestListener);
  const checks = [];
  try {
    await page.locator('.wf-conversation-workflow-details-trigger').click();
    await expect(dialog()).toHaveAttribute('aria-label', '工作流详情');
    await dialog().locator('[data-step-id=' + JSON.stringify(inspectedId) + ']').click();
    await expect(dialog().locator('[data-step-id=' + JSON.stringify(inspectedId) + ']')).toHaveAttribute('aria-current', 'true');
    await expect(instruction()).toHaveJSProperty('open', false); await expect(instructionBody()).toBeHidden();
    await expect(instructionBody()).toHaveText(inspected.selectedStep.instruction);
    await instructionSummary().click(); await expect(instructionBody()).toBeVisible();
    await switchLocale('en');
    await expect(trigger).toHaveAttribute('aria-label', `Workflow: ${before.name}`);
    await expect(trigger).toContainText(`Workflow: ${before.name}`);
    await expect(page.locator('.wf-conversation-workflow-contact')).toContainText('is your contact');
    await expect(dialog()).toHaveAttribute('aria-label', 'Workflow details');
    await expect(dialog().locator('[data-step-id=' + JSON.stringify(inspectedId) + ']')).toHaveAttribute('aria-current', 'true');
    await expect(dialog().getByRole('heading', { name: 'Step content', exact: true })).toBeVisible();
    await expect(instruction()).toHaveJSProperty('open', true); await expect(instructionBody()).toBeVisible();
    await expect(instruction().locator('dt')).toHaveText('Instructions');
    await expect(dialog().locator('details[data-requirement=outputs] summary')).toHaveText('Deliverables');
    await expect(dialog().locator('details[data-requirement=acceptance] summary')).toHaveText('Acceptance criteria');
    await expect(dialog().getByRole('heading', { level: 2 })).toHaveText(before.projectName);
    await expect(dialog()).toContainText(`Owner: ${inspected.selectedStep.owner.name}`);
    if (inspectedId !== before.currentStepId) await expect(dialog().getByRole('button', { name: 'Set as current', exact: true })).toBeVisible();
    if (before.steps.find(step => step.id === inspectedId)?.onRejectStepId) { await expect(requirements().locator('dt')).toHaveText('Return target'); await expect(requirements().locator('dd')).toHaveText(inspected.selectedStep.onRejectStepName); } else await expect(requirements()).toHaveCount(0);
    await expect(steps.and(page.locator('.is-current'))).toHaveAttribute('aria-label', /Current step/);
    assert.deepEqual(await page.locator('.wf-conversation-workflow-step-label').allTextContents(), originalVisibleStepNames, 'saved step names remain verbatim');
    const sections = requirements().locator(':scope > div');
    assert.equal(await instructionBody().textContent(), inspected.selectedStep.instruction);
    assert.deepEqual(await dialog().locator('details[data-requirement=outputs] li').allTextContents(), inspected.selectedStep.outputs);
    assert.deepEqual(await dialog().locator('details[data-requirement=acceptance] li').allTextContents(), inspected.selectedStep.acceptanceCriteria);
    for (const kind of ['outputs','acceptance']) await expect(dialog().locator('details[data-requirement=' + kind + ']')).toHaveJSProperty('open', false);
    await instructionSummary().focus(); await instructionSummary().press('Enter'); await expect(instructionBody()).toBeHidden();
    for (const item of await requirements().locator('dd').all()) await expect(item).toBeVisible();
    await instructionSummary().press('Space'); await expect(instructionBody()).toBeVisible();
    assert.equal((await details()).currentStepId, before.currentStepId, 'viewing another step while switching languages cannot activate it');
    await page.screenshot({ path: resolve(artifacts, 'locale-workflow-inspected-en.png') });
    checks.push('workflow-header-and-detail-controls-follow-native-English-without-translating-saved-content-or-activating-inspected-step');

    await dialog().getByRole('button', { name: 'Close details', exact: true }).click();
    await trigger.click();
    const choices = page.getByRole('listbox', { name: 'Project workflows', exact: true });
    await expect(choices.getByRole('option').first()).toHaveText('None');
    await expect(choices.getByRole('option', { name: before.name, exact: true })).toHaveAttribute('aria-selected', 'true');
    await choices.press('Escape');
    await expect(choices).toHaveCount(0);
    checks.push('native-workflow-picker-uses-English-system-labels-and-retains-the-original-workflow-name');

    await page.locator('.wf-conversation-workflow-details-trigger').click();
    await expect(dialog().locator('[data-step-id=' + JSON.stringify(before.currentStepId) + ']')).toHaveAttribute('aria-current', 'true');
    await expect(instruction()).toHaveJSProperty('open', false); await expect(instructionBody()).toBeHidden();
    const note = '未提交的验收意见 / Unsent review note';
    await dialog().getByLabel('Review note', { exact: true }).fill(note);
    await dialog().getByRole('tab', { name: 'Project knowledge', exact: true }).click();
    await expect(dialog().getByRole('tab', { name: 'Project knowledge', exact: true })).toHaveAttribute('aria-selected', 'true');
    await dialog().getByRole('tab', { name: 'Workflow', exact: true }).click();
    await expect(dialog().locator('[data-step-id=' + JSON.stringify(before.currentStepId) + ']')).toHaveAttribute('aria-current', 'true');
    await expect(instruction()).toHaveJSProperty('open', false); await expect(instructionBody()).toBeHidden();
    await expect(dialog().getByLabel('Review note', { exact: true })).toHaveValue(note);
    await expect(dialog().getByRole('button', { name: 'Accept delivery', exact: true })).toBeEnabled();
    await expect(dialog().getByRole('button', { name: 'Return', exact: true })).toBeEnabled();
    assert.equal(await dialog().locator('.wf-conversation-delivery-response > pre').textContent(), before.selectedStep.latestDelivery.output, 'model delivery output remains verbatim in English');
    await instructionSummary().click(); await expect(instructionBody()).toBeVisible();
    await expect(instructionBody()).toHaveText(before.selectedStep.instruction);
    await switchLocale('zh');
    await expect(dialog()).toHaveAttribute('aria-label', '工作流详情');
    await expect(dialog().locator('[data-step-id=' + JSON.stringify(before.currentStepId) + ']')).toHaveAttribute('aria-current', 'true');
    await expect(dialog().getByLabel('验收说明', { exact: true })).toHaveValue(note);
    await expect(instruction()).toHaveJSProperty('open', true); await expect(instructionBody()).toBeVisible();
    await expect(dialog().getByRole('button', { name: '验收通过', exact: true })).toBeEnabled();
    await page.screenshot({ path: resolve(artifacts, 'locale-workflow-note-zh.png') });
    await switchLocale('en');
    await expect(dialog().locator('[data-step-id=' + JSON.stringify(before.currentStepId) + ']')).toHaveAttribute('aria-current', 'true');
    await expect(dialog().getByLabel('Review note', { exact: true })).toHaveValue(note);
    await expect(instruction()).toHaveJSProperty('open', true); await expect(instructionBody()).toBeVisible();
    await page.screenshot({ path: resolve(artifacts, 'locale-workflow-note-en.png') });
    await switchLocale('zh');
    await expect(dialog().getByLabel('验收说明', { exact: true })).toHaveValue(note);
    await dialog().getByRole('button', { name: '关闭详情', exact: true }).click();
    const after = await details();
    for (const key of ['instanceId', 'currentStepId', 'steps', 'selectedStep', 'tasks', 'history']) assert.deepEqual(after[key], before[key], `language switches must not change workflow business data: ${key}`);
    assert.deepEqual(businessWrites, [], 'locale-only checks may not select, activate, resume or review workflow data');
    checks.push('open-workflow-details-switch-English-and-Chinese-with-step-selection-and-unsent-review-note-retained');
    const result = { status: 'passed', checks, checkCount: checks.length, sessionId, originalWorkflowName: before.name, savedStepNames: before.steps.map(step => step.name), businessWrites };
    await writeFile(resolve(artifacts, 'locale-workflow-report.json'), JSON.stringify(result, null, 2));
    return result;
  } finally {
    page.off('request', requestListener);
  }
}
