import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlankModules, createSeedState } from '../src/domain/seed.js';
import type { ProjectEmployee, RunStatus, WorkforceRun, WorkforceState } from '../src/domain/types.js';
import type { WorkTask } from '../src/work/types.js';
import type { WorkflowRun } from '../src/workflow/types.js';
import { isExplicitKnowledgeInput, knowledgeArchiveCheckpoint, knowledgeArchiveCheckpointEntries } from '../src/knowledge/archive-checkpoints.js';
import type { KnowledgeInput, KnowledgeSpace } from '../src/knowledge/types.js';

const at = '2026-10-24T00:00:00.000Z';
const space: KnowledgeSpace = { kind: 'project', projectId: 'project', teamId: 'team' };
const privateSpace = { ...space, memberId: 'alice' };
function employee(id: string): ProjectEmployee {
  return { id, projectId: 'project', name: id, templateId: id, templateName: id, templateVersion: 1, modules: createBlankModules(), version: 1, status: 'active', createdAt: at, updatedAt: at };
}
function run(id: string, owner = 'alice', status: RunStatus = 'running', extra: Partial<WorkforceRun> = {}): WorkforceRun {
  return { id, projectId: 'project', employeeId: owner, request: 'Complete the task', status, employeeSnapshot: employee(owner), artifacts: [], version: 1, createdAt: at, updatedAt: at, ...extra };
}
function task(id: string, status: WorkTask['status'], attempt?: string, owner = 'alice'): WorkTask {
  return { id, projectId: 'project', title: id, goal: 'Deliver the result', employeeId: owner, inputs: [], acceptanceCriteria: ['Review it'], dependencyTaskIds: [], requiredDeliverableIds: [], attemptRunIds: attempt ? [attempt] : [], status, manualReview: true, inputVersions: [], version: 1, createdAt: at, updatedAt: at };
}
function fixture(): WorkforceState {
  const state = createSeedState(at); state.runs = [];
  state.workState = { briefs: [], tasks: [], deliverables: [], events: [], receipts: [] };
  return state;
}
function workflow(status: WorkflowRun['steps'][number]['status'], attempt?: string, owner = 'alice'): WorkflowRun {
  return { id: 'flow', projectId: 'project', projectTeamId: 'team', workflowId: 'definition', requestId: 'request',
    definition: { id: 'definition', templateWorkflowId: 'template', name: 'Delivery', steps: [{ id: 'step', name: 'Produce', employeeId: owner, instruction: 'Produce the result' }] },
    request: 'Deliver', status: 'running', steps: [{ stepId: 'step', status, attempts: attempt ? [{ runId: attempt, number: 1, createdAt: at }] : [] }], version: 1, commands: [], events: [], createdAt: at, updatedAt: at };
}
const entries = (state: WorkforceState, target: KnowledgeSpace = privateSpace) => knowledgeArchiveCheckpointEntries(state, target, ['alice', 'bob']);
const checkpoint = (state: WorkforceState, target: KnowledgeSpace = privateSpace) => knowledgeArchiveCheckpoint(state, target, ['alice', 'bob']);
const accept = (value: WorkforceRun): void => { value.status = 'succeeded'; value.acceptance = { decision: 'accepted', reviewer: 'Owner', note: 'Reviewed', at }; };

test('resident light consultations never create automatic long-term archive checkpoints', () => {
  const state = fixture(), before = checkpoint(state);
  for (const status of ['succeeded', 'failed', 'cancelled'] as const) state.runs.push(run(`consult-${status}`, 'alice', status, {
    conversationEmployee: { sessionId: 'chat-session', mode: 'consult', bindingVersion: 1 }, output: 'An ordinary short answer',
  }));
  assert.equal(checkpoint(state), before);
  assert.deepEqual(entries(state), []);
  state.runs.push(run('execute', 'alice', 'succeeded', { conversationEmployee: { sessionId: 'chat-session', mode: 'execute', bindingVersion: 2 } }));
  assert.equal(entries(state).length, 1, 'execution retains ordinary archive policy');
});

test('task completion waits for the authoritative task and run to agree instead of each intermediate turn or transaction', () => {
  const state = fixture(); const attempt = run('attempt', 'alice', 'running', { workTaskId: 'task' });
  state.runs.push(attempt); const item = task('task', 'running', attempt.id); state.workState!.tasks.push(item);
  const initial = checkpoint(state);
  Object.assign(attempt, { version: 99, sessionId: 'session', usage: { inputTokens: 100, outputTokens: 20 }, artifacts: [{ id: 'a', title: 'Draft', content: 'Draft' }] });
  assert.equal(checkpoint(state), initial);
  attempt.status = 'awaiting-review'; item.status = 'awaiting-review'; assert.deepEqual(entries(state), []);
  item.status = 'accepted'; assert.deepEqual(entries(state), [], 'do not publish before the corresponding accepted run is committed');
  accept(attempt); const stable = entries(state); assert.equal(stable.length, 1); assert.equal(stable[0]![0], 'task:task');
  attempt.version++; attempt.updatedAt = 'later'; attempt.usage!.outputTokens++; attempt.artifacts.push({ id: 'b', title: 'Noise', content: 'Ignored' });
  item.version++; item.updatedAt = 'later'; state.revision++;
  assert.deepEqual(entries(state), stable, 'metadata and artifact notifications are not another business checkpoint');
});

test('failed and cancelled project attempts produce a checkpoint only after their task reaches its stable stage', () => {
  const state = fixture(); const attempt = run('attempt', 'alice', 'failed', { workTaskId: 'task', error: 'Provider failed' }); state.runs.push(attempt);
  const item = task('task', 'running', attempt.id); state.workState!.tasks.push(item);
  assert.deepEqual(entries(state), [], 'run.failed is the first scheduler transaction, not a separate checkpoint');
  item.status = 'blocked'; const blocked = checkpoint(state); assert.equal(entries(state).length, 1);
  attempt.error = 'A distinct failure'; assert.notEqual(checkpoint(state), blocked);
  attempt.status = 'running'; item.status = 'cancelled'; assert.deepEqual(entries(state), [], 'wait until a cancelled task has stopped its active attempt');
  attempt.status = 'cancelled'; assert.equal(entries(state).length, 1);
  const manual = task('manual', 'accepted'); state.workState!.tasks = [manual]; assert.equal(entries(state)[0]![0], 'task:manual');
  item.status = 'needs-revalidation'; attempt.status = 'awaiting-review'; state.workState!.tasks = [item]; assert.equal(entries(state).length, 1);
});

test('task checkpoint includes actual deliverable revisions, review decisions and invalidation, with stable ordering', () => {
  const state = fixture(); state.workState!.tasks.push(task('task', 'accepted'));
  state.workState!.deliverables.push({ id: 'result', projectId: 'project', taskId: 'task', title: 'Result', version: 1, createdAt: at, updatedAt: at,
    revisions: [{ version: 1, content: 'Private source body', inputVersions: [], reviews: [], createdAt: at }] });
  const deliverable = state.workState!.deliverables[0]!; const original = checkpoint(state);
  deliverable.version++; deliverable.updatedAt = 'later'; assert.equal(checkpoint(state), original);
  deliverable.revisions[0]!.review = { decision: 'accepted', reviewer: 'Owner', note: 'Confirmed', at };
  const reviewed = checkpoint(state); assert.notEqual(reviewed, original);
  deliverable.revisions[0]!.review!.at = 'later'; assert.equal(checkpoint(state), reviewed, 'review timestamps alone do not add knowledge');
  deliverable.revisions[0]!.invalidatedAt = at; deliverable.revisions[0]!.invalidationReason = 'Input was superseded';
  const invalidated = checkpoint(state); assert.notEqual(invalidated, reviewed);
  deliverable.revisions[0]!.invalidatedAt = 'later'; assert.equal(checkpoint(state), invalidated);
  deliverable.revisions.push({ version: 2, content: 'Revised result', inputVersions: [], reviews: [], createdAt: at }); assert.notEqual(checkpoint(state), invalidated);
  state.workState!.deliverables.push({ ...structuredClone(deliverable), id: 'another' });
  const sorted = checkpoint(state); state.workState!.deliverables.reverse(); assert.equal(checkpoint(state), sorted);
  assert.ok(entries(state).every(([, summary]) => /^[a-f0-9]{64}$/.test(summary)), 'checkpoint summaries contain no source body');
});

test('workflow checkpoints are per stable step and wait for the latest accepted or stopped attempt', () => {
  const state = fixture(); const flow = workflow('running', 'attempt'); state.workflowRuns = [flow];
  const attempt = run('attempt', 'alice', 'failed', { workflow: { workflowRunId: 'flow', stepId: 'step', attempt: 1, timeoutMs: 1000 } }); state.runs.push(attempt);
  assert.deepEqual(entries(state), []); flow.steps[0]!.status = 'blocked'; const blocked = checkpoint(state); assert.equal(entries(state)[0]![0], 'workflow:flow:step');
  flow.version++; flow.updatedAt = 'later'; flow.status = 'paused'; flow.events.push({ at, kind: 'pause', message: 'Pause' });
  assert.equal(checkpoint(state), blocked);
  flow.steps[0]!.status = 'accepted'; attempt.status = 'awaiting-review'; assert.deepEqual(entries(state), []);
  accept(attempt); assert.equal(entries(state).length, 1); assert.notEqual(checkpoint(state), blocked);
  flow.projectTeamId = 'another-team'; assert.deepEqual(entries(state), [], 'a team library does not track another team workflow');
});

test('independent delegation batches only the current library members after the root reaches a stable end', () => {
  const state = fixture(); const root = run('root', 'bob', 'running');
  const child = run('child', 'alice', 'awaiting-review', { parentRunId: root.id, output: 'Alice private result' });
  const sibling = run('sibling', 'bob', 'failed', { parentRunId: root.id, error: 'Bob private result' }); state.runs.push(root, child, sibling);
  assert.deepEqual(entries(state), []); root.status = 'awaiting-review'; assert.deepEqual(entries(state), []);
  root.status = 'failed'; root.error = 'Parent private failure'; const stable = checkpoint(state); assert.equal(entries(state).length, 1); assert.equal(entries(state)[0]![0], 'run:root');
  root.error = 'Changed parent private failure'; sibling.error = 'Changed sibling private failure'; sibling.status = 'cancelled'; assert.equal(checkpoint(state), stable, 'other employee private evidence does not enter this summary');
  child.status = 'failed'; child.error = 'Alice failure'; assert.notEqual(checkpoint(state), stable);
  assert.notEqual(checkpoint(state, space), checkpoint(state), 'team and private members have distinct batching frontiers');
  const bobOnly = knowledgeArchiveCheckpointEntries(state, privateSpace, ['bob']); assert.deepEqual(bobOnly, [], 'a private space must also belong to the supplied group');
});

test('delegated children in project tasks wait for the authoritative parent task stage', () => {
  const state = fixture(); const root = run('root', 'bob', 'failed', { workTaskId: 'task' }); const child = run('child', 'alice', 'failed', { parentRunId: root.id });
  const item = task('task', 'running', root.id, 'bob'); state.workState!.tasks.push(item); state.runs.push(root, child);
  assert.deepEqual(entries(state), []); item.status = 'blocked'; const stable = checkpoint(state); assert.equal(entries(state).length, 1);
  item.error = 'Bob private error'; item.feedback = 'Bob private feedback'; assert.equal(checkpoint(state), stable);
  child.error = 'Alice private error'; assert.notEqual(checkpoint(state), stable);
  root.parentRunId = child.id; assert.deepEqual(entries(state), [], 'malformed ancestry cycles cannot create a checkpoint');
});

test('checkpoint entries allow the engine to preserve prior phases across a retry without treating disappearance as new work', () => {
  const state = fixture(); const item = task('task', 'blocked', 'first'); const first = run('first', 'alice', 'failed', { workTaskId: item.id }); state.runs.push(first); state.workState!.tasks.push(item);
  const observed = new Map(entries(state));
  const changed = () => { let result = false; for (const [id, value] of entries(state)) { if (observed.get(id) !== value) result = true; observed.set(id, value); } return result; };
  assert.equal(changed(), false);
  const second = run('second', 'alice', 'running', { workTaskId: item.id }); state.runs.push(second); item.attemptRunIds.push(second.id); item.status = 'running';
  assert.deepEqual(entries(state), []); assert.equal(changed(), false); second.status = 'awaiting-review'; item.status = 'awaiting-review'; assert.equal(changed(), false);
  accept(second); item.status = 'accepted'; assert.equal(changed(), true); assert.equal(changed(), false);
});

test('project and member scopes exclude unrelated tasks and keep deterministic ordering', () => {
  const state = fixture(); const own = run('z', 'alice', 'failed'); const other = run('a', 'bob', 'failed'); const foreign = run('foreign', 'alice', 'failed', { projectId: 'other-project' }); state.runs.push(own, other, foreign);
  const personal = checkpoint(state); other.error = 'Unrelated'; foreign.error = 'Other project'; assert.equal(checkpoint(state), personal);
  assert.equal(entries(state).length, 1); assert.equal(entries(state, space).length, 2);
  const team = checkpoint(state, space); state.runs.reverse(); assert.equal(checkpoint(state, space), team);
  assert.deepEqual(entries(state, { kind: 'template', teamId: 'team', memberId: 'alice' }), []);
});

test('explicit professional sources and human-confirmed memories bypass auto scheduling without reclassifying automatic evidence', () => {
  const input = (extra: Partial<KnowledgeInput> = {}): KnowledgeInput => ({ id: 'upload:document', title: 'Document', content: 'Evidence', provenance: 'user-upload:document', verified: false, category: 'reference', ...extra });
  assert.equal(isExplicitKnowledgeInput(input()), true);
  assert.equal(isExplicitKnowledgeInput(input({ id: 'configuration:reference', provenance: 'configuration:text:reference' })), true);
  assert.equal(isExplicitKnowledgeInput(input({ id: 'file-authorized', provenance: JSON.stringify({ kind: 'project-file', path: 'docs/reference.md' }) })), true);
  assert.equal(isExplicitKnowledgeInput(input({ id: 'employee-template:reference', provenance: 'employee-template-snapshot:source@1/reference@1' })), true);
  assert.equal(isExplicitKnowledgeInput(input({ id: 'team-description', provenance: 'team:team' })), false);
  assert.equal(isExplicitKnowledgeInput(input({ id: 'run:one', provenance: 'run:one@1', category: 'task-evidence' })), false);
  assert.equal(isExplicitKnowledgeInput(input({ id: 'work-task:one', provenance: 'work-task:one@1', category: 'incident/reflection-proposal' })), false);
  const memory = (kind: string) => input({ id: 'memory:one', category: undefined, provenance: JSON.stringify({ kind: 'confirmed-memory', id: 'one', source: { kind } }) });
  assert.equal(isExplicitKnowledgeInput(memory('user-confirmed')), true);
  assert.equal(isExplicitKnowledgeInput(memory('project-file')), true);
  assert.equal(isExplicitKnowledgeInput(memory('accepted-artifact')), false);
  assert.equal(isExplicitKnowledgeInput(input({ id: 'memory:one', provenance: 'opaque' })), false);
  assert.equal(isExplicitKnowledgeInput(input({ id: 'memory:one', provenance: JSON.stringify({ kind: 'confirmed-memory', id: 'different', source: { kind: 'user-confirmed' } }) })), false);
});
