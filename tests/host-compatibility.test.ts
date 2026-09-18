import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { checkHost, requiredWorkspaceSlots } from '../integration/check-host.mjs';

test('host preflight checks the installed public client face and rejects old or unverified hosts', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'workforce-host-contract-'));
  const workspace = resolve(root, 'node_modules/@deepseek-ai/dsh-client-ui-workspace');
  const web = resolve(root, 'node_modules/@deepseek-ai/dsh-web-app');
  try {
    await mkdir(workspace, { recursive: true });
    await mkdir(web, { recursive: true });
    await writeFile(resolve(web, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-web-app', exports: { './package.json': './package.json' } }));
    const manifest = { name: '@deepseek-ai/dsh-client-ui-workspace', version: '0.1.1-rc.2', exports: { './package.json': './package.json', './client': './client.js' } };
    await writeFile(resolve(workspace, 'package.json'), JSON.stringify(manifest));
    await writeFile(resolve(workspace, 'client.js'), '/* original host without extension declarations */');
    await assert.rejects(checkHost(resolve(root, 'package.json')), /缺少工作区扩展接口/);
    await writeFile(resolve(workspace, 'client.js'), requiredWorkspaceSlots.join('\n'));
    assert.deepEqual((await checkHost(resolve(root, 'package.json'))).slots, requiredWorkspaceSlots);
    await writeFile(resolve(workspace, 'package.json'), JSON.stringify({ ...manifest, version: '0.2.0' }));
    await assert.rejects(checkHost(resolve(root, 'package.json')), /尚未验证此 Harness 版本/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
