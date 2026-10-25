import type { EmployeeModules, EmployeeTemplate, ProjectEmployee, TeamTemplate, WorkforceState, WorkflowTemplate } from './types.js';
import type { ExportSelection, PortableEmployee, PortableProjectTeam, TransferBundle } from './transfer-types.js';
import { invariant, textField } from './validation.js';
import { parseTransfer } from './transfer-validation.js';

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

export function exportBundle(state: WorkforceState, selection: ExportSelection, options: { portable?: boolean } = {}): TransferBundle {
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
    const portable = { ...clone(source), modules: options.portable === false ? clone(source.modules) : portableModules(source.modules) }; templates.set(id, portable);
    for (const dependency of portable.modules.collaboration.allowedTemplateIds) collectTemplate(dependency);
  };
  const collectTeam = (source: TeamTemplate) => {
    const team = clone(source);
    for (const member of team.members) collectTemplate(member.templateId);
    for (const flow of team.workflows ?? []) if (flow.sourceTemplateId) {
      const global = state.workflowTemplates?.find(workflow => workflow.id === flow.sourceTemplateId);
      if (global && global.version === flow.sourceTemplateVersion) { if (!data.workflowTemplates.some(entry => entry.id === global.id)) collectWorkflow(global); }
      else { delete flow.sourceTemplateId; delete flow.sourceTemplateVersion; }
    }
    data.teams.push(team);
  };
  const collectWorkflow = (workflow: WorkflowTemplate) => {
    for (const member of workflow.team?.members ?? []) collectTemplate(member.templateId);
    data.workflowTemplates.push(clone(workflow));
  };
  if (selection.scope === 'template') {
    invariant(selection.projectId === undefined, '通用模板导出不能指定项目');
    if (selection.kind === 'employee') collectTemplate(selection.id);
    else if (selection.kind === 'team') collectTeam(find(state.teams, selection.id, '团队'));
    else if (selection.teamId !== undefined) {
      const team = clone(find(state.teams, selection.teamId, '团队'));
      team.workflows = [find(team.workflows ?? [], selection.id, '工作流')];
      result.root.teamId = team.id; collectTeam(team);
    } else collectWorkflow(find(state.workflowTemplates ?? [], selection.id, '工作流模板'));
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

