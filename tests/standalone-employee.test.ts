import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkforceStore } from '../src/domain/store.js';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'standalone-employee-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await WorkforceStore.open(join(root, 'state.json'));
  const project = await store.saveProject({ name: 'Chat', rootPath: root });
  const template = store.snapshot().templates.find(item => item.status === 'ready')!;
  return { store, project, template };
}

test('concurrent standalone mentions create one independent employee and preserve its configuration on reuse', async t => {
  const { store, project, template } = await fixture(t);
  const input = { projectId: project.id, templateId: template.id };
  const results = await Promise.all(Array.from({ length: 5 }, () => store.ensureStandaloneEmployee(input)));
  assert.equal(new Set(results.map(employee => employee.id)).size, 1);
  assert.equal(store.snapshot().employees.length, 1);
  assert.equal(results[0]!.teamInstanceId, undefined);
  assert.equal(results[0]!.managerId, undefined);
  const modules = structuredClone(template.modules);
  modules.responsibilities.mission = 'CUSTOM_STANDALONE_MISSION';
  await store.updateEmployee(results[0]!.id, { modules });
  const before = await readFile(store.filePath, 'utf8');
  const reused = await store.ensureStandaloneEmployee(input);
  assert.equal(await readFile(store.filePath, 'utf8'), before, 'reuse is read-only');
  assert.equal(reused.modules.responsibilities.mission, 'CUSTOM_STANDALONE_MISSION');
  assert.equal(store.snapshot().projectTeams?.length ?? 0, 0);
  assert.equal(store.snapshot().conversationWorkflows?.instances.length ?? 0, 0);
});

test('standalone mention never adopts a workflow team member or bypasses a paused standalone employee', async t => {
  const { store, project, template } = await fixture(t);
  const team = await store.saveTeam({ name: 'Existing team', members: [{ memberId: 'lead', templateId: template.id }] });
  await store.instantiateTeam(project.id, team.id);
  const teamEmployee = store.snapshot().employees[0]!;
  const standalone = await store.ensureStandaloneEmployee({ projectId: project.id, templateId: template.id });
  assert.notEqual(standalone.id, teamEmployee.id);
  await store.updateEmployee(standalone.id, { status: 'paused' });
  const before = await readFile(store.filePath, 'utf8');
  await assert.rejects(store.ensureStandaloneEmployee({ projectId: project.id, templateId: template.id }), /暂停|停用/);
  assert.equal(await readFile(store.filePath, 'utf8'), before);
});

test('draft or archived templates and unknown projects cannot create a standalone mention employee', async t => {
  const { store, project, template } = await fixture(t);
  const draft = await store.saveTemplate({ name: 'Draft', modules: template.modules, status: 'draft' });
  const archived = await store.saveTemplate({ name: 'Archived', modules: template.modules, status: 'archived' });
  const before = await readFile(store.filePath, 'utf8');
  for (const templateId of [draft.id, archived.id]) await assert.rejects(store.ensureStandaloneEmployee({ projectId: project.id, templateId }));
  await assert.rejects(store.ensureStandaloneEmployee({ projectId: 'unknown', templateId: template.id }));
  assert.equal(await readFile(store.filePath, 'utf8'), before);
});
