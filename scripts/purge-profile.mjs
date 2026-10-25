/** Explicit, narrow cleanup of this plugin's profile configuration and state. */
import { createHash } from 'node:crypto';
import { access, lstat, readFile, readdir, realpath, rmdir, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { isMap, isSeq, parseDocument } from 'yaml';

export const pluginName = 'dsh-plugin-composable-workforce';
const pluginId = 'composable-workforce';
const absent = error => error?.code === 'ENOENT';
async function optionalRead(path) { try { return await readFile(path, 'utf8'); } catch (error) { if (absent(error)) return undefined; throw error; } }
async function canonical(path) { try { return await realpath(path); } catch (error) { if (!absent(error)) throw error; return resolve(await canonical(dirname(path)), basename(path)); } }

function ownRow(node) {
  if (!isMap(node)) return false;
  const id = node.get('id'); const name = node.get('name');
  if (id === pluginId && name && name !== pluginName) throw new Error(`配置 id ${pluginId} 已被其他包占用；拒绝清理。`);
  return id === pluginId || name === pluginName;
}
function inspectPatch(text, path) {
  if (text === undefined) return { path, text, next: text, statePaths: [], count: 0 };
  const doc = parseDocument(text, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }] });
  if (doc.errors.length) throw new Error(`无法安全解析 ${path}: ${doc.errors[0].message}`);
  if (doc.contents && !isSeq(doc.contents)) throw new Error(`配置不是官方 patch 数组，拒绝清理：${path}`);
  const statePaths = []; let count = 0;
  function visit(node) {
    if (isSeq(node)) {
      node.items = node.items.filter(item => {
        if (!ownRow(item)) { visit(item); return true; }
        if (item.has('insert')) throw new Error(`${path} 在本插件 id 上锚定了其他插入配置，无法只移除本插件，拒绝修改。`);
        count++;
        const config = item.get('config');
        const statePath = isMap(config) ? config.get('statePath') : undefined;
        if (isMap(config) && config.get('statePath', true)?.tag) throw new Error(`${path} 的动态 statePath 无法证明归属，拒绝清理。`);
        if (statePath !== undefined && (typeof statePath !== 'string' || !isAbsolute(statePath))) throw new Error(`${path} 的 statePath 必须为绝对路径才能安全清理。`);
        if (statePath) statePaths.push(resolve(statePath));
        return false;
      });
    } else if (isMap(node)) for (const key of ['insert', 'children']) visit(node.get(key, true));
  }
  visit(doc.contents);
  return { path, text, next: count ? doc.toString() : text, statePaths, count };
}
async function profilePatch(home, profile) { const path = resolve(home, 'profiles', profile, 'cordis.patch.yml'); return inspectPatch(await optionalRead(path), path); }
async function installed(home, profile) {
  const text = await optionalRead(resolve(home, 'profiles', profile, 'package.json'));
  if (!text) return false;
  const manifest = JSON.parse(text);
  return Boolean(manifest.dependencies?.[pluginName] || manifest.dsh?.profile?.bundles?.includes(pluginName));
}
function stateShape(data) {
  return data && typeof data === 'object' && data.schemaVersion === 1 && Number.isInteger(data.revision) && ['templates', 'teams', 'projects', 'employees', 'memories', 'runs'].every(key => Array.isArray(data[key]));
}
const sha256 = data => createHash('sha256').update(data).digest('hex');
const identity = metadata => ({ dev: metadata.dev, ino: metadata.ino });
function sameIdentity(metadata, expected) { return metadata.dev === expected.dev && metadata.ino === expected.ino; }

/** Knowledge belongs to exactly one state file. Never follow links or infer ownership from contents. */
async function inspectKnowledge(statePath) {
  const root = resolve(dirname(statePath), 'knowledge', basename(statePath));
  const rootMetadata = await lstat(root).catch(error => { if (absent(error)) return undefined; throw error; });
  if (!rootMetadata) return { statePath, root, absent: true };
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) throw new Error(`知识库目录是链接或非目录，拒绝清理：${root}`);
  await lstat(resolve(root, '.write.lock')).then(() => { throw new Error(`知识库仍被写入，先停止目标 Harness：${root}/.write.lock`); }, error => { if (!absent(error)) throw error; });
  const canonicalRoot = await realpath(root);
  if (canonicalRoot !== resolve(await canonical(dirname(statePath)), 'knowledge', basename(statePath))) throw new Error(`知识库父目录是链接，拒绝清理：${root}`);
  const directories = []; const files = [];
  async function visit(path) {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) throw new Error(`知识库包含链接，拒绝清理：${path}`);
    if (metadata.isDirectory()) {
      directories.push({ path, ...identity(metadata) });
      for (const entry of (await readdir(path)).sort()) await visit(resolve(path, entry));
    } else {
      if (!metadata.isFile()) throw new Error(`知识库包含非普通文件，拒绝清理：${path}`);
      if (metadata.nlink !== 1) throw new Error(`知识库包含硬链接，拒绝清理：${path}`);
      files.push({ path, ...identity(metadata), sha256: sha256(await readFile(path)) });
    }
  }
  await visit(root);
  const markerPath = resolve(root, '.owner.json');
  let marker;
  try { marker = JSON.parse(await readFile(markerPath, 'utf8')); } catch { throw new Error(`知识库缺少有效归属标记，拒绝清理：${root}`); }
  if (marker?.plugin !== pluginName || marker.schemaVersion !== 1 || marker.rootPath !== root) throw new Error(`知识库归属不符，拒绝清理：${root}`);
  return { statePath, root, canonicalRoot, directories, files };
}

async function assertKnowledgeDirectory(path, tree) {
  for (let current = path; ; current = dirname(current)) {
    const expected = tree.directories.find(directory => directory.path === current);
    const metadata = await lstat(current);
    if (!expected || !metadata.isDirectory() || metadata.isSymbolicLink() || !sameIdentity(metadata, expected)) throw new Error(`知识库目录已改变，请重新预览：${current}`);
    if (current === tree.root) break;
  }
  if (await realpath(tree.root) !== tree.canonicalRoot) throw new Error(`知识库路径已改变，请重新预览：${tree.root}`);
}

/** Plan first, so unsafe paths/configuration cannot leave a half-removed install. */
export async function planPurge({ home, profile = 'web', ownedStatePath, serviceRoot }) {
  home = resolve(home);
  if (!/^[a-zA-Z0-9_-]+$/.test(profile)) throw new Error('profile 名称无效。');
  const profileDirectory = resolve(home, 'profiles', profile);
  if (await canonical(profileDirectory) !== resolve(await canonical(home), 'profiles', profile)) throw new Error('profile 目录是链接，拒绝修改共享配置。');
  const profileConfig = await profilePatch(home, profile);
  const homeConfigPath = resolve(home, 'cordis.patch.yml');
  const homeConfig = inspectPatch(await optionalRead(homeConfigPath), homeConfigPath);
  const defaultState = resolve(home, pluginId, 'state.json');
  const configured = [...profileConfig.statePaths, ...homeConfig.statePaths];
  // Multiple historical overrides can own different files; do not silently leave one behind.
  const statePaths = [...new Set(configured.length ? configured : [defaultState])];
  if (ownedStatePath && !statePaths.includes(resolve(ownedStatePath))) throw new Error('--owned-state-path 必须与本插件配置的 statePath 完全一致。');
  const profilesDirectory = resolve(home, 'profiles');
  const profiles = await readdir(profilesDirectory, { withFileTypes: true }).catch(error => { if (absent(error)) return []; throw error; });
  for (const entry of profiles) {
    if (!entry.isDirectory() || entry.name === profile) continue;
    const other = await profilePatch(home, entry.name);
    const active = await installed(home, entry.name);
    const references = [...other.statePaths, ...(active ? homeConfig.statePaths : [])];
    if (active && references.length === 0) references.push(defaultState);
    for (const path of references) for (const target of statePaths) if (await canonical(target) === await canonical(path)) throw new Error(`statePath 正被 profile ${entry.name} 共享；拒绝删除共享数据。`);
    if (active && homeConfig.count) throw new Error(`home 级配置仍由 profile ${entry.name} 使用；拒绝修改共享配置。`);
  }
  const files = []; const knowledgeTrees = [];
  for (const statePath of statePaths) {
    if (statePath !== defaultState && resolve(ownedStatePath || '') !== statePath) throw new Error(`自定义 statePath 需要显式归属声明：--owned-state-path ${statePath}`);
    if (statePath === defaultState && await canonical(dirname(statePath)) !== resolve(await canonical(home), pluginId)) throw new Error(`默认 statePath 目录是链接，拒绝删除：${statePath}`);
    knowledgeTrees.push(await inspectKnowledge(statePath));
    await access(`${statePath}.lock`).then(() => { throw new Error(`状态文件仍被写入，先停止目标 Harness：${statePath}.lock`); }, error => { if (!absent(error)) throw error; });
    const metadata = await lstat(statePath).catch(error => { if (absent(error)) return undefined; throw error; });
    if (!metadata) continue;
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`statePath 不是普通文件，拒绝删除：${statePath}`);
    if (metadata.nlink > 1) throw new Error(`statePath 存在硬链接，拒绝删除：${statePath}`);
    const text = await readFile(statePath, 'utf8');
    if (!stateShape(JSON.parse(text))) throw new Error(`文件不是本插件状态格式，拒绝删除：${statePath}`);
    files.push({ path: statePath, sha256: createHash('sha256').update(text).digest('hex') });
  }
  const logs = [];
  if (serviceRoot) {
    const directory = resolve(serviceRoot, '.local/service');
    const entries = await readdir(directory, { withFileTypes: true }).catch(error => { if (absent(error)) return []; throw error; });
    if (entries.some(entry => !entry.isFile() || !['stdout.log', 'stderr.log'].includes(entry.name))) throw new Error(`服务日志目录包含未知文件，拒绝清理：${directory}`);
    if (entries.length && await canonical(directory) !== resolve(await canonical(serviceRoot), '.local/service')) throw new Error(`服务日志目录是链接，拒绝清理：${directory}`);
    for (const entry of entries) logs.push(resolve(directory, entry.name));
  }
  const patches = [profileConfig, homeConfig].filter(patch => patch.count > 0);
  for (const patch of patches) {
    const metadata = await lstat(patch.path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink > 1) throw new Error(`配置文件通过链接共享，拒绝修改：${patch.path}`);
  }
  return { home, profile, files, knowledgeTrees, logs, patches, serviceRoot: serviceRoot ? resolve(serviceRoot) : undefined };
}

/** Caller must stop the target host, then run the official CLI remove successfully. */
export async function applyPurge(plan) {
  if (await installed(plan.home, plan.profile)) throw new Error('请先通过官方 dsh plugin remove 移除本插件的依赖与 bundle。');
  // Recheck every precondition before deleting any file.
  for (const patch of plan.patches) {
    const metadata = await lstat(patch.path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink > 1 || await optionalRead(patch.path) !== patch.text) throw new Error(`配置已改变，请重新预览：${patch.path}`);
  }
  for (const file of plan.files) {
    const metadata = await lstat(file.path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink > 1) throw new Error(`文件归属已改变：${file.path}`);
    const hash = createHash('sha256').update(await readFile(file.path)).digest('hex');
    if (hash !== file.sha256) throw new Error(`状态文件已改变，请停止 Harness 后重新预览：${file.path}`);
    await access(`${file.path}.lock`).then(() => { throw new Error(`状态文件仍被写入：${file.path}`); }, error => { if (!absent(error)) throw error; });
  }
  for (const tree of plan.knowledgeTrees ?? []) {
    const current = await inspectKnowledge(tree.statePath);
    if (JSON.stringify(current) !== JSON.stringify(tree)) throw new Error(`知识库内容或目录树已改变，请停止 Harness 后重新预览：${tree.root}`);
    await access(`${tree.statePath}.lock`).then(() => { throw new Error(`知识库仍被写入：${tree.statePath}.lock`); }, error => { if (!absent(error)) throw error; });
  }
  for (const patch of plan.patches) await writeFile(patch.path, patch.next, { mode: 0o600 });
  for (const tree of plan.knowledgeTrees ?? []) {
    if (tree.absent) continue;
    const ownerPath = resolve(tree.root, '.owner.json');
    async function removeFile(file) {
      await assertKnowledgeDirectory(dirname(file.path), tree);
      const metadata = await lstat(file.path);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || !sameIdentity(metadata, file) || sha256(await readFile(file.path)) !== file.sha256) throw new Error(`知识库文件已改变，请重新预览：${file.path}`);
      await unlink(file.path);
    }
    for (const file of tree.files.filter(file => file.path !== ownerPath)) await removeFile(file);
    for (const directory of [...tree.directories].reverse().filter(directory => directory.path !== tree.root)) { await assertKnowledgeDirectory(directory.path, tree); await rmdir(directory.path); }
    // Keep ownership until the payload is gone, so interrupted cleanup can be planned again.
    await assertKnowledgeDirectory(tree.root, tree);
    if (JSON.stringify((await readdir(tree.root)).sort()) !== JSON.stringify(['.owner.json'])) throw new Error(`知识库目录树已改变，请重新预览：${tree.root}`);
    await removeFile(tree.files.find(file => file.path === ownerPath));
    await assertKnowledgeDirectory(tree.root, tree); await rmdir(tree.root);
    // Remove only known empty parents; sibling states and unknown files survive.
    await rmdir(dirname(tree.root)).catch(error => { if (!['ENOTEMPTY', 'ENOENT'].includes(error.code)) throw error; });
  }
  for (const file of plan.files) {
    await unlink(file.path);
    if (dirname(file.path) === resolve(plan.home, pluginId)) await rmdir(dirname(file.path)).catch(error => { if (!['ENOTEMPTY', 'ENOENT'].includes(error.code)) throw error; });
  }
  await rmdir(resolve(plan.home, pluginId)).catch(error => { if (!['ENOTEMPTY', 'ENOENT'].includes(error.code)) throw error; });
  for (const path of plan.logs) await unlink(path).catch(error => { if (!absent(error)) throw error; });
  if (plan.serviceRoot) await rmdir(resolve(plan.serviceRoot, '.local/service')).catch(error => { if (!['ENOTEMPTY', 'ENOENT'].includes(error.code)) throw error; });
  return { removedState: plan.files.map(file => file.path), removedKnowledge: (plan.knowledgeTrees ?? []).filter(tree => !tree.absent).map(tree => tree.root), removedConfigRows: plan.patches.reduce((count, patch) => count + patch.count, 0), removedLogs: plan.logs, preserved: ['user projects and delivered files', 'native Harness sessions, shared credentials and other plugins'] };
}
