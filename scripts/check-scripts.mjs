/** Syntax gate for executable JavaScript; TypeScript has a separate strict gate. */
import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
async function visit(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const file = resolve(path, entry.name);
    if (entry.isDirectory()) await visit(file);
    else if (entry.isFile() && entry.name.endsWith('.mjs')) files.push(file);
  }
}
for (const directory of ['scripts', 'integration', 'tests/ui']) await visit(resolve(root, directory));
for (const file of files.sort()) {
  const checked = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (checked.error) throw checked.error;
  if (checked.status) process.exit(checked.status);
}
console.log(`Checked ${files.length} executable JavaScript files.`);
