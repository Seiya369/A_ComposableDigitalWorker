import { createHash, randomUUID } from 'node:crypto';
import type { EmployeeModules, EmployeeTemplate, ProjectEmployee, TeamTemplate, WorkforceState } from './types.js';
import type { ExportSelection, ImportOptions, ImportPreview, ImportResult, ImportTarget, PortableEmployee, PortableProjectTeam, TransferBundle } from './transfer-types.js';
import { invariant, textField, WorkforceError } from './validation.js';
import { parseTransfer, rootName } from './transfer-validation.js';
import { remapWorkflowTeam } from './workflow-team.js';
import { remapWorkflowStepIds } from '../workflow/definition.js';
export { MAX_TRANSFER_BYTES } from './transfer-types.js';
export type * from './transfer-types.js';

const clone = <T>(value: T): T => structuredClone(value);
const timestamp = () => new Date().toISOString();
function find<T extends { id: string }>(values: T[], id: string, label: string): T {
  const entry = values.find(value => value.id === id); invariant(entry, `${label}不存在：${id}`); return entry;
}
export { exportBundle } from './transfer-export.js';

const commonWarnings = [
  '只传输配置声明；不包含技能或工具安装包、凭据、运行会话、项目记忆或交付成果。知识中的项目文件引用不随导出保留。',
  '导入创建全新对象并重建引用，不覆盖已有配置；模型、技能和工具需在本机可用，导入前请核对自由文本。',
  '无法取得对应版本的流程来源时只保留冻结定义，移除导出副本的来源关联；不会以最新版替换既有步骤。',
];
export function previewImport(state: WorkforceState, document: unknown, target: ImportTarget): ImportPreview {
  const bundle = parseTransfer(document);
  invariant(target && target.scope === bundle.scope, '导入范围必须与文档相同；请先导入模板库，再引入项目');
  if (target.scope === 'project') { textField(target.projectId, '请明确选择导入的本机项目'); find(state.projects, target.projectId, '目标项目'); }
  else invariant(target.projectId === undefined, '通用模板导入不能指定项目');
  return { scope: bundle.scope, kind: bundle.kind, name: rootName(bundle), counts: {
    templates: bundle.data.templates.length, teams: bundle.data.teams.length, workflowTemplates: bundle.data.workflowTemplates.length,
    employees: bundle.data.employees.length, projectTeams: bundle.data.projectTeams.length,
  }, warnings: [...commonWarnings, ...(target.scope === 'project' ? ['所有导入项目员工初始暂停；工具授权、写入路径、Shell、网络与委派权限均关闭，原权限请求保留在 importReview 中供人工复核。导入不会自动执行任务。'] : ['模板权限仅作为声明保留；导入不会创建成员会话或自动执行任务。'])] };
}

export function existingImportResult(state: WorkforceState, document: unknown, options: ImportOptions): ImportResult | undefined {
  const bundle = parseTransfer(document); previewImport(state, bundle, options);
  textField(options.requestId, '导入请求标识'); invariant(options.requestId.length <= 200, '导入请求标识过长');
  const fingerprint = createHash('sha256').update(JSON.stringify({ document: bundle, scope: options.scope, projectId: options.projectId })).digest('hex');
  const receipt = state.importReceipts?.find(entry => entry.requestId === options.requestId);
  if (!receipt) return undefined;
  if (receipt.fingerprint !== fingerprint) throw new WorkforceError('CONFLICT', '此导入请求已经用于另一文档或目标项目');
  return clone(receipt.result);
}

export function importBundle(state: WorkforceState, document: unknown, options: ImportOptions): ImportResult {
  const bundle = parseTransfer(document);
  const preview = previewImport(state, bundle, options);
  textField(options.requestId, '导入请求标识'); invariant(options.requestId.length <= 200, '导入请求标识过长');
  const fingerprint = createHash('sha256').update(JSON.stringify({ document: bundle, scope: options.scope, projectId: options.projectId })).digest('hex');
  const receipt = state.importReceipts?.find(entry => entry.requestId === options.requestId);
  if (receipt) { if (receipt.fingerprint !== fingerprint) throw new WorkforceError('CONFLICT', '此导入请求已经用于另一文档或目标项目'); return clone(receipt.result); }
  const date = timestamp();
  const map = <T extends { id: string }>(values: T[]) => new Map(values.map(value => [value.id, randomUUID()]));
  const templates = map(bundle.data.templates), teams = map(bundle.data.teams), workflows = map(bundle.data.workflowTemplates), employees = map(bundle.data.employees), projectTeams = map(bundle.data.projectTeams);
  const memberIds = new Map(bundle.data.teams.map(team => [team.id, new Map(team.members.map(member => [member.memberId, randomUUID()]))]));
  const teamWorkflowIds = new Map(bundle.data.teams.map(team => [team.id, map(team.workflows ?? [])]));
  const projectWorkflowIds = new Map(bundle.data.projectTeams.map(team => [team.id, map(team.workflows)]));
  const remapModules = (modules: EmployeeModules) => {
    const output = clone(modules); output.collaboration.allowedTemplateIds = output.collaboration.allowedTemplateIds.map(id => templates.get(id)!);
    output.knowledge.sources = output.knowledge.sources.map(source => ({ ...source, id: randomUUID() })); return output;
  };
  for (const source of bundle.data.templates) state.templates.push({ ...clone(source), id: templates.get(source.id)!, modules: remapModules(source.modules), version: 1, createdAt: date, updatedAt: date });
  for (const source of bundle.data.workflowTemplates) {
    const roles = map(source.roles);
    const adopted = remapWorkflowTeam(source, templates, teams, randomUUID);
    (state.workflowTemplates ??= []).push({ ...clone(source), ...adopted, id: workflows.get(source.id)!, version: 1, roles: adopted.roles.map(role => ({ ...role, id: roles.get(role.id)! })), steps: remapWorkflowStepIds(source.steps.map(step => ({ ...step, roleId: roles.get(step.roleId)! })), randomUUID), createdAt: date, updatedAt: date });
  }
  for (const source of bundle.data.teams) state.teams.push({
    ...clone(source), id: teams.get(source.id)!, version: 1, createdAt: date, updatedAt: date,
    members: source.members.map(member => ({ ...clone(member), memberId: memberIds.get(source.id)!.get(member.memberId)!, templateId: templates.get(member.templateId)!, ...(member.reportsTo ? { reportsTo: memberIds.get(source.id)!.get(member.reportsTo)! } : {}) })),
    workflows: (source.workflows ?? []).map(flow => ({ ...clone(flow), id: teamWorkflowIds.get(source.id)!.get(flow.id)!, ...(flow.sourceTemplateId ? { sourceTemplateId: workflows.get(flow.sourceTemplateId)!, sourceTemplateVersion: 1 } : {}), steps: remapWorkflowStepIds(flow.steps.map(step => ({ ...step, memberId: memberIds.get(source.id)!.get(step.memberId)! })), randomUUID) })),
  });
  for (const source of bundle.data.employees) {
    const modules = remapModules(source.modules);
    const requestedPermissions = clone(modules.permissions);
    modules.permissions = { allowedTools: [], readPaths: [], writePaths: [], allowShell: false, allowNetwork: false };
    modules.collaboration.canDelegate = false;
    state.employees.push({ ...clone(source), id: employees.get(source.id)!, projectId: options.projectId!, templateId: templates.get(source.templateId)!, templateVersion: 1, version: 1, modules, status: 'paused',
      ...(source.managerId ? { managerId: employees.get(source.managerId)! } : {}), ...(source.teamInstanceId ? { teamInstanceId: projectTeams.get(source.teamInstanceId)! } : {}),
      importReview: { requestedPermissions, importedAt: date }, createdAt: date, updatedAt: date });
  }
  for (const source of bundle.data.projectTeams) (state.projectTeams ??= []).push({
    ...clone(source), id: projectTeams.get(source.id)!, projectId: options.projectId!, teamTemplateId: teams.get(source.teamTemplateId)!, teamTemplateVersion: 1, status: 'active', version: 1, createdAt: date, updatedAt: date,
    members: source.members.map(member => ({ memberId: memberIds.get(source.teamTemplateId)!.get(member.memberId)!, employeeId: employees.get(member.employeeId)! })),
    workflows: source.workflows.map(flow => ({ ...clone(flow), id: projectWorkflowIds.get(source.id)!.get(flow.id)!, templateWorkflowId: teamWorkflowIds.get(source.teamTemplateId)!.get(flow.templateWorkflowId)!, version: 1, steps: remapWorkflowStepIds(flow.steps.map(step => ({ ...step, employeeId: employees.get(step.employeeId)! })), randomUUID) })),
  });
  const rootId = bundle.kind === 'employee' ? (bundle.scope === 'template' ? templates : employees).get(bundle.root.id)!
    : bundle.kind === 'team' ? (bundle.scope === 'template' ? teams : projectTeams).get(bundle.root.id)!
    : bundle.scope === 'template' && !bundle.root.teamId ? workflows.get(bundle.root.id)!
    : (bundle.scope === 'template' ? teamWorkflowIds : projectWorkflowIds).get(bundle.root.teamId!)!.get(bundle.root.id)!;
  const result: ImportResult = { scope: bundle.scope, kind: bundle.kind, rootId, templateIds: [...templates.values()], teamIds: [...teams.values()], workflowTemplateIds: [...workflows.values()], employeeIds: [...employees.values()], projectTeamIds: [...projectTeams.values()], warnings: preview.warnings };
  (state.importReceipts ??= []).push({ requestId: options.requestId, fingerprint, result: clone(result), createdAt: date });
  return result;
}
