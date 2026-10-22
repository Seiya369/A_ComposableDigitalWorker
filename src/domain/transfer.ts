import { createHash, randomUUID } from 'node:crypto';
import type { EmployeeModules, EmployeeTemplate, ProjectEmployee, TeamTemplate, WorkforceState } from './types.js';
import type { ExportSelection, ImportOptions, ImportPreview, ImportResult, ImportTarget, PortableEmployee, PortableProjectTeam, TransferBundle } from './transfer-types.js';
import { invariant, textField, WorkforceError } from './validation.js';
import { parseTransfer, rootName } from './transfer-validation.js';
export { MAX_TRANSFER_BYTES } from './transfer-types.js';
export type * from './transfer-types.js';

const clone = <T>(value: T): T => structuredClone(value);
const timestamp = () => new Date().toISOString();
function find<T extends { id: string }>(values: T[], id: string, label: string): T {
  const entry = values.find(value => value.id === id); invariant(entry, `${label}不存在：${id}`); return entry;
}
function portableModules(modules: EmployeeModules): EmployeeModules {
  const output = clone(modules);
  // These are declarations, not installed skills, credentials, files or saved memory.
  output.knowledge.sources = output.knowledge.sources.filter(source => {
    if (source.kind === 'project-file') return false;
    if (source.kind !== 'url') return true;
    try { const url = new URL(source.value); return !url.username && !url.password && ![...url.searchParams.keys()].some(key => /token|secret|password|api[_-]?key|credential|signature/i.test(key)); } catch { return false; }
  });
  return output;
}

export function exportBundle(state: WorkforceState, selection: ExportSelection): TransferBundle {
  invariant(selection && ['template', 'project'].includes(selection.scope) && ['employee', 'team', 'workflow'].includes(selection.kind), '导出范围或类型无效');
  textField(selection.id, '导出对象');
  const result: TransferBundle = { format: 'graph_horses', formatVersion: 1, scope: selection.scope, kind: selection.kind, root: { id: selection.id }, exportedAt: timestamp(), data: { templates: [], teams: [], workflowTemplates: [], employees: [], projectTeams: [] } };
  const { data } = result;
  const templates = new Map<string, EmployeeTemplate>();
  const collectTemplate = (id: string, fallback?: ProjectEmployee) => {
    if (templates.has(id)) return;
    let source = state.templates.find(template => template.id === id);
    if (!source && fallback) source = { id, name: fallback.templateName, description: '', version: fallback.templateVersion, status: 'draft', modules: fallback.modules, createdAt: fallback.createdAt, updatedAt: fallback.updatedAt };
    invariant(source, `依赖职业人模板不存在：${id}，请先修正协作配置`);
    const portable = { ...clone(source), modules: portableModules(source.modules) }; templates.set(id, portable);
    for (const dependency of portable.modules.collaboration.allowedTemplateIds) collectTemplate(dependency);
  };
  const collectTeam = (source: TeamTemplate) => {
    const team = clone(source);
    for (const member of team.members) collectTemplate(member.templateId);
    for (const flow of team.workflows ?? []) if (flow.sourceTemplateId) {
      const global = state.workflowTemplates?.find(workflow => workflow.id === flow.sourceTemplateId);
      if (global && global.version === flow.sourceTemplateVersion) { if (!data.workflowTemplates.some(entry => entry.id === global.id)) data.workflowTemplates.push(clone(global)); }
      else { delete flow.sourceTemplateId; delete flow.sourceTemplateVersion; }
    }
    data.teams.push(team);
  };
  if (selection.scope === 'template') {
    invariant(selection.projectId === undefined, '通用模板导出不能指定项目');
    if (selection.kind === 'employee') collectTemplate(selection.id);
    else if (selection.kind === 'team') collectTeam(find(state.teams, selection.id, '团队'));
    else if (selection.teamId !== undefined) {
      const team = clone(find(state.teams, selection.teamId, '团队'));
      team.workflows = [find(team.workflows ?? [], selection.id, '工作流')];
      result.root.teamId = team.id; collectTeam(team);
    } else data.workflowTemplates.push(clone(find(state.workflowTemplates ?? [], selection.id, '工作流模板')));
  } else {
    textField(selection.projectId, '导出项目');
    find(state.projects, selection.projectId, '项目');
    const employees = new Map<string, PortableEmployee>();
    const collectEmployee = (id: string) => {
      if (employees.has(id)) return;
      const source = find(state.employees, id, '项目职业人'); invariant(source.projectId === selection.projectId, '不能导出其他项目员工');
      const { projectId: _project, status: _status, teamInstanceId: _team, importReview: _review, legacyTeamKnowledgeEnabled: _legacyKnowledge, ...base } = source;
      const entry: PortableEmployee = { ...clone(base), modules: portableModules(source.modules) }; employees.set(id, entry);
      collectTemplate(source.templateId, source);
      for (const dependency of entry.modules.collaboration.allowedTemplateIds) collectTemplate(dependency);
      if (source.managerId) collectEmployee(source.managerId);
    };
    if (selection.kind === 'employee') collectEmployee(selection.id);
    else {
      const source = selection.kind === 'team' ? find(state.projectTeams ?? [], selection.id, '项目团队')
        : (state.projectTeams ?? []).find(team => team.id === selection.teamId && team.workflows.some(flow => flow.id === selection.id));
      invariant(source && source.projectId === selection.projectId, '项目团队或工作流不存在于所选项目');
      const { projectId: _project, status: _status, cancelledAt: _cancelled, resumeEmployeeIds: _resume, ...base } = source;
      const team: PortableProjectTeam = clone(base);
      if (selection.kind === 'workflow') { team.workflows = [find(team.workflows, selection.id, '项目工作流')]; result.root.teamId = team.id; }
      for (const member of team.members) { collectEmployee(member.employeeId); employees.get(member.employeeId)!.teamInstanceId = team.id; }
      // The source blueprint can have changed or been deleted. Export the detached current definition.
      // Project-created workflows may share the historical marker 'project-custom'.
      // Their instance IDs supply unique portable source definitions without touching live state.
      for (const flow of team.workflows) flow.templateWorkflowId = `portable-source-${flow.id}`;
      const original = state.teams.find(entry => entry.id === team.teamTemplateId);
      const byEmployee = new Map(team.members.map(member => [member.employeeId, member.memberId]));
      const blueprint: TeamTemplate = {
        id: team.teamTemplateId, name: team.name, description: original?.description ?? '', version: team.teamTemplateVersion, knowledgeEnabled: team.knowledgeEnabled ?? true,
        members: team.members.map(member => {
          const employee = employees.get(member.employeeId)!;
          const parent = employee.managerId ? byEmployee.get(employee.managerId) : undefined;
          return { memberId: member.memberId, templateId: employee.templateId, name: employee.name, ...(parent ? { reportsTo: parent } : {}) };
        }),
        workflows: team.workflows.map(flow => ({ id: flow.templateWorkflowId, name: flow.name, ...(flow.maxAttempts !== undefined ? { maxAttempts: flow.maxAttempts } : {}), steps: flow.steps.map(({ employeeId, ...step }) => ({ ...clone(step), memberId: byEmployee.get(employeeId)! })) })),
        createdAt: team.createdAt, updatedAt: team.updatedAt,
      };
      data.teams.push(blueprint); data.projectTeams.push(team);
    }
    data.employees.push(...employees.values());
  }
  data.templates.push(...templates.values());
  // Redact the selected machine directory even if it was pasted into free-text configuration.
  const localRoot = selection.projectId ? state.projects.find(project => project.id === selection.projectId)?.rootPath : undefined;
  let encoded = JSON.stringify(result);
  if (localRoot && localRoot !== '/') encoded = encoded.split(JSON.stringify(localRoot).slice(1, -1)).join('[project-root]');
  return parseTransfer(encoded);
}

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
    (state.workflowTemplates ??= []).push({ ...clone(source), id: workflows.get(source.id)!, version: 1, roles: source.roles.map(role => ({ ...clone(role), id: roles.get(role.id)! })), steps: source.steps.map(step => ({ ...clone(step), id: randomUUID(), roleId: roles.get(step.roleId)! })), createdAt: date, updatedAt: date });
  }
  for (const source of bundle.data.teams) state.teams.push({
    ...clone(source), id: teams.get(source.id)!, version: 1, createdAt: date, updatedAt: date,
    members: source.members.map(member => ({ ...clone(member), memberId: memberIds.get(source.id)!.get(member.memberId)!, templateId: templates.get(member.templateId)!, ...(member.reportsTo ? { reportsTo: memberIds.get(source.id)!.get(member.reportsTo)! } : {}) })),
    workflows: (source.workflows ?? []).map(flow => ({ ...clone(flow), id: teamWorkflowIds.get(source.id)!.get(flow.id)!, ...(flow.sourceTemplateId ? { sourceTemplateId: workflows.get(flow.sourceTemplateId)!, sourceTemplateVersion: 1 } : {}), steps: flow.steps.map(step => ({ ...clone(step), id: randomUUID(), memberId: memberIds.get(source.id)!.get(step.memberId)! })) })),
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
    workflows: source.workflows.map(flow => ({ ...clone(flow), id: projectWorkflowIds.get(source.id)!.get(flow.id)!, templateWorkflowId: teamWorkflowIds.get(source.teamTemplateId)!.get(flow.templateWorkflowId)!, version: 1, steps: flow.steps.map(step => ({ ...clone(step), id: randomUUID(), employeeId: employees.get(step.employeeId)! })) })),
  });
  const rootId = bundle.kind === 'employee' ? (bundle.scope === 'template' ? templates : employees).get(bundle.root.id)!
    : bundle.kind === 'team' ? (bundle.scope === 'template' ? teams : projectTeams).get(bundle.root.id)!
    : bundle.scope === 'template' && !bundle.root.teamId ? workflows.get(bundle.root.id)!
    : (bundle.scope === 'template' ? teamWorkflowIds : projectWorkflowIds).get(bundle.root.teamId!)!.get(bundle.root.id)!;
  const result: ImportResult = { scope: bundle.scope, kind: bundle.kind, rootId, templateIds: [...templates.values()], teamIds: [...teams.values()], workflowTemplateIds: [...workflows.values()], employeeIds: [...employees.values()], projectTeamIds: [...projectTeams.values()], warnings: preview.warnings };
  (state.importReceipts ??= []).push({ requestId: options.requestId, fingerprint, result: clone(result), createdAt: date });
  return result;
}
