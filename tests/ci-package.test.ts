import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

async function fixture(t: { after(fn: () => Promise<void>): void }, files = ['lib/index.js', 'lib/client.js']) {
  const root = await mkdtemp(resolve(tmpdir(), 'workforce-pack-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(resolve(root, 'lib'));
  await writeFile(resolve(root, 'package.json'), JSON.stringify({ name: 'dsh-plugin-composable-workforce', version: '0.0.0', files }));
  await writeFile(resolve(root, 'lib/index.js'), 'export default {};'); await writeFile(resolve(root, 'lib/client.js'), 'window.plugin = {};');
  const run = () => spawnSync(process.execPath, [resolve('scripts/ci-package.mjs'), '--root', root, '--output', resolve(root, 'artifacts/package')], { cwd: root, encoding: 'utf8' });
  return { root, run };
}
test('CI package verifies deterministic tarballs, every source byte and SHA-256', async t => {
  const f = await fixture(t), result = f.run(); assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(await readFile(resolve(f.root, 'artifacts/package/report.json'), 'utf8'));
  assert.equal(report.reproducible, true); assert.equal(report.files, 3); assert.match(report.sha256, /^[a-f0-9]{64}$/);
  assert.match(await readFile(resolve(f.root, 'artifacts/package/SHA256SUMS'), 'utf8'), new RegExp(report.sha256));
});
test('CI package rejects a manifest that accidentally ships test fixtures', async t => {
  const f = await fixture(t, ['lib/index.js', 'lib/client.js', 'tests']);
  await mkdir(resolve(f.root, 'tests')); await writeFile(resolve(f.root, 'tests/private.txt'), 'PRIVATE_FIXTURE');
  const result = f.run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /forbidden|禁止|tests/);
});
test('CI package rejects machine paths embedded in runtime JavaScript', async t => {
  const f = await fixture(t); await writeFile(resolve(f.root, 'lib/index.js'), `export const root=${JSON.stringify(f.root)};`);
  const result = f.run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /machine|local|本机/i);
});
