import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkVersionAlignment, validateVersionAlignment } from '../scripts/check-version-alignment.mjs';
import { harnessVersion } from '../integration/harness-baseline.mjs';

function fixture() {
  const manifest = { version: harnessVersion, engines: { dsh: harnessVersion }, peerDependencies: {
    '@deepseek-ai/dsh-agent': harnessVersion, '@deepseek-ai/cordis': '4.0.5',
  } };
  return { manifest, lockfile: { version: harnessVersion, packages: { '': structuredClone(manifest) } } };
}

test('current release metadata matches the verified official Harness baseline', async () => {
  assert.equal((await checkVersionAlignment()).version, harnessVersion);
});

test('the prepack guard keeps machine-readable npm pack stdout clean', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/check-version-alignment.mjs', import.meta.url))], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.includes(`match DSH ${harnessVersion}.`));
});

test('alignment permits independently versioned Cordis but rejects an independent plugin version or host range', () => {
  const { manifest, lockfile } = fixture();
  assert.deepEqual(validateVersionAlignment(manifest, lockfile), { version: harnessVersion, dshRuntimePeers: 1 });
  manifest.version = '0.30.0';
  assert.throws(() => validateVersionAlignment(manifest, lockfile), /package.version must equal/);
  manifest.version = harnessVersion;
  manifest.engines.dsh = '^' + harnessVersion;
  assert.throws(() => validateVersionAlignment(manifest, lockfile), /engines.dsh must equal/);
});

test('every DSH runtime peer must match the baseline exactly', () => {
  const { manifest, lockfile } = fixture();
  manifest.peerDependencies['@deepseek-ai/dsh-agent'] = '0.2.1-rc.2';
  assert.throws(() => validateVersionAlignment(manifest, lockfile), /peerDependencies.@deepseek-ai\/dsh-agent must equal/);
});

test('stale lockfile versions or root peer metadata block release', () => {
  const { manifest, lockfile } = fixture();
  lockfile.version = '0.30.0';
  assert.throws(() => validateVersionAlignment(manifest, lockfile), /package-lock.version must equal/);
  lockfile.version = harnessVersion;
  lockfile.packages[''].version = '0.30.0';
  assert.throws(() => validateVersionAlignment(manifest, lockfile), /package-lock.packages\[root\].version must equal/);
  lockfile.packages[''].version = harnessVersion;
  lockfile.packages[''].peerDependencies['@deepseek-ai/dsh-agent'] = '0.2.1-rc.2';
  assert.throws(() => validateVersionAlignment(manifest, lockfile), /package-lock.packages\[root\].peerDependencies/);
});
