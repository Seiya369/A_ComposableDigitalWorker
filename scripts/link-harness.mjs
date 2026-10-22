/** Verify published dependencies or link an explicit independent npm installation.
 * Writes only this plugin checkout's node_modules; never changes an official host.
 */
import { access, lstat, mkdir, readFile, realpath, rename, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { harnessVersion } from '../integration/harness-baseline.mjs';

const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const verifyOnly = process.argv.slice(2).includes('--verify-only');
if (process.argv.slice(2).some(arg => arg !== '--verify-only')) throw new Error('Usage: node scripts/link-harness.mjs [--verify-only]');
const modules = resolve(root, 'node_modules');
const ownerFile = resolve(modules, '.composable-workforce-links.json');
const inside = (base, target) => { const part = relative(base, target); return part === '' || !isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`); };
const stat = path => lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));

for (const path of [modules, resolve(modules, '@deepseek-ai')]) {
  const entry = await stat(path);
  if (entry && (entry.isSymbolicLink() || !entry.isDirectory())) throw new Error(`Refusing shared/symlink node_modules boundary: ${path}`);
}
const pkg = await readJson(resolve(root, 'package.json'));
const expected = Object.fromEntries(Object.entries({ ...pkg.peerDependencies, ...pkg.devDependencies }).filter(([name]) => name.startsWith('@deepseek-ai/')));
for (const [name, version] of Object.entries(expected)) {
  if (!/^@deepseek-ai\/[a-z0-9-]+$/.test(name) || !/^\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$/.test(version)) throw new Error(`Development official dependencies need exact versions: ${name}`);
}
const installation = process.env.DSH_INSTALLATION_MANIFEST;
const development = process.env.DSH_DEVELOPMENT_MANIFEST;
if (installation && development) throw new Error('Choose one installation or development manifest, not both.');
let anchor = resolve(root, 'package.json'), boundary = modules;
if (installation || development) {
  anchor = await realpath(resolve(installation || development));
  const declared = await readJson(anchor);
  if (installation) {
    if (declared.name !== '@deepseek-ai/dsh' || declared.version !== harnessVersion) throw new Error(`Official CLI version must be @deepseek-ai/dsh@${harnessVersion}.`);
    boundary = resolve(dirname(anchor), '../..');
    if (boundary.split(sep).at(-1) !== 'node_modules') throw new Error('Official installation must be an npm node_modules installation.');
    await access(resolve(dirname(anchor), typeof declared.bin === 'string' ? declared.bin : declared.bin?.dsh || 'lib/bin.js'));
  } else boundary = resolve(dirname(anchor), 'node_modules');
  boundary = await realpath(boundary);
}
const external = !!(installation || development);
const require = createRequire(anchor);
let owner = { schemaVersion: 1, plugin: pkg.name, root, links: {} };
const ownerStat = await stat(ownerFile);
if (ownerStat) {
  if (ownerStat.isSymbolicLink() || !ownerStat.isFile() || ownerStat.nlink !== 1) throw new Error('Unsafe development link ownership file.');
  owner = await readJson(ownerFile);
  if (owner.schemaVersion !== 1 || owner.plugin !== pkg.name || owner.root !== root || !owner.links || typeof owner.links !== 'object') throw new Error('Invalid development link ownership.');
}
const plan = [];
// Resolve and validate the entire set before making any filesystem change.
for (const [name, version] of Object.entries(expected)) {
  const manifest = await realpath(require.resolve(`${name}/package.json`));
  if (!inside(boundary, manifest)) throw new Error(`${name} resolved outside installation boundary (ancestor fallback).`);
  const target = dirname(manifest), actual = await readJson(manifest);
  if (actual.name !== name || actual.version !== version) throw new Error(`${name} version mismatch: expected ${version}, received ${actual.version}.`);
  if (actual.exports?.['./package.json'] !== './package.json') throw new Error(`${name} does not export its public package manifest.`);
  const types = actual.types || actual.exports?.['.']?.types;
  if (typeof types !== 'string' || !types.endsWith('.d.ts')) throw new Error(`${name} has no published declaration entry.`);
  if (!inside(target, await realpath(resolve(target, types)))) throw new Error(`${name} declaration escaped its package boundary.`);
  const destination = resolve(modules, name), existing = await stat(destination);
  if (verifyOnly) { plan.push({ name, version, target, destination, changed: false }); continue; }
  if (existing?.isSymbolicLink()) {
    const current = await realpath(destination);
    if (owner.links[name] !== current) throw new Error(`Refusing a development link not owned by this checkout: ${name}`);
    if (!external && !inside(modules, current)) throw new Error(`Use the explicit installation manifest for external managed links: ${name}`);
    plan.push({ name, version, target, destination, changed: external && current !== target });
  } else if (existing) {
    if (external) throw new Error(`Refusing to overwrite a non-owned concrete dependency: ${name}`);
    plan.push({ name, version, target, destination, changed: false });
  } else {
    if (!external) throw new Error(`Missing declared official dependency: ${name}; run npm ci.`);
    plan.push({ name, version, target, destination, changed: true });
  }
}
if (external && !verifyOnly) {
  await mkdir(resolve(modules, '@deepseek-ai'), { recursive: true });
  for (const entry of plan) {
    if (entry.changed) {
      const pending = `${entry.destination}.workforce-${process.pid}`;
      await symlink(entry.target, pending, 'dir'); await rename(pending, entry.destination);
    }
    owner.links[entry.name] = entry.target;
  }
  const pending = `${ownerFile}.${process.pid}`;
  await writeFile(pending, `${JSON.stringify(owner, null, 2)}\n`, { flag: 'wx' }); await rename(pending, ownerFile);
}
console.log(JSON.stringify({ mode: external ? 'published-links' : 'installed-verification', changed: plan.filter(entry => entry.changed).length, dependencies: plan.map(({ name, version, target }) => ({ name, version, target })) }));
