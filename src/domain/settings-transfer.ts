import type { EmployeeModules, EmployeeTemplate, MutationOptions, TeamTemplate, WorkforceState, WorkflowTemplate } from './types.js';
import type { TransferBundle, TransferKind } from './transfer-types.js';
import { exportBundle } from './transfer-export.js';
import { parseTransfer } from './transfer-validation.js';
import { invariant, textField, WorkforceError } from './errors.js';
import { remapWorkflowTeam } from './workflow-team.js';
import { remapWorkflowStepIds } from '../workflow/definition.js';

export type SettingsRoot = EmployeeTemplate | TeamTemplate | WorkflowTemplate;
const clone = <T>(value: T): T => structuredClone(value);
const collection = (kind: TransferKind) => kind === 'employee' ? 'templates' : kind === 'team' ? 'teams' : 'workflowTemplates';
const emptyState = (bundle: TransferBundle): WorkforceState => ({ schemaVersion: 1, revision: 0, templates: clone(bundle.data.templates), teams: clone(bundle.data.teams), workflowTemplates: clone(bundle.data.workflowTemplates), employees: [], projectTeams: [], projects: [], memories: [], runs: [] });
const validateKind = (kind: TransferKind) => invariant(['employee', 'team', 'workflow'].includes(kind), '设置导入类型无效');
function settingsDocument(document: unknown, kind: TransferKind): TransferBundle {
  validateKind(kind);
  const bundle = parseTransfer(document);
  invariant(bundle.scope === 'template' && bundle.kind === kind && bundle.root.teamId === undefined, '请导入相同类型的独立通用模板配置');
  return bundle;
}
function replace<T extends { id: string }>(values: T[], entry: T): void {
  const index = values.findIndex(value => value.id === entry.id);
  if (index < 0) values.push(clone(entry)); else values[index] = clone(entry);
}
function draftState(state: WorkforceState, kind: TransferKind, root: SettingsRoot, stagedBundle?: TransferBundle): WorkforceState {
  validateKind(kind); textField(root?.id, '设置草稿 ID');
  const next = clone(state);
  if (stagedBundle) {
    const staged = settingsDocument(stagedBundle, kind);
    invariant(staged.root.id === root.id, '导入草稿与当前对象不一致');
    for (const entry of staged.data.templates) replace(next.templates, entry);
    for (const entry of staged.data.teams) replace(next.teams, entry);
    for (const entry of staged.data.workflowTemplates) replace(next.workflowTemplates ??= [], entry);
  }
  const values = (next[collection(kind)] ??= []) as SettingsRoot[];
  const current = state[collection(kind)]?.find(value => value.id === root.id);
  replace(values, { ...clone(root), ...(current ? { id: current.id, version: current.version, createdAt: current.createdAt, updatedAt: current.updatedAt } : {}) });
  return next;
}

/** Export the current form, including unsaved imported dependencies, with existing portable redaction. */
export function exportSettingsBundle(state: WorkforceState, kind: TransferKind, root: SettingsRoot, stagedBundle?: TransferBundle): TransferBundle {
  return exportBundle(draftState(state, kind, root, stagedBundle), { scope: 'template', kind, id: root.id });
}

/** Save transport uses the same strict format but retains valid local project-file declarations. */
export function settingsBundleForSave(state: WorkforceState, kind: TransferKind, root: SettingsRoot, stagedBundle?: TransferBundle): TransferBundle {
  return exportBundle(draftState(state, kind, root, stagedBundle), { scope: 'template', kind, id: root.id }, { portable: false });
}

/** Validate and remap in memory. No state mutation or persistence takes place until explicit Save. */
export function prepareSettingsImport(state: WorkforceState, document: unknown, kind: TransferKind, targetId?: string): TransferBundle {
  const checked = settingsDocument(document, kind);
  const bundle = exportBundle(emptyState(checked), { scope: 'template', kind, id: checked.root.id }, { portable: false });
  const occupied = new Set([...state.templates, ...state.teams, ...(state.workflowTemplates ?? []), ...state.employees, ...(state.projectTeams ?? [])].map(value => value.id));
  const fresh = () => { let id: string; do { id = globalThis.crypto.randomUUID(); } while (occupied.has(id)); occupied.add(id); return id; };
  if (targetId !== undefined) textField(targetId, '当前设置对象');
  const rootId = targetId ?? fresh(); occupied.add(rootId);
  const current = state[collection(kind)]?.find(value => value.id === rootId);
  invariant(current || ![...state.templates, ...state.teams, ...(state.workflowTemplates ?? []), ...state.employees, ...(state.projectTeams ?? [])].some(value => value.id === rootId), '当前对象 ID 与其他配置冲突');
  const date = new Date().toISOString();
  const metadata = (id: string) => id === rootId && current
    ? { id, version: current.version, createdAt: current.createdAt, updatedAt: current.updatedAt }
    : { id, version: 1, createdAt: date, updatedAt: date };
  const map = <T extends { id: string }>(values: T[], rootKind: TransferKind) => new Map(values.map(value => [value.id, kind === rootKind && value.id === bundle.root.id ? rootId : fresh()]));
  const templates = map(bundle.data.templates, 'employee');
  const teams = map(bundle.data.teams, 'team');
  const workflows = map(bundle.data.workflowTemplates, 'workflow');
  const remapModules = (modules: EmployeeModules): EmployeeModules => ({ ...clone(modules),
    collaboration: { ...clone(modules.collaboration), allowedTemplateIds: modules.collaboration.allowedTemplateIds.map(id => templates.get(id)!) },
    knowledge: { ...clone(modules.knowledge), sources: modules.knowledge.sources.map(source => ({ ...clone(source), id: fresh() })) },
  });
  const output: TransferBundle = { format: 'graph_horses', formatVersion: 1, scope: 'template', kind, root: { id: rootId }, exportedAt: date,
    data: { templates: bundle.data.templates.map(source => ({ ...clone(source), ...metadata(templates.get(source.id)!), modules: remapModules(source.modules) })),
      teams: bundle.data.teams.map(source => {
        const members = new Map(source.members.map(member => [member.memberId, fresh()]));
        return { ...clone(source), ...metadata(teams.get(source.id)!),
          members: source.members.map(member => ({ ...clone(member), memberId: members.get(member.memberId)!, templateId: templates.get(member.templateId)!, ...(member.reportsTo ? { reportsTo: members.get(member.reportsTo)! } : {}) })),
          workflows: (source.workflows ?? []).map(flow => ({ ...clone(flow), id: fresh(), ...(flow.sourceTemplateId ? { sourceTemplateId: workflows.get(flow.sourceTemplateId)!, sourceTemplateVersion: 1 } : {}), steps: remapWorkflowStepIds(flow.steps.map(step => ({ ...step, memberId: members.get(step.memberId)! })), fresh) })),
        };
      }),
      workflowTemplates: bundle.data.workflowTemplates.map(source => {
        const roles = new Map(source.roles.map(role => [role.id, fresh()]));
        const adopted = remapWorkflowTeam(source, templates, teams, fresh);
        return { ...clone(source), ...adopted, ...metadata(workflows.get(source.id)!), roles: adopted.roles.map(role => ({ ...role, id: roles.get(role.id)! })), steps: remapWorkflowStepIds(source.steps.map(step => ({ ...step, roleId: roles.get(step.roleId)! })), fresh) };
      }), employees: [], projectTeams: [] },
  };
  return parseTransfer(output);
}

const canonical = (value: unknown): string => JSON.stringify(value, (_key, entry: unknown) => entry && typeof entry === 'object' && !Array.isArray(entry)
  ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
const dependencyConfiguration = ({ createdAt: _createdAt, updatedAt: _updatedAt, ...configuration }: SettingsRoot) => canonical(configuration);

/** Called only inside the store transaction: append fresh dependencies and replace this root together. */
export function applySettingsBundle(state: WorkforceState, document: unknown, options: MutationOptions = {}): SettingsRoot {
  const checked = parseTransfer(document);
  const bundle = settingsDocument(checked, checked.kind);
  const minimal = exportBundle(emptyState(bundle), { scope: 'template', kind: bundle.kind, id: bundle.root.id }, { portable: false });
  for (const key of ['templates', 'teams', 'workflowTemplates'] as const) invariant(minimal.data[key].length === bundle.data[key].length, '设置文档包含不属于当前对象的额外配置');
  const key = collection(bundle.kind);
  const values = (state[key] ??= []) as SettingsRoot[];
  const current = values.find(value => value.id === bundle.root.id);
  if (current) {
    if (options.expectedVersion === undefined || options.expectedVersion !== current.version) throw new WorkforceError('CONFLICT', '当前配置已更新，请刷新后重新导入或编辑');
  } else if (options.expectedVersion !== undefined) throw new WorkforceError('NOT_FOUND', '当前配置不存在或已被删除');
  const allCurrent = new Map([...state.templates, ...state.teams, ...(state.workflowTemplates ?? []), ...state.employees, ...(state.projectTeams ?? [])].map(value => [value.id, value]));
  if (!current) invariant(!allCurrent.has(bundle.root.id), '当前对象 ID 与其他配置冲突');
  const date = new Date().toISOString();
  let result: SettingsRoot | undefined;
  for (const dataKey of ['templates', 'teams', 'workflowTemplates'] as const) {
    const targets = (state[dataKey] ??= []) as SettingsRoot[];
    for (const source of bundle.data[dataKey]) {
      if (dataKey === key && source.id === bundle.root.id) {
        result = { ...clone(source), id: bundle.root.id, version: (current?.version ?? 0) + 1, createdAt: current?.createdAt ?? date, updatedAt: date };
        replace(targets, result);
      } else {
        const existing = allCurrent.get(source.id);
        if (existing) {
          if (!targets.some(value => value.id === source.id) || dependencyConfiguration(existing as SettingsRoot) !== dependencyConfiguration(source)) throw new WorkforceError('CONFLICT', '依赖配置已变化或标识冲突，请重新载入后保存');
        } else {
          invariant(source.version === 1, '新增依赖必须先通过设置导入规范化');
          const dependency = { ...clone(source), version: 1, createdAt: date, updatedAt: date };
          targets.push(dependency); allCurrent.set(source.id, dependency);
        }
      }
    }
  }
  invariant(result, '设置根对象不存在');
  return result;
}
