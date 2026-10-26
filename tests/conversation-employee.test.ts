import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkforceStore } from '../src/domain/store.js';
import { assertNoAdditionalTemporaryEmployeeMention, conversationEmployeeChoices, employeeInfoCard, resolveConversationEmployee, resolveTemporaryEmployeeMention, temporaryEmployeeMentionAliases } from '../src/domain/conversation-employee.js';
import { isLegacyStandaloneRun } from '../src/domain/conversation-session.js';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'conversation-employee-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'Chat'));
  const store = await WorkforceStore.open(join(root, 'state.json'));
  const project = await store.saveProject({ name: 'Chat', rootPath: join(root, 'Chat') });
  const template = store.snapshot().templates.find(item => item.status === 'ready')!;
  const select = (sessionId = 'chat-a', version = 0) => store.setConversationEmployee({ projectId: project.id, sessionId, templateId: template.id, mode: 'consult' }, { expectedRevision: store.revision, expectedVersion: version });
  return { root, store, project, template, select };
}

test('resident employee defaults and roster reads remain empty and never instantiate a role', async t => {
  const { store, project } = await fixture(t);
  const before = await readFile(store.filePath, 'utf8');
  const view = resolveConversationEmployee(store.snapshot(), project.id, 'chat-a');
  assert.equal(view.conversationEmployee, null);
  assert.equal(view.employee, undefined);
  assert.ok(conversationEmployeeChoices(store.snapshot(), project.id).every(choice => choice.kind === 'template'));
  assert.equal(await readFile(store.filePath, 'utf8'), before);
  assert.equal(store.snapshot().conversationEmployees, undefined);
  assert.equal(store.snapshot().employees.length, 0);
});

test('explicit binding creates one standalone snapshot atomically and isolates other conversations', async t => {
  const { store, project, template, select } = await fixture(t);
  const first = await select();
  assert.equal(first.conversationEmployee?.version, 1);
  assert.equal(first.conversationEmployee?.mode, 'consult');
  assert.equal(first.employee?.teamInstanceId, undefined);
  assert.equal(first.employee?.managerId, undefined);
  assert.equal(resolveConversationEmployee(store.snapshot(), project.id, 'chat-b').conversationEmployee, null);
  const modules = structuredClone(template.modules); modules.responsibilities.mission = 'INSTANCE_ONLY_MISSION';
  await store.updateEmployee(first.employee!.id, { modules });
  const second = await select('chat-b');
  assert.equal(first.employee?.id, second.employee?.id);
  assert.equal(second.employee?.modules.responsibilities.mission, 'INSTANCE_ONLY_MISSION');
  assert.equal(store.snapshot().employees.length, 1);
  assert.equal(store.snapshot().projectTeams?.length ?? 0, 0);
  assert.equal(store.snapshot().conversationWorkflows?.instances.length ?? 0, 0);
  assert.equal(store.snapshot().runs.length, 0);
  const reopened = await WorkforceStore.open(store.filePath);
  assert.equal(resolveConversationEmployee(reopened.snapshot(), project.id, 'chat-a').employee?.id, first.employee?.id);
});

test('binding changes require both fresh CAS values and a single target; failed writes create nothing', async t => {
  const { store, project, template, select } = await fixture(t);
  const base = { projectId: project.id, sessionId: 'chat-a', templateId: template.id, mode: 'consult' as const };
  for (const options of [{}, { expectedRevision: store.revision }, { expectedVersion: 0 }]) await assert.rejects(store.setConversationEmployee(base, options), /版本/);
  const revision = store.revision;
  const first = await select();
  const before = await readFile(store.filePath, 'utf8');
  await assert.rejects(store.setConversationEmployee({ ...base, mode: 'execute' }, { expectedRevision: revision, expectedVersion: 1 }), { code: 'CONFLICT' });
  await assert.rejects(store.setConversationEmployee({ ...base, mode: 'execute' }, { expectedRevision: store.revision, expectedVersion: 0 }), { code: 'CONFLICT' });
  await assert.rejects(store.setConversationEmployee({ ...base, employeeId: first.employee!.id }, { expectedRevision: store.revision, expectedVersion: 1 }), /一个/);
  assert.equal(await readFile(store.filePath, 'utf8'), before);
  const switched = await store.setConversationEmployee({ projectId: project.id, sessionId: 'chat-a', employeeId: first.employee!.id, mode: 'execute' }, { expectedRevision: store.revision, expectedVersion: 1 });
  assert.equal(switched.conversationEmployee?.mode, 'execute');
  assert.equal(switched.conversationEmployee?.version, 2);
});

test('concurrent explicit choices cannot duplicate admission, and a resident attempt locks only its own binding', async t => {
  const { store, project, template } = await fixture(t);
  const options = { expectedRevision: store.revision, expectedVersion: 0 };
  const attempts = await Promise.allSettled(['chat-a', 'chat-b'].map(sessionId => store.setConversationEmployee({ projectId: project.id, sessionId, templateId: template.id, mode: 'consult' }, options)));
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(store.snapshot().employees.length, 1);
  const selected = attempts.find(result => result.status === 'fulfilled'); assert.ok(selected?.status === 'fulfilled');
  const owner = selected.value.conversationEmployee!;
  const otherSessionId = owner.sessionId === 'chat-a' ? 'chat-b' : 'chat-a';
  await store.setConversationEmployee({ projectId: project.id, sessionId: otherSessionId, templateId: template.id, mode: 'execute' }, { expectedRevision: store.revision, expectedVersion: 0 });
  const run = await store.createRun({ projectId: project.id, employeeId: owner.employeeId, request: '咨询中', conversationEmployee: { sessionId: owner.sessionId, mode: owner.mode, bindingVersion: owner.version } });
  await assert.rejects(store.clearConversationEmployee({ projectId: project.id, sessionId: owner.sessionId }, { expectedRevision: store.revision, expectedVersion: owner.version }), /执行/);
  await store.clearConversationEmployee({ projectId: project.id, sessionId: otherSessionId }, { expectedRevision: store.revision, expectedVersion: 1 });
  await store.updateRun(run.id, { status: 'cancelled' });
  await store.clearConversationEmployee({ projectId: project.id, sessionId: owner.sessionId }, { expectedRevision: store.revision, expectedVersion: owner.version });
  assert.equal(store.snapshot().employees.length, 1);
});

test('active detached instance survives source archival and stale run binding cannot be replayed', async t => {
  const { store, project, template, select } = await fixture(t); const selected = await select();
  await store.archiveTemplate(template.id);
  const rebound = await store.setConversationEmployee({ projectId: project.id, sessionId: 'chat-a', employeeId: selected.employee!.id, mode: 'execute' }, { expectedRevision: store.revision, expectedVersion: 1 });
  assert.equal(rebound.unavailableReason, undefined);
  assert.ok(conversationEmployeeChoices(store.snapshot(), project.id).some(choice => choice.kind === 'employee' && choice.id === selected.employee!.id));
  const before = await readFile(store.filePath, 'utf8');
  await assert.rejects(store.createRun({ projectId: project.id, employeeId: selected.employee!.id, request: '旧授权', conversationEmployee: { sessionId: 'chat-a', mode: 'consult', bindingVersion: 1 } }), { code: 'CONFLICT' });
  assert.equal(await readFile(store.filePath, 'utf8'), before);
});

test('paused and archived roles can exit residency without losing the employee or history', async t => {
  const { store, project, template, select } = await fixture(t);
  const selected = await select(); const employeeId = selected.employee!.id;
  await store.updateEmployee(employeeId, { status: 'paused' });
  await store.archiveTemplate(template.id);
  assert.match(resolveConversationEmployee(store.snapshot(), project.id, 'chat-a').unavailableReason!, /暂停/);
  await assert.rejects(store.setConversationEmployee({ projectId: project.id, sessionId: 'chat-b', templateId: template.id, mode: 'consult' }, { expectedRevision: store.revision, expectedVersion: 0 }));
  await assert.rejects(store.deleteEmployee(employeeId), /常驻/);
  const cleared = await store.clearConversationEmployee({ projectId: project.id, sessionId: 'chat-a' }, { expectedRevision: store.revision, expectedVersion: 1 });
  assert.equal(cleared.conversationEmployee, null);
  assert.equal(store.snapshot().employees.length, 1);
  assert.equal(store.snapshot().employees[0]!.status, 'paused');
});

test('roster and admission reject foreign and team employees and never bypass paused standalone roles', async t => {
  const { store, project, template, root, select } = await fixture(t);
  await mkdir(join(root, 'other')); const other = await store.saveProject({ name: 'Other', rootPath: join(root, 'other') });
  const foreign = await store.createEmployee({ projectId: other.id, templateId: template.id });
  const team = await store.saveTeam({ name: 'Team', members: [{ memberId: 'lead', templateId: template.id }] });
  const [member] = await store.instantiateTeam(project.id, team.id);
  for (const employeeId of [foreign.id, member!.id]) await assert.rejects(store.setConversationEmployee({ projectId: project.id, sessionId: 'chat-a', employeeId, mode: 'consult' }, { expectedRevision: store.revision, expectedVersion: 0 }));
  const selected = await select();
  await store.updateEmployee(selected.employee!.id, { status: 'paused' });
  const before = await readFile(store.filePath, 'utf8');
  await assert.rejects(select('chat-b'), /暂停/);
  assert.ok(!conversationEmployeeChoices(store.snapshot(), project.id).some(choice => choice.id === template.id || choice.id === selected.employee!.id));
  assert.equal(await readFile(store.filePath, 'utf8'), before);
});

test('safe local employee card omits identifiers, paths, model settings and knowledge content', async t => {
  const { template } = await fixture(t);
  template.modules.model = { mode: 'override', provider: 'PRIVATE_PROVIDER', model: 'PRIVATE_MODEL' };
  template.modules.knowledge.sources = [{ id: 'PRIVATE_SOURCE_ID', title: 'Private', kind: 'project-file', value: '/PRIVATE_PATH/knowledge' }];
  template.modules.permissions.readPaths = ['/PRIVATE_PATH/read'];
  template.modules.capabilities.skills = [{ id: 'PRIVATE_SKILL_ID', name: '专业技能', description: '可用技能' }];
  const card = employeeInfoCard(template);
  const text = JSON.stringify(card);
  assert.equal(card.name, template.name);
  assert.ok(text.includes('专业技能'));
  assert.ok(!/PRIVATE_|templateId|projectId|createdAt|version/.test(text));
});

test('resident run link is persisted, validated and excluded from standalone delivery classification', async t => {
  const { store, project, select } = await fixture(t); const selected = await select();
  const run = await store.createRun({ projectId: project.id, employeeId: selected.employee!.id, request: '咨询', conversationEmployee: { sessionId: 'chat-a', mode: 'consult', bindingVersion: 1 } });
  assert.equal(run.conversationEmployee?.bindingVersion, 1);
  assert.equal(isLegacyStandaloneRun(run), false);
  const invalid = store.snapshot(); invalid.runs[0]!.conversationEmployee!.mode = 'other' as 'consult';
  await writeFile(store.filePath, JSON.stringify(invalid));
  await assert.rejects(WorkforceStore.open(store.filePath), /模式|mode/);
});

test('consultation completion is dedicated and idempotent, never fabricates delivery acceptance', async t => {
  const { store, project, select } = await fixture(t); const selected = await select();
  let run = await store.createRun({ projectId: project.id, employeeId: selected.employee!.id, request: '你是谁', conversationEmployee: { sessionId: 'chat-a', mode: 'consult', bindingVersion: 1 } });
  await assert.rejects(store.completeConversationConsultation(run.id, { output: '介绍' }), /执行/);
  run = await store.updateRun(run.id, { status: 'running', sessionId: 'chat-a' });
  const completed = await store.completeConversationConsultation(run.id, { output: '我负责产品需求与验收。', usage: { inputTokens: 10, outputTokens: 9 }, finishedAt: new Date().toISOString() });
  assert.equal(completed.status, 'succeeded'); assert.equal(completed.acceptance, undefined); assert.deepEqual(completed.artifacts, []);
  const before = await readFile(store.filePath, 'utf8');
  assert.deepEqual(await store.completeConversationConsultation(run.id, { output: '不可覆盖的迟到响应' }), completed);
  assert.equal(await readFile(store.filePath, 'utf8'), before);
  const ordinary = await store.createRun({ projectId: project.id, employeeId: selected.employee!.id, request: '普通工作' });
  await store.updateRun(ordinary.id, { status: 'running' });
  await assert.rejects(store.completeConversationConsultation(ordinary.id, { output: '不允许绕过验收' }), /咨询/);
});

test('temporary native mention admission reuses a standalone role and never changes the resident preference', async t => {
  const { store, project, template, select } = await fixture(t); const resident = await select();
  const otherTemplate = store.snapshot().templates.find(item => item.status === 'ready' && item.id !== template.id)!;
  const beforeBinding = structuredClone(store.snapshot().conversationEmployees);
  const temporary = await store.admitTemporaryConversationEmployee({ projectId: project.id, sessionId: 'chat-a', turnKey: 'chat-a:42', templateId: otherTemplate.id, expectedTargetVersion: otherTemplate.version });
  assert.equal(temporary.temporaryEmployee?.invocation, 'temporary');
  assert.equal(temporary.temporaryEmployee?.mode, 'execute');
  assert.equal(temporary.temporaryEmployee?.employeeId, temporary.employee?.id);
  assert.notEqual(temporary.employee?.id, resident.employee?.id);
  assert.deepEqual(store.snapshot().conversationEmployees, beforeBinding);
  assert.equal(resolveConversationEmployee(store.snapshot(), project.id, 'chat-a').employee?.id, resident.employee?.id);
  assert.equal(store.snapshot().runs.length, 0);
  const { employeeId: _employeeId, ...link } = temporary.temporaryEmployee!;
  const run = await store.createRun({ projectId: project.id, employeeId: temporary.employee!.id, request: '本轮临时处理', conversationEmployee: link });
  assert.equal(run.conversationEmployee?.invocation, 'temporary');
  assert.equal(isLegacyStandaloneRun(run), false);
  assert.deepEqual(store.snapshot().conversationEmployees, beforeBinding);
});

test('temporary admission is idempotent and validates target version, standalone ownership and native turn identity', async t => {
  const { store, project, template } = await fixture(t);
  const input = { projectId: project.id, sessionId: 'chat-a', turnKey: 'chat-a:8', templateId: template.id, expectedTargetVersion: template.version };
  const temporary = await store.admitTemporaryConversationEmployee(input);
  const before = await readFile(store.filePath, 'utf8');
  assert.equal((await store.admitTemporaryConversationEmployee(input)).employee?.id, temporary.employee?.id);
  assert.equal(await readFile(store.filePath, 'utf8'), before);
  assert.equal(store.snapshot().conversationEmployees, undefined);
  await assert.rejects(store.admitTemporaryConversationEmployee({ ...input, turnKey: 'other-chat:8' }), /轮次/);
  await assert.rejects(store.admitTemporaryConversationEmployee({ ...input, expectedTargetVersion: template.version + 1 }), { code: 'CONFLICT' });
  await store.updateEmployee(temporary.employee!.id, { status: 'paused' });
  const pausedBefore = await readFile(store.filePath, 'utf8');
  await assert.rejects(store.admitTemporaryConversationEmployee(input), /暂停/);
  assert.equal(await readFile(store.filePath, 'utf8'), pausedBefore);
});

test('raw human mention resolver uses exact leading shared aliases and stays read-only for unrelated @ files', async t => {
  const { store, project, template } = await fixture(t);
  const before = await readFile(store.filePath, 'utf8');
  const [alias, target] = [...temporaryEmployeeMentionAliases(store.snapshot(), project.id)].find(([, target]) => target.id === template.id)!;
  assert.deepEqual(resolveTemporaryEmployeeMention(store.snapshot(), project.id, `@${alias} 你是谁`), target);
  assert.equal(resolveTemporaryEmployeeMention(store.snapshot(), project.id, '@file.md 请读取'), undefined);
  assert.equal(resolveTemporaryEmployeeMention(store.snapshot(), project.id, `普通问题，提到 @${alias}`), undefined);
  assert.equal(resolveTemporaryEmployeeMention(store.snapshot(), project.id, `@${alias}extra 你是谁`), undefined);
  assert.equal(await readFile(store.filePath, 'utf8'), before);
  assert.equal(store.snapshot().employees.length, 0);
});

test('raw human mentions explicitly reject ambiguous, paused, unready and multiple employee targets', async t => {
  const { store, project, template, select } = await fixture(t);
  const alias = template.name.replace(/\s+/g, '_');
  const another = store.snapshot().templates.find(item => item.status === 'ready' && item.id !== template.id)!;
  assert.throws(() => resolveTemporaryEmployeeMention(store.snapshot(), project.id, `@${alias} @${another.name.replace(/\s+/g, '_')} 一起回答`), /一位员工/);
  const selected = await select(); await store.updateEmployee(selected.employee!.id, { status: 'paused' });
  assert.throws(() => resolveTemporaryEmployeeMention(store.snapshot(), project.id, `@${alias} 问题`), /暂停/);
  const archived = await store.saveTemplate({ name: '已归档角色', modules: template.modules, status: 'archived' });
  assert.throws(() => resolveTemporaryEmployeeMention(store.snapshot(), project.id, `@${archived.name} 问题`), /停用|就绪/);
  await store.saveTemplate({ name: another.name, modules: another.modules, status: 'ready' });
  assert.throws(() => resolveTemporaryEmployeeMention(store.snapshot(), project.id, `@${another.name.replace(/\s+/g, '_')} 问题`), /歧义/);
});

test('explicit chip identity and a unique active raw alias are not blocked by inactive duplicate names', async t => {
  const { store, project, template } = await fixture(t);
  await store.saveTemplate({ name: template.name, modules: template.modules, status: 'archived' });
  await store.saveTemplate({ name: template.name, modules: template.modules, status: 'draft' });
  const alias = [...temporaryEmployeeMentionAliases(store.snapshot(), project.id)].find(([, role]) => role.id === template.id)![0];
  assert.equal(resolveTemporaryEmployeeMention(store.snapshot(), project.id, `@${alias} 问题`)?.id, template.id);
  assert.doesNotThrow(() => assertNoAdditionalTemporaryEmployeeMention(store.snapshot(), project.id, `@${alias} 问题`));
  const other = store.snapshot().templates.find(role => role.status === 'ready' && role.id !== template.id)!;
  assert.throws(() => assertNoAdditionalTemporaryEmployeeMention(store.snapshot(), project.id, `@${alias} @${other.name.replace(/\s+/g, '_')} 问题`), /一位员工/);
});
