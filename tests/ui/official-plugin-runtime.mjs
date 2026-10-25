import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, cp, lstat, mkdir, readFile, realpath, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, relative, resolve, sep } from 'node:path';

/** Verify both launcher and SDK packages belong to the same actual npm installation. */
export async function officialSdkNamespace(installation) {
  const manifest = await realpath(installation.manifest);
  const namespace = await realpath(dirname(dirname(manifest)));
  assert.equal(basename(namespace), '@deepseek-ai', 'UI acceptance requires a real official npm installation, not a Harness source checkout');
  assert.equal(await realpath(resolve(namespace, 'dsh/package.json')), manifest);
  const packages = {};
  for (const name of ['cordis', 'dsh-agent', 'dsh-llm', 'dsh-tools', 'dsh-client-ui-conversation']) {
    const path = await realpath(resolve(namespace, name));
    const inside = relative(namespace, path);
    assert.ok(inside && inside !== '..' && !inside.startsWith(`..${sep}`), `Official SDK ${name} must not resolve to a patched checkout`);
    const metadata = JSON.parse(await readFile(resolve(path, 'package.json'), 'utf8'));
    assert.equal(metadata.name, `@deepseek-ai/${name}`);
    packages[name] = { path, version: metadata.version };
  }
  return { namespace, packages };
}

/** Link official peers alone; never attach the checkout's entire node_modules. */
export async function prepareOfficialRuntimeDependencies(packageDirectory, root, installation, { production = true } = {}) {
  const sdk = await officialSdkNamespace(installation);
  const expected = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).peerDependencies;
  for (const [name, version] of Object.entries(expected)) {
    const path = await realpath(resolve(sdk.namespace, name.slice('@deepseek-ai/'.length), 'package.json'));
    assert.ok(path.startsWith(sdk.namespace + sep), `${name} must physically exist in the isolated official installation`);
    assert.equal(JSON.parse(await readFile(path, 'utf8')).version, version, `${name} must match the verified official version`);
  }
  const modules = resolve(packageDirectory, 'node_modules');
  const current = await lstat(modules).catch(error => error.code === 'ENOENT' ? undefined : Promise.reject(error));
  assert.ok(!current?.isSymbolicLink(), 'A temporary plugin must not share the checkout node_modules symlink');
  await mkdir(modules, { recursive: true });
  await symlink(sdk.namespace, resolve(modules, '@deepseek-ai'), 'dir');
  if (production) {
    const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      assert.ok(!name.startsWith('@deepseek-ai/'), 'Harness peers must come from the official namespace');
      const target = await realpath(resolve(root, 'node_modules', name));
      await mkdir(dirname(resolve(modules, name)), { recursive: true });
      await symlink(target, resolve(modules, name), 'dir');
    }
  }
  const require = createRequire(resolve(packageDirectory, 'package.json'));
  for (const name of ['cordis', 'dsh-agent', 'dsh-llm', 'dsh-tools']) {
    const actual = await realpath(require.resolve(`@deepseek-ai/${name}`));
    const expected = await realpath(resolve(sdk.packages[name].path, 'lib/index.js'));
    assert.equal(actual, expected, `Plugin ${name} resolves to the exact official runtime`);
  }
  return sdk;
}

/** A source run copies its build into the profile; archive runs execute extracted bytes. */
export async function prepareOfficialPluginRuntime({ root, packageDirectory, installation, archive }) {
  await mkdir(packageDirectory, { recursive: true });
  if (archive) {
    await access(archive);
    await new Promise((done, reject) => execFile('tar', ['-xzf', archive, '-C', packageDirectory, '--strip-components=1'], error => error ? reject(error) : done()));
  } else {
    for (const name of ['lib', 'skills', 'package.json', 'cordis.patch.yml']) await cp(resolve(root, name), resolve(packageDirectory, name), { recursive: true });
  }
  assert.notEqual(await realpath(packageDirectory), await realpath(root), 'The temporary plugin must not execute through the source checkout');
  const sdk = await prepareOfficialRuntimeDependencies(packageDirectory, root, installation);
  return { packageDirectory, ...sdk };
}
