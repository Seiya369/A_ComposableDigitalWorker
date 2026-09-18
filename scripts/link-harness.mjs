import { readdir, readFile, mkdir, symlink, lstat, realpath } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const harness = resolve(process.env.DSH_SOURCE_PATH || resolve(root, '../deepseek-harness'));
const manifest = JSON.parse(await readFile(resolve(harness, 'package.json'), 'utf8'));
if (manifest.name !== '@deepseek-ai/dsh-root') throw new Error('DSH_SOURCE_PATH must point to a DeepSeek Harness source checkout.');
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
    await lstat(destination);
    if (await realpath(destination) !== await realpath(path)) throw new Error(`Existing dependency ${pkg.name} differs; use a clean node_modules before linking.`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await symlink(path, destination, 'dir');
  }
  count++;
}
console.log(`Linked ${count} Harness development packages (${manifest.version}) from ${harness}`);
