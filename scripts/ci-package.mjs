/** Package twice, inspect the real archives and retain one SHA-bound candidate. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  assert.ok(['--root', '--output'].includes(args[i]) && args[i + 1], 'Usage: ci-package.mjs [--root path] [--output path]');
  options[args[i]] = args[i + 1];
}
const root = await realpath(resolve(options['--root'] || resolve(dirname(fileURLToPath(import.meta.url)), '..')));
const localPaths = [root, resolve(options['--root'] || root)];
const output = resolve(options['--output'] || resolve(root, 'artifacts/ci/package'));
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const run = (command, argv, maxBuffer = 32 * 1024 * 1024) => {
  const child = spawnSync(command, argv, { cwd: root, encoding: null, maxBuffer });
  if (child.error) throw child.error;
  assert.equal(child.status, 0, `${command}: ${child.stderr?.toString()}`);
  return child.stdout;
};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const allowed = name => name === 'package.json' || (pkg.files || []).some(pattern =>
  pattern === name || !pattern.includes('*') && name.startsWith(`${pattern}/`)
  || pattern.endsWith('/**/*.d.ts') && name.startsWith(pattern.slice(0, -'**/*.d.ts'.length)) && name.endsWith('.d.ts'));
const forbidden = /^(?:src|tests|node_modules|artifacts|ci|\.github|\.local|\.runtime)\/|(?:^|\/)(?:\.env(?:\..*)?|[^/]+\.(?:pem|key|p12|pfx))$|\.map$|harness-workspace-slots\.patch$/;
const temp = await mkdtemp(resolve(tmpdir(), 'workforce-pack-check-'));
try {
  const archives = [];
  for (const name of ['first', 'second']) {
    const destination = resolve(temp, name); await mkdir(destination);
    const metadata = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', destination]).toString());
    archives.push(resolve(destination, metadata[0].filename));
  }
  const bytes = await readFile(archives[0]);
  assert.equal(digest(bytes), digest(await readFile(archives[1])), 'Package tarballs are not reproducible');
  assert.ok(bytes.length <= 1024 * 1024, 'Package exceeds the reviewed 1 MiB compressed budget');
  const names = run('tar', ['-tzf', archives[0]]).toString().trim().split('\n');
  for (const name of names) {
    assert.ok(name.startsWith('package/'), `Invalid package prefix ${name}`);
    const file = name.slice('package/'.length);
    assert.ok(file && !isAbsolute(file) && !file.split('/').includes('..'), `Invalid archive path ${name}`);
    assert.ok(!forbidden.test(file), `Forbidden packaged file: ${file}`);
    assert.ok(allowed(file), `File is outside explicit package whitelist: ${file}`);
    const source = await realpath(resolve(root, file));
    assert.ok(!relative(root, source).startsWith('..'), `Source escaped plugin root: ${file}`);
    const content = run('tar', ['-xOf', archives[0], name]);
    assert.equal(digest(content), digest(await readFile(source)), `Archive differs from source: ${file}`);
    if (['lib/index.js', 'lib/client.js'].includes(file)) assert.ok(localPaths.every(path => !content.includes(Buffer.from(path))), `Runtime contains a local machine path: ${file}`);
  }
  for (const required of ['package/package.json', 'package/lib/index.js', 'package/lib/client.js']) assert.ok(names.includes(required), `Missing ${required}`);
  await mkdir(output, { recursive: true });
  const archive = resolve(output, basename(archives[0])); await copyFile(archives[0], archive);
  const report = { package: pkg.name, version: pkg.version, archive: basename(archive), sha256: digest(bytes), bytes: bytes.length, files: names.length, reproducible: true, countScope: 'all packaged files compared byte-for-byte' };
  await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(resolve(output, 'SHA256SUMS'), `${report.sha256}  ${report.archive}\n`);
  console.log(JSON.stringify(report));
} finally { await rm(temp, { recursive: true, force: true }); }
