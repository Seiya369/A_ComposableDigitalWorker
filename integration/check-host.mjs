import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { harnessVersion } from './harness-baseline.mjs';

export const requiredPublicInterfaces = {
  '@deepseek-ai/dsh-client-ui-sidebar': ['sidebar.panellist'],
  '@deepseek-ai/dsh-client-ui-layout': ['main', 'selectPanel'],
  '@deepseek-ai/dsh-client-ui-plugin-manager': ['pluginNavigation', 'openBundle'],
  '@deepseek-ai/dsh-client-ui-conversation': ['conversation.input.left', 'conversation.session.header.utilities', 'conversation.input.dock'],
};

/** Check the installed public client artifact, never a copied/private source tree. */
export async function checkHost(installationManifest) {
  const installation = createRequire(resolve(installationManifest));
  const web = createRequire(installation.resolve('@deepseek-ai/dsh-web-app/package.json'));
  for (const [name, interfaces] of Object.entries(requiredPublicInterfaces)) {
    const manifest = JSON.parse(await readFile(web.resolve(`${name}/package.json`), 'utf8'));
    if (manifest.version !== harnessVersion) throw new Error(`尚未验证此 Harness 版本（${manifest.version}）。请按 integration/README.md 验证官方接口兼容性；不得修改宿主以绕过检查。`);
    const client = await readFile(web.resolve(`${name}/client`), 'utf8');
    const missing = interfaces.filter(value => !client.includes(value));
    if (missing.length) throw new Error(`Harness 缺少已声明的官方公开接口：${name}: ${missing.join(', ')}。请使用受支持的官方发行版；不支持修改宿主补接口。`);
  }
  return { version: harnessVersion, interfaces: requiredPublicInterfaces };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('用法：node integration/check-host.mjs /path/to/dsh/package.json');
  console.log(JSON.stringify(await checkHost(process.argv[2]), null, 2));
}
