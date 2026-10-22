import { invariant, textField } from './errors.js';
import { validateWorkflows } from '../workflow/definition.js';
export { invariant, textField, WorkforceError } from './errors.js';
export { validateWorkflows } from '../workflow/definition.js';
import type { EmployeeModules, WorkforceState } from './types.js';
import { validateWorkflowRuns } from '../workflow/validation.js';
import { validateWorkflowTemplates } from './workflow-template.js';
import { validateProjectWork } from '../work/validation.js';

function object(value: unknown, label: string): asserts value is Record<string, unknown> {
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} 必须为对象`);
}
function list(value: unknown, label: string): asserts value is unknown[] { invariant(Array.isArray(value), `${label} 必须为数组`); }
function strings(value: unknown, label: string) { list(value, label); value.forEach(v => textField(v, label)); }
function bool(value: unknown, label: string) { invariant(typeof value === 'boolean', `${label} 必须为布尔值`); }
function integer(value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER) { invariant(Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max, `${label} 超出有效整数范围`); }
function oneOf(value: unknown, values: readonly string[], label: string) { invariant(typeof value === 'string' && values.includes(value), `${label} 无效`); }
function timestamp(value: unknown, label: string) { textField(value, label); invariant(Number.isFinite(Date.parse(value)), `${label} 无效`); }
function identity(value: unknown, label: string): asserts value is Record<string, unknown> {
  object(value, label); textField(value.id, `${label}.id`); timestamp(value.createdAt, `${label}.createdAt`); timestamp(value.updatedAt, `${label}.updatedAt`);
}
export function validateRelativePath(path: unknown, label = '路径'): asserts path is string {
  textField(path, label);
  invariant(!path.startsWith('/') && !path.includes('\\') && !path.includes('\0') && !/^[A-Za-z]:/.test(path) && !path.split('/').includes('..'), `${label} 必须为项目内相对路径`);
}
export function validateModules(value: unknown, ready = false): asserts value is EmployeeModules {
  object(value, '七模块');
  const r = value.responsibilities; object(r, '岗位职责'); textField(r.mission, '岗位使命', !ready); strings(r.duties, '岗位职责'); strings(r.boundaries, '职责边界');
  if (ready) invariant((r.duties as string[]).length > 0, '可运行员工至少需要一项岗位职责');
  const c = value.capabilities; object(c, '能力组合'); list(c.skills, '技能'); list(c.tools, '工具');
  for (const s of c.skills) { object(s, '技能'); textField(s.id, '技能 ID'); textField(s.name, '技能名称'); textField(s.description, '技能描述', true); }
  for (const t of c.tools) { object(t, '工具'); textField(t.id, '工具 ID'); textField(t.description, '工具描述', true); }
  const m = value.model; object(m, '模型配置'); oneOf(m.mode, ['inherit', 'override'], '模型模式');
  for (const key of ['provider', 'model', 'reasoningEffort']) if (m[key] !== undefined) textField(m[key], `模型 ${key}`);
  if (m.mode === 'override') { textField(m.provider, '模型 provider'); textField(m.model, '模型名称'); }
  invariant(!('apiKey' in m) && !('token' in m), '模型配置不能保存密钥');
  const k = value.knowledge; object(k, '知识与记忆'); list(k.sources, '知识来源'); bool(k.projectMemory, '项目记忆'); bool(k.employeeMemory, '员工记忆'); oneOf(k.memoryWritePolicy, ['explicit-only'], '记忆写入策略');
  for (const s of k.sources) { object(s, '知识来源'); textField(s.id, '知识 ID'); textField(s.title, '知识标题'); oneOf(s.kind, ['project-file', 'url', 'text'], '知识类型'); textField(s.value, '知识内容'); if (s.kind === 'project-file') validateRelativePath(s.value); if (s.kind === 'url') invariant(/^https?:\/\//.test(s.value as string), '知识链接必须使用 HTTP(S)'); }
  const p = value.permissions; object(p, '权限'); strings(p.allowedTools, '工具白名单'); strings(p.readPaths, '读取路径'); strings(p.writePaths, '写入路径'); (p.readPaths as string[]).forEach(v => validateRelativePath(v)); (p.writePaths as string[]).forEach(v => validateRelativePath(v)); bool(p.allowShell, 'shell 权限'); bool(p.allowNetwork, '网络权限');
  const co = value.collaboration; object(co, '协作规则'); bool(co.canDelegate, '委派开关'); strings(co.allowedTemplateIds, '可委派模板'); integer(co.maxDepth, '委派深度', 0, 16); integer(co.maxConcurrent, '并发数', 1, 32); strings(co.escalationRules, '升级规则');
  const d = value.delivery; object(d, '交付标准'); strings(d.requiredArtifacts, '交付物'); strings(d.acceptanceCriteria, '验收标准'); bool(d.reviewRequired, '需要验收');
  if (ready) invariant((d.acceptanceCriteria as string[]).length > 0, '可运行员工至少需要一项验收标准');
}

export function validateHierarchy(nodes: Array<{ id: string; parent?: string }>, label: string): void {
  const parents = new Map<string, string | undefined>();
  for (const n of nodes) { invariant(!parents.has(n.id), `${label} ID 重复`); parents.set(n.id, n.parent); }
  for (const node of nodes) {
    const seen = new Set<string>(); let current: string | undefined = node.id;
    while (current !== undefined) { invariant(parents.has(current), `${label} 上级不存在`); invariant(!seen.has(current), `${label} 汇报关系存在循环`); seen.add(current); current = parents.get(current); }
  }
}

export function validateState(value: unknown): asserts value is WorkforceState {
  object(value, '存储'); invariant(value.schemaVersion === 1, '不支持的存储格式版本'); integer(value.revision, 'revision');
  for (const key of ['templates', 'teams', 'projects', 'employees', 'memories', 'runs']) {
    list(value[key], key); const ids = new Set<string>();
    for (const entry of value[key] as unknown[]) { identity(entry, key); invariant(!ids.has(entry.id as string), `${key} ID 重复`); ids.add(entry.id as string); }
  }
  const state = value as unknown as WorkforceState;
  if (state.workflowTemplates !== undefined) validateWorkflowTemplates(state.workflowTemplates);
  if (state.importReceipts !== undefined) {
    list(state.importReceipts, '导入回执'); const requests = new Set<string>();
    for (const receipt of state.importReceipts) {
      object(receipt, '导入回执'); textField(receipt.requestId, '导入请求'); invariant(!requests.has(receipt.requestId), '导入请求重复'); requests.add(receipt.requestId);
      textField(receipt.fingerprint, '导入摘要'); invariant(/^[a-f0-9]{64}$/.test(receipt.fingerprint), '导入摘要无效'); timestamp(receipt.createdAt, '导入时间');
      object(receipt.result, '导入结果'); textField(receipt.result.rootId, '导入根对象');
      oneOf(receipt.result.scope, ['template', 'project'], '导入范围'); oneOf(receipt.result.kind, ['employee', 'team', 'workflow'], '导入类型');
      for (const key of ['templateIds', 'teamIds', 'workflowTemplateIds', 'employeeIds', 'projectTeamIds', 'warnings']) strings(receipt.result[key], key);
    }
  }
  if (state.staffingBatches !== undefined) {
    list(state.staffingBatches, '创建请求记录');
    const requests = new Set<string>();
    for (const receipt of state.staffingBatches) {
      object(receipt, '创建请求记录'); textField(receipt.requestId, '创建请求标识');
      invariant(!requests.has(receipt.requestId), '创建请求标识重复'); requests.add(receipt.requestId);
      textField(receipt.projectId, '创建请求项目'); invariant(state.projects.some(project => project.id === receipt.projectId), '创建请求项目不存在');
      textField(receipt.fingerprint, '创建请求摘要'); invariant(/^[a-f0-9]{64}$/.test(receipt.fingerprint), '创建请求摘要无效');
      strings(receipt.employeeIds, '已创建员工'); invariant(receipt.employeeIds.length > 0 && new Set(receipt.employeeIds).size === receipt.employeeIds.length, '创建请求员工标识无效');
      timestamp(receipt.createdAt, '创建请求时间');
    }
  }
  for (const t of state.templates) { textField(t.name, '模板名称'); textField(t.description, '模板描述', true); integer(t.version, '模板版本', 1); oneOf(t.status, ['draft', 'ready', 'archived'], '模板状态'); validateModules(t.modules, t.status === 'ready'); }
  for (const t of state.teams) { textField(t.name, '团队名称'); textField(t.description, '团队描述', true); integer(t.version, '团队版本', 1); list(t.members, '团队成员'); for (const m of t.members) { object(m, '团队成员'); textField(m.memberId, '成员 ID'); textField(m.templateId, '成员模板'); invariant(state.templates.some(t => t.id === m.templateId), '团队引用的模板不存在'); if (m.name !== undefined) textField(m.name, '成员名称'); if (m.reportsTo !== undefined) textField(m.reportsTo, '上级成员'); } validateHierarchy(t.members.map(m => ({ id: m.memberId, ...(m.reportsTo ? { parent: m.reportsTo } : {}) })), '团队'); }
  for (const employee of state.employees) if (employee.legacyTeamKnowledgeEnabled !== undefined) bool(employee.legacyTeamKnowledgeEnabled, '历史团队资料管理员开关');
  for (const team of state.teams) if (team.knowledgeEnabled !== undefined) bool(team.knowledgeEnabled, '资料管理员开关');
  for (const team of state.teams) if (team.workflows !== undefined) {
    validateWorkflows(team.workflows, 'memberId', new Set(team.members.map(member => member.memberId)));
    for (const flow of team.workflows) {
      if (flow.sourceTemplateId !== undefined) textField(flow.sourceTemplateId, '来源通用工作流');
      if (flow.sourceTemplateVersion !== undefined) integer(flow.sourceTemplateVersion, '来源工作流版本', 1);
    }
  }
  for (const p of state.projects) { textField(p.name, '项目名称'); textField(p.rootPath, '项目目录'); invariant(p.rootPath.startsWith('/'), '项目目录必须为绝对路径'); }
  for (const e of state.employees) { textField(e.name, '员工名称'); textField(e.templateId, '员工模板'); textField(e.templateName, '模板名称'); integer(e.version, '员工版本', 1); integer(e.templateVersion, '员工模板版本', 1); invariant(state.projects.some(p => p.id === e.projectId), '员工项目不存在'); oneOf(e.status, ['active', 'paused'], '员工状态'); validateModules(e.modules, e.status === 'active'); if (e.managerId !== undefined) textField(e.managerId, '员工上级'); if (e.teamInstanceId !== undefined) textField(e.teamInstanceId, '团队实例'); if (e.importReview !== undefined) { object(e.importReview, '导入复核'); timestamp(e.importReview.importedAt, '导入时间'); validateModules({ ...e.modules, permissions: e.importReview.requestedPermissions }); } }
  for (const p of state.projects) validateHierarchy(state.employees.filter(e => e.projectId === p.id).map(e => ({ id: e.id, ...(e.managerId ? { parent: e.managerId } : {}) })), '项目员工');
  if (state.projectTeams !== undefined) {
    list(state.projectTeams, '项目团队');
    const ids = new Set<string>(); const installations = new Set<string>(); const assigned = new Set<string>();
    for (const team of state.projectTeams) {
      identity(team, '项目团队'); textField(team.projectId, '团队项目'); textField(team.teamTemplateId, '来源团队');
      textField(team.name, '团队名称'); integer(team.teamTemplateVersion, '团队模板版本', 1);
      if (team.version !== undefined) integer(team.version, '项目团队版本', 1);
      if (team.knowledgeEnabled !== undefined) bool(team.knowledgeEnabled, '资料管理员开关');
      if (team.status !== undefined) oneOf(team.status, ['active', 'cancelled'], '项目团队状态');
      invariant(!ids.has(team.id), '项目团队 ID 重复'); ids.add(team.id);
      const key = JSON.stringify([team.projectId, team.teamTemplateId]);
      invariant(!installations.has(key), '此项目已经配置该团队'); installations.add(key);
      invariant(state.projects.some(project => project.id === team.projectId), '团队项目不存在');
      list(team.members, '项目团队成员');
      invariant(team.members.length > 0, '项目团队不能为空');
      const memberIds = new Set<string>(); const employeeIds = new Set<string>();
      for (const member of team.members) {
        object(member, '项目团队成员'); textField(member.memberId, '团队成员'); textField(member.employeeId, '项目员工');
        invariant(!memberIds.has(member.memberId) && !assigned.has(member.employeeId), '项目团队成员重复');
        memberIds.add(member.memberId); employeeIds.add(member.employeeId); assigned.add(member.employeeId);
        invariant(state.employees.some(employee => employee.id === member.employeeId && employee.projectId === team.projectId && employee.teamInstanceId === team.id), '团队员工必须属于当前项目团队');
      }
      validateWorkflows(team.workflows, 'employeeId', employeeIds);
      if (team.status === 'cancelled') {
        timestamp(team.cancelledAt, '团队取消时间'); strings(team.resumeEmployeeIds, '恢复员工');
        invariant(new Set(team.resumeEmployeeIds).size === team.resumeEmployeeIds!.length && team.resumeEmployeeIds!.every(id => employeeIds.has(id)), '团队恢复员工无效');
        invariant(team.members.every(member => state.employees.find(employee => employee.id === member.employeeId)?.status === 'paused'), '团队已取消，请先恢复团队再启用员工');
        invariant(!state.workflowRuns?.some(flow => flow.projectTeamId === team.id && !['succeeded', 'cancelled'].includes(flow.status)), '取消团队必须同时停止工作流');
      } else invariant(team.cancelledAt === undefined && team.resumeEmployeeIds === undefined, '活动团队不能保留取消状态');
    }
  }
  for (const m of state.memories) {
    textField(m.title, '记忆标题'); textField(m.content, '记忆内容'); integer(m.version, '记忆版本', 1); timestamp(m.verifiedAt, '记忆核验时间'); invariant(state.projects.some(p => p.id === m.projectId), '记忆项目不存在'); oneOf(m.scope, ['project', 'employee'], '记忆范围');
    if (m.scope === 'employee') invariant(state.employees.some(e => e.id === m.employeeId && e.projectId === m.projectId), '员工记忆不能跨项目'); else invariant(m.employeeId === undefined, '项目记忆不能指定私有员工');
    object(m.source, '记忆来源'); oneOf(m.source.kind, ['user-confirmed', 'project-file', 'accepted-artifact'], '记忆来源类型');
    if (m.source.kind === 'user-confirmed') textField(m.source.reference, '用户确认依据');
    else if (m.source.kind === 'project-file') validateRelativePath(m.source.path, '记忆来源文件');
    else { const source = m.source; textField(source.runId, '来源任务'); textField(source.artifactId, '来源交付物'); const run = state.runs.find(r => r.id === source.runId); invariant(run?.projectId === m.projectId && run.status === 'succeeded' && run.acceptance?.decision === 'accepted' && run.artifacts.some(a => a.id === source.artifactId), '记忆必须引用本项目已验收交付物'); }
  }
  for (const r of state.runs) {
    textField(r.request, '工作请求'); integer(r.version, '工作版本', 1); oneOf(r.status, ['queued', 'running', 'blocked', 'awaiting-review', 'succeeded', 'failed', 'cancelled'], '工作状态'); invariant(state.employees.some(e => e.id === r.employeeId && e.projectId === r.projectId), '工作所属员工或项目无效');
    identity(r.employeeSnapshot, '员工快照'); invariant(r.employeeSnapshot.id === r.employeeId && r.employeeSnapshot.projectId === r.projectId, '工作员工快照不匹配'); validateModules(r.employeeSnapshot.modules, true); integer(r.employeeSnapshot.version, '快照版本', 1);
    if (r.parentRunId !== undefined) invariant(r.parentRunId !== r.id && state.runs.some(p => p.id === r.parentRunId && p.projectId === r.projectId), '父工作不能跨项目或指向自身');
    list(r.artifacts, '交付物'); const ids = new Set<string>(); for (const a of r.artifacts) { object(a, '交付物'); textField(a.id, '交付物 ID'); invariant(!ids.has(a.id as string), '交付物 ID 重复'); ids.add(a.id as string); textField(a.title, '交付物标题'); invariant(a.path !== undefined || a.content !== undefined, '交付物需要文件路径或文本内容'); if (a.path !== undefined) validateRelativePath(a.path, '交付物路径'); if (a.content !== undefined) textField(a.content, '交付物内容', true); }
    for (const key of ['sessionId', 'output', 'error'] as const) if (r[key] !== undefined) textField(r[key], `工作 ${key}`, key !== 'sessionId');
    if (r.usage !== undefined) { object(r.usage, '用量'); integer(r.usage.inputTokens, '输入 token'); integer(r.usage.outputTokens, '输出 token'); }
    if (r.startedAt !== undefined) timestamp(r.startedAt, '开始时间'); if (r.finishedAt !== undefined) timestamp(r.finishedAt, '结束时间');
    if (r.acceptance !== undefined) { object(r.acceptance, '验收'); oneOf(r.acceptance.decision, ['accepted', 'rejected'], '验收结论'); textField(r.acceptance.reviewer, '验收人'); textField(r.acceptance.note, '验收备注', true); timestamp(r.acceptance.at, '验收时间'); }
    if (r.status === 'succeeded') invariant(r.acceptance?.decision === 'accepted', '工作必须验收后才能成功');
  }
  validateHierarchy(state.runs.map(r => ({ id: r.id, ...(r.parentRunId ? { parent: r.parentRunId } : {}) })), '工作');
  validateWorkflowRuns(state);
  validateProjectWork(state);
}
