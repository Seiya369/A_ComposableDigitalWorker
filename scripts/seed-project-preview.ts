/** One-time, offline, explicitly simulated project preview. Dry-run unless --apply. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile, mkdir, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkforceStore } from '../src/domain/store.js';
import { validateState } from '../src/domain/validation.js';
import { CONFIRMED_ITEMS_MEDIA_TYPE } from '../src/domain/confirmed-items.js';
import type { ProjectEmployee, ProjectTeam, RunArtifact, WorkforceRun, WorkforceState } from '../src/domain/types.js';
import type { ConversationWorkflowInstance } from '../src/domain/conversation-workflow.js';
import { KnowledgeRepository } from '../src/knowledge/repository.js';
import { AUTO_ARCHIVE_CATEGORIES } from '../src/knowledge/archive-policy.js';
import { isExplicitKnowledgeInput } from '../src/knowledge/archive-checkpoints.js';
import { createWikiRuntime } from '../src/knowledge/wiki-runtime.js';
import type { KnowledgeCompilation, KnowledgeInput, KnowledgeSource, KnowledgeSpace } from '../src/knowledge/types.js';

export const PREVIEW_SEED = 'software-project-preview-v1';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOC_ROOT = resolve(ROOT, 'docs/demo/project-preview');
const FILES = ['01-product-baseline.md', '02-architecture-contract.md', '03-experience-guidelines.md', '04-test-plan.md', '05-release-handover.md', '06-delivery-preview.md'];
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const clone = <T>(value: T): T => structuredClone(value);
// Compare without allowing an assertion diff to print private project bodies.
const same = (a: unknown, b: unknown) => assert.equal(sha(JSON.stringify(a)), sha(JSON.stringify(b)), 'Original project records changed');
export interface PreviewDocument { file: string; title: string; content: string }
export interface PreviewPlan {
  seed: string; projectId: string; sessionId: string; expectedRevision: number; documentsDigest: string; projectReferencesDigest: string;
  originalSelection?: { projectId: string; sessionId: string; instanceId: string | null };
  team: ProjectTeam; employees: ProjectEmployee[]; instance: ConversationWorkflowInstance; runs: WorkforceRun[];
  documents: PreviewDocument[];
  projectMemoryInputs: KnowledgeInput[];
}

export async function readPreviewDocuments(): Promise<PreviewDocument[]> {
  return Promise.all(FILES.map(async file => {
    const content = await readFile(resolve(DOC_ROOT, file), 'utf8');
    assert.match(content, /^# 【演示/);
    return { file, title: content.split('\n')[0]!.replace(/^# /, ''), content };
  }));
}

/** Pure plan construction never edits the supplied state, native sessions or files. */
export function buildPreviewPlan(state: WorkforceState, projectId: string, sessionId: string, documents: PreviewDocument[], at = new Date().toISOString()): PreviewPlan {
  validateState(state);
  assert.ok(state.projects.some(project => project.id === projectId), 'Target project must already exist');
  assert.match(sessionId, /^session-[a-zA-Z0-9-]+$/, 'Pass the dedicated conversation created by the official host');
  assert.ok(documents.length === FILES.length && documents.every(doc => doc.content.startsWith('# 【演示')), 'Use all six marked preview documents');
  const suffix = sha(`${PREVIEW_SEED}:${projectId}`).slice(0, 24);
  const id = (kind: string) => `demo-preview-${kind}-${suffix}`;
  const workflowTemplateId = id('workflow-source');
  const installed = state.conversationWorkflows?.instances.find(instance => instance.projectId === projectId
    && instance.id === state.conversationWorkflows?.defaults.find(entry => entry.projectId === projectId)?.instanceId);
  assert.ok(installed, 'An existing software workflow is required as a read-only source');
  const sourceTeam = state.projectTeams?.find(team => team.id === installed.projectTeamId && team.projectId === projectId);
  const sourceWorkflow = sourceTeam?.workflows.find(workflow => workflow.id === installed.workflowId);
  assert.ok(sourceTeam && sourceWorkflow && sourceWorkflow.steps.length >= 4, 'The source workflow must contain at least four steps');
  assert.ok(!state.runs.some(run => run.sessionId === sessionId && !run.id.startsWith('demo-preview-')), 'Use a dedicated conversation without original plugin deliveries');
  const existing = state.conversationWorkflows?.instances.find(instance => instance.id === id('instance'));
  if (existing) at = existing.createdAt;
  const documentsDigest = sha(JSON.stringify(documents));
  const projectMemoryInputs: KnowledgeInput[] = state.memories.filter(memory => memory.projectId === projectId && memory.scope === 'project')
    .map(memory => ({ id: `memory:${memory.id}`, title: memory.title, content: memory.content,
      provenance: JSON.stringify({ kind: 'confirmed-memory', id: memory.id, version: memory.version, source: memory.source }), verified: true }))
    .filter(isExplicitKnowledgeInput);
  const projectReferencesDigest = sha(JSON.stringify(projectMemoryInputs));
  const originalSelection = state.conversationWorkflows?.selections.find(entry => entry.sessionId === sessionId);
  assert.ok(!originalSelection || originalSelection.projectId === projectId, 'Conversation selection belongs to another project');
  const employeeIds = new Map(sourceTeam.members.map((member, index) => [member.employeeId, id(`employee-${index}`)]));
  const employees = sourceTeam.members.map(member => {
    const source = state.employees.find(employee => employee.id === member.employeeId)!;
    assert.ok(source, 'Source team has a missing employee');
    const employee = clone(source);
    Object.assign(employee, { id: employeeIds.get(source.id)!, name: `【演示】${source.name}`, teamInstanceId: id('team'), version: 1, status: 'active', createdAt: at, updatedAt: at });
    if (source.managerId) employee.managerId = employeeIds.get(source.managerId);
    employee.modules.responsibilities.mission = `【演示岗位，非实际执行】仅用于阅读界面示例，不代表任务已经实施。${employee.modules.responsibilities.mission}`;
    employee.modules.knowledge = { sources: [], projectMemory: false, employeeMemory: false, memoryWritePolicy: 'explicit-only' };
    employee.modules.permissions = { allowedTools: [], readPaths: ['docs/demo/project-preview/**'], writePaths: [], allowShell: false, allowNetwork: false };
    return employee;
  });
  const workflow = clone(sourceWorkflow);
  Object.assign(workflow, { id: id('workflow'), templateWorkflowId: workflowTemplateId, templateWorkflowVersion: 1, name: '【演示】软件工程·界面演示', version: 1 });
  workflow.steps = workflow.steps.map(step => ({ ...step, name: `【演示】${step.name}`, employeeId: employeeIds.get(step.employeeId)!,
    instruction: `【演示说明，非真实任务】${step.instruction}\n本流程只展示模拟记录，未执行开发、测试、部署或真实人审。`,
    outputs: (step.outputs ?? []).map(text => `【演示候选成果】${text}`), acceptanceCriteria: ['【演示】只核对界面内容与来源呈现；不表示真实用户验收或测试通过。'] }));
  const team: ProjectTeam = { id: id('team'), projectId, teamTemplateId: `conversation-workflow:${workflowTemplateId}`, teamTemplateVersion: 1,
    name: '【演示】软件工程·界面演示', knowledgeEnabled: true, status: 'active', version: 1,
    members: sourceTeam.members.map(member => ({ memberId: member.memberId, employeeId: employeeIds.get(member.employeeId)! })), workflows: [workflow], createdAt: at, updatedAt: at };
  const instance: ConversationWorkflowInstance = { id: id('instance'), projectId, workflowTemplateId, workflowTemplateVersion: 1,
    sourceTeamId: installed.sourceTeamId, sourceTeamVersion: installed.sourceTeamVersion, projectTeamId: team.id, workflowId: workflow.id,
    currentStepId: workflow.steps[3]!.id, completions: [], version: 1, createdAt: at, updatedAt: at };
  const confirmed = (stepId: string): RunArtifact => ({ id: id(`items-${stepId}`), title: '【演示】模拟确定事项.confirmed-items.json', mediaType: CONFIRMED_ITEMS_MEDIA_TYPE,
    content: JSON.stringify({ schemaVersion: 1, items: [
      { id: `demo-${stepId}-scope`, title: '【演示】扩展边界约定', content: '【演示声明，非真实用户确认】示例方案采用官方插件公开扩展边界，不修改宿主。' },
      { id: `demo-${stepId}-cas`, title: '【演示】状态写入约定', content: '【演示声明，非真实用户确认】示例接口携带预期版本，冲突时重新读取，不静默覆盖。' },
      { id: `demo-${stepId}-evidence`, title: '【演示】知识来源约定', content: '【演示声明，非真实用户确认】关系保留精确原文引用，候选知识不等于真实验收。' },
    ] }, null, 2) });
  const manifest: RunArtifact = { id: id('manifest'), title: '【演示】种子来源清单.json', mediaType: 'application/json', content: JSON.stringify({ seed: PREVIEW_SEED, documentsDigest, projectReferencesDigest, projectId, sessionId, simulated: true, modelCalls: 0 }) };
  const runs: WorkforceRun[] = [];
  const addRun = (key: string, stepIndex: number, status: WorkforceRun['status'], docIndex: number, detail: string) => {
    const step = workflow.steps[stepIndex]!, employee = employees.find(entry => entry.id === step.employeeId)!;
    const time = new Date(Date.parse(at) + runs.length * 1000).toISOString();
    const document = documents[docIndex]!;
    const run: WorkforceRun = { id: id(`run-${key}`), projectId, employeeId: employee.id, employeeSnapshot: clone(employee), sessionId,
      conversationWorkflow: { instanceId: instance.id, stepId: step.id }, request: `【演示】${detail}`, status,
      output: `【演示交付，非真实开发或测试结果】\n${detail}\n本记录由一次性脚本人工设置，未发生模型执行或真实验收。`,
      artifacts: [{ id: id(`document-${key}`), title: `【演示成果】${document.title.replace(/^【演示资料】/, '')}`, path: `docs/demo/project-preview/${document.file}`, content: document.content, mediaType: 'text/markdown' },
        ...(status === 'succeeded' ? [confirmed(step.id)] : []), ...(key === 'test-plan-pending' ? [manifest] : [])],
      version: 1, createdAt: time, updatedAt: time, finishedAt: time };
    if (status === 'succeeded' || status === 'failed') run.acceptance = { decision: status === 'succeeded' ? 'accepted' : 'rejected', reviewer: '演示验收（模拟）', note: '界面示例，非真实验收；未执行真实测试或代码评审。', at: time };
    if (status === 'succeeded') instance.completions.push({ stepId: step.id, runId: run.id, acceptedAt: time });
    runs.push(run);
  };
  addRun('requirements', 0, 'succeeded', 0, '需求基线模拟交付与模拟验收');
  addRun('experience', 1, 'succeeded', 2, '交互设计模拟交付与模拟验收');
  addRun('architecture-rejected', 2, 'failed', 1, '架构初稿模拟退回：示例遗漏重复提交与版本冲突说明');
  addRun('architecture-accepted', 2, 'succeeded', 1, '架构修订稿模拟验收：仅展示已确定事项与来源');
  addRun('test-plan-pending', 3, 'awaiting-review', 3, '测试计划候选交付：用例全部未执行，等待真实复核，非测试通过报告');
  return { seed: PREVIEW_SEED, projectId, sessionId, expectedRevision: state.revision, documentsDigest, projectReferencesDigest, ...(originalSelection ? { originalSelection: clone(originalSelection) } : {}), team, employees, instance, runs, documents: clone(documents), projectMemoryInputs };
}

function appendPreview(state: WorkforceState, plan: PreviewPlan): void {
  assert.ok(!state.projectTeams?.some(team => team.id === plan.team.id), 'Preview is already installed');
  assert.ok(!state.employees.some(employee => plan.employees.some(entry => entry.id === employee.id)), 'Preview employee ID collision');
  assert.ok(!state.runs.some(run => plan.runs.some(entry => entry.id === run.id)), 'Preview delivery ID collision');
  state.projectTeams ??= []; state.projectTeams.push(clone(plan.team));
  state.employees.push(...clone(plan.employees)); state.runs.push(...clone(plan.runs));
  state.conversationWorkflows ??= { instances: [], defaults: [], selections: [] };
  state.conversationWorkflows.instances.push(clone(plan.instance));
  const selection = state.conversationWorkflows.selections.find(entry => entry.sessionId === plan.sessionId);
  if (selection) { assert.equal(selection.projectId, plan.projectId); selection.instanceId = plan.instance.id; }
  else state.conversationWorkflows.selections.push({ projectId: plan.projectId, sessionId: plan.sessionId, instanceId: plan.instance.id });
}

/** Every original record and workflow choice is immutable except the named new demo conversation. */
export function assertOriginalRecordsPreserved(before: WorkforceState, after: WorkforceState, plan: PreviewPlan): void {
  const restored = clone(after); restored.revision = before.revision;
  restored.employees = restored.employees.filter(entry => !plan.employees.some(employee => employee.id === entry.id));
  restored.runs = restored.runs.filter(entry => !plan.runs.some(run => run.id === entry.id));
  if (!before.workflowTemplates?.some(entry => entry.id === plan.instance.workflowTemplateId) && restored.workflowTemplates) {
    restored.workflowTemplates = restored.workflowTemplates.filter(entry => entry.id !== plan.instance.workflowTemplateId);
    if (before.workflowTemplates === undefined) delete restored.workflowTemplates;
  }
  if (restored.projectTeams) restored.projectTeams = restored.projectTeams.filter(entry => entry.id !== plan.team.id);
  const configuration = restored.conversationWorkflows!;
  configuration.instances = configuration.instances.filter(entry => entry.id !== plan.instance.id);
  configuration.selections = clone(before.conversationWorkflows?.selections ?? []);
  const originalOthers = (before.conversationWorkflows?.selections ?? []).filter(entry => entry.sessionId !== plan.sessionId);
  same(after.conversationWorkflows!.selections.filter(entry => entry.sessionId !== plan.sessionId), originalOthers);
  if (before.projectTeams === undefined) delete restored.projectTeams;
  if (before.conversationWorkflows === undefined) delete restored.conversationWorkflows;
  same(restored, before);
}

export function compilePreviewKnowledge(sources: KnowledgeSource[]): KnowledgeCompilation {
  const entries = sources.map(source => ({ id: `demo-entry-${sha(source.id).slice(0, 20)}`, title: `${source.provenance.startsWith('demo:') ? '【演示知识】' : '【既有项目记忆引用】'}${source.title}`,
    content: source.provenance.startsWith('demo:') ? `【演示候选知识】人工整理，未调用模型；非真实测试或验收。\n\n${source.text}` : source.text,
    citations: [{ sourceId: source.id, sourceVersion: source.version, startLine: 1, endLine: source.text.split('\n').length }] }));
  const definitions = new Map<string, { id: string; name: string; summary: string; entryIds: string[]; citations: Array<{ sourceId: string; sourceVersion: number; startLine: number; endLine: number }> }>();
  const evidence = (source: KnowledgeSource, line: number) => ({ sourceId: source.id, sourceVersion: source.version, startLine: line + 1, endLine: line + 1 });
  for (const [index, source] of sources.entries()) {
    if (!source.provenance.startsWith('demo:')) continue;
    let active = false;
    source.text.split('\n').forEach((line, lineNumber) => {
      if (line.startsWith('## ')) { active = line === '## 专业定义'; return; }
      if (!active) return;
      const match = /^([^：]+)：(.+)$/.exec(line); if (!match) return;
      const name = match[1]!, existing = definitions.get(name);
      if (existing) { existing.entryIds.push(entries[index]!.id); existing.citations.push(evidence(source, lineNumber)); }
      else definitions.set(name, { id: `demo-concept-${sha(name).slice(0, 20)}`, name, summary: `【演示候选】${match[2]}`, entryIds: [entries[index]!.id], citations: [evidence(source, lineNumber)] });
    });
  }
  const names = [...definitions.keys()].sort((a, b) => b.length - a.length);
  const relations: NonNullable<KnowledgeCompilation['conceptGraph']>['relations'] = [];
  for (const [index, source] of sources.entries()) {
    if (!source.provenance.startsWith('demo:')) continue;
    let active = false;
    source.text.split('\n').forEach((line, lineNumber) => {
      if (line.startsWith('## ')) { active = line === '## 明确关系'; return; }
      if (!active || !line.trim()) return;
      const from = names.find(name => line.startsWith(name));
      const to = names.find(name => line.endsWith(`${name}。`));
      assert.ok(from && to && from !== to, `Every demo relationship must be an explicit original sentence: ${source.title}:${lineNumber + 1}`);
      const predicate = line.slice(from.length, line.length - to.length - 1);
      assert.ok(predicate && predicate.length <= 40, 'Invalid handwritten demo predicate');
      relations.push({ id: `demo-relation-${sha(line).slice(0, 20)}`, sourceId: definitions.get(from)!.id, targetId: definitions.get(to)!.id, predicate,
        summary: `【演示原文】${line}`, basis: 'explicit', entryIds: [entries[index]!.id], citations: [evidence(source, lineNumber)] });
    });
  }
  return { entries, overview: [{ id: 'demo-software-overview', title: '【演示】软件工程知识索引', summary: '六篇自写演示资料形成候选专业知识与关系，另附现有同项目显式记忆的只读原文引用，不从原记忆生成演示概念或关系。演示不是实际完成或验收的证明。', entryIds: entries.map(entry => entry.id) }],
    conceptGraph: { schemaVersion: 1, concepts: [...definitions.values()].map(concept => ({ ...concept, kind: ['项目团队', '工作流实例', '插件入口', '发布清单'].includes(concept.name) ? 'entity' as const : 'concept' as const })), relations },
    compilationTrace: { revision: 'strict-incremental-v1', changedSourceIds: sources.map(source => source.id), removedSourceIds: [], modelCalls: 0 } };
}

async function prepareKnowledge(repository: KnowledgeRepository, plan: PreviewPlan) {
  const space: KnowledgeSpace = { kind: 'project', projectId: plan.projectId, teamId: plan.team.id };
  for (const current of [space, ...plan.employees.map(employee => ({ ...space, memberId: employee.id }))]) {
    await repository.ensure(current);
    await repository.markSeeded(current, { teamId: plan.team.teamTemplateId, version: 1 });
    for (const category of AUTO_ARCHIVE_CATEGORIES) {
      const policy = await repository.archivePolicy(current);
      if (policy.categories[category]) await repository.updateArchivePolicy(current, { category, enabled: false, expectedVersion: policy.version });
    }
  }
  for (const document of plan.documents) await repository.ingest(space, { id: `demo-document:${PREVIEW_SEED}:${document.file}`, title: document.title,
    content: document.content, provenance: `demo:${PREVIEW_SEED}:hand-authored:${document.file}`, verified: false, category: 'reference' });
  for (const input of plan.projectMemoryInputs) await repository.ingest(space, input);
  const sources = await repository.sources(space), fingerprint = await repository.fingerprint(space);
  let snapshot = await repository.snapshot(space);
  if (!snapshot || snapshot.sourceFingerprint !== fingerprint) snapshot = await repository.publish(space, compilePreviewKnowledge(sources), fingerprint, undefined, snapshot?.version ?? null);
  assert.equal(snapshot.status, 'candidate'); assert.equal(snapshot.compilationTrace?.modelCalls, 0);
  const runtime = createWikiRuntime();
  try {
    const spaceKey = JSON.stringify([space.kind, space.projectId ?? '', space.teamId, space.memberId ?? '']);
    const view = await runtime.build({ spaceId: sha(JSON.stringify(spaceKey)), snapshot, sources });
    await repository.publishWikiProjection(space, view, fingerprint);
    return { space, snapshotVersion: snapshot.version, sourceCount: sources.length, concepts: view.graph.nodes.length, relations: view.graph.edges.reduce((sum, edge) => sum + (edge.relations?.length ?? 0), 0), modelCalls: 0 };
  } finally { await runtime.dispose(); }
}

export async function requireStoppedPort(port: number): Promise<void> {
  assert.ok(Number.isSafeInteger(port) && port > 0 && port <= 65535, 'Invalid service port');
  await new Promise<void>((done, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (error?: Error) => { socket.destroy(); error ? reject(error) : done(); };
    socket.once('connect', () => finish(new Error('Refusing offline seed while the service port is listening')));
    socket.once('error', error => finish((error as NodeJS.ErrnoException).code === 'ECONNREFUSED' ? undefined : error));
    socket.setTimeout(1200, () => finish(new Error('Cannot prove that the service is stopped')));
  });
}

export async function applyPreviewPlan(statePath: string, plan: PreviewPlan, options: { expectedRevision: number; servicePort: number }) {
  assert.ok(Number.isSafeInteger(options.expectedRevision) && options.expectedRevision >= 0, 'An explicit integer revision is required');
  await requireStoppedPort(options.servicePort);
  const store = await WorkforceStore.open(statePath), before = store.snapshot();
  const previous = before.runs.find(run => run.id === plan.runs.at(-1)!.id)?.artifacts.find(artifact => artifact.id.endsWith(plan.team.id.slice('demo-preview-team-'.length)) && artifact.title === '【演示】种子来源清单.json');
  if (previous) {
    const receipt = JSON.parse(previous.content!);
    assert.equal(receipt.documentsDigest, plan.documentsDigest, 'Existing preview was created from different documents; do not overwrite');
    assert.equal(receipt.projectReferencesDigest, plan.projectReferencesDigest, 'Existing project references changed; do not overwrite the preview');
    assert.equal(receipt.sessionId, plan.sessionId, 'Existing preview belongs to another demo conversation');
    assert.equal(before.conversationWorkflows?.selections.find(entry => entry.sessionId === plan.sessionId)?.instanceId, plan.instance.id, 'Existing preview selection has changed');
    return { status: 'already-applied', revision: before.revision, teamId: plan.team.id, instanceId: plan.instance.id, modelCalls: 0 };
  }
  assert.equal(before.revision, options.expectedRevision, 'Fresh explicit revision is required');
  assert.equal(plan.expectedRevision, options.expectedRevision, 'Plan revision is stale');
  const candidate = clone(before); appendPreview(candidate, plan); validateState(candidate); assertOriginalRecordsPreserved(before, candidate, plan);
  const repository = new KnowledgeRepository(resolve(dirname(statePath), 'knowledge', basename(statePath)));
  const knowledge = await prepareKnowledge(repository, plan);
  await store.transaction(state => { appendPreview(state, plan); assertOriginalRecordsPreserved(before, state, plan); }, { expectedRevision: options.expectedRevision });
  const after = store.snapshot(); assertOriginalRecordsPreserved(before, after, plan);
  return { status: 'applied', revision: after.revision, teamId: plan.team.id, instanceId: plan.instance.id, newEmployees: plan.employees.length, simulatedRuns: plan.runs.length, knowledge, modelCalls: 0 };
}

async function main() {
  const args = process.argv.slice(2), value = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  const statePath = value('--state'), projectId = value('--project'), sessionId = value('--session');
  assert.ok(statePath && projectId && sessionId, 'Required: --state ABSOLUTE_PATH --project ID --session OFFICIALLY_CREATED_DEMO_SESSION_ID [--apply --expected-revision N --service-port N]');
  const path = resolve(statePath); await access(path);
  const state = JSON.parse(await readFile(path, 'utf8')) as WorkforceState;
  const plan = buildPreviewPlan(state, projectId, sessionId, await readPreviewDocuments());
  const preview = { mode: args.includes('--apply') ? 'apply' : 'dry-run', seed: plan.seed, projectId, sessionId, expectedRevision: plan.expectedRevision, documentsDigest: plan.documentsDigest, projectReferencesDigest: plan.projectReferencesDigest,
    name: plan.team.name, teamId: plan.team.id, instanceId: plan.instance.id, employees: plan.employees.length, simulatedRuns: plan.runs.length,
    simulatedCompletedSteps: plan.instance.completions.length, currentStepId: plan.instance.currentStepId, documents: plan.documents.map(doc => doc.file), existingProjectMemoryReferences: plan.projectMemoryInputs.length, modelCalls: 0,
    originalDefaultsAndInstancesPreserved: true, onlyDedicatedConversationOverride: true };
  const result = args.includes('--apply') ? await applyPreviewPlan(path, plan, { expectedRevision: Number(value('--expected-revision')), servicePort: Number(value('--service-port') ?? 3081) }) : preview;
  if (value('--report')) { const report = resolve(value('--report')!); await mkdir(dirname(report), { recursive: true }); await writeFile(report, `${JSON.stringify(result, null, 2)}\n`); }
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error instanceof Error ? error.message : 'Preview seed failed'); process.exitCode = 1; });
