import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, rename, rmdir, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { KnowledgeCitation, KnowledgeCompilation, KnowledgeCompilationAttempt, KnowledgeCompilationTrace, KnowledgeConceptGraph, KnowledgeInput, KnowledgeSnapshot, KnowledgeSource, KnowledgeSpace } from './types.js';
import { KNOWLEDGE_SOURCE_CATEGORIES, normalizeKnowledgeCategory } from './library-api.js';
import { knowledgeCategoryForInput, LEGACY_KNOWLEDGE_CATEGORY_DIRECTORIES } from './categories.js';
import type { WikiLibraryView } from './wiki-types.js';
import { defaultKnowledgeArchivePolicy, validateKnowledgeArchivePolicy, validateKnowledgeArchivePolicyChange, type KnowledgeArchivePolicy, type KnowledgeArchivePolicyChange } from './archive-policy.js';
import { WorkforceError } from '../domain/errors.js';

const PLUGIN = 'dsh-plugin-composable-workforce';
const queues = new Map<string, Promise<unknown>>();
const roots = new Map<string, Promise<void>>();
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const notFound = (message: string) => Object.assign(new Error(message), { code: 'NOT_FOUND' });
type WriteGuard = () => boolean;
function assertWritable(canWrite?: WriteGuard): void {
  if (canWrite && !canWrite()) throw Object.assign(new Error('Knowledge scope is disabled; write cancelled'), { code: 'KNOWLEDGE_WRITE_DISABLED' });
}
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const component = (value: unknown): string => {
  check(typeof value === 'string' && /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,159}$/u.test(value), 'Invalid knowledge path identifier');
  return value;
};
const identifier = (value: unknown): string => {
  check(typeof value === 'string' && /^[\p{L}\p{N}][\p{L}\p{N}._:-]{0,199}$/u.test(value), 'Invalid knowledge path identifier');
  return value;
};
const sourceDirectory = (path: string, id: string) => join(path, 'A-sources', encodeURIComponent(identifier(id)));
type SnapshotManifest = Omit<KnowledgeSnapshot, keyof KnowledgeCompilation> & Pick<KnowledgeSnapshot, 'compilationTrace'> & { publishedVersions: number[] };
type StoredOverview = KnowledgeCompilation['overview'] | { schemaVersion: 1; overview: KnowledgeCompilation['overview']; conceptGraph: KnowledgeConceptGraph };
type SeedMarker = { schemaVersion: 1; from: { teamId: string; version: number }; createdAt: string };
const versionNumber = (value: unknown): number => {
  check(Number.isSafeInteger(value) && Number(value) > 0, 'Invalid knowledge version');
  return value as number;
};
const bounded = (value: unknown, label: string, bytes: number, allowEmpty = false): string => {
  check(typeof value === 'string' && (allowEmpty || !!value.trim()), `${label} is required`);
  check(Buffer.byteLength(value) <= bytes, `${label} is too large`);
  return value;
};
function accountingTrace(trace: KnowledgeCompilationTrace): KnowledgeCompilationTrace {
  const count = (value: number) => { check(Number.isSafeInteger(value) && value >= 0, 'Invalid compilation accounting count'); return value; };
  check(trace?.revision === 'strict-incremental-v1', 'Invalid compilation accounting revision');
  check(Array.isArray(trace.changedSourceIds) && trace.changedSourceIds.length <= 10_000 && Array.isArray(trace.removedSourceIds) && trace.removedSourceIds.length <= 10_000, 'Invalid compilation source accounting');
  const modelCalls = count(trace.modelCalls);
  const usage = trace.usage ? {
    reportedCalls: count(trace.usage.reportedCalls), inputTokens: count(trace.usage.inputTokens), outputTokens: count(trace.usage.outputTokens),
    ...Object.fromEntries(['totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'].flatMap(key => {
      const value = trace.usage![key as keyof NonNullable<KnowledgeCompilationTrace['usage']>]; return value === undefined ? [] : [[key, count(value)]];
    })),
  } : undefined;
  check(!usage || usage.reportedCalls <= modelCalls, 'Compilation reported calls exceed attempted calls');
  return { revision: trace.revision, modelCalls, changedSourceIds: trace.changedSourceIds.map(identifier), removedSourceIds: trace.removedSourceIds.map(identifier),
    ...(trace.model ? { model: { provider: bounded(trace.model.provider, 'Accounting provider', 256), model: bounded(trace.model.model, 'Accounting model', 256),
      ...(trace.model.reasoningEffort === undefined ? {} : { reasoningEffort: bounded(trace.model.reasoningEffort, 'Accounting effort', 64) }) } } : {}),
    ...(usage ? { usage } : {}) };
}
function accountingAttempt(value: KnowledgeCompilationAttempt): KnowledgeCompilationAttempt {
  check(value?.schemaVersion === 1, 'Invalid compilation attempt schema');
  for (const date of [value.startedAt, value.finishedAt]) check(typeof date === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(date) && new Date(date).toISOString() === date, 'Invalid compilation attempt timestamp');
  check(value.finishedAt >= value.startedAt, 'Invalid compilation attempt interval');
  check(['published', 'failed', 'cancelled', 'superseded'].includes(value.outcome), 'Invalid compilation attempt outcome');
  check(typeof value.sourceFingerprint === 'string' && /^[a-f0-9]{64}$/.test(value.sourceFingerprint), 'Invalid compilation source fingerprint');
  return { schemaVersion: 1, id: component(value.id), startedAt: value.startedAt, finishedAt: value.finishedAt, outcome: value.outcome, sourceFingerprint: value.sourceFingerprint,
    ...(value.version === undefined ? {} : { version: versionNumber(value.version) }), ...(value.trace ? { trace: accountingTrace(value.trace) } : {}) };
}

export const knowledgeRootFor = (statePath: string): string => resolve(dirname(statePath), 'knowledge', basename(statePath));

/** File storage owned only by this plugin. Model-authored knowledge is never an acceptance decision. */
export class KnowledgeRepository {
  readonly rootPath: string;
  private readonly employeeLocations = new Map<string, string>();
  constructor(rootPath: string) { this.rootPath = resolve(rootPath); }

  private async spacePath(space: KnowledgeSpace, readOnly = false): Promise<string> {
    check(space && (space.kind === 'template' || space.kind === 'project'), 'Invalid knowledge space');
    let teamId = component(space.teamId);
    check(space.kind !== 'template' || space.projectId === undefined, 'Template knowledge cannot belong to a project');
    // A project's employee identity survives team changes. Bind its first physical
    // private directory rather than copying material into each subsequent team.
    if (space.kind === 'project' && space.memberId !== undefined) teamId = await this.employeeTeam(component(space.projectId), component(space.memberId), teamId, readOnly);
    const base = space.kind === 'project'
      ? join(this.rootPath, 'projects', component(space.projectId), 'teams', teamId)
      : join(this.rootPath, 'templates', teamId);
    return space.memberId === undefined ? join(base, 'team') : join(base, 'employees', component(space.memberId));
  }

  private async employeeTeam(projectId: string, employeeId: string, requestedTeamId: string, readOnly = false): Promise<string> {
    const locationKey = JSON.stringify([projectId, employeeId]);
    const cached = this.employeeLocations.get(locationKey);
    if (cached) return cached;
    if (!readOnly) await this.root();
    const path = join(this.rootPath, 'projects', projectId, 'employee-locations', `${employeeId}.json`);
    type Location = { schemaVersion: 1; projectId: string; employeeId: string; teamId: string };
    const read = async (): Promise<Location | undefined> => {
      // A concurrent first binder can be between its exclusive create and write.
      for (let attempt = 0; ; attempt++) {
        try {
          const value = await this.json<Location>(path);
          if (value) {
            check(value.schemaVersion === 1 && value.projectId === projectId && value.employeeId === employeeId, 'Invalid employee knowledge location');
            component(value.teamId);
          }
          return value;
        } catch (error) {
          if (!(error instanceof SyntaxError) || attempt >= 4) throw error;
          await new Promise(done => setTimeout(done, 25));
        }
      }
    };
    let location = await read();
    if (!location) {
      const teamsPath = join(this.rootPath, 'projects', projectId, 'teams');
      await this.safe(teamsPath);
      const candidates: Array<{ teamId: string; hasMaterial: boolean }> = [];
      const teams = await readdir(teamsPath, { withFileTypes: true }).catch(error => { if (missing(error)) return []; throw error; });
      for (const team of teams) {
        if (!team.isDirectory()) continue;
        const candidate = join(teamsPath, component(team.name), 'employees', employeeId);
        await this.safe(candidate);
        const metadata = await lstat(candidate).catch(error => { if (missing(error)) return undefined; throw error; });
        if (metadata?.isDirectory()) {
          let hasMaterial = false;
          for (const layer of ['A-sources', 'A-originals', 'B-knowledge', 'C-overview']) {
            const layerPath = join(candidate, layer);
            await this.safe(layerPath);
            const entries = await readdir(layerPath).catch(error => { if (missing(error)) return []; throw error; });
            if (entries.some(entry => entry !== 'index.json')) hasMaterial = true;
          }
          candidates.push({ teamId: team.name, hasMaterial });
        }
      }
      const material = candidates.filter(candidate => candidate.hasMaterial);
      check(material.length <= 1, '发现同一员工的多个旧私库目录；请先核对并处理归属冲突，未自动复制或覆盖资料');
      const firstEmpty = candidates.map(candidate => candidate.teamId).sort()[0];
      const proposed: Location = { schemaVersion: 1, projectId, employeeId, teamId: material[0]?.teamId ?? firstEmpty ?? requestedTeamId };
      if (readOnly) return proposed.teamId;
      await this.directory(dirname(path));
      await this.safe(path);
      let file;
      try {
        file = await open(path, 'wx', 0o600);
        await file.writeFile(`${JSON.stringify(proposed)}\n`, 'utf8');
        await file.sync();
        location = proposed;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        location = await read();
      } finally { await file?.close(); }
      check(location, 'Employee knowledge location could not be resolved');
    }
    this.employeeLocations.set(locationKey, location.teamId);
    return location.teamId;
  }

  /** Reject links in every managed component, including final files, before IO. */
  private async safe(path: string): Promise<void> {
    const rel = relative(this.rootPath, path);
    check(rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)), 'Invalid knowledge path');
    // The derived root lives immediately below the plugin's `knowledge` namespace.
    // Check that parent even before root creation; ancestor /tmp and /var aliases on macOS are outside this managed boundary.
    const parent = dirname(this.rootPath);
    if (parent !== '/tmp' && parent !== '/var') {
      try {
        const info = await lstat(parent);
        check(!info.isSymbolicLink(), 'Symbolic links are forbidden in knowledge parent paths');
        check(info.isDirectory(), 'Knowledge parent path must be a directory');
      } catch (error) { if (!missing(error)) throw error; }
    }
    let current = this.rootPath;
    for (const part of ['', ...(rel ? rel.split(sep) : [])]) {
      if (part) current = join(current, part);
      try {
        const info = await lstat(current);
        check(!info.isSymbolicLink(), 'Symbolic links are forbidden in knowledge paths');
        check(!info.isFile() || info.nlink === 1, 'Hard links are forbidden in knowledge paths');
        if (current !== path) check(info.isDirectory(), 'Knowledge parent path must be a directory');
      } catch (error) { if (missing(error)) return; throw error; }
    }
  }

  private async directory(path: string): Promise<void> {
    await this.safe(path);
    await mkdir(path, { recursive: true, mode: 0o700 });
    // A concurrent initializer can create the same directory; validate again before using it.
    await this.safe(path);
    const rel = relative(this.rootPath, path);
    let current = this.rootPath;
    for (const part of ['', ...(rel ? rel.split(sep) : [])]) {
      if (part) current = join(current, part);
      await chmod(current, 0o700);
    }
  }

  private async json<T>(path: string): Promise<T | undefined> {
    await this.safe(path);
    let file;
    try { file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) { if (missing(error)) return undefined; throw error; }
    try {
      check((await file.stat()).size <= 16_000_000, 'Knowledge file is too large');
      return JSON.parse(await file.readFile('utf8')) as T;
    } finally { await file.close(); }
  }

  private async write(path: string, value: unknown, signal?: AbortSignal, canWrite?: WriteGuard): Promise<void> {
    return this.writeText(path, `${JSON.stringify(value, null, 2)}\n`, signal, canWrite);
  }

  private async writeText(path: string, value: string, signal?: AbortSignal, canWrite?: WriteGuard): Promise<void> {
    assertWritable(canWrite);
    await this.directory(dirname(path));
    await this.safe(path);
    const temporary = join(dirname(path), `.pending-${randomUUID()}`);
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(value, 'utf8');
      await file.sync();
    } finally { await file.close(); }
    try { await this.safe(path); signal?.throwIfAborted(); assertWritable(canWrite); await rename(temporary, path); }
    finally { await unlink(temporary).catch(error => { if (!missing(error)) throw error; }); }
  }

  private async root(): Promise<void> {
    const previous = roots.get(this.rootPath) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      await this.safe(this.rootPath);
      await mkdir(this.rootPath, { recursive: true, mode: 0o700 });
      await this.safe(this.rootPath);
      check((await lstat(this.rootPath)).isDirectory(), 'Knowledge root must be a directory');
      const ownerPath = join(this.rootPath, '.owner.json');
      const expected = { plugin: PLUGIN, schemaVersion: 1, rootPath: this.rootPath };
      const owner = await this.json<typeof expected>(ownerPath);
      if (owner) check(owner.plugin === PLUGIN && owner.schemaVersion === 1 && owner.rootPath === this.rootPath, 'Knowledge root ownership does not match');
      else {
        check((await readdir(this.rootPath)).length === 0, 'Cannot claim a nonempty knowledge root without plugin ownership');
        await this.write(ownerPath, expected);
      }
      await chmod(this.rootPath, 0o700);
    });
    roots.set(this.rootPath, current);
    try { await current; }
    finally { if (roots.get(this.rootPath) === current) roots.delete(this.rootPath); }
  }

  async ensure(space: KnowledgeSpace): Promise<void> {
    const path = await this.spacePath(space);
    await this.root();
    for (const layer of ['A-sources', 'B-knowledge', 'C-overview']) await this.directory(join(path, layer));
    for (const category of KNOWLEDGE_SOURCE_CATEGORIES) await this.directory(join(path, '分类目录', category.label));
  }

  /** One immutable accounting record per completed attempt; never stores model/user text. */
  async recordCompilationAttempt(space: KnowledgeSpace, input: KnowledgeCompilationAttempt): Promise<void> {
    const record = accountingAttempt(input);
    await this.locked(async () => {
      const directory = join(await this.spacePath(space), 'compilation-attempts');
      const path = join(directory, `${record.id}.json`);
      const previous = await this.json<KnowledgeCompilationAttempt>(path);
      if (previous) check(JSON.stringify(previous) === JSON.stringify(record), 'Compilation attempt accounting is immutable');
      else await this.write(path, record);
      const indexPath = join(directory, 'index.json');
      const index = await this.json<{ schemaVersion: 1; items: Array<{ id: string; finishedAt: string }> }>(indexPath);
      check(index === undefined || (index.schemaVersion === 1 && Array.isArray(index.items) && index.items.length <= 50), 'Invalid compilation accounting index');
      const items = [...(index?.items ?? []).filter(item => item.id !== record.id), { id: record.id, finishedAt: record.finishedAt }]
        .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt) || b.id.localeCompare(a.id)).slice(0, 50);
      await this.write(indexPath, { schemaVersion: 1, items });
    });
  }

  /** Bounded view of this one already-authorized library, newest completions first. */
  async compilationAttempts(space: KnowledgeSpace, limit = 50): Promise<KnowledgeCompilationAttempt[]> {
    check(Number.isSafeInteger(limit) && limit >= 1 && limit <= 50, 'Invalid compilation history limit');
    const path = join(await this.spacePath(space, true), 'compilation-attempts');
    const index = await this.json<{ schemaVersion: 1; items: Array<{ id: string; finishedAt: string }> }>(join(path, 'index.json'));
    if (!index) return [];
    check(index.schemaVersion === 1 && Array.isArray(index.items) && index.items.length <= 50, 'Invalid compilation accounting index');
    const records: KnowledgeCompilationAttempt[] = [];
    for (const item of index.items.slice(0, limit)) {
      const value = await this.json<KnowledgeCompilationAttempt>(join(path, `${component(item.id)}.json`));
      if (value) records.push(accountingAttempt(value));
    }
    return records.sort((a, b) => b.finishedAt.localeCompare(a.finishedAt) || b.id.localeCompare(a.id)).slice(0, limit);
  }

  async compilationTrace(space: KnowledgeSpace, version: number): Promise<KnowledgeCompilationTrace | undefined> {
    versionNumber(version);
    const manifest = await this.manifest(space);
    check(manifest !== undefined && manifest.publishedVersions.includes(version), 'Knowledge trace version is not published');
    const trace = await this.json<KnowledgeCompilationTrace>(join(await this.spacePath(space, true), 'compilation-traces', `v${version}.json`));
    return trace ? accountingTrace(trace) : manifest.version === version && manifest.compilationTrace ? accountingTrace(manifest.compilationTrace) : undefined;
  }

  /** Missing policy preserves historical admission defaults without creating a file. */
  async archivePolicy(space: KnowledgeSpace): Promise<KnowledgeArchivePolicy> {
    const value = await this.json<unknown>(join(await this.spacePath(space, true), 'archive-policy.json'));
    return value === undefined ? defaultKnowledgeArchivePolicy() : validateKnowledgeArchivePolicy(value);
  }

  /** Independent libraries use independent CAS versions, coordinated by the owned-root mutex. */
  async updateArchivePolicy(space: KnowledgeSpace, change: KnowledgeArchivePolicyChange, canWrite?: WriteGuard): Promise<KnowledgeArchivePolicy> {
    validateKnowledgeArchivePolicyChange(change);
    return this.locked(async () => {
      const policy = await this.archivePolicy(space);
      if (policy.version !== change.expectedVersion) throw new WorkforceError('CONFLICT', '自动归档设置已更新，请刷新后重试');
      if (policy.categories[change.category] === change.enabled) return policy;
      if (policy.version === Number.MAX_SAFE_INTEGER) throw new WorkforceError('CONFLICT', '自动归档设置版本已达上限');
      const updated: KnowledgeArchivePolicy = { ...policy, version: policy.version + 1, categories: { ...policy.categories, [change.category]: change.enabled } };
      await this.write(join(await this.spacePath(space), 'archive-policy.json'), updated, undefined, canWrite);
      return updated;
    }, canWrite);
  }

  /** Rebuild a safe, human-readable category projection without moving canonical A/B/C files. */
  async syncCategoryDirectories(space: KnowledgeSpace, canWrite?: WriteGuard): Promise<void> {
    await this.locked(async () => {
      await this.ensure(space);
      const path = await this.spacePath(space);
      const active = await this.index(path);
      const sources = await Promise.all(Object.entries(active).sort(([a], [b]) => a.localeCompare(b)).map(([id, version]) => this.source(path, id, version, true)));
      for (const category of KNOWLEDGE_SOURCE_CATEGORIES) {
        const directory = join(path, '分类目录', category.label);
        const value = {
          schemaVersion: 1, category: category.id, name: category.label,
          sources: sources.filter(source => normalizeKnowledgeCategory(source.category) === category.id).map(source => ({
            id: source.id, title: source.title, version: source.version,
            sourceFile: relative(directory, join(sourceDirectory(path, source.id), `v${source.version}.json`)).split(sep).join('/'),
            ...(source.original ? { originalFile: relative(directory, join(path, 'A-originals', `${source.original.storageId}.json`)).split(sep).join('/') } : {}),
          })),
        };
        const indexPath = join(directory, 'index.json');
        if (JSON.stringify(await this.json(indexPath)) !== JSON.stringify(value)) await this.write(indexPath, value, undefined, canWrite);
      }
      await this.cleanLegacyCategoryProjections(path, canWrite);
    }, canWrite);
  }

  /** Remove only the recognized old derived index, never unknown files or canonical history. */
  private async cleanLegacyCategoryProjections(path: string, canWrite?: WriteGuard): Promise<void> {
    const root = join(path, '分类目录');
    await this.safe(root);
    for (const legacy of LEGACY_KNOWLEDGE_CATEGORY_DIRECTORIES) {
      const directory = join(root, legacy.label);
      const info = await lstat(directory).catch(error => { if (missing(error)) return undefined; throw error; });
      if (!info?.isDirectory()) continue;
      const indexPath = join(directory, 'index.json');
      const indexInfo = await lstat(indexPath).catch(error => { if (missing(error)) return undefined; throw error; });
      if (indexInfo?.isFile()) {
        let value: unknown;
        try { value = await this.json(indexPath); } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
        const record = value as { schemaVersion?: unknown; category?: unknown; name?: unknown; sources?: unknown } | undefined;
        const isGenerated = record && Object.keys(record).sort().join(',') === 'category,name,schemaVersion,sources'
          && record.schemaVersion === 1 && record.category === legacy.id && record.name === legacy.label
          && Array.isArray(record.sources) && record.sources.length <= 2_000 && record.sources.every(item => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
            const source = item as Record<string, unknown>;
            if (!['id,sourceFile,title,version', 'id,originalFile,sourceFile,title,version'].includes(Object.keys(source).sort().join(','))) return false;
            try {
              const id = identifier(source.id), version = versionNumber(source.version);
              if (typeof source.title !== 'string' || source.sourceFile !== relative(directory, join(sourceDirectory(path, id), `v${version}.json`)).split(sep).join('/')) return false;
              return source.originalFile === undefined || typeof source.originalFile === 'string' && /^\.\.\/\.\.\/A-originals\/[a-f0-9]{64}\.json$/.test(source.originalFile);
            } catch { return false; }
          });
        if (isGenerated) { assertWritable(canWrite); await this.safe(indexPath); await unlink(indexPath); }
      }
      if ((await readdir(directory)).length === 0) {
        assertWritable(canWrite); await this.safe(directory);
        await rmdir(directory).catch(error => { if (!missing(error) && (error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw error; });
      }
    }
  }

  private async seedMarker(space: KnowledgeSpace): Promise<SeedMarker | undefined> {
    check(space.kind === 'project', 'Template seeding is only available for project knowledge spaces');
    await this.ensure(space);
    const marker = await this.json<SeedMarker>(join(await this.spacePath(space), 'seed.json'));
    if (marker) {
      check(marker.schemaVersion === 1 && marker.from && typeof marker.createdAt === 'string', 'Invalid knowledge seed marker');
      identifier(marker.from.teamId); versionNumber(marker.from.version);
    }
    return marker;
  }

  async isSeeded(space: KnowledgeSpace): Promise<boolean> { return !!await this.seedMarker(space); }

  /** Mark even an empty initial copy so later template edits cannot silently seed an existing project. */
  async markSeeded(space: KnowledgeSpace, from: { teamId: string; version: number }, canWrite?: WriteGuard): Promise<void> {
    check(space.kind === 'project', 'Template seeding is only available for project knowledge spaces');
    // Provenance stays inside seed.json; detached workflow IDs carry a namespace.
    // Filesystem locations still use the separate, stricter spacePath components.
    from = { teamId: identifier(from.teamId), version: versionNumber(from.version) };
    return this.locked(async () => {
      const marker = await this.seedMarker(space);
      if (marker) {
        check(marker.from.teamId === from.teamId && marker.from.version === from.version, 'Knowledge seed already initialized from another template version');
        return;
      }
      await this.write(join(await this.spacePath(space), 'seed.json'), { schemaVersion: 1, from, createdAt: new Date().toISOString() } satisfies SeedMarker, undefined, canWrite);
    }, canWrite);
  }

  /** A root mutex also coordinates independent instances and CLI processes. No model work runs under it. */
  private async locked<T>(action: () => Promise<T>, canWrite?: WriteGuard): Promise<T> {
    assertWritable(canWrite);
    const previous = queues.get(this.rootPath) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      assertWritable(canWrite);
      await this.root();
      const path = join(this.rootPath, '.write.lock');
      const token = randomUUID();
      let lock;
      for (let attempt = 0; attempt < 200; attempt++) {
        assertWritable(canWrite);
        await this.safe(path);
        try {
          lock = await open(path, 'wx', 0o600);
          await lock.writeFile(JSON.stringify({ pid: process.pid, token }));
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          const holder = await this.json<{ pid?: number; token?: string }>(path).catch(() => undefined);
          if (holder?.pid && Number.isSafeInteger(holder.pid)) {
            try { process.kill(holder.pid, 0); }
            catch (failure) {
              if ((failure as NodeJS.ErrnoException).code === 'ESRCH') {
                const still = await this.json<typeof holder>(path);
                if (still?.token === holder.token) await unlink(path).catch(error => { if (!missing(error)) throw error; });
              }
            }
          }
          await new Promise(done => setTimeout(done, 25));
        }
      }
      check(lock, 'Knowledge write lock is busy');
      try { assertWritable(canWrite); return await action(); }
      finally {
        await lock.close();
        const holder = await this.json<{ token: string }>(path);
        if (holder?.token === token) await unlink(path);
      }
    });
    queues.set(this.rootPath, current);
    try { return await current; }
    finally { if (queues.get(this.rootPath) === current) queues.delete(this.rootPath); }
  }

  private async index(path: string): Promise<Record<string, number>> {
    const data = await this.json<Record<string, number>>(join(path, 'A-sources', 'index.json')) ?? {};
    check(data && typeof data === 'object' && !Array.isArray(data), 'Invalid source index');
    for (const [id, version] of Object.entries(data)) { identifier(id); versionNumber(version); }
    return data;
  }

  private async nextVersion(path: string, current = 0): Promise<number> {
    await this.directory(path);
    const versions = (await readdir(path)).filter(name => /^v[1-9]\d*\.json$/.test(name)).map(name => Number(name.slice(1, -5)));
    return Math.max(current, 0, ...versions) + 1;
  }

  async ingest(space: KnowledgeSpace, input: KnowledgeInput, canWrite?: WriteGuard): Promise<KnowledgeSource> {
    input = structuredClone(input);
    identifier(input.id);
    bounded(input.title, 'Source title', 1_600);
    bounded(input.content, 'Source content', 2_000_000, true);
    bounded(input.provenance, 'Source provenance', 8_000);
    check(typeof input.verified === 'boolean', 'Source verification state is required');
    const category = knowledgeCategoryForInput(input);
    const path = await this.spacePath(space);
    return this.locked(async () => {
      await this.ensure(space);
      const index = await this.index(path);
      const oldVersion = Object.hasOwn(index, input.id) ? index[input.id] : undefined;
      const old = oldVersion ? await this.source(path, input.id, oldVersion, true) : undefined;
      const hash = sha(input.content);
      if (old?.hash === hash && old.verified === input.verified && old.provenance === input.provenance && old.title === input.title && old.category === category && JSON.stringify(old.original) === JSON.stringify(input.original) && JSON.stringify(old.extraction) === JSON.stringify(input.extraction)) return old;
      check(oldVersion !== undefined || Object.keys(index).length < 2_000, 'Knowledge source count is too large');
      const processing: string[] = [];
      if (input.extraction) processing.push(`Extracted ${input.extraction.format.toUpperCase()} reading text with ${input.extraction.parser}; original bytes retained separately. ${input.extraction.format === 'pdf' ? 'Page markers identify the originating PDF page.' : 'Paragraph text retained; Word pagination and rich layout are not reproduced.'}`, ...input.extraction.warnings);
      let text = input.content;
      if (text.startsWith('\uFEFF')) { text = text.slice(1); processing.push('Removed leading BOM from reading text; original retained.'); }
      if (text.includes('\r')) { text = text.replace(/\r\n?/g, '\n'); processing.push('Normalized line endings to LF in reading text.'); }
      if (text.includes('\0')) { text = text.replace(/\0/g, '[U+0000]'); processing.push('Marked NUL characters as [U+0000] in reading text.'); }
      if (!processing.length) processing.push('Original text retained without semantic edits.');
      const source: KnowledgeSource = { ...input, category, version: await this.nextVersion(sourceDirectory(path, input.id), oldVersion), hash, text, processing, createdAt: new Date().toISOString() };
      await this.write(join(sourceDirectory(path, input.id), `v${source.version}.json`), source, undefined, canWrite);
      Object.defineProperty(index, input.id, { value: source.version, enumerable: true, writable: true, configurable: true });
      await this.write(join(path, 'A-sources', 'index.json'), index, undefined, canWrite);
      return source;
    }, canWrite);
  }

  /** Original bytes remain immutable inside this plugin's owned cleanup boundary. */
  async preserveOriginal(space: KnowledgeSpace, fileName: string, bytes: Uint8Array, canWrite?: WriteGuard): Promise<NonNullable<KnowledgeInput['original']>> {
    check(typeof fileName === 'string' && fileName.length <= 240 && !/[\\/\0\r\n]/.test(fileName), 'Invalid original file name');
    check(bytes.byteLength > 0 && bytes.byteLength <= 6_291_456, 'Original file is too large');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const metadata = { fileName, byteLength: bytes.byteLength, sha256, storageId: sha256 };
    await this.locked(async () => {
      await this.ensure(space);
      const path = join(await this.spacePath(space), 'A-originals', `${sha256}.json`);
      if (!await this.json(path)) await this.write(path, { sha256, base64: Buffer.from(bytes).toString('base64') }, undefined, canWrite);
    }, canWrite);
    return metadata;
  }

  async original(space: KnowledgeSpace, storageId: string): Promise<Buffer> {
    check(/^[a-f0-9]{64}$/.test(storageId), 'Invalid original storage ID');
    const value = await this.json<{ sha256: string; base64: string }>(join(await this.spacePath(space), 'A-originals', `${storageId}.json`));
    if (!value) throw notFound('Original document was not found');
    const bytes = Buffer.from(value.base64, 'base64');
    check(value.sha256 === storageId && createHash('sha256').update(bytes).digest('hex') === storageId, 'Original document is corrupt');
    return bytes;
  }

  /** Withdraw active material without deleting the source versions needed for an audit. */
  async retire(space: KnowledgeSpace, id: string, canWrite?: WriteGuard, expectedVersion?: number): Promise<void> {
    identifier(id);
    if (expectedVersion !== undefined) versionNumber(expectedVersion);
    const path = await this.spacePath(space);
    return this.locked(async () => {
      await this.ensure(space);
      const index = await this.index(path);
      if (expectedVersion !== undefined && index[id] !== expectedVersion) throw Object.assign(new Error('资料已更新，请刷新列表后重试'), { code: 'CONFLICT' });
      if (!Object.hasOwn(index, id)) return;
      delete index[id];
      await this.write(join(path, 'A-sources', 'index.json'), index, undefined, canWrite);
    }, canWrite);
  }

  /** Roll back a withdrawn reference only if no newer writer has already restored it. */
  async restoreActive(space: KnowledgeSpace, id: string, version: number, canWrite?: WriteGuard): Promise<void> {
    identifier(id); versionNumber(version);
    const path = await this.spacePath(space);
    await this.locked(async () => {
      await this.ensure(space);
      const index = await this.index(path);
      if (Object.hasOwn(index, id)) return;
      await this.source(path, id, version, true);
      Object.defineProperty(index, id, { value: version, enumerable: true, writable: true, configurable: true });
      await this.write(join(path, 'A-sources', 'index.json'), index, undefined, canWrite);
    }, canWrite);
  }

  private async source(path: string, id: string, version: number, required = false): Promise<KnowledgeSource> {
    const source = await this.json<KnowledgeSource>(join(sourceDirectory(path, id), `v${versionNumber(version)}.json`));
    if (!source && !required) throw notFound('Knowledge source was not found');
    check(source && source.id === id && source.version === version && typeof source.text === 'string' && source.hash === sha(source.content), 'Knowledge source is missing or corrupt');
    return { ...source, category: knowledgeCategoryForInput(source) };
  }

  async sources(space: KnowledgeSpace): Promise<KnowledgeSource[]> {
    await this.ensure(space);
    const path = await this.spacePath(space);
    const index = await this.index(path);
    return Promise.all(Object.entries(index).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([id, version]) => this.source(path, id, version, true)));
  }

  async fingerprint(space: KnowledgeSpace): Promise<string> {
    const sources = await this.sources(space);
    return sha(JSON.stringify(sources.map(source => [source.id, source.version, source.hash, source.verified])));
  }

  private async manifest(space: KnowledgeSpace): Promise<SnapshotManifest | undefined> {
    await this.ensure(space);
    const value = await this.json<SnapshotManifest>(join(await this.spacePath(space), 'snapshot.json'));
    if (value) {
      versionNumber(value.version); check(value.status === 'candidate', 'Invalid knowledge snapshot status');
      check(Array.isArray(value.publishedVersions) && value.publishedVersions.includes(value.version), 'Knowledge snapshot publication history is incomplete');
      value.publishedVersions.forEach(versionNumber);
      if (value.sourceManifest !== undefined) {
        check(Array.isArray(value.sourceManifest) && value.sourceManifest.length <= 2_000, 'Invalid incremental source manifest');
        const ids = new Set<string>();
        for (const item of value.sourceManifest) {
          identifier(item.id); versionNumber(item.version);
          check(typeof item.hash === 'string' && /^[a-f0-9]{64}$/.test(item.hash) && typeof item.verified === 'boolean' && !ids.has(item.id), 'Invalid incremental source identity');
          ids.add(item.id);
        }
        const identities = [...value.sourceManifest].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
        check(sha(JSON.stringify(identities.map(item => [item.id, item.version, item.hash, item.verified]))) === value.sourceFingerprint, 'Incremental source manifest fingerprint is inconsistent');
      }
    }
    return value;
  }

  async snapshot(space: KnowledgeSpace): Promise<KnowledgeSnapshot | undefined> {
    const manifest = await this.manifest(space);
    if (!manifest) return undefined;
    const path = await this.spacePath(space);
    const entries = await this.json<KnowledgeCompilation['entries']>(join(path, 'B-knowledge', `v${manifest.version}.json`));
    const storedOverview = await this.json<StoredOverview>(join(path, 'C-overview', `v${manifest.version}.json`));
    const overview = Array.isArray(storedOverview) ? storedOverview : storedOverview?.overview;
    const conceptGraph = Array.isArray(storedOverview) ? undefined : storedOverview?.conceptGraph;
    check(Array.isArray(entries) && Array.isArray(overview), 'Knowledge snapshot is incomplete');
    check(Array.isArray(storedOverview) || (storedOverview?.schemaVersion === 1 && conceptGraph?.schemaVersion === 1 && Array.isArray(conceptGraph.concepts) && Array.isArray(conceptGraph.relations)), 'Knowledge concept graph is incomplete');
    let sourceManifest = manifest.sourceManifest;
    if (!sourceManifest) {
      const active = await this.sources(space);
      if (sha(JSON.stringify(active.map(source => [source.id, source.version, source.hash, source.verified]))) === manifest.sourceFingerprint) {
        sourceManifest = active.map(({ id, version, hash, verified }) => ({ id, version, hash, verified }));
      } else {
        const versions = new Map<string, number>();
        for (const item of [...entries, ...(conceptGraph?.concepts ?? []), ...(conceptGraph?.relations ?? [])]) {
          for (const citation of item.citations) {
            check(!versions.has(citation.sourceId) || versions.get(citation.sourceId) === citation.sourceVersion, 'Legacy snapshot has conflicting source versions');
            versions.set(citation.sourceId, citation.sourceVersion);
          }
        }
        sourceManifest = await Promise.all([...versions].map(async ([id, version]) => {
          const source = await this.source(path, id, version, true);
          return { id, version, hash: source.hash, verified: source.verified };
        }));
      }
    }
    return { version: manifest.version, sourceFingerprint: manifest.sourceFingerprint, createdAt: manifest.createdAt, status: 'candidate', entries, overview, ...(conceptGraph ? { conceptGraph } : {}), sourceManifest, ...(manifest.compilationTrace ? { compilationTrace: manifest.compilationTrace } : {}) };
  }

  /** Adopt an exact old publication without a model call or a new knowledge version. */
  async checkpointSourceManifest(space: KnowledgeSpace, expectedSourceFingerprint: string, canWrite?: WriteGuard): Promise<void> {
    await this.locked(async () => {
      const manifest = await this.manifest(space);
      if (!manifest || manifest.sourceManifest || manifest.sourceFingerprint !== expectedSourceFingerprint) return;
      if (await this.fingerprint(space) !== expectedSourceFingerprint) return;
      const sources = await this.sources(space);
      await this.write(join(await this.spacePath(space), 'snapshot.json'), { ...manifest, sourceManifest: sources.map(({ id, version, hash, verified }) => ({ id, version, hash, verified })) }, undefined, canWrite);
    }, canWrite);
  }

  async publish(space: KnowledgeSpace, compilation: KnowledgeCompilation, expectedSourceFingerprint: string, signal?: AbortSignal, expectedSnapshotVersion?: number | null): Promise<KnowledgeSnapshot> {
    signal?.throwIfAborted();
    compilation = structuredClone(compilation);
    check(compilation && Array.isArray(compilation.entries) && Array.isArray(compilation.overview), 'Knowledge compilation is incomplete');
    check(Buffer.byteLength(JSON.stringify(compilation)) <= 2_000_000 && compilation.entries.length <= 500 && compilation.overview.length <= 200, 'Knowledge compilation is too large');
    return this.locked(async () => {
      signal?.throwIfAborted();
      await this.ensure(space);
      const path = await this.spacePath(space);
      const actualFingerprint = await this.fingerprint(space);
      if (actualFingerprint !== expectedSourceFingerprint) throw new WorkforceError('CONFLICT', 'Knowledge sources changed; compilation conflict');
      const baseline = await this.manifest(space);
      if (expectedSnapshotVersion !== undefined && (baseline?.version ?? null) !== expectedSnapshotVersion) throw new WorkforceError('CONFLICT', 'Knowledge snapshot changed; incremental compilation conflict');
      const sources = await this.sources(space);
      const sourceById = new Map(sources.map(source => [source.id, source]));
      const validateCitations = (citations: KnowledgeCitation[]): void => {
        check(Array.isArray(citations) && citations.length > 0 && citations.length <= 200, 'Each knowledge item requires source references');
        for (const citation of citations) {
          check(citation && typeof citation === 'object', 'Knowledge source reference is invalid');
          identifier(citation.sourceId); versionNumber(citation.sourceVersion);
          const source = sourceById.get(citation.sourceId);
          check(source?.version === citation.sourceVersion, 'Knowledge citation references an outdated source version');
          const lines = source.text.split('\n');
          check(Number.isSafeInteger(citation.startLine) && Number.isSafeInteger(citation.endLine) && citation.startLine >= 1 && citation.endLine >= citation.startLine && citation.endLine <= lines.length, 'Knowledge citation line range is invalid');
          check(lines.slice(citation.startLine - 1, citation.endLine).join('\n').trim(), 'Knowledge citation contains no evidence');
        }
      };
      check(!sources.length || compilation.compilationTrace?.revision === 'strict-incremental-v1' || (compilation.entries.length > 0 && compilation.overview.length > 0), 'Knowledge compilation is incomplete');
      const entryIds = new Set<string>();
      for (const entry of compilation.entries) {
        identifier(entry.id); check(!entryIds.has(entry.id), 'Duplicate knowledge entry ID'); entryIds.add(entry.id);
        bounded(entry.title, 'Knowledge title', 1_600); bounded(entry.content, 'Knowledge content', 256_000);
        validateCitations(entry.citations);
      }
      const overviewIds = new Set<string>();
      const covered = new Set<string>();
      check(Buffer.byteLength(JSON.stringify(compilation.overview)) <= 32_000, 'Knowledge overview is too large');
      for (const item of compilation.overview) {
        identifier(item.id); check(!overviewIds.has(item.id), 'Duplicate overview ID'); overviewIds.add(item.id);
        bounded(item.title, 'Overview title', 1_600); bounded(item.summary, 'Overview summary', 6_000);
        check(Array.isArray(item.entryIds) && item.entryIds.length > 0 && item.entryIds.length <= 500, 'Each overview requires knowledge references');
        for (const id of item.entryIds) { check(entryIds.has(id), 'Overview has a dangling knowledge reference'); covered.add(id); }
      }
      check([...entryIds].every(id => covered.has(id)), 'Knowledge compilation is incomplete: every entry needs an overview reference');
      if (compilation.conceptGraph !== undefined) {
        const graph = compilation.conceptGraph;
        check(graph && graph.schemaVersion === 1 && Array.isArray(graph.concepts) && Array.isArray(graph.relations), 'Knowledge concept graph is incomplete');
        check(graph.concepts.length <= 500 && graph.relations.length <= 1_500 && Buffer.byteLength(JSON.stringify(graph)) <= 1_000_000, 'Knowledge concept graph is too large');
        const conceptIds = new Set<string>();
        const graphIds = new Set<string>();
        const names = new Set<string>();
        const normalized = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase();
        const entryById = new Map(compilation.entries.map(entry => [entry.id, entry]));
        const validateEvidence = (item: { entryIds: string[]; citations: KnowledgeCitation[] }): void => {
          check(Array.isArray(item.entryIds) && item.entryIds.length > 0 && item.entryIds.length <= 500, 'Each graph item requires knowledge references');
          check(new Set(item.entryIds).size === item.entryIds.length, 'Duplicate graph knowledge reference');
          for (const id of item.entryIds) check(entryIds.has(id), 'Graph has a dangling knowledge reference');
          validateCitations(item.citations);
          for (const citation of item.citations) {
            check(item.entryIds.some(id => entryById.get(id)!.citations.some(reference => reference.sourceId === citation.sourceId && reference.sourceVersion === citation.sourceVersion && reference.startLine <= citation.startLine && reference.endLine >= citation.endLine)), 'Graph evidence is not supported by its knowledge references');
          }
        };
        for (const concept of graph.concepts) {
          check(concept && typeof concept === 'object', 'Invalid knowledge concept');
          identifier(concept.id); check(!graphIds.has(concept.id), 'Duplicate graph ID'); graphIds.add(concept.id); conceptIds.add(concept.id);
          bounded(concept.name, 'Concept name', 512); bounded(concept.summary, 'Concept summary', 8_000);
          check(concept.kind === undefined || concept.kind === 'entity' || concept.kind === 'concept', 'Concept page kind must be entity or concept');
          check(concept.aliases === undefined || (Array.isArray(concept.aliases) && concept.aliases.length <= 20), 'Concept aliases are invalid or too large');
          for (const name of [concept.name, ...(concept.aliases ?? [])]) {
            bounded(name, 'Concept alias', 512);
            const key = normalized(name);
            check(!names.has(key), 'Duplicate concept name or alias; merge synonymous concepts'); names.add(key);
          }
          validateEvidence(concept);
        }
        const relations = new Set<string>();
        for (const relation of graph.relations) {
          check(relation && typeof relation === 'object', 'Invalid knowledge relation');
          identifier(relation.id); check(!graphIds.has(relation.id), 'Duplicate graph ID'); graphIds.add(relation.id);
          check(conceptIds.has(relation.sourceId) && conceptIds.has(relation.targetId), 'Relation has a dangling concept reference');
          check(relation.sourceId !== relation.targetId, 'Concept relations cannot be self-referential');
          bounded(relation.predicate, 'Relation predicate', 160);
          if (relation.summary !== undefined) bounded(relation.summary, 'Relation summary', 4_000);
          check(relation.basis === 'explicit' || relation.basis === 'inferred', 'Relation basis must be explicit or inferred');
          const key = JSON.stringify([relation.sourceId, relation.targetId, normalized(relation.predicate)]);
          check(!relations.has(key), 'Duplicate concept relation'); relations.add(key);
          validateEvidence(relation);
        }
      }
      const previous = await this.manifest(space);
      const version = Math.max(await this.nextVersion(join(path, 'B-knowledge'), previous?.version), await this.nextVersion(join(path, 'C-overview'), previous?.version));
      const manifest = { version, sourceFingerprint: actualFingerprint, createdAt: new Date().toISOString(), status: 'candidate' as const, sourceManifest: sources.map(({ id, version, hash, verified }) => ({ id, version, hash, verified })), ...(compilation.compilationTrace ? { compilationTrace: compilation.compilationTrace } : {}) };
      // Immutable files become visible together only through this final atomic manifest replacement.
      signal?.throwIfAborted();
      await this.write(join(path, 'B-knowledge', `v${version}.json`), compilation.entries);
      signal?.throwIfAborted();
      const storedOverview: StoredOverview = compilation.conceptGraph
        ? { schemaVersion: 1, overview: compilation.overview, conceptGraph: compilation.conceptGraph }
        : compilation.overview;
      await this.write(join(path, 'C-overview', `v${version}.json`), storedOverview);
      if (compilation.compilationTrace) await this.write(join(path, 'compilation-traces', `v${version}.json`), accountingTrace(compilation.compilationTrace));
      signal?.throwIfAborted();
      await this.write(join(path, 'snapshot.json'), { ...manifest, publishedVersions: [...(previous?.publishedVersions ?? []), version] }, signal);
      return { ...compilation, ...manifest };
    });
  }

  /** Only data projections live in a knowledge space; the shared program stays in the package. */
  async publishWikiProjection(space: KnowledgeSpace, view: Omit<WikiLibraryView, 'status'>, sourceFingerprint: string, canWrite?: WriteGuard, activeFingerprint = sourceFingerprint): Promise<void> {
    versionNumber(view.version);
    check(view.schemaVersion === 1 && view.graph?.kind === 'semantic' && typeof view.spaceId === 'string' && Array.isArray(view.pages) && view.pages.length <= 6_500, 'Invalid semantic Wiki projection');
    check(Buffer.byteLength(JSON.stringify(view)) <= 16_000_000, 'Wiki projection is too large');
    const paths = new Set<string>();
    for (const page of view.pages) {
      check(typeof page.path === 'string' && /^wiki\/(?:[A-Za-z0-9_-]+\/){0,2}[A-Za-z0-9_-]+\.md$/.test(page.path) && !paths.has(page.path), 'Unsafe or duplicate Wiki page path');
      paths.add(page.path);
      bounded(page.markdown, 'Wiki Markdown', 2_000_000);
    }
    await this.locked(async () => {
      const snapshot = await this.snapshot(space);
      check(snapshot?.version === view.version && snapshot.sourceFingerprint === sourceFingerprint && await this.fingerprint(space) === activeFingerprint, 'Knowledge sources changed; Wiki projection conflict');
      const path = join(await this.spacePath(space), 'wiki', `v${view.version}`);
      const old = await this.json<{ sourceFingerprint: string; view: Omit<WikiLibraryView, 'status'> }>(join(path, 'projection.json'));
      if (old?.sourceFingerprint === sourceFingerprint && JSON.stringify(old.view) === JSON.stringify(view)) return;
      for (const page of view.pages) await this.writeText(join(path, page.path), page.markdown, undefined, canWrite);
      // This is a derived cache; the immutable B/C snapshot remains the authority.
      await this.write(join(path, 'projection.json'), { sourceFingerprint, view }, undefined, canWrite);
    }, canWrite);
  }

  async read(space: KnowledgeSpace, layer: 'A' | 'B', id: string, version?: number): Promise<unknown> {
    identifier(id); if (version !== undefined) versionNumber(version);
    await this.ensure(space);
    const path = await this.spacePath(space);
    if (layer === 'A') {
      const index = await this.index(path);
      const currentVersion = Object.hasOwn(index, id) ? index[id] : undefined;
      const sourceVersion = version ?? currentVersion;
      if (sourceVersion === undefined) throw notFound('Knowledge source was not found');
      return this.source(path, id, sourceVersion, sourceVersion === currentVersion);
    }
    check(layer === 'B', 'Invalid knowledge layer');
    const manifest = await this.manifest(space);
    const snapshotVersion = version ?? manifest?.version;
    if (snapshotVersion === undefined) throw notFound('Knowledge snapshot was not found');
    if (!manifest?.publishedVersions.includes(snapshotVersion)) throw notFound('Knowledge snapshot version was not published');
    const entries = await this.json<KnowledgeCompilation['entries']>(join(path, 'B-knowledge', `v${snapshotVersion}.json`));
    check(Array.isArray(entries), 'Published knowledge snapshot is incomplete');
    const entry = entries.find(entry => entry.id === id);
    if (!entry) throw notFound('Knowledge entry was not found');
    const activeSources = await this.index(path);
    check(entry.citations.every(citation => Object.hasOwn(activeSources, citation.sourceId)), 'Knowledge source withdrawn; entry requires recompilation');
    return entry;
  }

  async overview(space: KnowledgeSpace): Promise<string> {
    const snapshot = await this.snapshot(space);
    if (!snapshot) return '';
    const stale = await this.fingerprint(space) !== snapshot.sourceFingerprint;
    return [`Knowledge snapshot v${snapshot.version} (candidate; source fingerprint ${snapshot.sourceFingerprint})${stale ? '\nSources changed after this snapshot; relevant knowledge requires verification against current A sources.' : ''}`, ...snapshot.overview.map(item => `\n## ${item.title} [${item.id}]\n${item.summary}\nReferences: ${item.entryIds.map(id => `B:${id}@v${snapshot.version}`).join(', ')}`)].join('\n');
  }
}
