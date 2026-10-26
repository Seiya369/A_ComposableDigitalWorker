/** Release numbering follows the explicitly verified Harness baseline. */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { harnessVersion } from '../integration/harness-baseline.mjs';

export function validateVersionAlignment(manifest, lockfile) {
  const expected = harnessVersion;
  const requireVersion = (label, actual) => {
    if (actual !== expected) throw new Error(`${label} must equal the verified DSH version ${expected}; received ${String(actual)}.`);
  };
  requireVersion('package.version', manifest.version);
  requireVersion('engines.dsh', manifest.engines?.dsh);
  const peers = Object.entries(manifest.peerDependencies ?? {}).filter(([name]) => name.startsWith('@deepseek-ai/dsh-'));
  if (!peers.length) throw new Error('The package must declare its official DSH runtime peers.');
  for (const [name, version] of peers) requireVersion(`peerDependencies.${name}`, version);
  requireVersion('package-lock.version', lockfile.version);
  requireVersion('package-lock.packages[root].version', lockfile.packages?.['']?.version);
  requireVersion('package-lock.packages[root].engines.dsh', lockfile.packages?.['']?.engines?.dsh);
  for (const [name] of peers) requireVersion(`package-lock.packages[root].peerDependencies.${name}`, lockfile.packages?.['']?.peerDependencies?.[name]);
  return { version: expected, dshRuntimePeers: peers.length };
}

export async function checkVersionAlignment(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const [manifest, lockfile] = await Promise.all(['package.json', 'package-lock.json'].map(async name => JSON.parse(await readFile(resolve(root, name), 'utf8'))));
  return validateVersionAlignment(manifest, lockfile);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkVersionAlignment();
  // Keep npm pack --json stdout machine-readable when this runs as prepack.
  console.error(`Plugin and ${result.dshRuntimePeers} official runtime peers match DSH ${result.version}.`);
}
