import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { KnowledgeCompilation, KnowledgeInput, KnowledgeSnapshot, KnowledgeSource, KnowledgeSpace } from './types.js';

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
type SnapshotManifest = Omit<KnowledgeSnapshot, keyof KnowledgeCompilation> & { publishedVersions: number[] };
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

export const knowledgeRootFor = (statePath: string): string => resolve(dirname(statePath), 'knowledge', basename(statePath));

/** File storage owned only by this plugin. Model-authored knowledge is never an acceptance decision. */
export class KnowledgeRepository {
  readonly rootPath: string;
  constructor(rootPath: string) { this.rootPath = resolve(rootPath); }

  private spacePath(space: KnowledgeSpace): string {
    check(space && (space.kind === 'template' || space.kind === 'project'), 'Invalid knowledge space');
    const teamId = component(space.teamId);
    check(space.kind !== 'template' || space.projectId === undefined, 'Template knowledge cannot belong to a project');
    const base = space.kind === 'project'
      ? join(this.rootPath, 'projects', component(space.projectId), 'teams', teamId)
      : join(this.rootPath, 'templates', teamId);
    return space.memberId === undefined ? join(base, 'team') : join(base, 'employees', component(space.memberId));
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
      check((await file.stat()).size <= 12_000_000, 'Knowledge file is too large');
      return JSON.parse(await file.readFile('utf8')) as T;
    } finally { await file.close(); }
  }

  private async write(path: string, value: unknown, signal?: AbortSignal, canWrite?: WriteGuard): Promise<void> {
    assertWritable(canWrite);
    await this.directory(dirname(path));
    await this.safe(path);
    const temporary = join(dirname(path), `.pending-${randomUUID()}`);
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
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
    const path = this.spacePath(space);
    await this.root();
    for (const layer of ['A-sources', 'B-knowledge', 'C-overview']) await this.directory(join(path, layer));
  }

  private async seedMarker(space: KnowledgeSpace): Promise<SeedMarker | undefined> {
    check(space.kind === 'project', 'Template seeding is only available for project knowledge spaces');
    await this.ensure(space);
    const marker = await this.json<SeedMarker>(join(this.spacePath(space), 'seed.json'));
    if (marker) {
      check(marker.schemaVersion === 1 && marker.from && typeof marker.createdAt === 'string', 'Invalid knowledge seed marker');
      component(marker.from.teamId); versionNumber(marker.from.version);
    }
    return marker;
  }

  async isSeeded(space: KnowledgeSpace): Promise<boolean> { return !!await this.seedMarker(space); }

  /** Mark even an empty initial copy so later template edits cannot silently seed an existing project. */
  async markSeeded(space: KnowledgeSpace, from: { teamId: string; version: number }, canWrite?: WriteGuard): Promise<void> {
    check(space.kind === 'project', 'Template seeding is only available for project knowledge spaces');
    from = { teamId: component(from.teamId), version: versionNumber(from.version) };
    return this.locked(async () => {
      const marker = await this.seedMarker(space);
      if (marker) {
        check(marker.from.teamId === from.teamId && marker.from.version === from.version, 'Knowledge seed already initialized from another template version');
        return;
      }
      await this.write(join(this.spacePath(space), 'seed.json'), { schemaVersion: 1, from, createdAt: new Date().toISOString() } satisfies SeedMarker, undefined, canWrite);
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
    const path = this.spacePath(space);
    return this.locked(async () => {
      await this.ensure(space);
      const index = await this.index(path);
      const oldVersion = Object.hasOwn(index, input.id) ? index[input.id] : undefined;
      const old = oldVersion ? await this.source(path, input.id, oldVersion, true) : undefined;
      const hash = sha(input.content);
      if (old?.hash === hash && old.verified === input.verified && old.provenance === input.provenance && old.title === input.title) return old;
      check(oldVersion !== undefined || Object.keys(index).length < 2_000, 'Knowledge source count is too large');
      const processing: string[] = [];
      let text = input.content;
      if (text.startsWith('\uFEFF')) { text = text.slice(1); processing.push('Removed leading BOM from reading text; original retained.'); }
      if (text.includes('\r')) { text = text.replace(/\r\n?/g, '\n'); processing.push('Normalized line endings to LF in reading text.'); }
      if (text.includes('\0')) { text = text.replace(/\0/g, '[U+0000]'); processing.push('Marked NUL characters as [U+0000] in reading text.'); }
      if (!processing.length) processing.push('Original text retained without semantic edits.');
      const source: KnowledgeSource = { ...input, version: await this.nextVersion(sourceDirectory(path, input.id), oldVersion), hash, text, processing, createdAt: new Date().toISOString() };
      await this.write(join(sourceDirectory(path, input.id), `v${source.version}.json`), source, undefined, canWrite);
      Object.defineProperty(index, input.id, { value: source.version, enumerable: true, writable: true, configurable: true });
      await this.write(join(path, 'A-sources', 'index.json'), index, undefined, canWrite);
      return source;
    }, canWrite);
  }

  /** Withdraw active material without deleting the source versions needed for an audit. */
  async retire(space: KnowledgeSpace, id: string, canWrite?: WriteGuard): Promise<void> {
    identifier(id);
    const path = this.spacePath(space);
    return this.locked(async () => {
      await this.ensure(space);
      const index = await this.index(path);
      if (!Object.hasOwn(index, id)) return;
      delete index[id];
      await this.write(join(path, 'A-sources', 'index.json'), index, undefined, canWrite);
    }, canWrite);
  }

  private async source(path: string, id: string, version: number, required = false): Promise<KnowledgeSource> {
    const source = await this.json<KnowledgeSource>(join(sourceDirectory(path, id), `v${versionNumber(version)}.json`));
    if (!source && !required) throw notFound('Knowledge source was not found');
    check(source && source.id === id && source.version === version && typeof source.text === 'string' && source.hash === sha(source.content), 'Knowledge source is missing or corrupt');
    return source;
  }

  async sources(space: KnowledgeSpace): Promise<KnowledgeSource[]> {
    await this.ensure(space);
    const path = this.spacePath(space);
    const index = await this.index(path);
    return Promise.all(Object.entries(index).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([id, version]) => this.source(path, id, version, true)));
  }

  async fingerprint(space: KnowledgeSpace): Promise<string> {
    const sources = await this.sources(space);
    return sha(JSON.stringify(sources.map(source => [source.id, source.version, source.hash, source.verified])));
  }

  private async manifest(space: KnowledgeSpace): Promise<SnapshotManifest | undefined> {
    await this.ensure(space);
    const value = await this.json<SnapshotManifest>(join(this.spacePath(space), 'snapshot.json'));
    if (value) {
      versionNumber(value.version); check(value.status === 'candidate', 'Invalid knowledge snapshot status');
      check(Array.isArray(value.publishedVersions) && value.publishedVersions.includes(value.version), 'Knowledge snapshot publication history is incomplete');
      value.publishedVersions.forEach(versionNumber);
    }
    return value;
  }

  async snapshot(space: KnowledgeSpace): Promise<KnowledgeSnapshot | undefined> {
    const manifest = await this.manifest(space);
    if (!manifest) return undefined;
    const path = this.spacePath(space);
    const entries = await this.json<KnowledgeCompilation['entries']>(join(path, 'B-knowledge', `v${manifest.version}.json`));
    const overview = await this.json<KnowledgeCompilation['overview']>(join(path, 'C-overview', `v${manifest.version}.json`));
    check(Array.isArray(entries) && Array.isArray(overview), 'Knowledge snapshot is incomplete');
    return { version: manifest.version, sourceFingerprint: manifest.sourceFingerprint, createdAt: manifest.createdAt, status: 'candidate', entries, overview };
  }

  async publish(space: KnowledgeSpace, compilation: KnowledgeCompilation, expectedSourceFingerprint: string, signal?: AbortSignal): Promise<KnowledgeSnapshot> {
    signal?.throwIfAborted();
    compilation = structuredClone(compilation);
    check(compilation && Array.isArray(compilation.entries) && Array.isArray(compilation.overview), 'Knowledge compilation is incomplete');
    check(Buffer.byteLength(JSON.stringify(compilation)) <= 2_000_000 && compilation.entries.length <= 500 && compilation.overview.length <= 200, 'Knowledge compilation is too large');
    return this.locked(async () => {
      signal?.throwIfAborted();
      await this.ensure(space);
      const path = this.spacePath(space);
      const actualFingerprint = await this.fingerprint(space);
      check(actualFingerprint === expectedSourceFingerprint, 'Knowledge sources changed; compilation conflict');
      const sources = await this.sources(space);
      const sourceVersions = new Map(sources.map(source => [source.id, source.version]));
      check(!sources.length || (compilation.entries.length > 0 && compilation.overview.length > 0), 'Knowledge compilation is incomplete');
      const entryIds = new Set<string>();
      for (const entry of compilation.entries) {
        identifier(entry.id); check(!entryIds.has(entry.id), 'Duplicate knowledge entry ID'); entryIds.add(entry.id);
        bounded(entry.title, 'Knowledge title', 1_600); bounded(entry.content, 'Knowledge content', 256_000);
        check(Array.isArray(entry.citations) && entry.citations.length > 0 && entry.citations.length <= 200, 'Each knowledge entry requires source references');
        for (const citation of entry.citations) {
          identifier(citation.sourceId); versionNumber(citation.sourceVersion);
          check(sourceVersions.get(citation.sourceId) === citation.sourceVersion, 'Knowledge citation references an outdated source version');
          const source = await this.source(path, citation.sourceId, citation.sourceVersion, true);
          check(Number.isSafeInteger(citation.startLine) && Number.isSafeInteger(citation.endLine) && citation.startLine >= 1 && citation.endLine >= citation.startLine && citation.endLine <= source.text.split('\n').length, 'Knowledge citation line range is invalid');
        }
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
      const previous = await this.manifest(space);
      const version = Math.max(await this.nextVersion(join(path, 'B-knowledge'), previous?.version), await this.nextVersion(join(path, 'C-overview'), previous?.version));
      const manifest = { version, sourceFingerprint: actualFingerprint, createdAt: new Date().toISOString(), status: 'candidate' as const };
      // Immutable files become visible together only through this final atomic manifest replacement.
      signal?.throwIfAborted();
      await this.write(join(path, 'B-knowledge', `v${version}.json`), compilation.entries);
      signal?.throwIfAborted();
      await this.write(join(path, 'C-overview', `v${version}.json`), compilation.overview);
      signal?.throwIfAborted();
      await this.write(join(path, 'snapshot.json'), { ...manifest, publishedVersions: [...(previous?.publishedVersions ?? []), version] }, signal);
      return { ...compilation, ...manifest };
    });
  }

  async read(space: KnowledgeSpace, layer: 'A' | 'B', id: string, version?: number): Promise<unknown> {
    identifier(id); if (version !== undefined) versionNumber(version);
    await this.ensure(space);
    const path = this.spacePath(space);
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
