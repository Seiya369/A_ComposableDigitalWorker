import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Run only inside the caller's isolated official profile; never saves or dispatches. */
export async function verifyLocaleLibrary({ page, artifacts, switchLocale, exploration = false }) {
  const directory = resolve(artifacts, 'locale-library');
  await mkdir(directory, { recursive: true });
  const workspace = page.getByTestId('graph-horses-workspace');
  const nav = workspace.locator('.wf-graph-sections');
  const sidebar = workspace.locator('.wf-sidebar');
  await expect(nav.getByRole('button')).toHaveCount(3);
  const originalSection = await nav.getByRole('button').evaluateAll(buttons => buttons.findIndex(button => button.getAttribute('aria-current') === 'page'));
  const selectedRows = sidebar.locator('[data-library-order-id].is-active');
  const originalRow = await selectedRows.count() ? await selectedRows.first().getAttribute('data-library-order-id') : undefined;
  const originalDialogs = page.listeners('dialog');
  const dialogs = [];
  const acceptDraftDiscard = async dialog => { dialogs.push(dialog.message()); await dialog.accept(); };
  page.removeAllListeners('dialog'); page.on('dialog', acceptDraftDiscard);
  const checks = [];
  const knowledgeGeometry = [];
  const assertEnglishNav = async () => {
    await expect(nav.getByRole('button').nth(0)).toHaveText(/^Freelancer library\s*\d+/);
    await expect(nav.getByRole('button').nth(1)).toHaveText(/^Teams?\s*\d+/);
    await expect(nav.getByRole('button').nth(2)).toHaveText(/^Workflows?\s*\d+/);
  };
  const chooseSection = async index => { await nav.getByRole('button').nth(index).click(); };
  const screenshot = name => page.screenshot({ path: resolve(directory, name), animations: 'disabled' });
  try {
    await switchLocale('zh');
    await chooseSection(0);
    const employeeRow = sidebar.locator('.wf-employee-nav-item').first();
    await expect(employeeRow).toBeVisible(); await employeeRow.click();
    const editor = workspace.locator('.wf-employee-editor');
    const name = editor.locator('.wf-employee-name');
    const employeeName = await name.inputValue();
    const namesBefore = await sidebar.locator('.wf-employee-nav-item > span').allTextContents();
    await editor.locator('[role=tab]').nth(0).click();
    await switchLocale('en');
    await assertEnglishNav();
    await expect(editor.locator('[role=tab]')).toHaveText(['Model settings', 'Role definition', 'Capabilities', 'Cognitive memory']);
    await expect(editor.getByRole('button', { name: 'Save settings', exact: true })).toBeVisible();
    await expect(editor.getByRole('button', { name: 'Remove freelancer', exact: true })).toBeVisible();
    await expect(name).toHaveValue(employeeName);
    assert.deepEqual(await sidebar.locator('.wf-employee-nav-item > span').allTextContents(), namesBefore, 'User-defined freelancer names remain unchanged');
    checks.push('Three libraries, employee tabs, actions and model UI follow English; names stay verbatim');

    await editor.locator('[role=tab]').nth(1).click();
    await expect(editor.locator('.wf-role-definition .wf-field-label')).toHaveText(['Role', 'Responsibilities', 'Guidelines and boundaries']);
    const mission = editor.locator('.wf-role-definition textarea').first();
    const originalMission = await mission.inputValue();
    const draftName = `${employeeName} · LOCALE_DRAFT`;
    const draftMission = `${originalMission}\nLOCALE_DRAFT_CONTENT_保持原文`;
    await name.fill(draftName); await mission.fill(draftMission);
    await switchLocale('zh');
    await editor.locator('[role=tab]').nth(1).click();
    await expect(editor.locator('[role=tab]').nth(1)).toHaveText('岗位定义');
    await expect(name).toHaveValue(draftName); await expect(mission).toHaveValue(draftMission);
    await expect(editor.getByRole('button', { name: '保存配置', exact: true })).toBeEnabled();
    await screenshot('employee-chinese-draft.png');
    await switchLocale('en');
    await editor.locator('[role=tab]').nth(1).click();
    await expect(editor.locator('[role=tab]').nth(1)).toHaveText('Role definition');
    await expect(name).toHaveValue(draftName); await expect(mission).toHaveValue(draftMission);
    await expect(editor.getByRole('button', { name: 'Save settings', exact: true })).toBeEnabled();
    await screenshot('employee-english-draft.png');
    checks.push('Switching DSH language preserves unsaved name and role content without saving');
    await name.fill(employeeName); await mission.fill(originalMission);

    await editor.locator('[role=tab]').nth(2).click();
    const capabilities = editor.locator('.wf-capability-selector');
    await expect(capabilities.locator('.wf-capability-group-heading h3')).toHaveText(['Required skills(Every task)', 'Preferred skills', 'Preferred plugins', 'Preferred MCP servers']);
    for (const index of [0, 2, 3]) {
      await capabilities.locator('.wf-capability-group-heading > button').nth(index).click();
      const picker = page.locator('dialog.wf-capability-picker');
      await expect(picker).toBeVisible();
      await expect(picker.locator('h3')).toContainText('Add');
      await expect(picker.locator('input[type=search]')).toHaveAttribute('placeholder', /^Search/);
      if (index === 2) await expect(picker.getByRole('button', { name: 'Add a plugin in DSH', exact: true })).toBeVisible();
      if (index === 3) {
        await picker.getByRole('button', { name: 'How to connect MCP', exact: true }).click();
        await expect(picker.getByRole('heading', { name: 'Connect MCP', exact: true })).toBeVisible();
        await expect(picker.getByRole('link', { name: 'View official DSH configuration examples', exact: true })).toBeVisible();
      }
      await page.keyboard.press('Escape'); await expect(picker).toHaveCount(0);
    }
    await screenshot('capabilities-english.png');
    checks.push('Required skills, plugin picker, MCP picker and connection guide use English');

    // The shared engine fixture belongs to the saved architect. Select it
    // explicitly: the employee order and the preceding editor draft may vary.
    const architectRow = sidebar.locator('.wf-employee-nav-item[data-library-order-id="employee-template-architect"]');
    await expect(architectRow).toBeVisible(); await architectRow.click();
    await editor.getByRole('tab', { name: 'Cognitive memory', exact: true }).click();
    const knowledge = editor.getByRole('region', { name: 'Cognitive memory', exact: true });
    await expect(knowledge.locator('.wf-knowledge-category > strong')).toHaveText(['Professional knowledge', 'Task records', 'Lessons learned', 'Working constraints']);
    await expect(knowledge.getByRole('button', { name: 'Upload materials', exact: true })).toBeVisible();
    await expect(knowledge.getByRole('switch')).toHaveText(['Auto archive', 'Auto archive', 'Auto archive']);
    await expect(knowledge.getByRole('switch').first()).toBeEnabled();
    const wikiFrame = knowledge.locator('.wf-shared-wiki iframe');
    await expect(wikiFrame).toBeVisible();
    await expect(wikiFrame).toHaveAttribute('title', 'Wiki knowledge graph');
    await expect(wikiFrame).toHaveAttribute('sandbox', 'allow-scripts');
    const wiki = page.frameLocator('.wf-shared-wiki iframe');
    const graph = wiki.getByRole('region', { name: 'Wiki knowledge graph', exact: true });
    const network = wiki.getByRole('region', { name: 'Knowledge network', exact: true });
    await expect(graph.locator('.wiki-toolbar > strong')).toHaveText('Knowledge graph');
    await expect(graph.getByRole('searchbox', { name: 'Search knowledge', exact: true })).toHaveAttribute('placeholder', 'Search knowledge');
    await expect(graph.getByRole('button', { name: 'Node types', exact: true })).toBeVisible();
    await expect(graph.getByRole('button', { name: 'Knowledge groups', exact: true })).toBeVisible();
    await expect(network).toBeVisible();
    const concept = network.getByRole('button', { name: 'Read knowledge: 模块划分', exact: true });
    await expect(concept).toHaveText('模块划分');
    await concept.focus(); await concept.press('Enter');
    const reader = wiki.getByRole('complementary', { name: 'Knowledge article reader', exact: true });
    await expect(reader).toBeVisible();
    await expect(reader.locator('header > span')).toHaveText('模块划分');
    await expect(reader.locator('.wiki-markdown')).toContainText('将系统拆分为职责明确的组成部分');
    await expect(reader.getByRole('button', { name: 'Close article', exact: true })).toBeVisible();
    await expect(graph.locator('.wiki-focus-relations')).toHaveCount(0);
    const englishRelations = reader.locator('.wiki-semantic-links');
    await expect(englishRelations).toHaveAttribute('aria-label', 'Semantic relationships');
    await expect(englishRelations).toHaveAttribute('data-relation-root', await network.getAttribute('data-selected-node'));
    const englishRelationContext = englishRelations.locator('details.wiki-relation-context');
    await expect(englishRelationContext).toHaveAttribute('open', '');
    await expect(englishRelationContext.locator(':scope > summary')).toContainText('Semantic relationships');
    const englishRelation = englishRelationContext.locator('details.wiki-relation-details');
    await expect(englishRelation).toHaveCount(1); await expect(englishRelation).not.toHaveAttribute('open', '');
    const englishTriple = englishRelation.locator(':scope > summary');
    await expect(englishTriple).toHaveText('模块划分 → 依据 → 职责边界');
    await expect(englishTriple).toHaveAttribute('aria-label', 'View relationship: 模块划分 → 依据 → 职责边界');
    await englishTriple.focus(); await englishTriple.press('Enter');
    await expect(englishRelation).toContainText('Explicit in source');
    await expect(englishRelation.getByRole('button', { name: 'View material 架构专属资料.md, lines 4–4', exact: true })).toBeVisible();
    await englishTriple.press('Space'); await expect(englishRelation).not.toHaveAttribute('open', '');
    checks.push('Relationships appear only in the right reader, with an original direction triple, English disclosure/evidence labels and keyboard-accessible folded evidence');
    const article = reader.getByRole('button', { name: 'Read knowledge: 知识主题：架构专属资料.md', exact: true });
    await expect(article).toBeVisible(); await article.click();
    await expect(reader.locator('header > span')).toHaveText('知识主题：架构专属资料.md');
    await expect(reader.locator('.wiki-markdown')).toContainText('PRIVATE_ARCHITECT_SOURCE_417');
    await expect(reader.locator('.wiki-markdown')).toContainText('适用范围：仅用于本次离线 UI 验证。');
    await expect(englishRelationContext).not.toHaveAttribute('open', '');
    await expect(englishRelations).toHaveAttribute('data-relation-root', await network.getAttribute('data-selected-node'));
    await screenshot('knowledge-reader-english.png');
    await reader.getByRole('button', { name: 'Close article', exact: true }).click();
    await expect(reader).toHaveCount(0);
    const settleKnowledgeLayout = async () => {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await network.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };
    const geometryHeight = page.viewportSize()?.height ?? 1050;
    try {
      for (const width of [1512, 860]) {
        await page.setViewportSize({ width, height: geometryHeight });
        await settleKnowledgeLayout();
        const metrics = await knowledge.locator('.wf-knowledge-categories').evaluate(row => {
          const box = element => {
            const rect = element.getBoundingClientRect();
            return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
          };
          return { viewport: { width: innerWidth, height: innerHeight }, row: box(row), scrollWidth: row.scrollWidth, clientWidth: row.clientWidth,
            cards: [...row.querySelectorAll('.wf-knowledge-category')].map(card => {
              const title = card.querySelector('strong');
              const action = card.querySelector('button');
              const titleStyle = getComputedStyle(title);
              return { card: box(card), title: box(title), action: box(action), text: title.textContent, fullTitle: title.getAttribute('title'),
                gap: Number.parseFloat(getComputedStyle(card).columnGap), minWidth: titleStyle.minWidth, overflow: titleStyle.overflow,
                textOverflow: titleStyle.textOverflow, whiteSpace: titleStyle.whiteSpace, actionFlexShrink: getComputedStyle(action).flexShrink };
            }) };
        });
        knowledgeGeometry.push(metrics);
        await writeFile(resolve(directory, 'knowledge-card-geometry.json'), JSON.stringify(knowledgeGeometry, null, 2));
        await screenshot(`knowledge-cards-english-${width}.png`);
        assert.equal(metrics.cards.length, 4, `${width}px: all four knowledge cards remain present`);
        for (const [index, item] of metrics.cards.entries()) {
          const context = `${width}px knowledge card ${index + 1} (${item.text})`;
          assert.ok(Math.abs(item.card.height - 36) <= 0.5, `${context}: compact card stays 36px high`);
          assert.ok(item.title.width > 0, `${context}: title retains visible space`);
          assert.equal(item.fullTitle, item.text, `${context}: the full title remains available on hover`);
          assert.equal(item.minWidth, '0px', `${context}: title can shrink inside its card`);
          assert.equal(item.overflow, 'hidden', `${context}: long text is clipped inside the title`);
          assert.equal(item.textOverflow, 'ellipsis', `${context}: clipped text uses an ellipsis`);
          assert.equal(item.whiteSpace, 'nowrap', `${context}: title stays on one line`);
          assert.equal(item.actionFlexShrink, '0', `${context}: action stays readable without shrinking`);
          assert.ok(item.title.right <= item.action.left - item.gap + 0.5, `${context}: title and action keep their configured gap`);
          assert.ok(item.action.left >= item.card.left && item.action.right <= item.card.right + 0.5
            && item.action.top >= item.card.top && item.action.bottom <= item.card.bottom + 0.5, `${context}: action stays entirely inside its card`);
          if (index) assert.ok(metrics.cards[index - 1].card.right <= item.card.left, `${context}: neighboring cards do not overlap`);
        }
      }
    } finally {
      await page.setViewportSize({ width: 1512, height: geometryHeight });
      await settleKnowledgeLayout();
    }
    await screenshot('knowledge-english.png');
    checks.push('Cognitive memory categories, upload, auto archive, sandboxed Wiki toolbar and reader use English; original Chinese concept, article title and body stay verbatim');
    checks.push('Knowledge cards keep 36px height, readable actions, full hover titles and nonoverlapping ellipsis labels at 1512px and 860px; horizontal overflow is allowed');

    if (exploration) {
      const stableFrame = editor.locator('.wf-knowledge-library .wf-shared-wiki iframe');
      const stableGraph = wiki.locator('.wiki-app');
      const stableNetwork = wiki.locator('.wiki-network');
      const stableReader = wiki.locator('.wiki-reader');
      const exploreState = async () => ({
        space: await stableGraph.getAttribute('data-space-id'), version: await stableGraph.getAttribute('data-version'),
        root: await stableGraph.getAttribute('data-exploration-root'), depth: await stableGraph.getAttribute('data-exploration-depth'),
        explored: JSON.parse(await stableNetwork.getAttribute('data-exploration-nodes') || '[]').sort(),
        selected: await stableNetwork.getAttribute('data-selected-node'),
        highlighted: JSON.parse(await stableNetwork.getAttribute('data-highlighted-nodes') || '[]').sort(),
      });
      await graph.getByRole('button', { name: 'Fit graph', exact: true }).click();
      const alpha = network.getByRole('button', { name: 'Read knowledge: 链路甲', exact: true });
      await expect(alpha).toHaveText('链路甲'); await alpha.focus(); await alpha.press('Enter');
      await expect(stableReader.locator('.wiki-expand')).toHaveText('Expand relationships');
      await stableReader.locator('.wiki-expand').click(); await stableReader.locator('.wiki-expand').click();
      await expect(stableGraph).toHaveAttribute('data-exploration-depth', '2');
      await expect(stableReader.getByText('Related knowledge: 2', { exact: true })).toBeVisible();
      await expect(stableReader.locator('header > span')).toHaveText('链路甲');
      const retained = await exploreState();
      assert.equal(retained.explored.length, 3); assert.equal(retained.selected, retained.root);
      const rootRelationships = stableReader.locator('.wiki-semantic-links');
      const rootRelationship = rootRelationships.locator('details.wiki-relation-details');
      const rootTriple = rootRelationship.locator(':scope > summary');
      const assertRelationLocale = async locale => {
        await expect(stableGraph.locator('.wiki-focus-relations')).toHaveCount(0);
        await expect(rootRelationships).toHaveAttribute('data-relation-root', retained.root);
        await expect(rootRelationships).toHaveAttribute('aria-label', locale === 'en' ? 'Semantic relationships' : '语义关系');
        await expect(rootRelationship).toHaveCount(1);
        await expect(rootTriple).toHaveText('链路甲 → 依据 → 链路乙');
        await expect(rootTriple).toHaveAttribute('aria-label', `${locale === 'en' ? 'View relationship:' : '查看关系'} 链路甲 → 依据 → 链路乙`);
      };
      await assertRelationLocale('en');
      await rootTriple.click(); await expect(rootRelationship).toHaveAttribute('open', '');
      await expect(rootRelationship).toContainText('Explicit in source');
      const originalBody = await stableReader.locator('.wiki-markdown').textContent();
      const originalLabels = await stableNetwork.locator('button[data-node-id]').allTextContents();
      await switchLocale('zh');
      await expect(stableFrame).toHaveAttribute('title', 'Wiki知识图谱');
      await expect(stableReader.locator('.wiki-expand')).toHaveText('展开关联');
      await expect(stableGraph.getByRole('button', { name: '适配图谱', exact: true })).toBeVisible();
      await expect(stableReader.getByText('关联知识 2', { exact: true })).toBeVisible();
      await assertRelationLocale('zh'); await expect(rootRelationship).toHaveAttribute('open', '');
      await expect(rootRelationship).toContainText('原文明确');
      assert.deepEqual(await exploreState(), retained, 'Switching to Chinese preserves root, depth, explored set and one semantic binding');
      assert.equal(await stableReader.locator('.wiki-markdown').textContent(), originalBody, 'Chinese mode keeps the original concept body');
      assert.deepEqual(await stableNetwork.locator('button[data-node-id]').allTextContents(), originalLabels);
      await screenshot('knowledge-exploration-chinese.png');
      await switchLocale('en');
      await expect(stableFrame).toHaveAttribute('title', 'Wiki knowledge graph');
      await expect(stableReader.locator('.wiki-expand')).toHaveText('Expand relationships');
      await expect(stableGraph.getByRole('button', { name: 'Fit graph', exact: true })).toBeVisible();
      await assertRelationLocale('en'); await expect(rootRelationship).toHaveAttribute('open', '');
      await expect(rootRelationship).toContainText('Explicit in source');
      assert.deepEqual(await exploreState(), retained, 'Switching back to English does not reset exploration or select a translated concept');
      assert.equal(await stableReader.locator('.wiki-markdown').textContent(), originalBody, 'English mode keeps the original concept body');
      assert.deepEqual(await stableNetwork.locator('button[data-node-id]').allTextContents(), originalLabels);
      await screenshot('knowledge-exploration-english.png');
      await stableReader.locator('.wiki-expand').click();
      await expect(stableReader.locator('.wiki-expand')).toHaveText('All relationships expanded');
      await expect(stableReader.locator('.wiki-expand')).toBeDisabled();
      await expect(stableReader.getByText('Related knowledge: 3', { exact: true })).toBeVisible();
      await stableGraph.getByRole('button', { name: 'Fit graph', exact: true }).click();
      const isolated = network.getByRole('button', { name: 'Read knowledge: 孤立戊', exact: true });
      await isolated.focus(); await isolated.press('Enter');
      await expect(stableReader.locator('.wiki-expand')).toHaveText('No relationships');
      await expect(stableReader.locator('.wiki-expand')).toBeDisabled();
      await expect(stableReader.locator('.wiki-no-relations')).toHaveText('No confirmed relationships');
      await expect(stableReader.locator('.wiki-relation-details')).toHaveCount(0);
      await stableGraph.getByRole('button', { name: 'Fit graph', exact: true }).click();
      await expect(stableReader).toHaveCount(0);
      checks.push('Live Chinese/English changes preserve exploration root, depth, real node set, original concept names, article body and expanded right-side evidence; one-hop relationship context and expanded/isolated controls follow DSH');
    }

    await chooseSection(1);
    const teamRow = sidebar.locator('.wf-team-nav-heading').first();
    await expect(teamRow).toBeVisible(); await teamRow.click();
    const team = workspace.locator('.wf-team-editor:not(.wf-workflow-template-editor)');
    await expect(team.locator('.wf-team-identity > span')).toHaveText('Organization');
    await expect(team.getByRole('switch', { name: 'Knowledge librarian', exact: true })).toBeVisible();
    await expect(team.locator('.wf-team-member-add select')).toHaveAttribute('aria-label', 'Select a freelancer to add');
    if (await team.locator('.wf-team-member-row').count()) await expect(team.locator('.wf-team-member-row').first().locator('.wf-field-label')).toHaveText(['Team role', 'Manager']);
    await expect(team.getByRole('button', { name: 'Save team', exact: true })).toBeVisible();
    await screenshot('team-english.png');
    assert.ok(dialogs.some(message => message === 'You have unsaved changes. Discard them?'), 'Leaving the restored draft uses an English discard confirmation');
    checks.push('Team organization, librarian, role controls and discard confirmation use English');

    await chooseSection(2);
    const workflow = workspace.locator('.wf-workflow-template-editor');
    if (!await workflow.count()) await sidebar.locator('.wf-sidebar-add').click();
    await expect(workflow).toBeVisible();
    await expect(workflow.locator('.wf-team-name')).toHaveAttribute('aria-label', 'Workflow name');
    await workflow.locator('.wf-workflow-team-button').click();
    const picker = page.locator('dialog.wf-workflow-binding-dialog');
    await expect(picker).toBeVisible();
    await expect(picker.locator('select').first().locator('option').first()).toHaveText('Select a team');
    await expect(picker.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(picker).toHaveCount(0);
    await screenshot('workflow-team-picker-english.png');
    checks.push('Workflow library and its team selection child dialog follow English');
  } finally {
    try {
      await switchLocale('zh');
      await chooseSection(originalSection < 0 ? 0 : originalSection);
      if (originalRow) {
        const rows = sidebar.locator('[data-library-order-id]');
        const index = await rows.evaluateAll((elements, id) => elements.findIndex(element => element.getAttribute('data-library-order-id') === id), originalRow);
        if (index >= 0) await rows.nth(index).click();
      }
      await expect(nav.getByRole('button').nth(0)).toContainText('自由职业人库');
      await screenshot('library-restored-chinese.png');
    } finally { page.off('dialog', acceptDraftDiscard); for (const listener of originalDialogs) page.on('dialog', listener); }
  }
  return { passed: true, checks, knowledgeGeometry, restoredLocale: 'zh', restoredSection: originalSection };
}
