import { Buffer } from 'node:buffer';
import type { TransferBundle } from './transfer-types.js';
import { MAX_TRANSFER_BYTES } from './transfer-types.js';
import { invariant, validateState } from './validation.js';

const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
function scan(value: unknown, depth = 0, budget = { nodes: 0 }): void {
  invariant(depth <= 35 && ++budget.nodes <= 40_000, '导入文档层级或对象数量超出上限');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number') { invariant(Number.isFinite(value), '导入文档必须是有效 JSON'); return; }
  invariant(typeof value === 'object', '导入文档只能包含 JSON 值');
  invariant(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, '导入文档包含非法对象');
  for (const [key, entry] of Object.entries(value)) { invariant(!forbidden.has(key), '导入文档包含不安全的对象键'); scan(entry, depth + 1, budget); }
}
function keys(value: unknown, allowed: string[], label: string): asserts value is Record<string, unknown> {
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} 必须为对象`);
  for (const key of Object.keys(value)) invariant(allowed.includes(key), `${label} 包含未支持的字段：${key}`);
}
function array(value: unknown, label: string): asserts value is unknown[] { invariant(Array.isArray(value) && value.length <= 500, `${label} 数量超出上限`); }
function modules(value: unknown): void {
  keys(value, ['responsibilities', 'capabilities', 'model', 'knowledge', 'permissions', 'collaboration', 'delivery'], '七模块');
  keys(value.responsibilities, ['mission', 'duties', 'boundaries'], '岗位职责');
  keys(value.capabilities, ['skills', 'tools'], '专业能力');
  array(value.capabilities.skills, '技能'); for (const skill of value.capabilities.skills) keys(skill, ['id', 'name', 'description'], '技能');
  array(value.capabilities.tools, '工具'); for (const tool of value.capabilities.tools) keys(tool, ['id', 'description'], '工具');
  keys(value.model, ['mode', 'provider', 'model', 'reasoningEffort'], '模型声明');
  keys(value.knowledge, ['sources', 'organization', 'projectMemory', 'employeeMemory', 'memoryWritePolicy'], '知识声明');
  array(value.knowledge.sources, '知识来源'); for (const source of value.knowledge.sources) {
    keys(source, ['id', 'title', 'kind', 'value', 'category'], '知识来源');
    if (source.kind === 'url' && typeof source.value === 'string') {
      let url: URL; try { url = new URL(source.value); } catch { throw new Error('知识链接无效'); }
      invariant(!url.username && !url.password && ![...url.searchParams.keys()].some(key => /token|secret|password|api[_-]?key|credential|signature/i.test(key)), '导入文档不能包含带凭据的知识链接');
    }
  }
  keys(value.permissions, ['allowedTools', 'readPaths', 'writePaths', 'allowShell', 'allowNetwork'], '权限声明');
  keys(value.collaboration, ['canDelegate', 'allowedTemplateIds', 'maxDepth', 'maxConcurrent', 'escalationRules'], '协作声明');
  keys(value.delivery, ['requiredArtifacts', 'acceptanceCriteria', 'reviewRequired'], '交付声明');
}
const identity = ['id', 'name', 'version', 'createdAt', 'updatedAt'];
const stepKeys = ['id', 'name', 'instruction', 'inputs', 'outputs', 'acceptanceCriteria', 'timeoutMs'];
function workflows(value: unknown, assignee: string): void {
  array(value, '流程');
  for (const flow of value) {
    keys(flow, ['id', 'name', 'version', 'maxAttempts', ...(assignee === 'employeeId' ? ['templateWorkflowId', 'templateWorkflowVersion'] : ['sourceTemplateId', 'sourceTemplateVersion']), 'steps'], '流程');
    array(flow.steps, '步骤'); for (const step of flow.steps) keys(step, [...stepKeys, assignee], '步骤');
  }
}

/** Parse strictly before using any IDs or committing a domain transaction. */
export function parseTransfer(input: unknown): TransferBundle {
  let value: unknown;
  if (typeof input === 'string') {
    invariant(Buffer.byteLength(input, 'utf8') <= MAX_TRANSFER_BYTES, '导入文件大小超出 1 MiB 上限');
    try { value = JSON.parse(input); } catch { invariant(false, '导入文件不是有效 JSON'); }
  } else value = input;
  scan(value);
  invariant(Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_TRANSFER_BYTES, '导入文件大小超出 1 MiB 上限');
  keys(value, ['format', 'formatVersion', 'scope', 'kind', 'root', 'exportedAt', 'data'], '导入格式');
  invariant(value.format === 'graph_horses' && value.formatVersion === 1, '不支持的 graph_horses 格式或格式版本');
  invariant(value.scope === 'template' || value.scope === 'project', '导入范围无效');
  invariant(['employee', 'team', 'workflow'].includes(String(value.kind)), '导入类型无效');
  invariant(typeof value.exportedAt === 'string' && Number.isFinite(Date.parse(value.exportedAt)), '导出时间无效');
  keys(value.root, ['id', 'teamId'], '根对象');
  invariant(typeof value.root.id === 'string' && value.root.id.length > 0, '根对象 ID 无效');
  if (value.root.teamId !== undefined) invariant(typeof value.root.teamId === 'string' && value.root.teamId.length > 0, '根团队 ID 无效');
  keys(value.data, ['templates', 'teams', 'workflowTemplates', 'employees', 'projectTeams'], '导入内容');
  for (const key of ['templates', 'teams', 'workflowTemplates', 'employees', 'projectTeams']) array(value.data[key], key);
  const bundle = value as unknown as TransferBundle;
  for (const template of bundle.data.templates) { keys(template, [...identity, 'description', 'status', 'modules'], '职业人模板'); modules(template.modules); }
  for (const team of bundle.data.teams) {
    keys(team, [...identity, 'description', 'knowledgeEnabled', 'members', 'workflows'], '团队模板'); array(team.members, '团队成员');
    for (const member of team.members) keys(member, ['memberId', 'templateId', 'name', 'reportsTo'], '团队成员');
    if (team.workflows !== undefined) workflows(team.workflows, 'memberId');
  }
  for (const workflow of bundle.data.workflowTemplates) {
    keys(workflow, [...identity, 'description', 'roles', 'steps', 'maxAttempts'], '通用工作流');
    array(workflow.roles, '流程岗位'); for (const role of workflow.roles) keys(role, ['id', 'name', 'description'], '流程岗位');
    array(workflow.steps, '流程步骤'); for (const step of workflow.steps) keys(step, [...stepKeys, 'roleId'], '流程步骤');
  }
  for (const employee of bundle.data.employees) { keys(employee, [...identity, 'templateId', 'templateName', 'templateVersion', 'modules', 'managerId', 'teamInstanceId'], '项目职业人'); modules(employee.modules); }
  for (const team of bundle.data.projectTeams) {
    keys(team, [...identity, 'teamTemplateId', 'teamTemplateVersion', 'knowledgeEnabled', 'members', 'workflows'], '项目团队'); array(team.members, '项目成员');
    for (const member of team.members) keys(member, ['memberId', 'employeeId'], '项目成员'); workflows(team.workflows, 'employeeId');
  }
  const projectId = 'transfer-validation-project';
  validateState({ schemaVersion: 1, revision: 0, templates: bundle.data.templates, teams: bundle.data.teams, workflowTemplates: bundle.data.workflowTemplates,
    projects: bundle.scope === 'project' ? [{ id: projectId, name: '本地校验', rootPath: '/', createdAt: bundle.exportedAt, updatedAt: bundle.exportedAt }] : [],
    employees: bundle.data.employees.map(employee => ({ ...employee, projectId, status: 'paused' })), projectTeams: bundle.data.projectTeams.map(team => ({ ...team, projectId, status: 'active' })), memories: [], runs: [] });
  if (bundle.scope === 'template') invariant(bundle.data.employees.length === 0 && bundle.data.projectTeams.length === 0, '模板文档不能包含项目实例');
  const templates = new Set(bundle.data.templates.map(template => template.id));
  const teams = new Map(bundle.data.teams.map(team => [team.id, team]));
  const workflowTemplates = new Set(bundle.data.workflowTemplates.map(workflow => workflow.id));
  for (const entry of [...bundle.data.templates, ...bundle.data.employees]) {
    for (const id of entry.modules.collaboration.allowedTemplateIds) invariant(templates.has(id), '协作模板引用不完整');
  }
  for (const employee of bundle.data.employees) {
    invariant(templates.has(employee.templateId), '项目职业人的来源模板引用不完整');
    if (employee.teamInstanceId !== undefined) invariant(bundle.data.projectTeams.some(team => team.id === employee.teamInstanceId && team.members.some(member => member.employeeId === employee.id)), '项目职业人的团队引用不完整');
  }
  for (const team of bundle.data.teams) for (const flow of team.workflows ?? []) if (flow.sourceTemplateId !== undefined) invariant(workflowTemplates.has(flow.sourceTemplateId), '流程模板引用不完整');
  for (const team of bundle.data.projectTeams) {
    const source = teams.get(team.teamTemplateId); invariant(source, '项目团队来源模板引用不完整');
    for (const member of team.members) invariant(source.members.some(entry => entry.memberId === member.memberId), '项目团队成员岗位引用不完整');
    for (const flow of team.workflows) invariant(source.workflows?.some(entry => entry.id === flow.templateWorkflowId), '项目工作流来源引用不完整');
  }
  rootName(bundle); return structuredClone(bundle);
}

export function rootName(bundle: TransferBundle): string {
  const { scope, kind, root, data } = bundle;
  const entry = kind === 'employee' ? (scope === 'template' ? data.templates : data.employees).find(entry => entry.id === root.id)
    : kind === 'team' ? (scope === 'template' ? data.teams : data.projectTeams).find(entry => entry.id === root.id)
    : scope === 'template' && root.teamId === undefined ? data.workflowTemplates.find(entry => entry.id === root.id)
    : (scope === 'template' ? data.teams : data.projectTeams).find(team => team.id === root.teamId)?.workflows?.find(entry => entry.id === root.id);
  invariant(entry, '导入根对象不存在或归属引用无效'); return entry.name;
}
