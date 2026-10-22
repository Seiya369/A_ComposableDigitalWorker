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
  return { entries: [{ categoryId: request.policy?.categories[0]?.id, id: 'cash-detail', title: '现金流方法', content: '现金流假设须核对原始资料。',
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

test('employee compilation receives professional rules and stable declared categories rather than generic source categories', async t => {
  const f = await fixture(t);
  const modules = structuredClone(f.employee.modules);
  modules.knowledge.organization = { version: 1, profession: '现金流分析师', taskScope: '现金流预测与复核', conceptRules: '回款与收入必须区分。',
    categories: [{ id: 'cash-cycle', title: '现金周期', description: '保留周转口径与条件' }] };
  await f.store.updateEmployee(f.employee.id, { modules });
  await f.engine.prepareFor(f.store.snapshot().employees.find(employee => employee.id === f.employee.id)!);
  await f.engine.flush();
  const own = f.calls.findLast(request => request.space.memberId === f.employee.id)!;
  assert.equal(own.policy?.profession, '现金流分析师');
  assert.match(own.policy?.conceptRules ?? '', /回款与收入必须区分/);
  assert.deepEqual(own.policy?.categories.map(category => category.id), ['cash-cycle']);
  assert.match(JSON.stringify(own.policy), /现金流预测/);
  const shared = f.calls.findLast(request => request.space.kind === 'project' && !request.space.memberId)!;
  assert.ok(shared.policy?.categories.some(category => category.id.endsWith('-cash-cycle')));
  assert.doesNotMatch(JSON.stringify(shared.policy), /回款与收入必须区分|现金流分析师|现金流预测与复核/);
});

test('publication binds B categories and each historical snapshot to the policy used to compile it', async t => {
  const f = await fixture(t);
  await f.engine.prepareFor(f.employee);
  const request = f.calls.findLast(item => item.space.memberId === f.employee.id)!;
  const original = compiled(request); delete original.entries[0]!.categoryId;
  const fingerprint = await f.repository.fingerprint(f.privateSpace);
  await assert.rejects(f.repository.publish(f.privateSpace, original, fingerprint, undefined, request.policy), /分类|category/i);
  original.entries[0]!.categoryId = request.policy.categories[0]!.id;
  const first = await f.repository.publish(f.privateSpace, original, fingerprint, undefined, request.policy);
  const nextPolicy = structuredClone(request.policy); nextPolicy.categories[0]!.title = '修改显示名称';
  const second = await f.repository.publish(f.privateSpace, original, fingerprint, undefined, nextPolicy);
  assert.notEqual(first.policyFingerprint, second.policyFingerprint);
  assert.equal((await f.repository.snapshot(f.privateSpace, first.version))?.policy?.categories[0]!.title, request.policy.categories[0]!.title);
  assert.equal((await f.repository.snapshot(f.privateSpace, second.version))?.policy?.categories[0]!.title, '修改显示名称');
  original.entries[0]!.categoryId = 'unknown';
  await assert.rejects(f.repository.publish(f.privateSpace, original, fingerprint, undefined, request.policy), /分类|category/i);
  assert.equal((await f.repository.snapshot(f.privateSpace))?.version, second.version);
});

test('changing only professional policy recompiles B/C and preserves source versions', async t => {
  const f = await fixture(t);
  await f.engine.prepareFor(f.employee);
  const first = (await f.repository.snapshot(f.privateSpace))!;
  const sources = await f.repository.sources(f.privateSpace);
  const modules = structuredClone(f.employee.modules);
  modules.knowledge.organization = { version: 1, profession: '资金分析', taskScope: '', conceptRules: '同名现金流按项目消歧。',
    categories: [{ id: 'cash-cycle', title: '现金周期', description: '' }] };
  await f.store.updateEmployee(f.employee.id, { modules });
  await f.engine.flush();
  const next = (await f.repository.snapshot(f.privateSpace))!;
  assert.ok(next.version > first.version, 'policy changes must publish a new snapshot even when A is unchanged');
  assert.notEqual(next.policyFingerprint, first.policyFingerprint);
  assert.equal(next.entries[0]!.categoryId, 'cash-cycle');
  assert.deepEqual((await f.repository.sources(f.privateSpace)).map(source => [source.id, source.version, source.hash]), sources.map(source => [source.id, source.version, source.hash]));
});

test('failed policy recompilation hides default C/B but explicit history carries its own outdated identity', async t => {
  const f = await fixture(t, async request => {
    if (request.policy.profession === '新专业') throw new Error('合成编纂失败');
    return compiled(request);
  });
  await f.engine.prepareFor(f.employee);
  const previous = (await f.repository.snapshot(f.privateSpace))!;
  const modules = structuredClone(f.employee.modules);
  modules.knowledge.organization = { version: 1, profession: '新专业', taskScope: '', conceptRules: '新规则', categories: [] };
  const current = await f.store.updateEmployee(f.employee.id, { modules });
  await f.engine.flush();
  assert.equal((await f.repository.snapshot(f.privateSpace))!.version, previous.version);
  assert.ok(f.errors.some(error => String(error).includes('合成编纂失败')));
  const overview = await f.engine.overviewDocumentsFor(current);
  assert.ok(overview.some(document => document.id.startsWith('pending:')));
  assert.ok(!overview.some(document => document.id === 'cash-map'));
  assert.deepEqual(await f.engine.searchFor(current, '现金流', 'B'), []);
  await assert.rejects(f.engine.readFor(current, 'B', 'cash-detail', undefined, 'employee'), /政策|重编/);
  const historical = await f.engine.readFor(current, 'B', 'cash-detail', previous.version, 'employee') as any;
  assert.equal(historical.policyStatus, 'outdated');
  assert.equal(historical.policyFingerprint, previous.policyFingerprint);
  assert.equal(historical.stale, true);
});

test('default categories use professional duty identities and shared member namespaces without private rule text', async t => {
  const f = await fixture(t);
  await f.engine.prepareFor(f.employee);
  const request = f.calls.findLast(item => item.space.memberId === f.employee.id)!;
  assert.equal(request.policy.categories[0]!.title, '现金流预测');
  assert.match(request.policy.categories[0]!.id, /^duty-[a-f0-9]{12}$/);
  assert.ok(request.policy.categories.some(category => category.id === 'professional-foundations'));
  assert.ok(request.policy.categories.some(category => category.id === 'task-experience'));
  const firstId = request.policy.categories[0]!.id;
  const modules = structuredClone(f.employee.modules); modules.responsibilities.duties = ['现金流预测', '成本分析'];
  await f.store.updateEmployee(f.employee.id, { modules }); await f.engine.flush();
  assert.equal(f.calls.findLast(item => item.space.memberId === f.employee.id)!.policy.categories[0]!.id, firstId);
});
