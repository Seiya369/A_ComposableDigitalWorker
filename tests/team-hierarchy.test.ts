import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTeamHierarchy, moveTeamMember, getEligibleTeamManagers, getSelectableTeamLevels, getTeamMemberLevel } from '../src/domain/team-hierarchy.js';
import { WorkforceStore } from '../src/domain/store.js';
import { ARCHITECT_TEMPLATE_ID } from '../src/domain/seed.js';
import type { TeamHierarchyNode } from '../src/domain/team-hierarchy.js';
import type { TeamMember } from '../src/domain/types.js';

function member(memberId: string, reportsTo?: string): TeamMember {
  return { memberId, templateId: 'shared-template', ...(reportsTo ? { reportsTo } : {}) };
}

function describe(nodes: TeamHierarchyNode[]): unknown[] {
  return nodes.map(node => ({ id: node.member.memberId, level: node.level, children: describe(node.children) }));
}

test('multiple roots and levels preserve member order regardless of input dependency order', () => {
  const members = [member('developer', 'lead'), member('product'), member('designer', 'product'), member('ops'), member('lead', 'product'), member('tester', 'lead')];
  const original = structuredClone(members);
  assert.deepEqual(describe(buildTeamHierarchy(members)), [
    { id: 'product', level: 1, children: [
      { id: 'designer', level: 2, children: [] },
      { id: 'lead', level: 2, children: [
        { id: 'developer', level: 3, children: [] },
        { id: 'tester', level: 3, children: [] },
      ] },
    ] },
    { id: 'ops', level: 1, children: [] },
  ]);
  assert.deepEqual(members, original);
});

test('employees using the same template remain distinct by memberId', () => {
  const members = [member('lead'), member('frontend', 'lead'), member('backend', 'lead')];
  const hierarchy = buildTeamHierarchy(members);
  assert.equal(hierarchy.length, 1);
  assert.deepEqual(hierarchy[0]!.children.map(node => node.member.memberId), ['frontend', 'backend']);
  assert.equal(getTeamMemberLevel(members, 'frontend'), 2);
  assert.equal(getTeamMemberLevel(members, 'backend'), 2);
});

test('changing a manager recalculates the whole descendant subtree', () => {
  const members = [member('product'), member('lead', 'product'), member('developer', 'lead'), member('tester', 'developer')];
  assert.equal(getTeamMemberLevel(members, 'tester'), 4);
  const moved = members.map(item => item.memberId === 'developer' ? { ...item, reportsTo: 'product' } : item);
  assert.equal(getTeamMemberLevel(moved, 'developer'), 2);
  assert.equal(getTeamMemberLevel(moved, 'tester'), 3);
  assert.equal(getTeamMemberLevel(moved, 'missing'), 0);
});

test('missing managers, self references and cycles remain visible without changing input', () => {
  const members = [member('child', 'b'), member('a', 'c'), member('orphan', 'missing'), member('b', 'a'), member('c', 'b'), member('self', 'self')];
  const original = structuredClone(members);
  assert.deepEqual(describe(buildTeamHierarchy(members)), [
    { id: 'a', level: 1, children: [{ id: 'b', level: 2, children: [
      { id: 'child', level: 3, children: [] },
      { id: 'c', level: 3, children: [] },
    ] }] },
    { id: 'orphan', level: 1, children: [] },
    { id: 'self', level: 1, children: [] },
  ]);
  assert.deepEqual(members, original);
});

test('manager choices exclude self and all descendants while retaining peers and ancestors', () => {
  const members = [member('product'), member('lead', 'product'), member('developer', 'lead'), member('tester', 'developer'), member('designer', 'product'), member('ops')];
  assert.deepEqual(getEligibleTeamManagers(members, 'lead').map(item => item.memberId), ['product', 'designer', 'ops']);
  assert.deepEqual(getEligibleTeamManagers(members, 'product').map(item => item.memberId), ['ops']);
  assert.deepEqual(getEligibleTeamManagers(members, 'new-member'), members);
});

test('manager filtering terminates on a cycle and excludes the entire dependent component', () => {
  const members = [member('a', 'b'), member('b', 'a'), member('child', 'a'), member('other')];
  assert.deepEqual(getEligibleTeamManagers(members, 'a').map(item => item.memberId), ['other']);
  assert.deepEqual(buildTeamHierarchy([]), []);
  assert.equal(getTeamMemberLevel([], 'absent'), 0);
  assert.deepEqual(getEligibleTeamManagers([], 'absent'), []);
});

test('a selected level limits managers to the immediately preceding level', () => {
  const members = [member('product'), member('lead', 'product'), member('developer', 'lead'), member('designer', 'product'), member('ops')];
  assert.deepEqual(getEligibleTeamManagers(members, 'new-member', 1), []);
  assert.deepEqual(getEligibleTeamManagers(members, 'new-member', 2).map(item => item.memberId), ['product', 'ops']);
  assert.deepEqual(getEligibleTeamManagers(members, 'new-member', 3).map(item => item.memberId), ['lead', 'designer']);
  assert.deepEqual(getEligibleTeamManagers(members, 'new-member', 4).map(item => item.memberId), ['developer']);
  assert.deepEqual(getEligibleTeamManagers(members, 'new-member', 5), []);
});

test('selecting a deeper level still excludes the employee and their entire subtree', () => {
  const members = [member('product'), member('lead', 'product'), member('developer', 'lead'), member('tester', 'developer'), member('designer', 'product')];
  assert.deepEqual(getEligibleTeamManagers(members, 'lead', 3).map(item => item.memberId), ['designer']);
  assert.deepEqual(getEligibleTeamManagers(members, 'lead', 4), []);
  assert.deepEqual(getEligibleTeamManagers(members, 'lead', 5), []);
  assert.deepEqual(getSelectableTeamLevels(members, 'lead'), [1, 2, 3]);
  assert.deepEqual(getSelectableTeamLevels(members, 'product'), [1]);
});

test('selectable levels cover empty teams, sole roots and new members', () => {
  assert.deepEqual(getSelectableTeamLevels([], 'new-member'), [1]);
  const members = [member('root')];
  assert.deepEqual(getSelectableTeamLevels(members, 'root'), [1]);
  assert.deepEqual(getSelectableTeamLevels(members, 'new-member'), [1, 2]);
  assert.deepEqual(getEligibleTeamManagers(members, 'root', 2), []);
  assert.deepEqual(getEligibleTeamManagers([], 'new-member', 2), []);
});

test('invalid duplicate member identities use the first member consistently', () => {
  const members = [member('root'), member('child', 'root'), { ...member('child'), name: 'Duplicate' }];
  assert.deepEqual(describe(buildTeamHierarchy(members)), [
    { id: 'root', level: 1, children: [{ id: 'child', level: 2, children: [] }] },
  ]);
  assert.deepEqual(getEligibleTeamManagers(members, 'other'), members.slice(0, 2));
});

test('deep reporting chains do not depend on the JavaScript recursion limit', () => {
  const members = Array.from({ length: 12_000 }, (_, index) => member(`member-${index}`, index ? `member-${index - 1}` : undefined));
  assert.equal(getTeamMemberLevel(members, 'member-11999'), 12_000);
  assert.deepEqual(getEligibleTeamManagers(members, 'member-0'), []);
  assert.deepEqual(getEligibleTeamManagers(members, 'new-member', 12_001).map(item => item.memberId), ['member-11999']);
  const selectable = getSelectableTeamLevels(members, 'member-11999');
  assert.equal(selectable.length, 12_000);
  assert.equal(selectable[0], 1);
  assert.equal(selectable.at(-1), 12_000);
});

async function storeFixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'workforce-team-hierarchy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'workforce.json');
  const store = await WorkforceStore.open(file);
  const members = [member('product'), member('lead', 'product'), member('developer', 'lead'), member('tester', 'developer')]
    .map(item => ({ ...item, templateId: ARCHITECT_TEMPLATE_ID }));
  const team = await store.saveTeam({ name: '测试软件开发团', members });
  return { file, store, team };
}

test('saved multilevel teams retain reporting relationships and derived levels after reopening', async t => {
  const { file, team } = await storeFixture(t);
  const reopened = await WorkforceStore.open(file);
  const persisted = reopened.snapshot().teams.find(item => item.id === team.id)!;
  assert.deepEqual(persisted.members, team.members);
  assert.equal(getTeamMemberLevel(persisted.members, 'tester'), 4);

  const movedMembers = persisted.members.map(item => item.memberId === 'developer' ? { ...item, reportsTo: 'product' } : item);
  const updated = await reopened.saveTeam({ ...persisted, members: movedMembers }, { expectedVersion: persisted.version });
  const reloaded = (await WorkforceStore.open(file)).snapshot().teams.find(item => item.id === team.id)!;
  assert.equal(reloaded.version, updated.version);
  assert.equal(reloaded.members.find(item => item.memberId === 'developer')!.reportsTo, 'product');
  assert.equal(getTeamMemberLevel(reloaded.members, 'tester'), 3);
});

test('a stale team editor cannot overwrite changes saved by another tab', async t => {
  const { file, store, team } = await storeFixture(t);
  const otherTab = await WorkforceStore.open(file);
  const updated = await otherTab.saveTeam({ ...team, name: '已由其他标签更新' }, { expectedVersion: team.version });
  await assert.rejects(store.saveTeam({ ...team, name: '过期草稿' }, { expectedVersion: team.version }), { code: 'CONFLICT' });
  await store.reload();
  const before = await readFile(file, 'utf8');
  await assert.rejects(store.saveTeam({ ...team, name: '过期草稿' }, { expectedVersion: team.version }), { code: 'CONFLICT' });
  assert.equal(await readFile(file, 'utf8'), before);
  assert.deepEqual(store.snapshot().teams.find(item => item.id === team.id), updated);
});

test('saving an old team draft after deletion cannot recreate the deleted team', async t => {
  const { file, store, team } = await storeFixture(t);
  const otherTab = await WorkforceStore.open(file);
  await otherTab.deleteTeam(team.id, { expectedVersion: team.version });
  await assert.rejects(store.saveTeam(team, { expectedVersion: team.version }), { code: 'CONFLICT' });
  await store.reload();
  const before = await readFile(file, 'utf8');
  const revision = store.snapshot().revision;
  await assert.rejects(store.saveTeam(team, { expectedVersion: team.version }), { code: 'NOT_FOUND' });
  assert.equal(store.snapshot().revision, revision);
  assert.equal(await readFile(file, 'utf8'), before);
  assert.equal((await WorkforceStore.open(file)).snapshot().teams.some(item => item.id === team.id), false);
});


test('dragging reorders siblings and retains the moved subtree without mutating input', () => {
  const original = [member('root'), member('lead', 'root'), member('dev', 'lead'), member('design', 'root')];
  const copy = structuredClone(original);
  const moved = moveTeamMember(original, 'lead', 'design', 'after')!;
  assert.deepEqual(buildTeamHierarchy(moved)[0]!.children.map(node => node.member.memberId), ['design', 'lead']);
  assert.equal(getTeamMemberLevel(moved, 'dev'), 3);
  assert.deepEqual(original, copy);
  const before = moveTeamMember(moved, 'lead', 'design', 'before')!;
  assert.deepEqual(buildTeamHierarchy(before)[0]!.children.map(node => node.member.memberId), ['lead', 'design']);
});

test('dropping inside changes hierarchy, and dropping on the team promotes a subtree', () => {
  const original = [member('root'), member('lead', 'root'), member('dev', 'lead'), member('design', 'root')];
  const nested = moveTeamMember(original, 'lead', 'design', 'inside')!;
  assert.equal(getTeamMemberLevel(nested, 'lead'), 3);
  assert.equal(getTeamMemberLevel(nested, 'dev'), 4);
  const promoted = moveTeamMember(nested, 'lead', undefined, 'inside')!;
  assert.equal(getTeamMemberLevel(promoted, 'lead'), 1);
  assert.equal(getTeamMemberLevel(promoted, 'dev'), 2);
  assert.equal(promoted.length, original.length);
});

test('dragging rejects missing members, self targets and descendant targets', () => {
  const members = [member('root'), member('lead', 'root'), member('dev', 'lead')];
  for (const position of ['before', 'inside', 'after'] as const) {
    assert.equal(moveTeamMember(members, 'lead', 'dev', position), null);
    assert.equal(moveTeamMember(members, 'lead', 'lead', position), null);
  }
  assert.equal(moveTeamMember(members, 'missing', 'root', 'inside'), null);
  assert.equal(moveTeamMember(members, 'lead', 'missing', 'inside'), null);
});
