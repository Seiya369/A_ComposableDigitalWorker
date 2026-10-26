/** Public Playwright/Node cleanup for a browser process owned by one UI fixture. */
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function closeFixtureBrowser({ page, browser, browserServer }) {
  if (page) await Promise.race([page.close({ runBeforeUnload: false }).catch(() => {}), delay(2000)]);
  if (browser) await Promise.race([browser.close().catch(() => {}), delay(2000)]);
  if (!browserServer) return;
  const owned = browserServer.process();
  const killing = browserServer.kill().catch(() => {});
  await Promise.race([killing, delay(2000)]);
  if (owned.exitCode === null && owned.signalCode === null) {
    owned.kill('SIGKILL');
    await Promise.race([new Promise(resolve => owned.once('exit', resolve)), delay(2000)]);
  }
  if (owned.exitCode === null && owned.signalCode === null) throw new Error('The isolated UI browser did not exit after termination');
  // Chrome may exit before inherited debugging pipes close. Release only this
  // launch's documented ChildProcess stdio, after its exit has been confirmed.
  for (const stream of owned.stdio) stream?.destroy?.();
  owned.unref();
  await Promise.race([killing, delay(2000)]);
}
