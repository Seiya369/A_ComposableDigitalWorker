import assert from 'node:assert/strict';
import test from 'node:test';
import { access, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { parse } from 'yaml';
import { applyPurge, planPurge, pluginName } from '../scripts/purge-profile.mjs';

const fixtureState = () => ({ schemaVersion: 1, revision: 0, templates: [], teams: [], projects: [], employees: [], memories: [], runs: [] });
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'graph-horses-cleanup-'));
  const home = resolve(root, 'home'); const profile = resolve(home, 'profiles/web');
  const statePath = resolve(home, 'composable-workforce/state.json');
  await mkdir(profile, { recursive: true }); await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(fixtureState()));
  await writeFile(resolve(profile, 'package.json'), JSON.stringify({ dependencies: { [pluginName]: '0.3.0', 'other-plugin': '1.0.0' }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', pluginName, 'other-plugin'] } } }));
  return { root, home, profile, statePath };
}
async function removed(profile: string) {
  const manifest = JSON.parse(await readFile(resolve(profile, 'package.json'), 'utf8'));
  delete manifest.dependencies[pluginName]; manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((item: string) => item !== pluginName);
  await writeFile(resolve(profile, 'package.json'), JSON.stringify(manifest));
}
async function knowledgeRoot(statePath: string) {
  const root = resolve(dirname(statePath), 'knowledge', basename(statePath));
  await mkdir(resolve(root, 'templates/team-1/team/A-sources/source'), { recursive: true });
  await writeFile(resolve(root, '.owner.json'), JSON.stringify({ plugin: pluginName, schemaVersion: 1, rootPath: root }));
  await writeFile(resolve(root, 'templates/team-1/team/A-sources/source/v1.json'), 'source evidence');
  return root;
}

test('purge preview is read-only and cleanup preserves projects, credentials, native history and other configuration', async () => {
  const f = await fixture();
  try {
    const patch = '# user configuration\n- id: composable-workforce\n  config: {}\n- id: another-plugin\n  config:\n    enabled: true\n';
    const patchPath = resolve(f.profile, 'cordis.patch.yml'); await writeFile(patchPath, patch);
    for (const name of ['.credentials.yaml', 'sessions/history.json', 'project/delivery.md']) { await mkdir(dirname(resolve(f.home, name)), { recursive: true }); await writeFile(resolve(f.home, name), name); }
    const logs = resolve(f.root, '.local/service'); await mkdir(logs, { recursive: true }); await writeFile(resolve(logs, 'stdout.log'), 'plugin log');
    const plan = await planPurge({ home: f.home, serviceRoot: f.root });
    assert.equal(await readFile(patchPath, 'utf8'), patch); await access(f.statePath);
    await assert.rejects(applyPurge(plan), /官方 dsh plugin remove/);
    await removed(f.profile); const result = await applyPurge(plan);
    assert.equal(result.removedConfigRows, 1); await assert.rejects(access(f.statePath), /ENOENT/); await assert.rejects(access(logs), /ENOENT/);
    assert.deepEqual(parse(await readFile(patchPath, 'utf8')), [{ id: 'another-plugin', config: { enabled: true } }]);
    for (const name of ['.credentials.yaml', 'sessions/history.json', 'project/delivery.md']) assert.equal(await readFile(resolve(f.home, name), 'utf8'), name);
    const manifest = JSON.parse(await readFile(resolve(f.profile, 'package.json'), 'utf8')); assert.equal(manifest.dependencies['other-plugin'], '1.0.0');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('retained configuration and state survive ordinary official removal', async () => {
  const f = await fixture();
  try {
    const patchPath = resolve(f.profile, 'cordis.patch.yml'); await writeFile(patchPath, '- id: composable-workforce\n  config: {}\n');
    const knowledge = await knowledgeRoot(f.statePath);
    const before = await readFile(f.statePath, 'utf8'); await removed(f.profile);
    assert.equal(await readFile(f.statePath, 'utf8'), before); assert.ok((await readFile(patchPath, 'utf8')).includes('composable-workforce'));
    assert.equal(await readFile(resolve(knowledge, 'templates/team-1/team/A-sources/source/v1.json'), 'utf8'), 'source evidence');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('complete purge removes only its marked knowledge root, including when its state is already absent', async () => {
  const f = await fixture();
  try {
    const knowledge = await knowledgeRoot(f.statePath);
    const otherKnowledge = await knowledgeRoot(resolve(dirname(f.statePath), 'other-state.json'));
    const protectedFiles = ['projects/delivery.md', 'sessions/native.json'].map(name => resolve(f.home, name));
    for (const path of protectedFiles) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, 'keep'); }
    await rm(f.statePath);
    const plan = await planPurge({ home: f.home });
    await access(knowledge); await removed(f.profile);
    const result = await applyPurge(plan);
    assert.deepEqual(result.removedKnowledge, [knowledge]);
    await assert.rejects(access(knowledge), /ENOENT/);
    await access(otherKnowledge);
    for (const path of protectedFiles) assert.equal(await readFile(path, 'utf8'), 'keep');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('knowledge cleanup rejects unowned roots, symlinks and hardlinked evidence', async () => {
  const f = await fixture();
  try {
    const knowledge = await knowledgeRoot(f.statePath);
    const marker = resolve(knowledge, '.owner.json');
    await rm(marker); await assert.rejects(planPurge({ home: f.home }), /知识库.*归属/);
    await writeFile(marker, JSON.stringify({ plugin: 'other-plugin', schemaVersion: 1, rootPath: knowledge }));
    await assert.rejects(planPurge({ home: f.home }), /知识库.*归属/);
    await writeFile(marker, JSON.stringify({ plugin: pluginName, schemaVersion: 1, rootPath: resolve(f.root, 'elsewhere') }));
    await assert.rejects(planPurge({ home: f.home }), /知识库.*归属/);
    await writeFile(marker, JSON.stringify({ plugin: pluginName, schemaVersion: 1, rootPath: knowledge }));
    const target = resolve(f.root, 'shared.txt'); await writeFile(target, 'shared');
    const linkPath = resolve(knowledge, 'shared.txt');
    await symlink(target, linkPath); await assert.rejects(planPurge({ home: f.home }), /知识库.*链接/);
    await rm(linkPath); await link(target, linkPath); await assert.rejects(planPurge({ home: f.home }), /知识库.*硬链接/);
    await rm(linkPath);
    const relocated = resolve(f.root, 'relocated'); await rm(knowledge, { recursive: true }); await mkdir(relocated);
    await symlink(relocated, knowledge); await assert.rejects(planPurge({ home: f.home }), /知识库.*链接/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('knowledge tree changes invalidate the entire purge before any configuration or state mutation', async () => {
  const f = await fixture();
  try {
    const knowledge = await knowledgeRoot(f.statePath);
    const patchPath = resolve(f.profile, 'cordis.patch.yml'); const patch = '- id: composable-workforce\n  config: {}\n';
    await writeFile(patchPath, patch);
    const plan = await planPurge({ home: f.home }); await removed(f.profile);
    const evidence = resolve(knowledge, 'templates/team-1/team/A-sources/source/v1.json');
    await writeFile(evidence, 'changed evidence');
    await assert.rejects(applyPurge(plan), /知识库.*改变/);
    assert.equal(await readFile(patchPath, 'utf8'), patch); await access(f.statePath);
    const nextPlan = await planPurge({ home: f.home });
    await writeFile(resolve(knowledge, 'late.txt'), 'new evidence');
    await assert.rejects(applyPurge(nextPlan), /知识库.*改变/);
    assert.equal(await readFile(patchPath, 'utf8'), patch); await access(f.statePath);
    const linkedPlan = await planPurge({ home: f.home });
    await rm(evidence); await symlink(resolve(f.statePath), evidence);
    await assert.rejects(applyPurge(linkedPlan), /知识库.*链接/);
    assert.equal(await readFile(patchPath, 'utf8'), patch); await access(f.statePath);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('knowledge writers, newly appeared roots and linked parent directories stop cleanup', async () => {
  const f = await fixture();
  try {
    const absentPlan = await planPurge({ home: f.home }); await removed(f.profile);
    const knowledge = await knowledgeRoot(f.statePath);
    await assert.rejects(applyPurge(absentPlan), /知识库.*改变/); await access(f.statePath);
    await writeFile(resolve(knowledge, '.write.lock'), JSON.stringify({ pid: process.pid, token: 'writer' }));
    await assert.rejects(planPurge({ home: f.home }), /知识库仍被写入/);
    await rm(resolve(knowledge, '.write.lock'));
    const relocated = resolve(f.root, 'relocated-knowledge'); await mkdir(relocated);
    await rm(dirname(knowledge), { recursive: true }); await symlink(relocated, dirname(knowledge));
    await mkdir(resolve(relocated, basename(f.statePath)));
    await assert.rejects(planPurge({ home: f.home }), /知识库父目录是链接/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('external paths require an exact explicit ownership argument and shared state is rejected', async () => {
  const f = await fixture();
  try {
    const external = resolve(f.root, 'custom-state.json'); await writeFile(external, JSON.stringify(fixtureState()));
    await writeFile(resolve(f.profile, 'cordis.patch.yml'), `- id: composable-workforce\n  config:\n    statePath: ${JSON.stringify(external)}\n`);
    await assert.rejects(planPurge({ home: f.home }), /显式归属声明/);
    const plan = await planPurge({ home: f.home, ownedStatePath: external }); assert.equal(plan.files[0].path, external);
    const other = resolve(f.home, 'profiles/other'); await mkdir(other, { recursive: true }); await writeFile(resolve(other, 'cordis.patch.yml'), `- id: composable-workforce\n  config:\n    statePath: ${JSON.stringify(external)}\n`);
    await assert.rejects(planPurge({ home: f.home, ownedStatePath: external }), /共享/);
    await access(external);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('unsafe state files and stale plans are rejected before cleanup', async () => {
  const f = await fixture();
  try {
    const plan = await planPurge({ home: f.home }); await removed(f.profile);
    await writeFile(f.statePath, JSON.stringify({ ...fixtureState(), revision: 1 }));
    await assert.rejects(applyPurge(plan), /状态文件已改变/);
    await writeFile(f.statePath, '{"unrelated":true}'); await assert.rejects(planPurge({ home: f.home }), /不是本插件状态格式/);
    await rm(f.statePath); const target = resolve(f.root, 'shared.json'); await writeFile(target, JSON.stringify(fixtureState())); await symlink(target, f.statePath);
    await assert.rejects(planPurge({ home: f.home }), /不是普通文件/); await rm(f.statePath); await link(target, f.statePath);
    await assert.rejects(planPurge({ home: f.home }), /硬链接/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('purge only visits plugin rows and never rewrites another plugin configuration payload', async () => {
  const f = await fixture();
  try {
    const patchPath = resolve(f.profile, 'cordis.patch.yml');
    const other = { id: 'another-plugin', config: { rows: [{ id: 'composable-workforce', value: 'unrelated payload' }] } };
    await writeFile(patchPath, JSON.stringify([{ insert: [{ id: 'composable-workforce', name: pluginName }] }, other]));
    const plan = await planPurge({ home: f.home }); await removed(f.profile); await applyPurge(plan);
    assert.deepEqual(parse(await readFile(patchPath, 'utf8')), [{ insert: [] }, other]);
    await writeFile(patchPath, '- id: composable-workforce\n  insert:\n    - id: other\n      name: another-plugin\n');
    await assert.rejects(planPurge({ home: f.home }), /锚定了其他插入配置/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
