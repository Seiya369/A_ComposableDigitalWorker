import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkforceStore } from '../src/domain/store.js';
import { createBlankModules } from '../src/domain/seed.js';
import { KnowledgeEngine } from '../src/knowledge/engine.js';
import { KnowledgeRepository } from '../src/knowledge/repository.js';
import type { KnowledgeCompilation, KnowledgeCompileRequest, KnowledgeCompiler } from '../src/knowledge/types.js';

function compiled(request: KnowledgeCompileRequest): KnowledgeCompilation {
  return { entries: [{ id: 'cash-detail', title: '现金流方法', content: '现金流假设须核对原始资料。',
    citations: request.sources.map(source => ({ sourceId: source.id, sourceVersion: source.version, startLine: 1, endLine: 1 })) }],
    overview: [{ id: 'cash-map', title: '现金流', summary: '候选方法，先检查适用条件。', entryIds: ['cash-detail'] }] };
}
async function fixture(t: { after(fn: () => Promise<void>): void }, compiler: KnowledgeCompiler = async request => compiled(request)) {
  const root = await mkdtemp(join(tmpdir(), 'workforce-organization-'));
  const store = await WorkforceStore.open(join(root, 'state.json'));
  const modules = createBlankModules();
  modules.responsibilities = { mission: '财务分析', duties: ['现金流预测'], boundaries: ['不代替人工批准'] };
  modules.delivery.acceptanceCriteria = ['引用原始资料'];
  modules.model = { mode: 'override', provider: 'fixture', model: 'leader' };
  modules.knowledge.sources = [{ id: 'cash', title: '现金流资料', kind: 'text', value: '未核验现金流观察。' }];
  const template = await store.saveTemplate({ name: '财务员工', status: 'ready', modules });
  const team = await store.saveTeam({ name: '财务团队', description: '财务目标与核验要求', members: [{ memberId: 'lead', templateId: template.id }] });
  const project = await store.saveProject({ name: '合成项目', rootPath: root });
  const installed = await store.configureProjectTeam({ projectId: project.id, teamId: team.id, teamVersion: team.version, templateVersions: { [template.id]: template.version } });
  const employee = store.snapshot().employees[0]!;
  const repository = new KnowledgeRepository(join(root, 'knowledge'));
  const calls: KnowledgeCompileRequest[] = []; const errors: unknown[] = [];
  const engine = new KnowledgeEngine(store, repository, async request => { calls.push(request); return compiler(request); }, error => errors.push(error));
  t.after(async () => { await engine.dispose(); await rm(root, { force: true, recursive: true }); });
  await engine.start();
  return { store, repository, engine, employee, calls, errors, space: { kind: 'project' as const, projectId: project.id, teamId: installed.id },
    privateSpace: { kind: 'project' as const, projectId: project.id, teamId: installed.id, memberId: employee.id } };
}

test('librarian assigns source categories by trusted record kind rather than guessing from titles', async t => {
  const f = await fixture(t);
  const failed = await f.store.createRun({ projectId: f.employee.projectId, employeeId: f.employee.id, request: '合成失败任务' });
  await f.store.updateRun(failed.id, { status: 'failed', error: '没有观察到因果依据' });
  const pending = await f.store.createRun({ projectId: f.employee.projectId, employeeId: f.employee.id, request: '合成待验收任务' });
  await f.store.updateRun(pending.id, { status: 'running' });
  await f.store.updateRun(pending.id, { status: 'awaiting-review', output: '仍需验收' });
  const memory = await f.store.saveMemory({ projectId: f.employee.projectId, scope: 'employee', employeeId: f.employee.id,
    title: '偏好这个词不证明它是用户偏好', content: '一条通用专业记忆', source: { kind: 'user-confirmed', reference: '合成用户消息' } });
  await f.engine.flush();
  const sources = await f.repository.sources(f.privateSpace);
  assert.equal(sources.find(source => source.id === `run:${failed.id}`)?.category, 'incidents-reflections');
  assert.equal(sources.find(source => source.id === `run:${pending.id}`)?.category, 'task-evidence');
  assert.equal(sources.find(source => source.id === `memory:${memory.id}`)?.category, 'reference');
  assert.equal((await f.repository.sources(f.space)).find(source => source.id === 'team-description')?.category, 'requirements-decisions');
});
