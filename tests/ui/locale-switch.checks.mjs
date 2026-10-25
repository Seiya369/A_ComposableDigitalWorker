import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

/** Change only the isolated host's language through its native Settings UI.
 * A temporary tab allows an already open native <dialog> in the test page to
 * retain its modal state and unsaved fields. Host settings broadcast the change.
 */
export async function switchDshLocale(page, locale) {
  assert.ok(locale === 'zh' || locale === 'en', 'The UI check supports zh and en');
  const startingUrl = page.url();
  let navigations = 0;
  const observeNavigation = frame => { if (frame === page.mainFrame()) navigations++; };
  page.on('framenavigated', observeNavigation);
  let settingsContext;
  try {
    const browser = page.context().browser();
    assert.ok(browser, 'The native locale check requires a browser-backed page');
    settingsContext = await browser.newContext({ storageState: await page.context().storageState() });
    const settingsPage = await settingsContext.newPage();
    await settingsPage.goto(startingUrl, { waitUntil: 'domcontentloaded' });
    await settingsPage.getByRole('button', { name: /^(账号菜单|Account menu)$/ }).click();
    await settingsPage.getByText(/^(设置|Settings)$/, { exact: true }).click();
    const settings = settingsPage.getByRole('dialog', { name: /^(设置|Settings)$/ });
    await expect(settings).toBeVisible();
    await settings.getByRole('button', { name: /^(通用设置|General)$/ }).click();
    const selector = settings.getByRole('button', { name: /^(中文|English)$/ });
    await expect(selector).toBeVisible();
    await selector.click();
    await settingsPage.getByRole('menuitem', { name: locale === 'en' ? 'English' : '中文', exact: true }).click();
    await expect(settings.getByText(locale === 'en' ? 'Language' : '语言', { exact: true })).toBeVisible();
    await settings.getByRole('button', { name: locale === 'en' ? 'Close' : '关闭', exact: true }).click();
    await expect(settings).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('lang', locale === 'en' ? 'en' : 'zh-CN', { timeout: 15000 });
    assert.equal(page.url(), startingUrl, 'Switching native language must retain the original page URL');
    assert.equal(navigations, 0, 'Switching native language must not navigate or reload the original page');
  } finally {
    page.off('framenavigated', observeNavigation);
    await settingsContext?.close();
  }
}
