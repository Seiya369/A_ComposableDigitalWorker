import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('../skills/worktree-cleanup/scripts/cleanup.mjs', import.meta.url));
const git = (directory: string, ...args: string[]) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function fixture(t: TestContext) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'workforce-cleanup-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'main repo'), worktree = join(root, 'task tree');
  mkdirSync(repo);
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.email', 'worktree-test@example.invalid');
  git(repo, 'config', 'user.name', 'Worktree cleanup test');
  git(repo, 'config', 'core.hooksPath', join(root, 'no-hooks'));
  writeFileSync(join(repo, '.gitignore'), '/node_modules/\n/dist/\n/local-notes/\n');
  writeFileSync(join(repo, 'source.txt'), 'baseline\n');
  git(repo, 'add', '.'); git(repo, 'commit', '-m', 'baseline');
  const head = git(repo, 'rev-parse', 'HEAD');
  const base = ['--repo', repo, '--worktree', worktree, '--owner', 'task-1', '--integration', 'refs/heads/main'];
  function call(action: string, extras: string[] = [], overrideBase = base) {
    const result = spawnSync(process.execPath, [helper, action, ...overrideBase, ...extras], { cwd: repo, encoding: 'utf8' });
    return { exitCode: result.status, value: JSON.parse(result.status === 0 ? result.stdout : result.stderr) as any };
  }
  function create(extras: string[] = []) {
    const result = call('create', ['--branch', 'task', ...extras]);
    assert.equal(result.exitCode, 0, JSON.stringify(result.value));
    return result.value;
  }
  function commit(text: string) {
    writeFileSync(join(worktree, 'source.txt'), text);
    git(worktree, 'add', 'source.txt'); git(worktree, 'commit', '-m', 'task change');
  }
  function merge() { git(repo, 'merge', '--ff-only', 'task'); }
  return { root, repo, worktree, head, base, call, create, commit, merge };
}

test('cleanup removes a merged owned checkout and its dedicated Git metadata with no surviving directory', (t) => {
  const f = fixture(t), record = f.create();
  f.commit('accepted implementation\n'); f.merge();
  const ready = f.call('audit');
  assert.equal(ready.exitCode, 0, JSON.stringify(ready.value));
  assert.equal(existsSync(f.worktree), true, 'audit is read-only');
  const result = f.call('cleanup');
  assert.equal(result.exitCode, 0, JSON.stringify(result.value));
  assert.equal(result.value.status, 'removed');
  assert.deepEqual(result.value.verified, { physicalDirectoryAbsent: true, worktreeListEntryAbsent: true, gitDirectoryAbsent: true });
  assert.equal(existsSync(f.worktree), false);
  assert.equal(existsSync(ready.value.gitDirectory), false);
  assert.equal(existsSync(record.record), false);
  assert.equal(git(f.repo, 'worktree', 'list', '--porcelain').includes(f.worktree), false);
  assert.equal(readFileSync(join(f.repo, 'source.txt'), 'utf8'), 'accepted implementation\n');
  assert.equal(git(f.repo, 'rev-parse', 'task'), result.value.head, 'branch and history remain recoverable');
});

test('the helper creates ownership itself and cannot adopt an existing clean or dirty checkout', (t) => {
  const f = fixture(t);
  git(f.repo, 'worktree', 'add', '-b', 'someone-else', f.worktree);
  const clean = f.call('create', ['--branch', 'task']);
  assert.equal(clean.exitCode, 1); assert.match(clean.value.message, /已存在.*拒绝认领/);
  writeFileSync(join(f.worktree, 'notes.txt'), 'only local copy');
  const dirty = f.call('create', ['--branch', 'task']);
  assert.equal(dirty.exitCode, 1); assert.match(dirty.value.message, /已存在.*拒绝认领/);
  assert.equal(readFileSync(join(f.worktree, 'notes.txt'), 'utf8'), 'only local copy');
  assert.equal(f.call('cleanup').exitCode, 1);
});

test('cleanup refuses unmerged history and squash-equivalent commits while preserving the only checkout', (t) => {
  const f = fixture(t); f.create(); f.commit('same content\n');
  const unmerged = f.call('cleanup');
  assert.equal(unmerged.exitCode, 1); assert.match(unmerged.value.message, /尚未.*已合并/);
  git(f.repo, 'merge', '--squash', 'task'); git(f.repo, 'commit', '-m', 'squash task');
  const squashed = f.call('cleanup');
  assert.equal(squashed.exitCode, 1); assert.match(squashed.value.message, /祖先关系/);
  assert.equal(readFileSync(join(f.worktree, 'source.txt'), 'utf8'), 'same content\n');
  assert.notEqual(git(f.repo, 'rev-parse', 'HEAD'), git(f.worktree, 'rev-parse', 'HEAD'));
});

test('cleanup refuses tracked edits, staged changes and untracked files without touching them', (t) => {
  const f = fixture(t); f.create();
  writeFileSync(join(f.worktree, 'source.txt'), 'uncommitted original\n');
  assert.equal(f.call('cleanup').exitCode, 1);
  assert.equal(readFileSync(join(f.worktree, 'source.txt'), 'utf8'), 'uncommitted original\n');
  git(f.worktree, 'add', 'source.txt');
  assert.equal(f.call('cleanup').exitCode, 1);
  git(f.worktree, 'reset', '--hard', 'HEAD');
  writeFileSync(join(f.worktree, 'user-upload.txt'), 'unique user file');
  assert.equal(f.call('cleanup').exitCode, 1);
  assert.equal(readFileSync(join(f.worktree, 'user-upload.txt'), 'utf8'), 'unique user file');
});

test('ignored files are protected by default and unrelated ignored material remains even with an allowlisted cache', (t) => {
  const f = fixture(t); f.create(['--disposable-dir', 'node_modules']);
  mkdirSync(join(f.worktree, 'node_modules')); writeFileSync(join(f.worktree, 'node_modules', 'regenerable'), 'cache');
  mkdirSync(join(f.worktree, 'local-notes')); writeFileSync(join(f.worktree, 'local-notes', 'only-copy'), 'private material');
  const result = f.call('cleanup');
  assert.equal(result.exitCode, 1); assert.match(result.value.message, /未声明.*ignored/);
  assert.equal(readFileSync(join(f.worktree, 'local-notes', 'only-copy'), 'utf8'), 'private material');
  assert.equal(existsSync(join(f.worktree, 'node_modules', 'regenerable')), true, 'preflight finishes before deleting any cache');
});

test('an explicitly declared reproducible ignored dependency and build directory are physically removed', (t) => {
  const f = fixture(t); f.create(['--disposable-dir', 'node_modules', '--disposable-dir', 'dist']);
  mkdirSync(join(f.worktree, 'node_modules', '.bin'), { recursive: true });
  writeFileSync(join(f.worktree, 'node_modules', 'tool.js'), 'generated dependency');
  symlinkSync('../tool.js', join(f.worktree, 'node_modules', '.bin', 'tool'));
  mkdirSync(join(f.worktree, 'dist')); writeFileSync(join(f.worktree, 'dist', 'index.js'), 'generated output');
  const result = f.call('cleanup');
  assert.equal(result.exitCode, 0, JSON.stringify(result.value));
  assert.equal(result.value.disposableDirectories.length, 2);
  assert.equal(existsSync(f.worktree), false);
});

test('declared cache containing tracked files, an external symlink or a nested Git repository is preserved', (t) => {
  const f = fixture(t); f.create(['--disposable-dir', 'node_modules']);
  mkdirSync(join(f.worktree, 'node_modules'));
  const external = join(f.root, 'unique-external.txt'); writeFileSync(external, 'outside data');
  symlinkSync(external, join(f.worktree, 'node_modules', 'outside'));
  const linked = f.call('cleanup');
  assert.equal(linked.exitCode, 1); assert.match(linked.value.message, /越界符号链接/);
  assert.equal(readFileSync(external, 'utf8'), 'outside data');
  rmSync(join(f.worktree, 'node_modules', 'outside'));
  mkdirSync(join(f.worktree, 'node_modules', 'nested', '.git'), { recursive: true });
  const nested = f.call('cleanup');
  assert.equal(nested.exitCode, 1); assert.match(nested.value.message, /嵌套 Git/);
  rmSync(join(f.worktree, 'node_modules', 'nested'), { recursive: true });
  const bareDirectory = join(f.worktree, 'node_modules', 'local-bare.git');
  git(f.worktree, 'clone', '--bare', f.repo, bareDirectory);
  const uniqueCommit = git(bareDirectory, '-c', 'user.name=Unique data', '-c', 'user.email=unique@example.invalid', 'commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'only survives in nested bare repository');
  git(bareDirectory, 'update-ref', 'refs/heads/unique', uniqueCommit);
  const bare = f.call('cleanup');
  assert.equal(bare.exitCode, 1); assert.match(bare.value.message, /裸 Git/);
  assert.equal(existsSync(join(f.worktree, 'node_modules', 'local-bare.git', 'HEAD')), true);
  assert.equal(git(bareDirectory, 'cat-file', '-t', uniqueCommit), 'commit', 'unique bare repository history remains accessible');
  rmSync(join(f.worktree, 'node_modules', 'local-bare.git'), { recursive: true });
  writeFileSync(join(f.worktree, 'node_modules', 'important'), 'tracked user data');
  git(f.worktree, 'add', '-f', 'node_modules/important'); git(f.worktree, 'commit', '-m', 'keep important'); f.merge();
  writeFileSync(join(f.worktree, 'node_modules', 'cache'), 'cache');
  const tracked = f.call('cleanup');
  assert.equal(tracked.exitCode, 1); assert.match(tracked.value.message, /跟踪文件/);
  assert.equal(readFileSync(join(f.worktree, 'node_modules', 'important'), 'utf8'), 'tracked user data');
});

test('main, unrelated, locked and symlinked worktrees cannot be removed through this helper', (t) => {
  const f = fixture(t); f.create();
  const differentOwner = f.base.map((value) => value === 'task-1' ? 'someone-else' : value);
  assert.equal(f.call('cleanup', [], differentOwner).exitCode, 1);
  const mainTarget = f.base.map((value) => value === f.worktree ? f.repo : value);
  assert.equal(f.call('cleanup', [], mainTarget).exitCode, 1);
  git(f.repo, 'worktree', 'lock', f.worktree);
  assert.equal(f.call('cleanup').exitCode, 1);
  git(f.repo, 'worktree', 'unlock', f.worktree);
  const alias = join(f.root, 'alias'); symlinkSync(f.worktree, alias);
  assert.equal(f.call('cleanup', [], f.base.map((value) => value === f.worktree ? alias : value)).exitCode, 1);
  assert.equal(existsSync(f.worktree), true); assert.equal(existsSync(f.repo), true);
});

test('hidden index flags cannot conceal local data from the clean-tree check', (t) => {
  const f = fixture(t); f.create();
  git(f.worktree, 'update-index', '--assume-unchanged', 'source.txt');
  writeFileSync(join(f.worktree, 'source.txt'), 'hidden local data');
  const result = f.call('cleanup');
  assert.equal(result.exitCode, 1); assert.match(result.value.message, /assume-unchanged/);
  assert.equal(readFileSync(join(f.worktree, 'source.txt'), 'utf8'), 'hidden local data');
});

test('unregistered targets and integration-ref mismatches stay untouched', (t) => {
  const f = fixture(t);
  git(f.repo, 'worktree', 'add', '-b', 'unregistered', f.worktree);
  assert.equal(f.call('cleanup').exitCode, 1);
  git(f.repo, 'worktree', 'remove', f.worktree);
  f.create(); git(f.repo, 'branch', 'other-integration');
  const mismatched = f.base.map((value) => value === 'refs/heads/main' ? 'refs/heads/other-integration' : value);
  assert.equal(f.call('cleanup', [], mismatched).exitCode, 1);
  assert.equal(existsSync(f.worktree), true);
});
