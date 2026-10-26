import type { CreateEmployeeInput, EmployeeTemplate, MutationOptions, ProjectEmployee, WorkforceState } from './types.js';
import { invariant, textField, WorkforceError } from './errors.js';

export type ConversationEmployeeMode = 'consult' | 'execute';
/** Explicit session-local preference. Earlier mentions never create this record. */
export interface ConversationEmployeeBinding {
  sessionId: string; projectId: string; employeeId: string; mode: ConversationEmployeeMode;
  version: number; createdAt: string; updatedAt: string;
}
/** Historical attempts retain their admission identity after the user exits residency. */
export type ConversationEmployeeRunLink =
  | { sessionId: string; mode: ConversationEmployeeMode; bindingVersion: number; invocation?: 'resident' }
  | { sessionId: string; mode: 'execute'; invocation: 'temporary'; turnKey: string; employeeVersion: number };
export type TemporaryConversationEmployeeAdmission = Extract<ConversationEmployeeRunLink, { invocation: 'temporary' }> & { employeeId: string };
export const TEMPORARY_EMPLOYEE_MARKER_PREFIX = '<graph-horses-employee:';
export function hasTemporaryEmployeeMentionMarker(text: string): boolean { return text.includes(TEMPORARY_EMPLOYEE_MARKER_PREFIX); }
export function stripTemporaryEmployeeMentionMarker(text: string): string { return text.replace(/<graph-horses-employee:[a-f0-9]{32}>/g, ''); }
export function parseTemporaryEmployeeMentionMarker(text: string): { token: string; marker: string; requestText: string } | undefined {
  if (!hasTemporaryEmployeeMentionMarker(text)) return undefined;
  invariant(text.split(TEMPORARY_EMPLOYEE_MARKER_PREFIX).length === 2, '一轮对话只能临时调用一位员工');
  const match = /^\s*(<graph-horses-employee:([a-f0-9]{32})>)(?=\s|$)/.exec(text);
  invariant(match, '临时员工引用无效，请从输入框重新选择员工');
  return { token: match[2]!, marker: match[1]!, requestText: stripTemporaryEmployeeMentionMarker(text).trim() };
}
export interface AdmitTemporaryConversationEmployeeInput {
  projectId: string; sessionId: string; turnKey: string; employeeId?: string; templateId?: string; expectedTargetVersion: number;
}
export interface SelectConversationEmployeeInput {
  projectId: string; sessionId: string; mode: ConversationEmployeeMode;
  employeeId?: string; templateId?: string;
}
export interface ClearConversationEmployeeInput { projectId: string; sessionId: string }
export interface EmployeeInfoCard {
  name: string; mission: string; duties: string[]; boundaries: string[];
  capabilities: {
    skills: Array<{ name: string; description: string; usage: 'required' | 'preferred' }>;
    tools: string[]; plugins: string[]; mcps: string[];
  };
}
export interface ConversationEmployeeChoice {
  kind: 'employee' | 'template'; id: string; name: string; description: string; card: EmployeeInfoCard;
}
export interface ResolvedConversationEmployee {
  sessionId: string; projectId: string; revision: number;
  conversationEmployee: ConversationEmployeeBinding | null;
  /** One explicitly submitted native mention; never a persistent role choice. */
  temporaryEmployee?: TemporaryConversationEmployeeAdmission;
  employee?: ProjectEmployee; unavailableReason?: string;
}

export interface TemporaryEmployeeMentionTarget { kind: 'employee' | 'template'; id: string; name: string; description: string; version: number }
function mentionAliases(targets: TemporaryEmployeeMentionTarget[]): Map<string, TemporaryEmployeeMentionTarget> {
  const names = targets.map(target => target.name.replace(/\s+/g, '_')); const result = new Map<string, TemporaryEmployeeMentionTarget>();
  targets.forEach((target, index) => {
    const name = names[index]!;
    let alias = names.filter(value => value === name).length > 1 ? `${name}·${target.kind === 'employee' ? '实例' : '岗位'}-${target.id.slice(-6)}` : name;
    if (result.has(alias)) alias += `-${target.id}`;
    result.set(alias, target);
  });
  return result;
}
/** Shared display aliases; raw admission additionally requires a current native human message. */
export function temporaryEmployeeMentionAliases(state: WorkforceState, projectId: string): Map<string, TemporaryEmployeeMentionTarget> {
  const choices = conversationEmployeeChoices(state, projectId);
  return mentionAliases(choices.map(choice => {
    const version = choice.kind === 'employee' ? state.employees.find(employee => employee.id === choice.id)!.version : state.templates.find(template => template.id === choice.id)!.version;
    return { kind: choice.kind, id: choice.id, name: choice.name, description: choice.description, version };
  }));
}

function knownTemporaryEmployeeTargets(state: WorkforceState, projectId: string): TemporaryEmployeeMentionTarget[] {
  const standalone = state.employees.filter(employee => employee.projectId === projectId && !employee.teamInstanceId && !employee.managerId);
  const instantiated = new Set(standalone.map(employee => employee.templateId));
  return [
    ...standalone.map(employee => ({ kind: 'employee' as const, id: employee.id, name: employee.name, description: employee.modules.responsibilities.mission, version: employee.version })),
    ...state.templates.filter(template => !instantiated.has(template.id)).map(template => ({ kind: 'template' as const, id: template.id, name: template.name, description: template.modules.responsibilities.mission, version: template.version })),
  ];
}

/** A chip has already selected its primary employee by ID; only additional human role mentions are disallowed. */
export function assertNoAdditionalTemporaryEmployeeMention(state: WorkforceState, projectId: string, requestText: string): void {
  const known = knownTemporaryEmployeeTargets(state, projectId); const aliases = mentionAliases(known);
  const available = temporaryEmployeeMentionAliases(state, projectId);
  const body = requestText.replace(/^\s*@[^\s]+(?=\s|$)/, '');
  const additional = [...body.matchAll(/(?:^|\s)@([^\s]+)(?=\s|$)/g)].some(match => available.has(match[1]!) || aliases.has(match[1]!) || known.some(target => target.name.replace(/\s+/g, '_') === match[1]));
  invariant(!additional, '一轮对话只能临时调用一位员工，请分轮发送');
}

/** Only the Host's current native human message calls this resolver; history/tool text is never an admission source. */
export function resolveTemporaryEmployeeMention(state: WorkforceState, projectId: string, requestText: string): TemporaryEmployeeMentionTarget | undefined {
  const leading = /^\s*@([^\s]+)(?=\s|$)/.exec(requestText);
  if (!leading) return undefined;
  const available = temporaryEmployeeMentionAliases(state, projectId).get(leading[1]!);
  if (available) { assertNoAdditionalTemporaryEmployeeMention(state, projectId, requestText); return available; }
  const known = knownTemporaryEmployeeTargets(state, projectId);
  const aliases = mentionAliases(known);
  const bare = known.filter(target => target.name.replace(/\s+/g, '_') === leading[1]);
  invariant(bare.length <= 1, '员工名称存在歧义，请从 @ 候选中选择具体员工');
  const target = aliases.get(leading[1]!);
  if (!target) return undefined;
  assertNoAdditionalTemporaryEmployeeMention(state, projectId, requestText);
  if (target.kind === 'employee') invariant(state.employees.find(employee => employee.id === target.id)?.status === 'active', '该独立员工已暂停，请先启用或从候选中选择其他员工');
  else invariant(state.templates.find(template => template.id === target.id)?.status === 'ready', '该自由职业人已停用或尚未就绪，请从候选中重新选择');
  return target;
}

export function validateTemporaryEmployeeTurnKey(sessionId: string, turnKey: string): void {
  textField(sessionId, '临时员工对话'); textField(turnKey, '临时员工原生轮次');
  const sequence = turnKey.startsWith(`${sessionId}:`) ? turnKey.slice(sessionId.length + 1) : '';
  invariant(/^(0|[1-9]\d*)$/.test(sequence) && Number.isSafeInteger(Number(sequence)), '临时员工原生轮次不属于当前对话');
}

/** A submitted native reference may reuse/create one standalone snapshot without binding a conversation. */
export function admitTemporaryConversationEmployee(state: WorkforceState, input: AdmitTemporaryConversationEmployeeInput,
  createEmployee?: (input: CreateEmployeeInput) => ProjectEmployee): ResolvedConversationEmployee | undefined {
  textField(input.projectId, '项目 ID'); validateTemporaryEmployeeTurnKey(input.sessionId, input.turnKey);
  invariant(state.projects.some(project => project.id === input.projectId), '项目不存在');
  invariant((input.employeeId === undefined) !== (input.templateId === undefined), '请选择一个员工实例或自由职业人');
  invariant(Number.isSafeInteger(input.expectedTargetVersion) && input.expectedTargetVersion > 0, '请选择当前临时员工版本');
  invariant(!state.conversationEmployees?.some(binding => binding.sessionId === input.sessionId && binding.projectId !== input.projectId), '对话属于其他项目');
  let employee: ProjectEmployee | undefined;
  if (input.employeeId !== undefined) {
    textField(input.employeeId, '员工 ID');
    employee = state.employees.find(entry => entry.id === input.employeeId && entry.projectId === input.projectId && !entry.teamInstanceId && !entry.managerId);
    invariant(employee, '临时调用只能选择当前工作区的独立员工');
    if (employee.version !== input.expectedTargetVersion) throw new WorkforceError('CONFLICT', '临时员工配置已更新，请重新选择');
  } else {
    textField(input.templateId, '自由职业人 ID');
    const template = state.templates.find(entry => entry.id === input.templateId);
    invariant(template?.status === 'ready', '请先完善并启用自由职业人');
    if (template.version !== input.expectedTargetVersion) throw new WorkforceError('CONFLICT', '自由职业人配置已更新，请重新选择');
    const candidates = state.employees.filter(entry => entry.projectId === input.projectId && entry.templateId === template.id && !entry.teamInstanceId && !entry.managerId);
    employee = candidates.find(entry => entry.status === 'active') ?? candidates[0];
    invariant(!employee || employee.status === 'active', '该独立员工已暂停，请先启用');
    if (!employee && createEmployee) employee = createEmployee({ projectId: input.projectId, templateId: template.id });
  }
  if (!employee) return undefined;
  invariant(employee.status === 'active', '该独立员工已暂停，请先启用');
  return { projectId: input.projectId, sessionId: input.sessionId, revision: state.revision,
    conversationEmployee: resolveConversationEmployee(state, input.projectId, input.sessionId).conversationEmployee,
    employee: structuredClone(employee), temporaryEmployee: { sessionId: input.sessionId, mode: 'execute', invocation: 'temporary', turnKey: input.turnKey,
      employeeId: employee.id, employeeVersion: employee.version } };
}
/** Plugin HTTP projection; role internals are never sent as the visible information card. */
export interface ConversationEmployeeView {
  enabled: boolean; busy: boolean; sessionId: string; projectId: string | null; revision: number;
  conversationEmployee: ConversationEmployeeBinding | null;
  employee?: EmployeeInfoCard; unavailableReason?: string; choices: ConversationEmployeeChoice[];
}

export function employeeInfoCard(employee: Pick<EmployeeTemplate, 'name' | 'modules'>): EmployeeInfoCard {
  const { responsibilities, capabilities } = employee.modules;
  return {
    name: employee.name, mission: responsibilities.mission,
    duties: [...responsibilities.duties], boundaries: [...responsibilities.boundaries],
    capabilities: {
      skills: capabilities.skills.map(skill => ({ name: skill.name, description: skill.description, usage: skill.usage ?? 'required' })),
      tools: capabilities.tools.map(tool => tool.description).filter(Boolean),
      plugins: (capabilities.plugins ?? []).map(plugin => plugin.name), mcps: (capabilities.mcps ?? []).map(mcp => mcp.name),
    },
  };
}

export function conversationEmployeeChoices(state: WorkforceState, projectId: string): ConversationEmployeeChoice[] {
  const standalone = state.employees.filter(employee => employee.projectId === projectId && !employee.teamInstanceId && !employee.managerId);
  const instantiated = new Set(standalone.map(employee => employee.templateId));
  const choices: ConversationEmployeeChoice[] = standalone.filter(employee => employee.status === 'active').map(employee => ({
    kind: 'employee', id: employee.id, name: employee.name, description: employee.modules.responsibilities.mission, card: employeeInfoCard(employee),
  }));
  for (const template of state.templates) if (template.status === 'ready' && !instantiated.has(template.id)) choices.push({
    kind: 'template', id: template.id, name: template.name, description: template.modules.responsibilities.mission, card: employeeInfoCard(template),
  });
  return choices;
}

export function resolveConversationEmployee(state: WorkforceState, projectId: string, sessionId: string): ResolvedConversationEmployee {
  const binding = state.conversationEmployees?.find(entry => entry.sessionId === sessionId && entry.projectId === projectId);
  const base = { sessionId, projectId, revision: state.revision, conversationEmployee: binding ? structuredClone(binding) : null };
  if (!binding) return base;
  const employee = state.employees.find(entry => entry.projectId === projectId && entry.id === binding.employeeId);
  const unavailableReason = !employee ? '常驻员工已不可用，请退出常驻后重新选择'
    : employee.status !== 'active' ? '常驻员工已暂停，请启用员工或退出常驻'
      : employee.teamInstanceId || employee.managerId ? '常驻员工已加入项目团队，请退出常驻后重新选择独立员工' : undefined;
  return { ...base, ...(employee ? { employee: structuredClone(employee) } : {}), ...(unavailableReason ? { unavailableReason } : {}) };
}

function requireBindingVersion(state: WorkforceState, input: ClearConversationEmployeeInput, options: MutationOptions): ConversationEmployeeBinding | undefined {
  textField(input.projectId, '项目 ID'); textField(input.sessionId, '对话 ID');
  invariant(state.projects.some(project => project.id === input.projectId), '项目不存在');
  invariant(Number.isSafeInteger(options.expectedRevision) && options.expectedRevision! >= 0, '请选择当前工作区版本');
  invariant(Number.isSafeInteger(options.expectedVersion) && options.expectedVersion! >= 0, '请选择当前常驻员工版本');
  invariant(!state.conversationEmployees?.some(entry => entry.sessionId === input.sessionId && entry.projectId !== input.projectId), '对话属于其他项目');
  const binding = state.conversationEmployees?.find(entry => entry.sessionId === input.sessionId);
  if (options.expectedVersion !== (binding?.version ?? 0)) throw new WorkforceError('CONFLICT', '常驻员工已更新，请刷新后重试');
  invariant(!state.runs.some(run => run.conversationEmployee?.sessionId === input.sessionId && ['queued', 'running', 'blocked'].includes(run.status)), '当前对话正在执行，请等待本轮结束再切换常驻员工');
  return binding;
}

export function selectConversationEmployee(state: WorkforceState, input: SelectConversationEmployeeInput, options: MutationOptions,
  createEmployee: (input: CreateEmployeeInput) => ProjectEmployee): ResolvedConversationEmployee {
  const previous = requireBindingVersion(state, input, options);
  invariant(input.mode === 'consult' || input.mode === 'execute', '常驻员工模式无效');
  invariant((input.employeeId === undefined) !== (input.templateId === undefined), '请选择一个员工实例或自由职业人');
  let employee: ProjectEmployee;
  if (input.employeeId !== undefined) {
    textField(input.employeeId, '员工 ID');
    const selected = state.employees.find(entry => entry.id === input.employeeId && entry.projectId === input.projectId);
    invariant(selected && !selected.teamInstanceId && !selected.managerId, '常驻对话只能选择当前工作区的独立员工');
    invariant(selected.status === 'active', '该独立员工已暂停，请先启用'); employee = selected;
  } else {
    textField(input.templateId, '自由职业人 ID');
    const template = state.templates.find(entry => entry.id === input.templateId);
    invariant(template?.status === 'ready', '请先完善并启用自由职业人');
    const candidates = state.employees.filter(entry => entry.projectId === input.projectId && entry.templateId === template.id && !entry.teamInstanceId && !entry.managerId);
    const selected = candidates.find(entry => entry.status === 'active') ?? candidates[0];
    invariant(!selected || selected.status === 'active', '该独立员工已暂停，请先启用');
    employee = selected ?? createEmployee({ projectId: input.projectId, templateId: template.id });
  }
  const at = new Date().toISOString();
  const binding: ConversationEmployeeBinding = { projectId: input.projectId, sessionId: input.sessionId, employeeId: employee.id, mode: input.mode,
    version: (previous?.version ?? 0) + 1, createdAt: previous?.createdAt ?? at, updatedAt: at };
  const bindings = state.conversationEmployees ??= [];
  if (previous) bindings[bindings.indexOf(previous)] = binding; else bindings.push(binding);
  return resolveConversationEmployee(state, input.projectId, input.sessionId);
}

export function clearConversationEmployee(state: WorkforceState, input: ClearConversationEmployeeInput, options: MutationOptions): ResolvedConversationEmployee {
  requireBindingVersion(state, input, options);
  if (state.conversationEmployees) state.conversationEmployees = state.conversationEmployees.filter(entry => entry.sessionId !== input.sessionId);
  return resolveConversationEmployee(state, input.projectId, input.sessionId);
}

export function validateConversationEmployees(state: WorkforceState): void {
  if (state.conversationEmployees !== undefined) {
    invariant(Array.isArray(state.conversationEmployees), '常驻员工配置必须为数组'); const sessions = new Set<string>();
    for (const binding of state.conversationEmployees) {
      invariant(binding && typeof binding === 'object' && !Array.isArray(binding), '常驻员工配置必须为对象');
      for (const field of ['projectId', 'sessionId', 'employeeId'] as const) textField(binding[field], `常驻员工 ${field}`);
      invariant(!sessions.has(binding.sessionId), '常驻员工对话重复'); sessions.add(binding.sessionId);
      invariant(state.projects.some(project => project.id === binding.projectId), '常驻员工项目不存在');
      invariant(state.employees.some(employee => employee.id === binding.employeeId && employee.projectId === binding.projectId), '常驻员工不属于当前项目');
      invariant(binding.mode === 'consult' || binding.mode === 'execute', '常驻员工模式无效');
      invariant(Number.isSafeInteger(binding.version) && binding.version > 0, '常驻员工版本无效');
      for (const field of ['createdAt', 'updatedAt'] as const) invariant(typeof binding[field] === 'string' && Number.isFinite(Date.parse(binding[field])), '常驻员工时间无效');
    }
  }
  for (const run of state.runs) if (run.conversationEmployee !== undefined) {
    const link = run.conversationEmployee;
    invariant(link && typeof link === 'object' && !Array.isArray(link), '常驻员工工作记录无效'); textField(link.sessionId, '常驻员工工作对话');
    invariant(link.mode === 'consult' || link.mode === 'execute', '常驻员工工作模式无效');
    if (link.invocation === 'temporary') {
      validateTemporaryEmployeeTurnKey(link.sessionId, link.turnKey);
      invariant(link.mode === 'execute' && Number.isSafeInteger(link.employeeVersion) && link.employeeVersion > 0, '临时员工工作版本或模式无效');
      invariant(run.employeeSnapshot.version === link.employeeVersion, '临时员工工作快照版本不一致');
      invariant(!run.parentRunId, '临时员工工作必须由原生对话发起');
    } else {
      invariant(link.invocation === undefined || link.invocation === 'resident', '员工工作调用方式无效');
      invariant(Number.isSafeInteger(link.bindingVersion) && link.bindingVersion > 0, '常驻员工工作绑定版本无效');
    }
    invariant(!run.conversationWorkflow && !run.workflow && !run.workTaskId, '常驻员工工作不能混用工作流或任务');
    invariant(run.sessionId === undefined || run.sessionId === link.sessionId, '常驻员工工作对话不一致');
  }
}

/** Read-only public description; callers validate actual native session ownership. */
export function resolveEmployeeInfo(state: WorkforceState, projectId: string, input: { employeeId?: string; templateId?: string }): EmployeeInfoCard {
  invariant((input.employeeId === undefined) !== (input.templateId === undefined), '请选择一个员工实例或自由职业人');
  if (input.employeeId !== undefined) {
    textField(input.employeeId, '员工 ID');
    const employee = state.employees.find(entry => entry.id === input.employeeId && entry.projectId === projectId && !entry.teamInstanceId && !entry.managerId);
    invariant(employee, '员工不属于当前工作区的独立员工'); return employeeInfoCard(employee);
  }
  textField(input.templateId, '自由职业人 ID');
  const template = state.templates.find(entry => entry.id === input.templateId && entry.status === 'ready');
  invariant(template, '自由职业人不可用'); return employeeInfoCard(template);
}
