import { readdir, readFile, mkdir, symlink, lstat, realpath, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { harnessVersion, resolveHarness } from '../integration/harness-baseline.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const harness = resolveHarness(root);
const manifest = JSON.parse(await readFile(resolve(harness, 'package.json'), 'utf8'));
if (manifest.name !== '@deepseek-ai/dsh-root') throw new Error('DSH_SOURCE_PATH must point to a DeepSeek Harness source checkout.');
if (manifest.version !== harnessVersion) throw new Error(`Expected Harness ${harnessVersion}; received ${manifest.version}.`);
const packages = [];
for (const group of await readdir(resolve(harness, 'packages'), { withFileTypes: true })) {
  if (!group.isDirectory()) continue;
  for (const pkg of await readdir(resolve(harness, 'packages', group.name), { withFileTypes: true })) {
    if (pkg.isDirectory()) packages.push(resolve(harness, 'packages', group.name, pkg.name));
  }
}
for (const pkg of await readdir(resolve(harness, 'vendor'), { withFileTypes: true })) {
  if (pkg.isDirectory()) packages.push(resolve(harness, 'vendor', pkg.name));
}
await mkdir(resolve(root, 'node_modules/@deepseek-ai'), { recursive: true });
let count = 0;
for (const path of packages) {
  let pkg;
  try { pkg = JSON.parse(await readFile(resolve(path, 'package.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  if (!pkg.name.startsWith('@deepseek-ai/')) continue;
  const destination = resolve(root, 'node_modules', pkg.name);
  try {
    const entry = await lstat(destination);
    if (await realpath(destination) !== await realpath(path)) {
      if (!entry.isSymbolicLink()) throw new Error(`Existing dependency ${pkg.name} is not a development link; use a clean node_modules before linking.`);
      const previous = JSON.parse(await readFile(resolve(destination, 'package.json'), 'utf8'));
      if (previous.name !== pkg.name) throw new Error(`Existing link ${pkg.name} points to another package.`);
      const pending = `${destination}.upgrade-${process.pid}`;
      await symlink(path, pending, 'dir');
      await rename(pending, destination);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await symlink(path, destination, 'dir');
  }
  count++;
}
console.log(`Linked ${count} Harness development packages (${manifest.version}) from ${harness}`);
