#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const disposableNames = new Set(['node_modules', 'dist', 'build', 'coverage', '.cache', '.next', '.nuxt', '.turbo', '.vite']);
const fail = (message) => { throw new Error(message); };
const present = (path) => { try { lstatSync(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const inside = (root, path) => path === root || path.startsWith(root + sep);
const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } });
const lines0 = (text) => text.split('\0').filter(Boolean);

function options(argv) {
  const action = argv.shift();
  if (action === '--help' || action === '-h') return { action: 'help' };
  if (!['create', 'audit', 'cleanup'].includes(action)) fail('需要 create、audit 或 cleanup；--help 查看参数');
  const result = { action, disposable: [] };
  const flags = new Map([['--repo', 'repo'], ['--worktree', 'worktree'], ['--owner', 'owner'], ['--integration', 'integration'], ['--branch', 'branch']]);
  while (argv.length) {
    const flag = argv.shift(), value = argv.shift();
    if (!value || value.startsWith('--')) fail(`参数缺少值：${flag}`);
    if (flag === '--disposable-dir') result.disposable.push(value);
    else if (flags.has(flag) && result[flags.get(flag)] === undefined) result[flags.get(flag)] = value;
    else fail(`未知或重复参数：${flag}`);
  }
  for (const key of ['repo', 'worktree', 'owner', 'integration']) if (!result[key]) fail(`缺少参数：${key}`);
  if (!isAbsolute(result.repo) || !isAbsolute(result.worktree)) fail('repo 与 worktree 必须为绝对路径');
  if (!/^refs\/heads\/.+/.test(result.integration)) fail('integration 必须是明确的本地 refs/heads/... 分支');
  if (result.action === 'create' && !result.branch) fail('create 必须明确指定新建分支 --branch');
  if (result.action !== 'create' && (result.branch || result.disposable.length)) fail('branch 和 disposable-dir 仅在创建时提供');
  for (const path of result.disposable) if (!disposableNames.has(path)) fail(`未列为可再生根目录：${path}`);
  return result;
}

function list(repo) {
  return git(repo, ['worktree', 'list', '--porcelain', '-z']).split('\0\0').filter(Boolean).map((block) => {
    const row = {};
    for (const line of lines0(block)) { const index = line.indexOf(' '); row[index === -1 ? line : line.slice(0, index)] = index === -1 ? true : line.slice(index + 1); }
    return row;
  });
}

function mainRepo(path) {
  const repo = realpathSync(path);
  if (git(repo, ['rev-parse', '--show-toplevel']).trim() !== repo || list(repo)[0]?.worktree !== repo) fail('repo 必须是主仓库工作目录的根路径');
  const common = realpathSync(git(repo, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim());
  return { repo, common };
}

const recordPath = (common, worktree) => resolve(common, 'workforce-temporary-worktrees', createHash('sha256').update(worktree).digest('hex') + '.json');

function context(args) {
  // Never dereference a user-supplied target alias; ownership is tied to one physical checkout.
  const { repo, common } = mainRepo(args.repo), worktree = realpathSync(args.worktree);
  if (resolve(args.worktree) !== worktree) fail(`worktree 路径含符号链接或别名：${args.worktree}`);
  if (git(repo, ['rev-parse', '--show-toplevel']).trim() !== repo) fail('repo 必须是主仓库工作目录的根路径');
  const rows = list(repo), main = rows[0];
  if (main?.worktree !== repo) fail('repo 必须指向主工作树，而非另一个临时工作树');
  if (worktree === repo || inside(worktree, repo)) fail('主工作树或包含主工作树的目录不能清理');
  const row = rows.find((entry) => entry.worktree === worktree);
  if (!row || row.bare || row.prunable || row.locked) fail(`目标不是可清理的已注册工作树（不存在、锁定或已损坏）：${worktree}`);
  if (git(worktree, ['rev-parse', '--show-toplevel']).trim() !== worktree) fail('目标不是工作树根目录');
  if (realpathSync(git(worktree, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim()) !== common) fail('目标工作树不属于指定仓库');
  const gitDir = realpathSync(git(worktree, ['rev-parse', '--absolute-git-dir']).trim());
  if (!inside(resolve(common, 'worktrees'), gitDir) || gitDir === resolve(common, 'worktrees')) fail('目标 Git 管理目录不属于 linked worktree');
  const record = recordPath(common, worktree);
  return { repo, worktree, gitDir, common, record, head: git(worktree, ['rev-parse', 'HEAD']).trim() };
}

function ancestor(repo, child, parent) {
  try { git(repo, ['merge-base', '--is-ancestor', child, parent]); return true; }
  catch (error) { if (error.status === 1) return false; throw error; }
}

function inspectTree(path, worktree, device) {
  const stat = lstatSync(path);
  if (stat.dev !== device) fail(`可再生目录跨越挂载设备：${path}`);
  if (stat.isSymbolicLink()) {
    let target; try { target = realpathSync(path); } catch { fail(`可再生目录含无法核验的符号链接：${path}`); }
    if (!inside(worktree, target)) fail(`可再生目录含越界符号链接：${path}`);
    return;
  }
  if (!stat.isDirectory()) return;
  // A bare repository has no .git child and can contain the only surviving commits.
  if (present(resolve(path, 'HEAD')) && present(resolve(path, 'objects')) && (present(resolve(path, 'refs')) || present(resolve(path, 'config')))) fail(`可再生目录含裸 Git 仓库：${path}`);
  for (const entry of readdirSync(path)) {
    if (entry === '.git') fail(`可再生目录含嵌套 Git 仓库：${resolve(path, entry)}`);
    inspectTree(resolve(path, entry), worktree, device);
  }
}

function audit(ctx, args) {
  if (!present(ctx.record)) fail(`缺少本任务的创建登记：${ctx.worktree}`);
  const record = JSON.parse(readFileSync(ctx.record, 'utf8'));
  if (record.version !== 2 || record.source !== 'helper-create' || record.owner !== args.owner || record.repo !== ctx.repo || record.worktree !== ctx.worktree || record.gitDir !== ctx.gitDir || record.integration !== args.integration) fail(`任务归属、工作树身份或集成分支与登记不符：${ctx.worktree}`);
  if (!Array.isArray(record.disposable) || record.disposable.some((name) => !disposableNames.has(name))) fail('登记的可再生目录格式无效');
  const integrationHead = git(ctx.repo, ['rev-parse', '--verify', `${args.integration}^{commit}`]).trim();
  if (!ancestor(ctx.repo, record.createdHead, ctx.head)) fail('工作树 HEAD 已偏离创建时提交；需保全后人工核查');
  if (!ancestor(ctx.repo, ctx.head, integrationHead)) fail(`工作树提交尚未由祖先关系证明已合并：${ctx.head} → ${args.integration}`);
  const hidden = lines0(git(ctx.worktree, ['ls-files', '-v', '-z'])).filter((row) => /^[a-zS]/.test(row));
  if (hidden.length) fail(`索引含 assume-unchanged 或 skip-worktree，无法证明文件干净：${hidden[0].slice(2)}`);
  const statuses = lines0(git(ctx.worktree, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching', '--ignore-submodules=none']));
  const disposable = new Set();
  for (const status of statuses) {
    if (!status.startsWith('!! ')) fail(`存在未保存修改、未跟踪内容或子模块变更：${status}`);
    const name = status.slice(3).replace(/\/$/, ''), root = name.split('/')[0];
    if (!record.disposable.includes(root)) fail(`存在未声明可丢弃的 ignored 内容：${name}`);
    disposable.add(root);
  }
  const tracked = lines0(git(ctx.worktree, ['ls-files', '-z']));
  for (const root of disposable) {
    const absolute = resolve(ctx.worktree, root);
    if (!inside(ctx.worktree, absolute) || absolute === ctx.worktree || tracked.some((name) => name === root || name.startsWith(root + '/'))) fail(`可再生目录含跟踪文件或路径无效：${root}`);
    if (!lstatSync(absolute).isDirectory() || lstatSync(absolute).isSymbolicLink()) fail(`可再生根目录不是普通目录：${absolute}`);
    try { git(ctx.worktree, ['check-ignore', '-q', '--', root + '/']); } catch { fail(`可再生根目录未被整体忽略：${absolute}`); }
    inspectTree(absolute, ctx.worktree, lstatSync(ctx.worktree).dev);
  }
  return { status: 'ready', owner: args.owner, repo: ctx.repo, worktree: ctx.worktree, head: ctx.head, integration: args.integration, integrationHead, disposableDirectories: [...disposable].map((name) => resolve(ctx.worktree, name)), gitDirectory: ctx.gitDir };
}

export function run(argv) {
  const args = options([...argv]);
  if (args.action === 'help') return { usage: 'cleanup.mjs create|audit|cleanup --repo /absolute/main --worktree /absolute/temporary --owner task-id --integration refs/heads/main [create: --branch <new-branch> --disposable-dir <root>]', disposableRoots: [...disposableNames], note: 'create 实际创建并记录归属，不认领已有目录；audit 只读；cleanup 清理单目标且从不 force。' };
  if (args.action === 'create') {
    const { repo, common } = mainRepo(args.repo), worktree = resolve(args.worktree);
    if (present(worktree) || list(repo).some((row) => row.worktree === worktree)) fail(`目标已存在，拒绝认领现有工作树：${worktree}`);
    if (realpathSync(dirname(worktree)) !== dirname(worktree)) fail('worktree 的父目录必须存在且路径不能含符号链接或别名');
    if (inside(worktree, repo)) fail('目标不能是主工作树的祖先目录');
    git(repo, ['check-ref-format', '--branch', args.branch]);
    const start = git(repo, ['rev-parse', '--verify', `${args.integration}^{commit}`]).trim();
    const recordFile = recordPath(common, worktree);
    if (present(recordFile)) fail(`此路径已有未结清的创建记录：${worktree}`);
    mkdirSync(dirname(recordFile), { recursive: true });
    const lock = recordFile + '.create-lock'; mkdirSync(lock);
    try {
      git(repo, ['worktree', 'add', '-b', args.branch, '--', worktree, start]);
      const ctx = context(args);
      const record = { version: 2, source: 'helper-create', owner: args.owner, repo, worktree, gitDir: ctx.gitDir, integration: args.integration, createdHead: ctx.head, branch: args.branch, disposable: [...new Set(args.disposable)], createdAt: new Date().toISOString() };
      writeFileSync(recordFile, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      return { status: 'created', owner: args.owner, worktree, head: ctx.head, record: recordFile };
    } catch (error) {
      if (present(worktree)) fail(`创建或登记失败；尚未删除以保全内容。残留工作树：${worktree}；归属记录：${recordFile}。原因：${error.stderr?.toString().trim() || error.message}`);
      throw error;
    } finally { rmSync(lock, { recursive: true, force: true }); }
  }
  const ctx = context(args);
  if (args.action === 'audit') return audit(ctx, args);
  if (inside(ctx.worktree, realpathSync(process.cwd()))) fail('请先退出目标工作树，再执行 cleanup');
  const lock = ctx.record + '.cleanup-lock';
  mkdirSync(lock);
  try {
    const result = audit(ctx, args);
    // No shell expansion, no force on git, no recursive walk through symlinks.
    for (const path of result.disposableDirectories) rmSync(path, { recursive: true });
    if (git(ctx.worktree, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching', '--ignore-submodules=none'])) fail(`清理期间内容发生变化，工作树保留：${ctx.worktree}`);
    if (git(ctx.worktree, ['rev-parse', 'HEAD']).trim() !== result.head || git(ctx.repo, ['rev-parse', '--verify', `${args.integration}^{commit}`]).trim() !== result.integrationHead) fail('清理期间提交发生变化，工作树保留');
    git(ctx.repo, ['worktree', 'remove', '--', ctx.worktree]);
    if (present(ctx.worktree) || present(ctx.gitDir) || list(ctx.repo).some((row) => row.worktree === ctx.worktree)) fail(`移除后仍有物理目录或 Git 条目残留：${ctx.worktree}；${ctx.gitDir}`);
    unlinkSync(ctx.record);
    return { ...result, status: 'removed', verified: { physicalDirectoryAbsent: true, worktreeListEntryAbsent: true, gitDirectoryAbsent: true } };
  } finally { rmSync(lock, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(run(process.argv.slice(2)), null, 2) + '\n'); }
  catch (error) {
    const message = error.stderr?.toString().trim() || error.message;
    process.stderr.write(JSON.stringify({ status: 'blocked', message }, null, 2) + '\n');
    process.exitCode = 1;
  }
}
