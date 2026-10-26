/** Release numbering follows the explicitly verified Harness baseline. */
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { harnessVersion } from '../integration/harness-baseline.mjs';

/** Use the SemVer core for the plugin label, without widening host compatibility. */
export function pluginVersionForHarness(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version);
  if (!match || match[4]?.split('.').some(part => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) {
    throw new Error(`Invalid exact Harness SemVer: ${String(version)}.`);
  }
  return match.slice(1, 4).join('.');
}

/** Small root metadata snapshot; this is deliberately not a dependency lock. */
export function rootLockMetadata(lockfile) {
  const root = lockfile.packages?.[''];
  return { version: lockfile.version, packages: { '': {
    version: root?.version, engines: root?.engines, peerDependencies: root?.peerDependencies,
  } } };
}

export function validateVersionAlignment(manifest, lockfile) {
  const version = pluginVersionForHarness(harnessVersion);
  const requireVersion = (label, actual, expected = harnessVersion) => {
    if (actual !== expected) throw new Error(`${label} must equal ${expected}; received ${String(actual)}.`);
  };
  requireVersion('package.version', manifest.version, version);
  requireVersion('engines.dsh', manifest.engines?.dsh);
  const peers = Object.entries(manifest.peerDependencies ?? {}).filter(([name]) => name.startsWith('@deepseek-ai/dsh-'));
  if (!peers.length) throw new Error('The package must declare its official DSH runtime peers.');
  for (const [name, peerVersion] of peers) requireVersion(`peerDependencies.${name}`, peerVersion);
  requireVersion('package-lock.version', lockfile.version, version);
  requireVersion('package-lock.packages[root].version', lockfile.packages?.['']?.version, version);
  requireVersion('package-lock.packages[root].engines.dsh', lockfile.packages?.['']?.engines?.dsh);
  for (const [name] of peers) requireVersion(`package-lock.packages[root].peerDependencies.${name}`, lockfile.packages?.['']?.peerDependencies?.[name]);
  return { version, harnessVersion, dshRuntimePeers: peers.length };
}

const exists = path => access(path).then(() => true, error => {
  if (error.code === 'ENOENT') return false;
  throw error;
});

export async function checkVersionAlignment(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const json = async name => JSON.parse(await readFile(resolve(root, name), 'utf8'));
  const [manifest, snapshot] = await Promise.all(['package.json', 'build-support/version-lock.json'].map(json));
  let lockfile;
  let lockSource = 'root-package-lock';
  try { lockfile = await json('package-lock.json'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (await exists(resolve(root, '.git')) || await exists(resolve(root, 'tests'))) {
      throw new Error('The development checkout must retain its real package-lock.json.');
    }
    // npm excludes the root package-lock.json from tarballs. Check the explicitly
    // named root metadata snapshot, without claiming dependency-lock validation.
    lockfile = snapshot;
    lockSource = 'packaged-root-metadata';
  }
  if (lockSource === 'root-package-lock' && !isDeepStrictEqual(rootLockMetadata(lockfile), snapshot)) {
    throw new Error('build-support/version-lock.json is stale; synchronize it with the real root package-lock metadata.');
  }
  return { ...validateVersionAlignment(manifest, lockfile), lockSource };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkVersionAlignment();
  // Keep npm pack --json stdout machine-readable when this runs as prepack.
  console.error(`Plugin ${result.version} and ${result.dshRuntimePeers} official runtime peers match DSH ${result.harnessVersion}; lockSource=${result.lockSource}.`);
}
