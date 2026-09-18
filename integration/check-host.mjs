import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const requiredWorkspaceSlots = ['sidebar.workspaces.header.action', 'sidebar.workspaces.menu.action'];

/** Check the installed public client artifact, never a copied/private source tree. */
export async function checkHost(installationManifest) {
  const installation = createRequire(resolve(installationManifest));
  const web = createRequire(installation.resolve('@deepseek-ai/dsh-web-app/package.json'));
  const manifest = JSON.parse(await readFile(web.resolve('@deepseek-ai/dsh-client-ui-workspace/package.json'), 'utf8'));
  if (manifest.version !== '0.1.1-rc.2') throw new Error(`尚未验证此 Harness 版本（${manifest.version}）。请按 integration/README.md 重新验证接口兼容性。`);
  const client = await readFile(web.resolve('@deepseek-ai/dsh-client-ui-workspace/client'), 'utf8');
  const missing = requiredWorkspaceSlots.filter(slot => !client.includes(slot));
  if (missing.length) throw new Error(`Harness 缺少工作区扩展接口：${missing.join(', ')}。请应用 integration/harness-workspace-slots.patch 并重新构建宿主。`);
  return { version: manifest.version, slots: requiredWorkspaceSlots };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('用法：node integration/check-host.mjs /path/to/dsh/package.json');
  console.log(JSON.stringify(await checkHost(process.argv[2]), null, 2));
}
