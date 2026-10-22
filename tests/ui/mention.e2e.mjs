/** Real native @ integration. Set WORKFORCE_LIVE_MODEL=1 to make one model request. */
import { chromium, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { authenticateWeb } from '../../integration/web-auth.mjs';

const base = process.env.WORKFORCE_URL || 'http://127.0.0.1:3080';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1024 }, colorScheme: 'dark', locale: 'zh-CN' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await mkdir('artifacts/ui', { recursive: true });

try {
  const auth = await authenticateWeb(await readFile(resolve(process.env.WORKFORCE_SERVICE_LOG || '.local/service/stdout.log'), 'utf8'), base);
  const split = auth.cookie.indexOf('=');
  await page.context().addCookies([{ name: auth.cookie.slice(0, split), value: auth.cookie.slice(split+1), url: base, httpOnly: true, sameSite: 'Strict' }]);
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '数字员工模板', exact: true }).waitFor();
  const input = page.locator('[data-composer-input]');
  await input.click();
  await input.pressSequentially('@');
  await page.getByText('技术负责人（架构师）', { exact: true }).first().click();
  await expect(page.locator('[data-composer-card]')).toContainText('技术负责人（架构师）');
  await page.screenshot({ path: 'artifacts/ui/native-mention.png' });
  if (process.env.WORKFORCE_LIVE_MODEL === '1') {
    await input.press('End');
    await input.pressSequentially('请用一句话说明你的岗位，以及默认允许写入的目录。不要使用工具，不要读取项目文件。');
    const submitted = page.waitForResponse(response => response.url().endsWith('/digital-workers/api/run') && response.request().method() === 'POST');
    await input.press('Enter');
    const response = await submitted;
    expect(response.status()).toBe(202);
    const { run } = await response.json();
    await expect(page.locator('.wf-native-dock')).toContainText('技术负责人（架构师）', { timeout: 15000 });
    let finished;
    for (let i = 0; i < 60; i++) {
      const state = await (await page.request.get(`${base}/digital-workers/api/state`)).json();
      const current = state.runs.find(item => item.id === run.id);
      if (!['queued', 'running'].includes(current.status)) { finished = current; break; }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    expect(finished?.status, finished?.error || 'Model did not finish within 60 seconds').toBe('awaiting-review');
    expect(finished.output).toContain('docs/architecture');
    await expect(page.locator('.wf-native-dock')).toContainText('待验收', { timeout: 10000 });
    // Regression: disposing the AgentHandle used to remove the selected native session.
    await expect(page.getByText('选择一个工作区开始', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/我是本项目|技术负责人/).first()).toBeVisible();
    await page.screenshot({ path: 'artifacts/ui/native-live-architect.png' });
    console.log(JSON.stringify({ runId: finished.id, sessionId: finished.sessionId, status: finished.status, output: finished.output, usage: finished.usage }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.wf-native-dock')).toContainText('待验收', { timeout: 15000 });
    console.log('PASS: actual @ dispatch, native navigation, real model identity/permission reply, retained completed session, refresh.');
  } else console.log('PASS: native @ selection. Live model request skipped (set WORKFORCE_LIVE_MODEL=1 to enable).');
  expect(errors).toEqual([]);
} catch (error) {
  await page.screenshot({ path: 'artifacts/ui/native-mention-failure.png' });
  throw error;
} finally { await browser.close(); }
