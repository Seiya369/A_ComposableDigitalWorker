import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

const script = resolve('scripts/link-harness.mjs');
const requirements = { '@deepseek-ai/cordis': '4.0.5', '@deepseek-ai/dsh-session': '0.2.1-alpha.2' };
async function json(path: string, value: unknown) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(value)); }
async function published(root: string, name: string, version: string) {
  const dir = resolve(root, 'node_modules', name);
  await json(resolve(dir, 'package.json'), { name, version, type: 'module', types: './lib/index.d.ts', exports: { '.': { types: './lib/index.d.ts', default: './lib/index.js' }, './package.json': './package.json' } });
  await mkdir(resolve(dir, 'lib')); await writeFile(resolve(dir, 'lib/index.d.ts'), 'export {};'); await writeFile(resolve(dir, 'lib/index.js'), 'export {};');
  return dir;
}
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const base = await mkdtemp(resolve(tmpdir(), 'workforce-setup-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = resolve(base, 'project'), installation = resolve(root, '.local/official');
  await json(resolve(root, 'package.json'), { name: 'dsh-plugin-composable-workforce', peerDependencies: requirements });
  await mkdir(resolve(root, 'scripts')); await mkdir(resolve(root, 'integration'));
  await writeFile(resolve(root, 'scripts/link-harness.mjs'), await readFile(script));
  await writeFile(resolve(root, 'integration/harness-baseline.mjs'), await readFile(resolve('integration/harness-baseline.mjs')));
  const cli = resolve(installation, 'node_modules/@deepseek-ai/dsh/package.json');
  await json(cli, { name: '@deepseek-ai/dsh', version: '0.2.1-alpha.2', bin: { dsh: 'lib/bin.js' } });
  await mkdir(resolve(dirname(cli), 'lib')); await writeFile(resolve(dirname(cli), 'lib/bin.js'), '');
  for (const [name, version] of Object.entries(requirements)) await published(installation, name, version);
  const run = (manifest: string | null = cli, extra: Record<string, string> = {}, args: string[] = []) => {
    const env = { ...process.env }; delete env.DSH_SOURCE_PATH; delete env.DSH_INSTALLATION_MANIFEST; delete env.DSH_DEVELOPMENT_MANIFEST;
    if (manifest) env.DSH_INSTALLATION_MANIFEST = manifest;
    return spawnSync(process.execPath, [resolve(root, 'scripts/link-harness.mjs'), ...args], { cwd: root, env: { ...env, ...extra }, encoding: 'utf8' });
  };
  return { base, root, installation, cli, run };
}

test('setup uses exported official npm packages, is idempotent and never writes the host', async t => {
  const f = await fixture(t), before = await readFile(f.cli);
  const first = f.run(); assert.equal(first.status, 0, first.stderr);
  assert.equal(await realpath(resolve(f.root, 'node_modules/@deepseek-ai/cordis')), await realpath(resolve(f.installation, 'node_modules/@deepseek-ai/cordis')));
  const second = f.run(); assert.equal(second.status, 0, second.stderr);
  assert.equal(JSON.parse(second.stdout).changed, 0);
  assert.deepEqual(await readFile(f.cli), before);
});

test('setup verifies an ordinary local npm ci without requiring a Harness checkout', async t => {
  const f = await fixture(t);
  for (const [name, version] of Object.entries(requirements)) await published(f.root, name, version);
  const result = f.run(null); assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).changed, 0);
});

test('setup rejects ancestor fallback before creating any development links', async t => {
  const f = await fixture(t);
  await rm(resolve(f.installation, 'node_modules/@deepseek-ai/dsh-session'), { recursive: true });
  await published(f.root, '@deepseek-ai/dsh-session', requirements['@deepseek-ai/dsh-session']);
  const result = f.run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /outside|boundary|祖先|边界/i);
  await assert.rejects(readFile(resolve(f.root, 'node_modules/@deepseek-ai/cordis/package.json')), /ENOENT/);
});

test('setup rejects package and declaration symlinks outside the installation', async t => {
  const f = await fixture(t), packagePath = resolve(f.installation, 'node_modules/@deepseek-ai/dsh-session');
  const outside = await published(resolve(f.base, 'unrelated-source'), '@deepseek-ai/dsh-session', requirements['@deepseek-ai/dsh-session']);
  await rm(packagePath, { recursive: true }); await symlink(outside, packagePath, 'dir');
  const result = f.run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /outside|boundary|边界/i);
});

test('setup refuses a shared node_modules and preserves foreign concrete packages', async t => {
  const f = await fixture(t), shared = resolve(f.base, 'shared'); await mkdir(shared);
  await symlink(shared, resolve(f.root, 'node_modules'), 'dir');
  const result = f.run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /symlink|符号链接|shared/i);
  await rm(resolve(f.root, 'node_modules'));
  const foreign = await published(f.root, '@deepseek-ai/cordis', '4.0.5');
  const before = await readFile(resolve(foreign, 'package.json'));
  const next = f.run(); assert.notEqual(next.status, 0); assert.match(next.stderr, /owned|concrete|实体|管理/i);
  assert.deepEqual(await readFile(resolve(foreign, 'package.json')), before);
});

test('setup rejects wrong official release or peer version without partial mutation', async t => {
  const f = await fixture(t);
  await json(f.cli, { name: '@deepseek-ai/dsh', version: '0.2.1-alpha.1', bin: { dsh: 'lib/bin.js' } });
  assert.notEqual(f.run().status, 0);
  await json(f.cli, { name: '@deepseek-ai/dsh', version: '0.2.1-alpha.2', bin: { dsh: 'lib/bin.js' } });
  await json(resolve(f.installation, 'node_modules/@deepseek-ai/dsh-session/package.json'), { name: '@deepseek-ai/dsh-session', version: '0.2.1-alpha.1', types: './lib/index.d.ts', exports: { './package.json': './package.json' } });
  const result = f.run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /version|版本/i);
  await assert.rejects(readFile(resolve(f.root, 'node_modules/@deepseek-ai/cordis/package.json')), /ENOENT/);
});

test('development fixture is a distinct input and cannot masquerade as an official CLI', async t => {
  const f = await fixture(t), development = resolve(f.installation, 'package.json');
  await json(development, { name: 'workforce-official-development', private: true });
  const result = f.run(null, { DSH_DEVELOPMENT_MANIFEST: development }); assert.equal(result.status, 0, result.stderr);
  assert.equal(f.run(development).status, 1);
});

test('verification-only checks an independent official tree without replacing local packages', async t => {
  const f = await fixture(t), own = await published(f.root, '@deepseek-ai/cordis', '4.0.5');
  const result = f.run(f.cli, {}, ['--verify-only']); assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).changed, 0);
  assert.equal(await realpath(resolve(f.root, 'node_modules/@deepseek-ai/cordis')), await realpath(own));
  await assert.rejects(readFile(resolve(f.root, 'node_modules/.composable-workforce-links.json')), /ENOENT/);
});

test('development fixture packages cannot resolve into an in-tree source directory', async t => {
  const f = await fixture(t), development = resolve(f.installation, 'package.json');
  await json(development, { name: 'workforce-official-development', private: true });
  const target = await published(resolve(f.installation, 'source-copy'), '@deepseek-ai/dsh-session', requirements['@deepseek-ai/dsh-session']);
  const entry = resolve(f.installation, 'node_modules/@deepseek-ai/dsh-session'); await rm(entry, { recursive: true }); await symlink(target, entry, 'dir');
  const result = f.run(null, { DSH_DEVELOPMENT_MANIFEST: development }); assert.notEqual(result.status, 0); assert.match(result.stderr, /outside|boundary|边界/i);
});

test('published declaration files cannot escape a valid package through symlinks', async t => {
  const f = await fixture(t), declaration = resolve(f.installation, 'node_modules/@deepseek-ai/dsh-session/lib/index.d.ts');
  const outside = resolve(f.base, 'external.d.ts'); await writeFile(outside, 'export {};'); await rm(declaration); await symlink(outside, declaration);
  const result = f.run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /declaration.*boundary/);
});
