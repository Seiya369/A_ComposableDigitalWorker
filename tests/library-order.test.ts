import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkforceStore } from '../src/domain/store.js';
import { createBlankModules } from '../src/domain/seed.js';
import { mergeVisibleOrder, type LibraryKind } from '../src/domain/library-order.js';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const directory = await mkdtemp(join(tmpdir(), 'workforce-library-order-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'state.json'), store = await WorkforceStore.open(file);
  const archived = await store.saveTemplate({ name: '归档位置', modules: createBlankModules() });
  await store.archiveTemplate(archived.id);
  await store.saveTemplate({ name: '可见 A', modules: createBlankModules() });
  await store.saveTemplate({ name: '可见 B', modules: createBlankModules() });
  const templateId = store.snapshot().templates[0]!.id;
  await store.saveTeam({ name: '团队 A', members: [{ memberId: 'root', templateId }, { memberId: 'child', templateId, reportsTo: 'root' }] });
  await store.saveTeam({ name: '团队 B', members: [] });
  for (const suffix of ['A', 'B', 'C']) await store.saveWorkflowTemplate({ name: `流程 ${suffix}`, roles: [{ id: 'role', name: '负责人' }], steps: [{ id: 'step', name: '执行', roleId: 'role', instruction: '执行并交付' }] });
  return { file, store, archived };
}
const idsFor = (state: ReturnType<WorkforceStore['snapshot']>, kind: LibraryKind) => (kind === 'employee' ? state.templates.filter(row => row.status !== 'archived') : kind === 'team' ? state.teams : state.workflowTemplates ?? []).map(row => row.id);

test('three libraries persist root order without changing entity versions, archived positions, hierarchy or instances', async t => {
  const { file, store, archived } = await fixture(t);
  const original = store.snapshot();
  const archivedIndex = original.templates.findIndex(row => row.id === archived.id);
  for (const kind of ['employee', 'team', 'workflow'] as const) {
    const before = store.snapshot(), orderedIds = idsFor(before, kind).reverse();
    await store.reorderLibrary({ kind, orderedIds }, { expectedRevision: before.revision });
    const after = store.snapshot();
    assert.deepEqual(idsFor(after, kind), orderedIds);
    assert.equal(after.revision, before.revision + 1);
    for (const key of ['templates', 'teams', 'workflowTemplates'] as const) {
      const canonical = (rows: typeof before[typeof key]) => [...rows ?? []].sort((a, b) => a.id.localeCompare(b.id));
      assert.deepEqual(canonical(after[key]), canonical(before[key]));
    }
    assert.deepEqual(after.projects, before.projects); assert.deepEqual(after.employees, before.employees); assert.deepEqual(after.runs, before.runs);
  }
  assert.deepEqual(store.snapshot().templates[archivedIndex], original.templates[archivedIndex]);
  assert.deepEqual((await WorkforceStore.open(file)).snapshot(), store.snapshot());
});

test('search reorders only visible occupied slots and leaves hidden positions unchanged', () => {
  assert.deepEqual(mergeVisibleOrder(['hidden-1', 'a', 'hidden-2', 'b', 'c', 'hidden-3'], ['c', 'a', 'b']), ['hidden-1', 'c', 'hidden-2', 'a', 'b', 'hidden-3']);
});

test('stale, incomplete, duplicate, foreign and malformed orders fail atomically', async t => {
  const { store, file, archived } = await fixture(t);
  const before = store.snapshot(), disk = await readFile(file, 'utf8'), ids = idsFor(before, 'employee');
  const invalid = [ids.slice(1), [...ids, ids[0]!], [...ids.slice(0, -1), archived.id], [...ids.slice(0, -1), before.teams[0]!.id], [null], 'not-an-array'];
  for (const orderedIds of invalid) await assert.rejects(store.reorderLibrary({ kind: 'employee', orderedIds } as never, { expectedRevision: before.revision }), { code: 'VALIDATION' });
  await assert.rejects(store.reorderLibrary({ kind: 'employee', orderedIds: ids }, {}), { code: 'VALIDATION' });
  await assert.rejects(store.reorderLibrary({ kind: 'invalid', orderedIds: ids } as never, { expectedRevision: before.revision }), { code: 'VALIDATION' });
  await assert.rejects(store.reorderLibrary({ kind: 'employee', orderedIds: ids }, { expectedRevision: before.revision - 1 }), { code: 'CONFLICT' });
  assert.deepEqual(store.snapshot(), before); assert.equal(await readFile(file, 'utf8'), disk);
  await store.reorderLibrary({ kind: 'employee', orderedIds: ids.reverse() }, { expectedRevision: before.revision });
  await assert.rejects(store.reorderLibrary({ kind: 'team', orderedIds: idsFor(before, 'team') }, { expectedRevision: before.revision }), { code: 'CONFLICT' });
});
