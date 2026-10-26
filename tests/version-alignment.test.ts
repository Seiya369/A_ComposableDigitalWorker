import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { checkVersionAlignment, pluginVersionForHarness, rootLockMetadata, validateVersionAlignment } from '../scripts/check-version-alignment.mjs';
import { harnessVersion } from '../integration/harness-baseline.mjs';

const pluginVersion = pluginVersionForHarness(harnessVersion);
function fixture() {
  const manifest = { version: pluginVersion, engines: { dsh: harnessVersion }, peerDependencies: {
    '@deepseek-ai/dsh-agent': harnessVersion, '@deepseek-ai/cordis': '4.0.5',
  } };
  return { manifest, lockfile: { version: pluginVersion, packages: { '': structuredClone(manifest) } } };
}

test('current plugin core version matches the verified Harness while compatibility keeps its full suffix', async () => {
  const result = await checkVersionAlignment();
  assert.equal(result.version, pluginVersion);
  assert.equal(result.harnessVersion, harnessVersion);
  assert.equal(result.lockSource, 'root-package-lock');
});

test('official SemVer prerelease and build suffixes do not enter the plugin version', () => {
  for (const input of ['0.2.1', '0.2.1-rc.3', '0.2.1-alpha.2', '0.2.1-rc.3+build.001', '0.2.1+vendor.4']) {
    assert.equal(pluginVersionForHarness(input), '0.2.1');
  }
  for (const input of ['^0.2.1', 'v0.2.1', '0.02.1', '0.2.1-rc.03', '0.2.1-', '0.2.1+']) {
    assert.throws(() => pluginVersionForHarness(input), /Invalid exact Harness SemVer/);
  }
});

test('the prepack guard keeps machine-readable npm pack stdout clean', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/check-version-alignment.mjs', import.meta.url))], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.includes(`match DSH ${harnessVersion}; lockSource=root-package-lock`));
});

test('alignment permits independently versioned Cordis but rejects a plugin suffix or a widened host range', () => {
  const { manifest, lockfile } = fixture();
  assert.deepEqual(validateVersionAlignment(manifest, lockfile), { version: pluginVersion, harnessVersion, dshRuntimePeers: 1 });
  manifest.version = pluginVersion + '-unverified';
  assert.throws(() => validateVersionAlignment(manifest, lockfile), /package.version must equal/);
  manifest.version = pluginVersion;
  manifest.engines.dsh = '^' + harnessVersion;
  assert.throws(() => validateVersionAlignment(manifest, lockfile), /engines.dsh must equal/);
});

test('DSH runtime peers still require the exact full host release rather than its plugin core number', () => {
  const { manifest, lockfile } = fixture();
  manifest.peerDependencies['@deepseek-ai/dsh-agent'] = harnessVersion === pluginVersion ? harnessVersion + '-unverified' : pluginVersion;
  assert.throws(() => validateVersionAlignment(manifest, lockfile), /peerDependencies.@deepseek-ai\/dsh-agent must equal/);
});

test('stale lockfile versions or root peer metadata block release', () => {
  const { manifest, lockfile } = fixture();
  lockfile.version = '0.30.0';
  assert.throws(() => validateVersionAlignment(manifest, lockfile), /package-lock.version must equal/);
  lockfile.version = pluginVersion;
  lockfile.packages[''].version = pluginVersion + '-unverified';
  assert.throws(() => validateVersionAlignment(manifest, lockfile), /package-lock.packages\[root\].version must equal/);
  lockfile.packages[''].version = pluginVersion;
  lockfile.packages[''].peerDependencies['@deepseek-ai/dsh-agent'] = harnessVersion === pluginVersion ? harnessVersion + '-unverified' : pluginVersion;
  assert.throws(() => validateVersionAlignment(manifest, lockfile), /package-lock.packages\[root\].peerDependencies/);
});

test('an extracted package explicitly checks root metadata while development rejects a missing or stale real lock', async t => {
  const root = await mkdtemp(resolve(tmpdir(), 'workforce-version-metadata-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { manifest, lockfile } = fixture();
  await mkdir(resolve(root, 'build-support'));
  await writeFile(resolve(root, 'package.json'), JSON.stringify(manifest));
  await writeFile(resolve(root, 'build-support/version-lock.json'), JSON.stringify(rootLockMetadata(lockfile)));
  assert.equal((await checkVersionAlignment(root)).lockSource, 'packaged-root-metadata');
  await mkdir(resolve(root, 'tests'));
  await assert.rejects(checkVersionAlignment(root), /development checkout must retain its real package-lock/);
  await writeFile(resolve(root, 'package-lock.json'), JSON.stringify(lockfile));
  assert.equal((await checkVersionAlignment(root)).lockSource, 'root-package-lock');
  lockfile.packages[''].peerDependencies['@deepseek-ai/cordis'] = '4.0.6';
  await writeFile(resolve(root, 'package-lock.json'), JSON.stringify(lockfile));
  await assert.rejects(checkVersionAlignment(root), /version-lock.json is stale/);
});
