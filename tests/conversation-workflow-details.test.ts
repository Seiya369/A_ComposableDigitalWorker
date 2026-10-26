import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkforceStore } from '../src/domain/store.js';
import { captureWorkflowTeam } from '../src/domain/workflow-team.js';
import { resolveConversationWorkflowDetails, requireConversationWorkflowReview, type ConversationWorkflowReviewInput } from '../src/domain/conversation-workflow-details.js';
import { resolveConversationWorkflow } from '../src/domain/conversation-workflow.js';
import { WorkService } from '../src/work/service.js';
import type { WorkTask } from '../src/work/types.js';
import type { WorkforceRun } from '../src/domain/types.js';
import { CONFIRMED_ITEMS_MEDIA_TYPE } from '../src/domain/confirmed-items.js';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'workflow-details-')); t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'state.json'); const store = await WorkforceStore.open(file);
  const project = await store.saveProject({ name: '软件项目', rootPath: root });
  await mkdir(join(root, 'other')); const other = await store.saveProject({ name: '其他项目', rootPath: join(root, 'other') });
  const base = store.snapshot().templates[0]!; const modules = structuredClone(base.modules);
  modules.model = { mode: 'override', provider: 'PRIVATE_PROVIDER', model: 'PRIVATE_MODEL' };
  modules.capabilities.skills = [{ id: 'PRIVATE_SKILL', name: 'PRIVATE_SKILL_NAME', description: 'PRIVATE_SKILL_BODY' }];
  const lead = await store.saveTemplate({ name: '技术负责人', status: 'ready', modules });
  const developer = await store.saveTemplate({ name: '开发人员', status: 'ready', modules });
  const tester = await store.saveTemplate({ name: '测试负责人', status: 'ready', modules });
  const team = await store.saveTeam({ name: '软件团队', members: [
    { memberId: 'lead', templateId: lead.id }, { memberId: 'developer', templateId: developer.id, reportsTo: 'lead' }, { memberId: 'tester', templateId: tester.id },
  ] });
  const workflow = await store.saveWorkflowTemplate({ name: '软件交付', team: captureWorkflowTeam(team, store.snapshot().templates),
    roles: team.members.map(member => ({ id: member.memberId, name: member.memberId, memberId: member.memberId })), steps: [
      { id: 'design', name: '架构设计', roleId: 'lead', instruction: '设计架构', outputs: ['架构文档'], acceptanceCriteria: ['决策有依据'] },
      { id: 'test', name: '验证交付', roleId: 'tester', instruction: '验证完整方案', outputs: ['测试报告'], acceptanceCriteria: ['关键场景通过'], onRejectStepId: 'design' },
    ] });
  const selected = await store.selectConversationWorkflow({ projectId: project.id, sessionId: 'chat-a', workflowTemplateId: workflow.id,
    workflowTemplateVersion: workflow.version, templateVersions: Object.fromEntries(store.snapshot().templates.map(entry => [entry.id, entry.version])) }, { expectedRevision: store.snapshot().revision });
  const run = async (options: { sessionId?: string; parentRunId?: string; legacy?: boolean; employeeId?: string; output?: string } = {}) => {
    const view = resolveConversationWorkflow(store.snapshot(), project.id, 'chat-a');
    let created = await store.createRun({ projectId: project.id, employeeId: options.employeeId ?? view.owner!.id, request: '完成该步骤',
      ...(!options.legacy ? { conversationWorkflow: { instanceId: view.instanceId!, stepId: view.currentStepId! } } : {}),
      ...(options.parentRunId ? { parentRunId: options.parentRunId } : {}) });
    created = await store.updateRun(created.id, { status: 'running', sessionId: options.sessionId ?? 'chat-a' });
    return store.updateRun(created.id, { status: 'awaiting-review', output: options.output ?? '可审查的真实交付' });
  };
  const details = (options: Parameters<typeof resolveConversationWorkflowDetails>[3] = {}) => resolveConversationWorkflowDetails(store.snapshot(), project.id, 'chat-a', options);
  const review = (delivery: WorkforceRun, patch: Partial<ConversationWorkflowReviewInput> = {}): ConversationWorkflowReviewInput => {
    const view = resolveConversationWorkflow(store.snapshot(), project.id, 'chat-a');
    return { projectId: project.id, sessionId: 'chat-a', instanceId: view.instanceId, instanceVersion: view.instanceVersion,
      stepId: delivery.conversationWorkflow?.stepId, runId: delivery.id, runVersion: delivery.version,
      expectedRevision: store.snapshot().revision, decision: 'accepted', ...patch };
  };
  return { root, file, store, project, other, lead, developer, tester, team, workflow, selected, run, details, review };
}

test('details show the referenced workflow and responsible hierarchy without private employee configuration', async t => {
  const f = await fixture(t); const before = await readFile(f.file, 'utf8'); const details = f.details();
  assert.equal(details.name, '软件交付'); assert.equal(details.selectedStep!.instruction, '设计架构');
  assert.deepEqual(details.selectedStep!.outputs, ['架构文档']); assert.deepEqual(details.selectedStep!.acceptanceCriteria, ['决策有依据']);
  assert.deepEqual(details.selectedStep!.roster.map(person => person.name).sort(), ['开发人员', '技术负责人']);
  const child = details.selectedStep!.roster.find(person => person.name === '开发人员')!;
  assert.equal(child.managerId, details.selectedStep!.owner!.id); assert.equal(details.selectedStep!.onRejectStepId, 'design');
  assert.doesNotMatch(JSON.stringify(details), /PRIVATE_|modules|employeeSnapshot|permissions|knowledge|capabilities/);
  assert.equal(await readFile(f.file, 'utf8'), before, 'opening details never mutates progress or employee data');
  await f.store.saveWorkflowTemplate({ ...f.workflow, name: '未来的全局流程', steps: f.workflow.steps.map(step => ({ ...step, instruction: '全局修改' })) });
  assert.equal(f.details().name, '未来的全局流程'); assert.equal(f.details().selectedStep!.instruction, '全局修改');
  assert.equal(f.details({ stepId: 'test' }).selectedStep!.onRejectStepName, '架构设计');
  assert.throws(() => f.details({ stepId: 'foreign-step' }), /步骤不属于/);
});

test('delivery bodies are scoped and explicitly flag every size truncation while retaining artifact identity', async t => {
  const f = await fixture(t); let run = await f.run({ output: 'o'.repeat(200_123) });
  run = await f.store.updateRun(run.id, { artifacts: [{ id: 'real-document', title: '交付文档', content: 'a'.repeat(100_123), path: 'docs/design.md', mediaType: 'text/markdown' }] });
  const details = f.details(); const delivery = details.selectedStep!.latestDelivery!;
  assert.equal(delivery.id, run.id); assert.equal(delivery.output!.length, 200_000); assert.equal(delivery.outputLength, 200_123); assert.equal(delivery.outputTruncated, true);
  assert.equal(delivery.artifacts[0]!.content!.length, 100_000); assert.equal(delivery.artifacts[0]!.contentLength, 100_123); assert.equal(delivery.artifacts[0]!.contentTruncated, true);
  assert.equal(delivery.artifacts[0]!.path, 'docs/design.md'); assert.equal(delivery.reviewable, true);
  assert.doesNotMatch(JSON.stringify(details), /PRIVATE_|employeeSnapshot|usage|inputTokens/);
  assert.equal(f.store.snapshot().runs.find(entry => entry.id === run.id)!.output!.length, 200_123, 'projection limits never alter original evidence');
});

test('delivery details expose only reported usage scalars and preserve unknown cache and total fields', async t => {
  const f = await fixture(t); const run = await f.run();
  const usage = { inputTokens: 40, outputTokens: 10, cacheReadTokens: 700, cacheWriteTokens: 0,
    reasoningTokens: 5, totalTokens: 750, modelCalls: 2, reportedCalls: 2 };
  await f.store.updateRun(run.id, { usage });
  const state = f.store.snapshot();
  Object.assign(state.runs.find(item => item.id === run.id)!.usage!, { provider: 'PRIVATE_USAGE_PROVIDER', secret: 'PRIVATE_USAGE_SECRET' });
  const details = resolveConversationWorkflowDetails(state, f.project.id, 'chat-a');
  assert.deepEqual(details.selectedStep!.latestDelivery!.usage, usage);
  assert.doesNotMatch(JSON.stringify(details), /PRIVATE_USAGE_|employeeSnapshot/);
  await f.store.updateRun(run.id, { usage: { inputTokens: 12, outputTokens: 3 } });
  const legacy = f.details().selectedStep!.latestDelivery!.usage!;
  assert.deepEqual(legacy, { inputTokens: 12, outputTokens: 3 });
  assert.equal(Object.hasOwn(legacy, 'cacheReadTokens'), false);
  assert.equal(Object.hasOwn(legacy, 'totalTokens'), false);
});

test('history includes only current workflow roots and this native conversation legacy roots', async t => {
  const f = await fixture(t); const root = await f.run({ sessionId: 'another-workflow-chat' });
  const childEmployee = f.details().selectedStep!.roster.find(person => person.name === '开发人员')!;
  const child = await f.run({ sessionId: 'child-chat', parentRunId: root.id, employeeId: childEmployee.id });
  const legacy = await f.run({ legacy: true }); const foreignLegacy = await f.run({ legacy: true, sessionId: 'unrelated-chat' });
  const foreignEmployee = await f.store.createEmployee({ projectId: f.other.id, templateId: f.lead.id });
  const foreign = await f.store.createRun({ projectId: f.other.id, employeeId: foreignEmployee.id, request: 'PRIVATE_FOREIGN_PROJECT_DELIVERY' });
  assert.deepEqual(new Set(f.details().history.map(entry => entry.id)), new Set([root.id, legacy.id]));
  assert.equal(f.details({ runId: legacy.id }).legacyDelivery!.id, legacy.id);
  assert.equal(f.details({ runId: root.id }).selectedStep!.latestDelivery!.id, root.id);
  for (const excluded of [child, foreignLegacy, foreign]) assert.throws(() => f.details({ runId: excluded.id }), /交付不属于/);
  const state = f.store.snapshot();
  await f.store.selectConversationWorkflow({ projectId: f.project.id, sessionId: 'chat-a', workflowTemplateId: null }, { expectedRevision: state.revision });
  const none = f.details({ runId: legacy.id }); assert.equal(none.instanceId, null); assert.equal(none.legacyDelivery!.id, legacy.id);
  assert.equal(none.legacyDelivery!.reviewable, true); assert.deepEqual(none.history.map(entry => entry.id), [legacy.id]);
  assert.throws(() => f.details({ runId: root.id }), /交付不属于/, 'another native chat cannot discover an unselected workflow through its run id');
  const ownModern = await f.store.transaction(state => { const copy = structuredClone(root); copy.id = 'own-modern-after-none'; copy.sessionId = 'chat-a'; state.runs.push(copy); return copy; });
  assert.throws(() => f.details({ runId: ownModern.id }), /请先在此对话选择“软件交付”工作流，再切换到“架构设计”步骤/);
});

test('planned task summaries expose only the selected frozen step and permitted owner descendants', async t => {
  const f = await fixture(t); const work = new WorkService(f.store); const current = f.details();
  const child = current.selectedStep!.roster.find(person => person.name === '开发人员')!;
  const create = async (employeeId: string, title: string, stepId?: string) => {
    const task = await work.command('work.saveTask', { projectId: f.project.id, employeeId, title, goal: 'PRIVATE_TASK_GOAL', acceptanceCriteria: ['验证任务'] }) as WorkTask;
    if (stepId) await f.store.transaction(state => { state.workState!.tasks.find(entry => entry.id === task.id)!.sourceWorkflow = {
      projectTeamId: f.selected.projectTeamId!, workflowId: f.selected.workflowId!, stepId }; });
    return task;
  };
  const leadTask = await create(current.selectedStep!.owner!.id, '分解架构任务', 'design');
  const childTask = await create(child.id, '实现任务', 'design');
  await create(child.id, '其他步骤', 'test'); await create(child.id, '未归属规划');
  const result = f.details(); assert.deepEqual(new Set(result.tasks.map(task => task.id)), new Set([leadTask.id, childTask.id]));
  assert.equal(result.tasksTotal, 2); assert.doesNotMatch(JSON.stringify(result.tasks), /PRIVATE_|goal|inputs|attemptRunIds/);
});

test('detail review uses real store acceptance to advance, and rejects wrong step, stale CAS, busy or unrelated runs', async t => {
  const f = await fixture(t); const run = await f.run(); const input = f.review(run); const before = await readFile(f.file, 'utf8');
  assert.equal(requireConversationWorkflowReview(f.store.snapshot(), input).id, run.id);
  assert.throws(() => requireConversationWorkflowReview(f.store.snapshot(), { ...input, expectedRevision: input.expectedRevision - 1 }), /工作区已更新/);
  assert.throws(() => requireConversationWorkflowReview(f.store.snapshot(), { ...input, runVersion: 1 }), /交付已更新/);
  assert.throws(() => requireConversationWorkflowReview(f.store.snapshot(), { ...input, instanceVersion: 99 }), /进度已更新/);
  assert.throws(() => requireConversationWorkflowReview(f.store.snapshot(), { ...input, stepId: 'test' }), /所属步骤/);
  assert.throws(() => requireConversationWorkflowReview(f.store.snapshot(), { ...input, sessionId: 'wrong-conversation', instanceId: null }), /进度已更新/);
  assert.throws(() => requireConversationWorkflowReview(f.store.snapshot(), input, true), /仍在执行/);
  assert.equal(await readFile(f.file, 'utf8'), before);
  await f.store.reviewRun(run.id, { decision: input.decision, reviewer: '用户', note: '确认交付' }, { expectedRevision: input.expectedRevision, expectedVersion: input.runVersion });
  assert.equal(f.details().currentStepId, 'test'); assert.deepEqual(f.details().steps.map(step => step.status), ['completed', 'current']);
  const validationRun = await f.run(); const rejected = f.review(validationRun, { decision: 'rejected', note: '返回设计修改' });
  assert.equal(requireConversationWorkflowReview(f.store.snapshot(), rejected).id, validationRun.id);
  await f.store.reviewRun(validationRun.id, { decision: rejected.decision, reviewer: '用户', note: rejected.note! }, { expectedRevision: rejected.expectedRevision, expectedVersion: rejected.runVersion });
  assert.equal(f.details().currentStepId, 'design'); assert.deepEqual(f.details().steps.map(step => step.status), ['current', 'pending']);
});

test('effective stage delivery follows live completion evidence, survives newer failures and disappears after return invalidation', async t => {
  const f = await fixture(t);
  const original = await f.run({ output: '已确认架构' });
  await f.store.updateRun(original.id, { artifacts: [{ id: 'architecture-file', title: '架构文档', path: 'docs/architecture.md', content: '已确认的文档快照' }] });
  const accepted = await f.store.reviewRun(original.id, { decision: 'accepted', reviewer: '用户', note: '架构验收通过' });
  const first = f.details({ stepId: 'design' }).selectedStep!;
  assert.equal(first.status, 'completed'); assert.equal(first.acceptedDelivery?.id, accepted.id);
  assert.deepEqual(first.acceptedDelivery?.artifacts, [{ id: 'architecture-file', title: '架构文档', path: 'docs/architecture.md', content: '已确认的文档快照', contentLength: 8 }]);
  assert.equal(first.acceptedDelivery?.acceptance?.at, accepted.acceptance!.at);
  assert.equal(first.acceptedDelivery?.reviewable, false);

  let view = resolveConversationWorkflow(f.store.snapshot(), f.project.id, 'chat-a');
  await f.store.selectConversationWorkflowStep({ projectId: f.project.id, sessionId: 'chat-a', stepId: 'design', instanceVersion: view.instanceVersion! }, { expectedRevision: f.store.snapshot().revision });
  const newer = await f.run({ output: '未完成的新尝试' });
  await f.store.updateRun(newer.id, { status: 'failed', error: '本轮执行失败' });
  const retry = f.details({ stepId: 'design' }).selectedStep!;
  assert.equal(retry.latestDelivery?.id, newer.id); assert.equal(retry.latestDelivery?.status, 'failed');
  assert.equal(retry.acceptedDelivery?.id, accepted.id, 'an execution failure alone does not replace accepted stage evidence');
  assert.equal(f.details({ runId: newer.id }).selectedStep?.latestDelivery?.id, newer.id, 'history keeps the explicitly selected attempt');
  assert.equal(f.details({ runId: newer.id }).selectedStep?.acceptedDelivery?.id, accepted.id);

  view = resolveConversationWorkflow(f.store.snapshot(), f.project.id, 'chat-a');
  await f.store.selectConversationWorkflowStep({ projectId: f.project.id, sessionId: 'chat-a', stepId: 'test', instanceVersion: view.instanceVersion! }, { expectedRevision: f.store.snapshot().revision });
  const validation = await f.run();
  await f.store.reviewRun(validation.id, { decision: 'rejected', reviewer: '用户', note: '需要返回架构修正' });
  const returned = f.details({ stepId: 'design' }).selectedStep!;
  assert.equal(returned.acceptedDelivery, undefined);
  assert.equal(f.details({ runId: accepted.id }).selectedStep?.acceptedDelivery, undefined, 'historical accepted output cannot revive invalidated stage evidence');
  assert.equal(f.details({ runId: accepted.id }).selectedStep?.latestDelivery?.id, accepted.id, 'the actual historical delivery remains inspectable');
});

test('accepted delivery projection rejects mismatched project, workflow instance, owner, step and acceptance evidence', async t => {
  const f = await fixture(t); const original = await f.run({ output: '已确认架构' });
  await f.store.updateRun(original.id, { artifacts: [{ id: 'scoped-items', title: '事项声明', mediaType: CONFIRMED_ITEMS_MEDIA_TYPE,
    content: JSON.stringify({ schemaVersion: 1, items: [{ id: 'scope', title: '范围', content: '保留真实作用域' }] }) }] });
  const accepted = await f.store.reviewRun(original.id, { decision: 'accepted', reviewer: '用户', note: '确认' });
  const source = f.store.snapshot();
  const patches: Array<(run: WorkforceRun) => void> = [
    run => { run.projectId = f.other.id; },
    run => { run.conversationWorkflow!.instanceId = 'another-frozen-instance'; },
    run => { run.conversationWorkflow!.stepId = 'test'; },
    run => { run.employeeId = source.employees.find(employee => employee.name === '测试负责人')!.id; },
    run => { run.status = 'failed'; },
    run => { run.acceptance!.decision = 'rejected'; },
    run => { run.acceptance!.at = '2000-01-01T00:00:00.000Z'; },
  ];
  for (const patch of patches) {
    const state = structuredClone(source); patch(state.runs.find(run => run.id === accepted.id)!);
    const result = resolveConversationWorkflowDetails(state, f.project.id, 'chat-a', { stepId: 'design' });
    assert.equal(result.selectedStep?.acceptedDelivery, undefined, 'only a matching accepted completion can supply effective stage evidence');
    assert.deepEqual(result.selectedStep?.confirmedItems, [], 'declarations cannot outlive their exact accepted completion evidence');
  }
  const foreign = resolveConversationWorkflowDetails(source, f.other.id, 'chat-a');
  assert.equal(foreign.selectedStep?.acceptedDelivery, undefined); assert.equal(foreign.historyTotal, 0);
});

test('project Wiki stays bound to the frozen project team across step browsing and is absent for no workflow', async t => {
  const f = await fixture(t); const initial = f.details();
  assert.equal(initial.projectWiki?.teamId, f.selected.projectTeamId);
  assert.notEqual(initial.projectWiki?.teamId, f.team.id, 'project Wiki never points at the editable team template');
  assert.ok(f.store.snapshot().employees.some(employee => employee.projectId === f.project.id && employee.id === initial.projectWiki?.employeeId));
  assert.deepEqual(f.details({ stepId: 'test' }).projectWiki, initial.projectWiki, 'changing the inspected step keeps one team knowledge space');
  const installedOther = await f.store.selectConversationWorkflow({ projectId: f.other.id, sessionId: 'chat-other', workflowTemplateId: f.workflow.id,
    workflowTemplateVersion: f.workflow.version, templateVersions: Object.fromEntries(f.store.snapshot().templates.map(entry => [entry.id, entry.version])) }, { expectedRevision: f.store.snapshot().revision });
  const other = resolveConversationWorkflowDetails(f.store.snapshot(), f.other.id, 'chat-other');
  assert.equal(other.projectWiki?.teamId, installedOther.projectTeamId);
  assert.notEqual(other.projectWiki?.teamId, initial.projectWiki?.teamId);
  assert.notEqual(other.projectWiki?.employeeId, initial.projectWiki?.employeeId);
  await f.store.selectConversationWorkflow({ projectId: f.project.id, sessionId: 'chat-a', workflowTemplateId: null }, { expectedRevision: f.store.snapshot().revision });
  assert.equal(f.details().projectWiki, undefined);
  assert.deepEqual(resolveConversationWorkflowDetails(f.store.snapshot(), f.other.id, 'chat-other').projectWiki, other.projectWiki);
});

test('details use the current project name and expose frozen rejection destinations without project paths', async t => {
  const f = await fixture(t); const initial = f.details();
  assert.equal(initial.projectName, '软件项目');
  assert.deepEqual(initial.steps.map(step => [step.id, step.onRejectStepId]), [['design', undefined], ['test', 'design']]);
  assert.equal(initial.selectedStep!.onRejectStepId, 'design', 'the selected step retains its separate effective default retry rule');
  await f.store.saveProject({ id: f.project.id, name: '真实项目新名称', rootPath: f.project.rootPath });
  const updated = f.details();
  assert.equal(updated.projectName, '真实项目新名称');
  assert.equal(updated.name, '软件交付', 'project name and frozen workflow name remain separate');
  assert.equal('rootPath' in updated, false);
});

test('selected step history contains only that responsible owner attempts and counts before limiting', async t => {
  const f = await fixture(t); const first = await f.run();
  await f.store.reviewRun(first.id, { decision: 'accepted', reviewer: '用户', note: '设计已验收' });
  const next = await f.run();
  const current = f.details();
  assert.deepEqual(current.selectedStep!.history!.map(entry => entry.id), [next.id]);
  assert.equal(current.selectedStep!.historyTotal, 1);
  const design = f.details({ stepId: 'design' });
  assert.deepEqual(design.selectedStep!.history!.map(entry => entry.id), [first.id]);
  assert.equal(design.selectedStep!.historyTotal, 1);
  assert.deepEqual(new Set(design.history.map(entry => entry.id)), new Set([first.id, next.id]), 'compatible full-workflow history remains available separately');
  assert.equal(f.details().currentStepId, 'test', 'browsing an earlier step never activates it');
});

test('item declarations are promoted only from effective accepted evidence and retain exact delivery provenance', async t => {
  const f = await fixture(t); let run = await f.run({ output: '用户已确认所有事项（未被结构化记录，不得推断为确认）' });
  assert.deepEqual(f.details().selectedStep!.confirmedItems, []);
  const declared = { id: 'scope', title: '范围声明', content: '仅交付架构文档。' };
  run = await f.store.updateRun(run.id, { artifacts: [
    { id: 'declarations', title: '事项声明', mediaType: CONFIRMED_ITEMS_MEDIA_TYPE, content: JSON.stringify({ schemaVersion: 1, items: [declared] }) },
    { id: 'ordinary-json', title: '普通 JSON', mediaType: 'application/json', content: JSON.stringify({ schemaVersion: 1, items: [{ ...declared, id: 'untyped' }] }) },
    { id: 'invalid', title: '非法事项声明', mediaType: CONFIRMED_ITEMS_MEDIA_TYPE, content: '{not json' },
  ] });
  assert.deepEqual(f.details().selectedStep!.confirmedItems, [], 'unreviewed delivery declarations are not accepted items');
  const accepted = await f.store.reviewRun(run.id, { decision: 'accepted', reviewer: '明确验收人', note: '仅验收这份交付，并非逐项用户确认' });
  const before = await readFile(f.file, 'utf8'); const selected = f.details({ stepId: 'design' }).selectedStep!;
  assert.deepEqual(selected.confirmedItems, [{ ...declared, sourceArtifactId: 'declarations', runId: accepted.id,
    runVersion: accepted.version, reviewer: '明确验收人', acceptedAt: accepted.acceptance!.at }]);
  assert.equal(selected.acceptedDelivery!.artifacts.length, 3, 'untyped or invalid declarations remain readable artifacts');
  assert.equal(await readFile(f.file, 'utf8'), before, 'opening accepted declarations is read-only');
  const validation = await f.run(); await f.store.reviewRun(validation.id, { decision: 'rejected', reviewer: '验收人', note: '回到设计调整' });
  assert.deepEqual(f.details({ stepId: 'design' }).selectedStep!.confirmedItems, [], 'return invalidation removes the effective accepted declarations');
});

test('accepted item projection is bounded across artifacts without hiding the original snapshots', async t => {
  const f = await fixture(t); const run = await f.run();
  const artifacts = [26, 25].map((count, document) => ({ id: `declarations-${document}`, title: `事项声明 ${document}`,
    mediaType: CONFIRMED_ITEMS_MEDIA_TYPE, content: JSON.stringify({ schemaVersion: 1, items: Array.from({ length: count }, (_, index) => ({ id: `${document}-${index}`, title: '范围', content: '交付声明' })) }) }));
  await f.store.updateRun(run.id, { artifacts }); await f.store.reviewRun(run.id, { decision: 'accepted', reviewer: '验收人' });
  const selected = f.details({ stepId: 'design' }).selectedStep!;
  assert.deepEqual(selected.confirmedItems, [], 'an oversized combined declaration list is not partially promoted');
  assert.equal(selected.acceptedDelivery!.artifacts.length, 2);
});

test('reading a delivery can bind the exact displayed version without activating a step or reading project files', async t => {
  const f = await fixture(t); const run = await f.run(); const before = await readFile(f.file, 'utf8');
  assert.equal(f.details({ stepId: 'design', runId: run.id, runVersion: run.version }).selectedStep!.latestDelivery!.version, run.version);
  assert.throws(() => f.details({ runVersion: run.version }), /交付 ID 和有效版本/);
  for (const runVersion of [0, -1, 1.5, NaN]) assert.throws(() => f.details({ runId: run.id, runVersion }), /有效版本/);
  assert.throws(() => f.details({ runId: run.id, runVersion: run.version - 1 }), /交付版本已更新/);
  assert.equal(await readFile(f.file, 'utf8'), before);
  await f.store.updateRun(run.id, { output: '较新的文字快照' });
  assert.throws(() => f.details({ stepId: 'design', runId: run.id, runVersion: run.version }), /交付版本已更新/);
});
