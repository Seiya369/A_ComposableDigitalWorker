import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkforceStore } from '../src/domain/store.js';
import { WorkflowRepository } from '../src/workflow/repository.js';
import { WorkflowEngine } from '../src/workflow/engine.js';
import { prepareSettingsImport } from '../src/domain/settings-transfer.js';
import { KnowledgeEngine } from '../src/knowledge/engine.js';
import { KnowledgeRepository } from '../src/knowledge/repository.js';
import type { WorkflowCommandInput } from '../src/workflow/types.js';

async function fixture(t: TestContext, maxAttempts = 3, returnTarget = 'implement') {
  const root = await mkdtemp(join(tmpdir(), 'workflow-rework-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = await WorkforceStore.open(join(root, 'state.json'));
  const template = store.snapshot().templates[0]!;
  const project = await store.saveProject({ name: '本地流程测试', rootPath: root });
  const workflow = await store.saveWorkflowTemplate({ name: '返工闭环', maxAttempts, roles: [{ id: 'author', name: '开发' }, { id: 'reviewer', name: '测试' }], steps: [
    { id: 'scope', name: '确认范围', roleId: 'author', instruction: '明确范围', outputs: ['范围说明'] },
    { id: 'implement', name: '实现', roleId: 'author', instruction: '实现功能', outputs: ['代码', '验证记录'] },
    { id: 'review', name: '判断', roleId: 'reviewer', instruction: '核对结果', acceptanceCriteria: ['行为正确'], onRejectStepId: returnTarget },
    { id: 'deliver', name: '交付', roleId: 'author', instruction: '交付成果' },
  ] });
  const team = await store.saveTeam({ name: '返工团队', knowledgeEnabled: false, members: [{ memberId: 'author', templateId: template.id }, { memberId: 'reviewer', templateId: template.id, reportsTo: 'author' }] });
  const bound = await store.bindTeamWorkflow(team.id, workflow.id, { author: 'author', reviewer: 'reviewer' });
  const installed = await store.configureProjectTeam({ projectId: project.id, teamId: team.id, teamVersion: bound.version, templateVersions: { [template.id]: template.version } });
  const repository = new WorkflowRepository(store), starts: string[] = [], errors: unknown[] = [];
  const engine = new WorkflowEngine(repository, {
    startReserved: async id => { starts.push(id); return store.updateRun(id, { status: 'running' }); },
    cancel: async id => { await store.updateRun(id, { status: 'cancelled' }); },
  }, error => errors.push(error)); t.after(() => engine.dispose());
  const get = () => store.snapshot().workflowRuns![0]!;
  const control = (action: WorkflowCommandInput['action'], extra: Partial<WorkflowCommandInput> = {}) => repository.control({ projectId: project.id, id: get().id, commandId: randomUUID(), expectedVersion: get().version, action, runId: starts.at(-1), ...extra });
  const complete = async (output: string) => { await store.updateRun(starts.at(-1)!, { status: 'awaiting-review', output }); await engine.idle(); };
  const accept = async (output: string) => { await complete(output); await control('review', { decision: 'accepted' }); await engine.idle(); };
  await engine.start(); await repository.start({ projectId: project.id, projectTeamId: installed.id, workflowId: installed.workflows[0]!.id, workflowVersion: 1, request: '验证条件退回', requestId: randomUUID() }); await engine.idle();
  return { root, store, repository, engine, workflow, team: bound, project, installed, starts, errors, get, control, complete, accept };
}

test('rejected acceptance returns to configured step only on confirmation, invalidates downstream results and preserves history', async t => {
  const f = await fixture(t);
  await f.accept('STABLE_SCOPE'); const scopeRun = f.starts[0]!;
  await f.accept('OLD_IMPLEMENTATION'); const oldRun = f.store.snapshot().runs.find(run => run.id === f.starts[1])!;
  await f.complete('BUG_REPORT'); await f.control('review', { decision: 'rejected', note: '修正边界行为' }); await f.engine.idle();
  assert.equal(f.get().status, 'blocked'); assert.equal(f.starts.length, 3);
  const beforeTasks = structuredClone(f.store.snapshot().runs);
  const command: WorkflowCommandInput = { projectId: f.project.id, id: f.get().id, commandId: randomUUID(), expectedVersion: f.get().version, action: 'retry', runId: f.starts.at(-1), note: '修正边界行为' };
  await f.repository.control(command); await f.repository.control(command); await f.engine.idle();
  assert.equal(f.starts.length, 4); assert.equal(f.get().steps[0]!.status, 'accepted'); assert.equal(f.get().steps[1]!.status, 'running'); assert.equal(f.get().steps[2]!.status, 'pending');
  assert.ok(f.get().steps[1]!.attempts[0]!.invalidatedAt); assert.match(f.get().steps[1]!.attempts[0]!.invalidationReason!, /修正边界行为/);
  assert.deepEqual(f.store.snapshot().runs.slice(0, 3), beforeTasks, 'original run outputs and approvals remain immutable');
  const request = f.store.snapshot().runs.at(-1)!.request;
  assert.match(request, /STABLE_SCOPE/); assert.match(request, /修正边界行为/); assert.doesNotMatch(request, /OLD_IMPLEMENTATION/);
  assert.equal(f.get().steps[0]!.attempts[0]!.runId, scopeRun);
  await f.accept('NEW_IMPLEMENTATION');
  assert.match(f.store.snapshot().runs.at(-1)!.request, /NEW_IMPLEMENTATION/); assert.doesNotMatch(f.store.snapshot().runs.at(-1)!.request, /OLD_IMPLEMENTATION/);
  await f.accept('复核通过'); await f.accept('最终交付'); assert.equal(f.get().status, 'succeeded');
  assert.deepEqual(f.get().steps.map(step => step.attempts.length), [1, 2, 2, 1]);
  assert.deepEqual(f.store.snapshot().runs.find(run => run.id === oldRun.id), oldRun); assert.deepEqual(f.errors, []);
});

test('runtime execution errors retry locally rather than triggering a quality return', async t => {
  const f = await fixture(t); await f.accept('范围'); await f.accept('实现');
  await f.store.updateRun(f.starts.at(-1)!, { status: 'failed', error: '连接中断' }); await f.engine.idle();
  await f.control('retry'); await f.engine.idle();
  assert.equal(f.get().steps[1]!.status, 'accepted'); assert.equal(f.get().steps[1]!.attempts[0]!.invalidatedAt, undefined);
  assert.equal(f.get().steps[2]!.attempts.length, 2); assert.deepEqual(f.errors, []);
});

test('paused returns wait for resume and all affected steps share a bounded lifetime attempt budget', async t => {
  const f = await fixture(t, 2); await f.accept('范围'); await f.accept('实现');
  await f.complete('不通过'); await f.control('pause'); await f.control('review', { decision: 'rejected', note: '修正' });
  await f.control('retry'); await f.engine.idle(); assert.equal(f.get().status, 'paused'); assert.equal(f.starts.length, 3);
  await f.control('resume'); await f.engine.idle(); assert.equal(f.starts.length, 4);
  await f.accept('新版实现'); await f.complete('仍有缺陷'); await f.control('review', { decision: 'rejected', note: '仍需修改' });
  const before = f.store.snapshot(); await assert.rejects(f.control('retry'), /次数上限/); assert.deepEqual(f.store.snapshot(), before); assert.deepEqual(f.errors, []);
});

test('return identities survive global binding, template import, draft import, and project roundtrip', async t => {
  const f = await fixture(t);
  const bound = f.team.workflows![0]!; assert.equal(bound.steps[2]!.onRejectStepId, bound.steps[1]!.id); assert.notEqual(bound.steps[1]!.id, 'implement');
  const document = f.store.exportBundle({ scope: 'template', kind: 'workflow', id: f.workflow.id });
  const imported = await f.store.importBundle(document, { scope: 'template', requestId: randomUUID() });
  const copy = f.store.snapshot().workflowTemplates!.find(item => item.id === imported.rootId)!; assert.equal(copy.steps[2]!.onRejectStepId, copy.steps[1]!.id);
  const staged = prepareSettingsImport(f.store.snapshot(), document, 'workflow', f.workflow.id); const stagedRoot = staged.data.workflowTemplates.find(item => item.id === staged.root.id)!; assert.equal(stagedRoot.steps[2]!.onRejectStepId, stagedRoot.steps[1]!.id);
  const projectBundle = f.store.exportBundle({ scope: 'project', kind: 'team', projectId: f.project.id, id: f.installed.id });
  const result = await f.store.importBundle(projectBundle, { scope: 'project', projectId: f.project.id, requestId: randomUUID() });
  const projectCopy = f.store.snapshot().projectTeams!.find(item => item.id === result.rootId)!; assert.equal(projectCopy.workflows[0]!.steps[2]!.onRejectStepId, projectCopy.workflows[0]!.steps[1]!.id);
});

test('forward/missing return references are rejected atomically and invalidated results cannot be accepted again', async t => {
  const f = await fixture(t); const before = f.store.snapshot();
  for (const target of ['missing', 'deliver']) await assert.rejects(f.store.saveWorkflowTemplate({ ...f.workflow, steps: f.workflow.steps.map(step => step.id === 'review' ? { ...step, onRejectStepId: target } : step) }), /只能退回/);
  assert.deepEqual(f.store.snapshot(), before);
  await f.accept('范围'); await f.accept('实现'); await f.complete('不合格'); await f.control('review', { decision: 'rejected', note: '修正' });
  await f.engine.dispose(); await f.control('retry');
  const valid = f.store.snapshot();
  await assert.rejects(f.store.transaction(state => { state.workflowRuns![0]!.steps[1]!.status = 'accepted'; }), /尚未验收/);
  assert.deepEqual(f.store.snapshot(), valid);
  const reopened = await WorkforceStore.open(f.store.filePath); assert.equal(reopened.snapshot().workflowRuns![0]!.steps[1]!.status, 'pending');
  assert.equal(reopened.snapshot().workflowRuns![0]!.steps[1]!.attempts.length, 1);
});

test('a return withdraws stale verified knowledge even when automatic archive is disabled', async t => {
  const f = await fixture(t); await f.accept('范围'); await f.accept('OLD_VERIFIED_RESULT'); const oldId = f.starts[1]!;
  await f.store.transaction(state => { state.projectTeams!.find(team => team.id === f.installed.id)!.knowledgeEnabled = true; });
  const repository = new KnowledgeRepository(join(f.root, 'knowledge'));
  const knowledge = new KnowledgeEngine(f.store, repository, async () => ({ entries: [], overview: [] }), () => {}); t.after(() => knowledge.dispose());
  const space = { kind: 'project' as const, projectId: f.project.id, teamId: f.installed.id };
  await knowledge.start(); await knowledge.flush();
  assert.ok((await repository.sources(space)).some(source => source.id === `accepted-run:${oldId}` && source.verified));
  await repository.updateArchivePolicy(space, { category: 'task-evidence', enabled: false, expectedVersion: 1 });
  await f.complete('缺陷'); await f.control('review', { decision: 'rejected', note: '必须修正' }); await f.control('retry'); await f.engine.idle(); await knowledge.flush();
  assert.ok(!(await repository.sources(space)).some(source => source.id === `accepted-run:${oldId}`));
  assert.equal(f.store.snapshot().runs.find(run => run.id === oldId)!.acceptance!.decision, 'accepted');
});


test('returning across multiple accepted steps invalidates the whole interval and revalidates it in order', async t => {
  const f = await fixture(t, 3, 'scope');
  await f.accept('OLD_SCOPE'); await f.accept('OLD_IMPLEMENTATION'); await f.complete('不符合范围');
  await f.control('review', { decision: 'rejected', note: '范围需要更正' }); await f.control('retry'); await f.engine.idle();
  assert.deepEqual(f.get().steps.map(step => step.status), ['running', 'pending', 'pending', 'pending']);
  assert.ok(f.get().steps[0]!.attempts[0]!.invalidatedAt); assert.ok(f.get().steps[1]!.attempts[0]!.invalidatedAt);
  assert.doesNotMatch(f.store.snapshot().runs.at(-1)!.request, /OLD_SCOPE|OLD_IMPLEMENTATION/);
  await f.accept('NEW_SCOPE');
  assert.match(f.store.snapshot().runs.at(-1)!.request, /NEW_SCOPE/); assert.doesNotMatch(f.store.snapshot().runs.at(-1)!.request, /OLD_SCOPE|OLD_IMPLEMENTATION/);
  await f.accept('NEW_IMPLEMENTATION'); await f.accept('重验通过'); await f.accept('交付');
  assert.equal(f.get().status, 'succeeded'); assert.deepEqual(f.get().steps.map(step => step.attempts.length), [2, 2, 2, 1]); assert.deepEqual(f.errors, []);
});
