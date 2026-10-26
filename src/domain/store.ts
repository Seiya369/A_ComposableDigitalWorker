import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename, stat, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { createSeedState } from './seed.js';
import { bindWorkflow } from './workflow-template.js';
import { reorderLibrary, type ReorderLibraryInput } from './library-order.js';
import { exportBundle, previewImport, importBundle, existingImportResult } from './transfer.js';
import { applySettingsBundle, type SettingsRoot } from './settings-transfer.js';
import type { ExportSelection, ImportOptions, ImportTarget, ImportPreview, ImportResult, TransferBundle } from './transfer-types.js';
import type { SaveWorkflowTemplateInput, WorkflowTemplate, TeamTemplate } from './types.js';
import { cancelProjectTeams, installProjectTeam } from './project-team.js';
import { selectConversationWorkflow, selectConversationWorkflowStep, validateConversationWorkflowRun, reviewConversationWorkflowRun, conversationWorkflowLibraryNeedsSync, synchronizeConversationWorkflowLibrary, type SelectConversationWorkflowInput, type SelectConversationWorkflowStepInput, type ConversationWorkflowView } from './conversation-workflow.js';
import { selectConversationEmployee, clearConversationEmployee, type SelectConversationEmployeeInput, type ClearConversationEmployeeInput, type ResolvedConversationEmployee } from './conversation-employee.js';
import type { CancelProjectTeamsInput, ConfigureProjectTeamInput, ProjectTeam, SetProjectTeamKnowledgeInput } from './types.js';
import { invariant, textField, validateRelativePath, validateState, WorkforceError } from './validation.js';
import type { CreateEmployeeInput, CreateProjectEmployeesInput, CreateRunInput, EmployeeTemplate, MemoryRecord, MutationOptions, ProjectEmployee, ReviewRunInput, RunStatus, SaveEmployeeConfigurationInput, SaveMemoryInput, SaveProjectInput, SaveTeamInput, SaveTemplateInput, UpdateEmployeeInput, UpdateRunInput, WorkforceRun, WorkforceState } from './types.js';

const clone = <T>(value: T): T => structuredClone(value);
const now = () => new Date().toISOString();
function errorCode(error: unknown): string | undefined { return error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined; }
function required<T extends { id: string }>(entries: T[], id: string, label: string): T { const result = entries.find(e => e.id === id); if (!result) throw new WorkforceError('NOT_FOUND', `${label}不存在：${id}`); return result; }
function checkVersion(value: { version: number }, options: MutationOptions): void { if (options.expectedVersion !== undefined && options.expectedVersion !== value.version) throw new WorkforceError('CONFLICT', '该记录已更新，请刷新后重新编辑'); }
async function loadState(path: string): Promise<WorkforceState> { const data: unknown = JSON.parse(await readFile(path, 'utf8')); validateState(data); return data; }
async function atomicWrite(path: string, data: WorkforceState): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { const file = await open(temporary, 'wx', 0o600); try { await file.writeFile(`${JSON.stringify(data, null, 2)}\n`, 'utf8'); await file.sync(); } finally { await file.close(); } await rename(temporary, path); }
  finally { await unlink(temporary).catch(error => { if (errorCode(error) !== 'ENOENT') throw error; }); }
}
/** Cross-store writers fail explicitly instead of silently overwriting a revision. */
async function withLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = `${path}.lock`;
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) { if (errorCode(error) === 'EEXIST') throw new WorkforceError('STORE_BUSY', '数字员工存储正由另一实例写入；请稍后重试。若进程意外退出，请确认没有其他写入进程后清理 .lock 文件。'); throw error; }
  try { await lock.writeFile(JSON.stringify({ pid: process.pid, createdAt: now() })); return await operation(); }
  finally { await lock.close(); await unlink(lockPath); }
}

export class WorkforceStore {
  private pending: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  private constructor(public readonly filePath: string, private state: WorkforceState) {}
  static async open(filePath: string): Promise<WorkforceStore> {
    textField(filePath, '存储路径'); const path = resolve(filePath); await mkdir(dirname(path), { recursive: true });
    let state: WorkforceState;
    try { state = await loadState(path); }
    catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
      state = await withLock(path, async () => {
        try { return await loadState(path); } catch (second) { if (errorCode(second) !== 'ENOENT') throw second; }
        const seed = createSeedState(); validateState(seed); await atomicWrite(path, seed); return seed;
      });
    }
    const store = new WorkforceStore(path, state);
    if (conversationWorkflowLibraryNeedsSync(state)) await store.transaction(() => undefined);
    return store;
  }
  snapshot(): WorkforceState { return clone(this.state); }
  get revision(): number { return this.state.revision; }
  /** Project synchronization must not copy every employee, memory and historical run. */
  listProjects(): WorkforceState['projects'] { return clone(this.state.projects); }
  async reorderLibrary(input: ReorderLibraryInput, options: MutationOptions = {}): Promise<void> {
    input = clone(input);
    invariant(Number.isSafeInteger(options.expectedRevision) && options.expectedRevision! >= 0, '排序必须提供当前工作区版本');
    return this.mutate(options, state => reorderLibrary(state, input));
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  /** Trusted domain transactions share the same revision check and atomic disk commit. */
  transaction<T>(operation: (state: WorkforceState) => T, options: Pick<MutationOptions, 'expectedRevision'> = {}, replay?: (state: WorkforceState) => T | undefined): Promise<T> { return this.mutate(options, operation, replay); }
  reload(): Promise<WorkforceState> {
    const job = this.pending.then(async () => { this.state = await loadState(this.filePath); return this.snapshot(); });
    this.pending = job.catch(() => undefined); return job;
  }
  private mutate<T>(options: MutationOptions, operation: (next: WorkforceState) => T | Promise<T>, replay?: (state: WorkforceState) => T | undefined): Promise<T> {
    const checkedOptions = clone(options);
    const job = this.pending.then(() => withLock(this.filePath, async () => {
      const disk = await loadState(this.filePath);
      const previous = replay?.(disk);
      if (previous !== undefined) { this.state = disk; return clone(previous); }
      if (checkedOptions.expectedRevision !== undefined && checkedOptions.expectedRevision !== this.state.revision) throw new WorkforceError('CONFLICT', '工作区配置已更新，请刷新后重试');
      if (disk.revision !== this.state.revision) throw new WorkforceError('CONFLICT', '其他实例已写入配置，请重新载入后重试');
      const next = clone(this.state); const result = await operation(next);
      synchronizeConversationWorkflowLibrary(next, (input, teamId) => this.addEmployee(next, input, teamId));
      next.revision += 1; validateState(next); await atomicWrite(this.filePath, next); this.state = next;
      for (const listener of this.listeners) { try { listener(); } catch { /* A subscriber cannot undo a committed transaction. */ } }
      return clone(result);
    }));
    this.pending = job.catch(() => undefined); return job;
  }
  saveTemplate(input: SaveTemplateInput, options: MutationOptions = {}): Promise<EmployeeTemplate> {
    input = clone(input); options = clone(options);
    return this.mutate(options, state => {
      const old = input.id ? state.templates.find(t => t.id === input.id) : undefined; if (old) checkVersion(old, options);
      const date = now(); const entry: EmployeeTemplate = { id: old?.id ?? input.id ?? randomUUID(), name: input.name, description: input.description ?? old?.description ?? '', status: input.status ?? old?.status ?? 'draft', modules: input.modules, version: (old?.version ?? 0) + 1, createdAt: old?.createdAt ?? date, updatedAt: date };
      if (old) state.templates[state.templates.indexOf(old)] = entry; else state.templates.push(entry); return entry;
    });
  }
  /** Persist a role and its selected blueprint membership without partial saves. */
  saveEmployeeConfiguration(input: SaveEmployeeConfigurationInput, options: MutationOptions = {}): Promise<EmployeeTemplate> {
    input = clone(input); options = clone(options);
    return this.mutate(options, state => {
      invariant(input && typeof input === 'object', '员工配置必须为对象');
      const { template, membership } = input;
      invariant(template && typeof template === 'object', '员工岗位配置必须为对象');
      if (membership !== undefined) invariant(membership && typeof membership === 'object', '员工所属团队配置必须为对象');
      const old = template.id ? state.templates.find(item => item.id === template.id) : undefined;
      if (!old && options.expectedVersion !== undefined) throw new WorkforceError('NOT_FOUND', '员工模板不存在或已被删除，请刷新后重新选择');
      if (old) checkVersion(old, options);

      const { source, target } = membership ?? {};
      const findTeam = (reference: NonNullable<typeof source>) => {
        invariant(reference && typeof reference === 'object', '员工所属团队引用必须为对象');
        textField(reference.teamId, '所属团队');
        textField(reference.memberId, '团队成员 ID');
        invariant(Number.isSafeInteger(reference.teamVersion) && reference.teamVersion > 0, '所属团队版本无效');
        const team = required(state.teams, reference.teamId, '团队');
        checkVersion(team, { expectedVersion: reference.teamVersion });
        return team;
      };
      const sourceTeam = source !== undefined ? findTeam(source) : undefined;
      const targetTeam = target !== undefined ? findTeam(target) : undefined;
      const sourceMember = sourceTeam?.members.find(member => member.memberId === source!.memberId);
      if (sourceTeam) {
        if (!sourceMember) throw new WorkforceError('NOT_FOUND', '团队成员不存在或已被移除，请刷新后重新选择');
        if (sourceMember.templateId !== old?.id) throw new WorkforceError('CONFLICT', '团队成员的岗位模板已变更，请刷新后重新选择');
      }
      const sameTeam = sourceTeam !== undefined && sourceTeam === targetTeam;
      if (sameTeam && source!.memberId !== target!.memberId) throw new WorkforceError('CONFLICT', '不能改变当前团队成员的标识，请刷新后重新选择');
      if (targetTeam && !sameTeam && targetTeam.members.some(member => member.memberId === target!.memberId)) throw new WorkforceError('CONFLICT', '目标团中已存在同一成员标识，请重新添加员工');

      const date = now();
      const entry: EmployeeTemplate = {
        id: old?.id ?? template.id ?? randomUUID(), name: template.name,
        description: template.description ?? old?.description ?? '', status: template.status ?? old?.status ?? 'draft',
        modules: template.modules, version: (old?.version ?? 0) + 1,
        createdAt: old?.createdAt ?? date, updatedAt: date,
      };
      if (old) state.templates[state.templates.indexOf(old)] = entry; else state.templates.push(entry);
      if (sameTeam) {
        if (target!.reportsTo === undefined) delete sourceMember!.reportsTo;
        else sourceMember!.reportsTo = target!.reportsTo;
      } else {
        if (sourceTeam && sourceMember) {
          sourceTeam.members = sourceTeam.members.filter(member => member !== sourceMember);
          // The departing member's direct reports stay in their original team.
          for (const member of sourceTeam.members) if (member.reportsTo === sourceMember.memberId) {
            if (sourceMember.reportsTo === undefined) delete member.reportsTo;
            else member.reportsTo = sourceMember.reportsTo;
          }
        }
        if (targetTeam) targetTeam.members.push({
          memberId: target!.memberId, templateId: entry.id,
          ...(sourceMember?.name !== undefined ? { name: sourceMember.name } : {}),
          ...(target!.reportsTo !== undefined ? { reportsTo: target!.reportsTo } : {}),
        });
      }
      for (const team of new Set([sourceTeam, targetTeam])) if (team) { team.version++; team.updatedAt = date; }
      return entry;
    });
  }
  archiveTemplate(id: string, options: MutationOptions = {}): Promise<EmployeeTemplate> { return this.mutate(options, state => { const t = required(state.templates, id, '模板'); checkVersion(t, options); t.status = 'archived'; t.version++; t.updatedAt = now(); return t; }); }
  saveTeam(input: SaveTeamInput, options: MutationOptions = {}) {
    input = clone(input); options = clone(options);
    return this.mutate(options, state => {
      const old = input.id ? state.teams.find(t => t.id === input.id) : undefined;
      if (!old && options.expectedVersion !== undefined) throw new WorkforceError('NOT_FOUND', '团队不存在或已被删除，请刷新后重新选择');
      if (old) checkVersion(old, options);
      invariant(input.knowledgeEnabled === undefined || typeof input.knowledgeEnabled === 'boolean', '资料管理员开关必须为布尔值');
      const date = now(); const entry = { id: old?.id ?? input.id ?? randomUUID(), name: input.name, description: input.description ?? old?.description ?? '', knowledgeEnabled: input.knowledgeEnabled ?? old?.knowledgeEnabled ?? true, members: input.members, workflows: input.workflows ?? old?.workflows ?? [], version: (old?.version ?? 0) + 1, createdAt: old?.createdAt ?? date, updatedAt: date };
      if (old) state.teams[state.teams.indexOf(old)] = entry; else state.teams.push(entry);
      return entry;
    });
  }
  saveWorkflowTemplate(input: SaveWorkflowTemplateInput, options: MutationOptions = {}): Promise<WorkflowTemplate> {
    input = clone(input); options = clone(options);
    return this.mutate(options, state => {
      const old = input.id ? state.workflowTemplates?.find(workflow => workflow.id === input.id) : undefined;
      if (!old && options.expectedVersion !== undefined) throw new WorkforceError('NOT_FOUND', '工作流模板不存在，请刷新后重试');
      if (old) checkVersion(old, options);
      const date = now();
      const workflow: WorkflowTemplate = { id: old?.id ?? input.id ?? randomUUID(), name: input.name, description: input.description ?? old?.description ?? '', roles: input.roles, steps: input.steps, version: (old?.version ?? 0) + 1, createdAt: old?.createdAt ?? date, updatedAt: date, ...(input.team ? { team: input.team } : {}), ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}) };
      const templates = state.workflowTemplates ??= []; if (old) templates[templates.indexOf(old)] = workflow; else templates.push(workflow); return workflow;
    });
  }
  deleteWorkflowTemplate(id: string, options: MutationOptions = {}): Promise<void> {
    return this.mutate(options, state => { const workflow = required(state.workflowTemplates ?? [], id, '工作流模板'); checkVersion(workflow, options); state.workflowTemplates = state.workflowTemplates!.filter(entry => entry.id !== id); });
  }
  bindTeamWorkflow(teamId: string, workflowTemplateId: string, bindings: Record<string, string>, options: MutationOptions = {}): Promise<TeamTemplate> {
    bindings = clone(bindings); options = clone(options);
    return this.mutate(options, state => { const team = required(state.teams, teamId, '团队'); checkVersion(team, options); const workflow = required(state.workflowTemplates ?? [], workflowTemplateId, '工作流模板'); bindWorkflow(team, workflow, bindings); team.version++; team.updatedAt = now(); return team; });
  }
  exportBundle(selection: ExportSelection): TransferBundle { return exportBundle(this.state, clone(selection)); }
  saveSettingsBundle(document: unknown, options: MutationOptions = {}): Promise<SettingsRoot> {
    document = clone(document); options = clone(options); return this.mutate(options, state => applySettingsBundle(state, document, options));
  }
  previewImport(document: unknown, target: ImportTarget): ImportPreview { return previewImport(this.state, document, clone(target)); }
  importBundle(document: unknown, input: ImportOptions, options: MutationOptions = {}): Promise<ImportResult> {
    document = clone(document); input = clone(input); return this.mutate(options, state => importBundle(state, document, input), state => existingImportResult(state, document, input));
  }
  deleteTeam(id: string, options: MutationOptions = {}): Promise<void> { return this.mutate(options, state => { const team = required(state.teams, id, '团队'); checkVersion(team, options); state.teams = state.teams.filter(t => t.id !== id); }); }
  saveProject(input: SaveProjectInput, options: MutationOptions = {}) {
    input = clone(input);
    return this.mutate(options, async state => { textField(input.rootPath, '项目目录'); invariant(isAbsolute(input.rootPath), '项目目录必须为绝对路径'); const rootPath = await realpath(input.rootPath); invariant((await stat(rootPath)).isDirectory(), '项目目录必须是文件夹'); const old = input.id ? state.projects.find(p => p.id === input.id) : state.projects.find(p => p.rootPath === rootPath); invariant(!state.projects.some(p => p.id !== old?.id && p.rootPath === rootPath), '该目录已绑定另一个项目'); const date = now(); const entry = { id: old?.id ?? input.id ?? randomUUID(), name: input.name, rootPath, createdAt: old?.createdAt ?? date, updatedAt: date }; if (old) state.projects[state.projects.indexOf(old)] = entry; else state.projects.push(entry); return entry; });
  }
  private addEmployee(state: WorkforceState, input: CreateEmployeeInput, teamInstanceId?: string): ProjectEmployee {
    required(state.projects, input.projectId, '项目'); const t = required(state.templates, input.templateId, '模板'); invariant(t.status !== 'archived', '归档模板不能添加到项目'); const date = now();
    const entry: ProjectEmployee = { id: randomUUID(), projectId: input.projectId, name: input.name ?? t.name, templateId: t.id, templateName: t.name, templateVersion: t.version, modules: clone(t.modules), version: 1, status: t.status === 'ready' ? 'active' : 'paused', createdAt: date, updatedAt: date, ...(input.managerId ? { managerId: input.managerId } : {}), ...(teamInstanceId ? { teamInstanceId } : {}) }; state.employees.push(entry); return entry;
  }
  createEmployee(input: CreateEmployeeInput, options: MutationOptions = {}): Promise<ProjectEmployee> { input = clone(input); return this.mutate(options, state => this.addEmployee(state, input)); }
  /** Explicit standalone mention admission; listing templates never creates employees. */
  ensureStandaloneEmployee(input: Pick<CreateEmployeeInput, 'projectId' | 'templateId'>): Promise<ProjectEmployee> {
    input = clone(input);
    const existing = (state: WorkforceState) => {
      required(state.projects, input.projectId, '项目');
      const template = required(state.templates, input.templateId, '模板');
      invariant(template.status === 'ready', '请先完善并启用自由职业人');
      const candidates = state.employees.filter(employee => employee.projectId === input.projectId
        && employee.templateId === input.templateId && !employee.teamInstanceId && !employee.managerId);
      const employee = candidates.find(item => item.status === 'active') ?? candidates[0];
      invariant(!employee || employee.status === 'active', '该独立员工已暂停，请先启用');
      return employee;
    };
    return this.mutate({}, state => existing(state) ?? this.addEmployee(state, input), existing);
  }
  /** Explicit binding and optional standalone admission share one atomic commit. */
  setConversationEmployee(input: SelectConversationEmployeeInput, options: MutationOptions = {}): Promise<ResolvedConversationEmployee> {
    input = clone(input); options = clone(options);
    return this.mutate(options, state => ({ ...selectConversationEmployee(state, input, options, draft => this.addEmployee(state, draft)), revision: state.revision + 1 }));
  }
  clearConversationEmployee(input: ClearConversationEmployeeInput, options: MutationOptions = {}): Promise<ResolvedConversationEmployee> {
    input = clone(input); options = clone(options);
    return this.mutate(options, state => ({ ...clearConversationEmployee(state, input, options), revision: state.revision + 1 }));
  }
  /** Confirm the entire staffing draft once; no partial team or global template edit is persisted. */
  createProjectEmployees(input: CreateProjectEmployeesInput, options: MutationOptions = {}): Promise<ProjectEmployee[]> {
    input = clone(input);
    return this.mutate(options, state => {
      invariant(input && typeof input === 'object', '项目员工配置必须为对象');
      textField(input.projectId, '项目 ID');
      required(state.projects, input.projectId, '项目');
      invariant(Array.isArray(input.employees) && input.employees.length > 0 && input.employees.length <= 50, '请选择 1–50 位项目员工');
      const fingerprint = createHash('sha256').update(JSON.stringify({ projectId: input.projectId, employees: input.employees })).digest('hex');
      if (input.requestId !== undefined) {
        textField(input.requestId, '创建请求标识');
        invariant(input.requestId.length <= 200, '创建请求标识过长');
        const receipt = state.staffingBatches?.find(batch => batch.requestId === input.requestId);
        if (receipt) {
          if (receipt.projectId !== input.projectId || receipt.fingerprint !== fingerprint) throw new WorkforceError('CONFLICT', '这次创建请求已完成，请到项目团队查看已创建的实例；修改分工请编辑实例，新建其他员工请重新开始组队');
          const previous = receipt.employeeIds.map(id => state.employees.find(employee => employee.id === id && employee.projectId === input.projectId));
          if (previous.some(employee => !employee)) throw new WorkforceError('CONFLICT', '这次创建请求已完成，但部分员工已被移除，请刷新项目团队后重新组队');
          return previous as ProjectEmployee[];
        }
      }
      const keys = new Set<string>();
      for (const draft of input.employees) {
        invariant(draft && typeof draft === 'object', '待创建员工必须为对象');
        textField(draft.key, '待创建员工标识');
        invariant(!keys.has(draft.key), '待创建员工标识重复');
        keys.add(draft.key);
        textField(draft.templateId, '来源模板');
        invariant(Number.isSafeInteger(draft.templateVersion) && draft.templateVersion > 0, '来源模板版本无效');
        const template = required(state.templates, draft.templateId, '模板');
        invariant(template.status === 'ready', '只能从已发布的可用模板创建项目员工');
        if (template.version !== draft.templateVersion) throw new WorkforceError('CONFLICT', `“${template.name}”模板已更新，请重新选择最新版本后创建项目实例`);
        invariant(!(draft.managerId !== undefined && draft.managerKey !== undefined), '汇报对象只能选择一位员工');
        if (draft.managerId !== undefined) {
          textField(draft.managerId, '已有汇报对象');
          invariant(state.employees.some(employee => employee.id === draft.managerId && employee.projectId === input.projectId), '汇报对象必须是本项目员工');
        }
        if (draft.managerKey !== undefined) textField(draft.managerKey, '本批汇报对象');
      }
      const groupId = randomUUID();
      const created = new Map<string, ProjectEmployee>();
      for (const draft of input.employees) {
        const employee = this.addEmployee(state, { projectId: input.projectId, templateId: draft.templateId, name: draft.name, managerId: draft.managerId }, groupId);
        if (draft.modules !== undefined) employee.modules = clone(draft.modules);
        if (draft.status !== undefined) employee.status = draft.status;
        created.set(draft.key, employee);
      }
      for (const draft of input.employees) {
        if (draft.managerKey !== undefined) {
          const manager = created.get(draft.managerKey);
          invariant(manager, '汇报对象不在本次选择的员工中');
          created.get(draft.key)!.managerId = manager.id;
        }
      }
      // validateState in mutate checks module values and cycles before the single disk commit.
      if (input.requestId !== undefined) (state.staffingBatches ??= []).push({ requestId: input.requestId, projectId: input.projectId, fingerprint, employeeIds: [...created.values()].map(employee => employee.id), createdAt: now() });
      return [...created.values()];
    });
  }
  instantiateTeam(projectId: string, teamTemplateId: string, options: MutationOptions = {}): Promise<ProjectEmployee[]> {
    return this.mutate(options, state => {
      const team = required(state.teams, teamTemplateId, '团队'); checkVersion(team, options);
      invariant(team.members.length > 0, '空团队没有可添加的员工');
      const groupId = randomUUID(); const members = new Map<string, ProjectEmployee>();
      for (const member of team.members) {
        const employee = this.addEmployee(state, { projectId, templateId: member.templateId, ...(member.name ? { name: member.name } : {}) }, groupId);
        employee.legacyTeamKnowledgeEnabled = team.knowledgeEnabled ?? true;
        members.set(member.memberId, employee);
      }
      for (const member of team.members) if (member.reportsTo) members.get(member.memberId)!.managerId = members.get(member.reportsTo)!.id;
      return [...members.values()];
    });
  }
  configureProjectTeam(input: ConfigureProjectTeamInput, options: MutationOptions = {}): Promise<ProjectTeam> {
    input = clone(input);
    return this.mutate(options, state => installProjectTeam(state, input, (employee, teamId) => this.addEmployee(state, employee, teamId)));
  }
  async selectConversationWorkflow(input: SelectConversationWorkflowInput, options: MutationOptions = {}): Promise<ConversationWorkflowView> {
    input = clone(input); invariant(Number.isSafeInteger(options.expectedRevision) && options.expectedRevision! >= 0, '选择工作流必须提供当前工作区版本');
    return this.mutate(options, state => selectConversationWorkflow(state, input, (employee, teamId) => this.addEmployee(state, employee, teamId)));
  }
  async selectConversationWorkflowStep(input: SelectConversationWorkflowStepInput, options: MutationOptions = {}): Promise<ConversationWorkflowView> {
    input = clone(input); invariant(Number.isSafeInteger(options.expectedRevision) && options.expectedRevision! >= 0, '切换步骤必须提供当前工作区版本');
    return this.mutate(options, state => selectConversationWorkflowStep(state, input));
  }
  setProjectTeamKnowledge(input: SetProjectTeamKnowledgeInput): Promise<Pick<ProjectTeam, 'id' | 'knowledgeEnabled' | 'version'>> {
    input = clone(input);
    return this.mutate({}, state => {
      textField(input.projectId, '项目 ID'); textField(input.teamId, '项目团队 ID');
      invariant(typeof input.enabled === 'boolean', '资料管理员开关必须为布尔值');
      const team = state.projectTeams?.find(team => team.id === input.teamId && team.projectId === input.projectId);
      if (!team) {
        const members = state.employees.filter(employee => employee.projectId === input.projectId && employee.teamInstanceId === input.teamId);
        invariant(members.length > 0 && !state.projectTeams?.some(team => team.id === input.teamId), '团队不属于当前项目');
        const version = Math.max(...members.map(member => member.version));
        if (!Number.isSafeInteger(input.version) || input.version !== version) throw new WorkforceError('CONFLICT', '项目团队已更新，请刷新后重试');
        const at = now();
        for (const member of members) { member.legacyTeamKnowledgeEnabled = input.enabled; member.version++; member.updatedAt = at; }
        return { id: input.teamId, knowledgeEnabled: input.enabled, version: version + 1 };
      }
      invariant(team, '团队不属于当前项目');
      invariant(team.status !== 'cancelled', '请先恢复已取消的团队');
      if (!Number.isSafeInteger(input.version) || input.version !== (team.version ?? 1)) throw new WorkforceError('CONFLICT', '项目团队已更新，请刷新后重试');
      team.knowledgeEnabled = input.enabled;
      team.version = (team.version ?? 1) + 1; team.updatedAt = now();
      return team;
    });
  }
  cancelProjectTeams(input: CancelProjectTeamsInput): Promise<{ runIds: string[] }> {
    input = clone(input);
    return this.mutate({}, state => cancelProjectTeams(state, input));
  }
  updateEmployee(id: string, patch: UpdateEmployeeInput, options: MutationOptions = {}): Promise<ProjectEmployee> {
    patch = clone(patch); options = clone(options);
    return this.mutate(options, state => { const e = required(state.employees, id, '员工'); checkVersion(e, options); if (patch.name !== undefined) e.name = patch.name; if (patch.modules !== undefined) e.modules = patch.modules; if (patch.status !== undefined) e.status = patch.status; if (patch.managerId === null) delete e.managerId; else if (patch.managerId !== undefined) e.managerId = patch.managerId; e.version++; e.updatedAt = now(); return e; });
  }
  deleteEmployee(id: string, options: MutationOptions = {}): Promise<void> { return this.mutate(options, state => { const e = required(state.employees, id, '员工'); checkVersion(e, options); invariant(!state.conversationEmployees?.some(binding => binding.employeeId === id), '该员工正在常驻对话，请先退出常驻'); invariant(!state.projectTeams?.some(team => team.members.some(member => member.employeeId === id)), '该员工属于项目团队，请暂停员工以保留团队和工作流关系'); invariant(!state.employees.some(other => other.managerId === id), '请先调整下属的汇报关系'); invariant(!state.workState?.tasks.some(task => task.employeeId === id), '该员工已有项目任务，请保留员工并暂停以保护任务历史'); invariant(!state.runs.some(r => r.employeeId === id) && !state.memories.some(m => m.employeeId === id), '该员工已有工作或记忆记录，请暂停员工以保留历史'); state.employees = state.employees.filter(other => other.id !== id); }); }
  listMemories(projectId: string, employeeId?: string): MemoryRecord[] {
    required(this.state.projects, projectId, '项目'); if (employeeId) invariant(this.state.employees.some(e => e.id === employeeId && e.projectId === projectId), '不能读取其他项目员工的记忆');
    return clone(this.state.memories.filter(m => m.projectId === projectId && (m.scope === 'project' || (employeeId !== undefined && m.employeeId === employeeId))));
  }
  saveMemory(input: SaveMemoryInput, options: MutationOptions = {}): Promise<MemoryRecord> {
    input = clone(input); options = clone(options);
    return this.mutate(options, async state => {
      const project = required(state.projects, input.projectId, '项目'); const old = input.id ? required(state.memories, input.id, '记忆') : undefined; if (old) { checkVersion(old, options); invariant(old.projectId === input.projectId && old.scope === input.scope && old.employeeId === input.employeeId, '不能改变记忆的项目或归属范围'); }
      invariant(input.source && typeof input.source === 'object', '记忆必须提供核验来源');
      if (input.source.kind === 'project-file') { validateRelativePath(input.source.path); const root = await realpath(project.rootPath); const file = await realpath(resolve(root, input.source.path)); const rel = relative(root, file); invariant(rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), '记忆来源文件必须位于本项目内'); invariant((await stat(file)).isFile(), '记忆来源必须为真实文件'); }
      const date = now(); const entry: MemoryRecord = { id: old?.id ?? randomUUID(), projectId: input.projectId, scope: input.scope, ...(input.employeeId ? { employeeId: input.employeeId } : {}), title: input.title, content: input.content, source: input.source, verifiedAt: date, version: (old?.version ?? 0) + 1, createdAt: old?.createdAt ?? date, updatedAt: date }; if (old) state.memories[state.memories.indexOf(old)] = entry; else state.memories.push(entry); return entry;
    });
  }
  deleteMemory(id: string, options: MutationOptions = {}): Promise<void> { return this.mutate(options, state => { const memory = required(state.memories, id, '记忆'); checkVersion(memory, options); state.memories = state.memories.filter(m => m.id !== id); }); }
  createRun(input: CreateRunInput, options: MutationOptions = {}): Promise<WorkforceRun> {
    input = clone(input);
    return this.mutate(options, state => {
      const e = required(state.employees, input.employeeId, '员工');
      invariant(e.projectId === input.projectId, '不能在其他项目运行员工'); invariant(e.status === 'active', '该员工尚未启用');
      const parent = input.parentRunId ? state.runs.find(run => run.id === input.parentRunId && run.projectId === input.projectId) : undefined;
      if (parent?.conversationWorkflow && !input.conversationWorkflow) input.conversationWorkflow = clone(parent.conversationWorkflow);
      validateConversationWorkflowRun(state, input);
      if (input.conversationEmployee) {
        const binding = state.conversationEmployees?.find(entry => entry.sessionId === input.conversationEmployee!.sessionId && entry.projectId === input.projectId);
        if (!binding || binding.employeeId !== e.id || binding.mode !== input.conversationEmployee.mode || binding.version !== input.conversationEmployee.bindingVersion) throw new WorkforceError('CONFLICT', '常驻员工已更新，请刷新后重试');
        invariant(!input.parentRunId, '常驻员工工作必须由原生对话发起');
      }
      const date = now(); const entry: WorkforceRun = { id: randomUUID(), projectId: input.projectId, employeeId: e.id,
        request: input.request, status: 'queued', employeeSnapshot: clone(e), artifacts: [], version: 1, createdAt: date, updatedAt: date,
        ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}), ...(input.conversationWorkflow ? { conversationWorkflow: input.conversationWorkflow } : {}),
        ...(input.conversationEmployee ? { conversationEmployee: clone(input.conversationEmployee) } : {}) };
      state.runs.push(entry); return entry;
    });
  }
  updateRun(id: string, patch: UpdateRunInput, options: MutationOptions = {}): Promise<WorkforceRun> {
    patch = clone(patch); options = clone(options);
    return this.mutate(options, state => {
      const run = required(state.runs, id, '工作'); checkVersion(run, options);
      invariant(!['succeeded', 'failed', 'cancelled'].includes(run.status), '已结束工作不能修改，请创建新的执行记录');
      // Cancellation may commit while a provider is returning its last response.
      // Preserve that response, but never reopen work for a cancelled installation.
      if (patch.status && state.projectTeams?.some(team => team.status === 'cancelled' && team.members.some(member => member.employeeId === run.employeeId))) patch.status = 'cancelled';
      const transitions: Record<RunStatus, RunStatus[]> = { queued: ['running', 'failed', 'cancelled'], running: ['blocked', 'awaiting-review', 'failed', 'cancelled'], blocked: ['running', 'failed', 'cancelled'], 'awaiting-review': ['running', 'failed', 'cancelled'], succeeded: [], failed: [], cancelled: [] };
      if (patch.status !== undefined && patch.status !== run.status) { invariant(transitions[run.status].includes(patch.status), `不能从 ${run.status} 转为 ${patch.status}`); run.status = patch.status; }
      for (const key of ['sessionId', 'artifacts', 'error', 'output', 'usage', 'activity', 'startedAt', 'finishedAt'] as const) if (patch[key] !== undefined) Object.assign(run, { [key]: patch[key] });
      if (run.status === 'running' && !run.startedAt) run.startedAt = now(); if (['failed', 'cancelled'].includes(run.status) && !run.finishedAt) run.finishedAt = now();
      run.version++; run.updatedAt = now(); return run;
    });
  }
  /** Consulting finishes in the native conversation; no artifact review is invented. */
  completeConversationConsultation(id: string, result: Pick<UpdateRunInput, 'output' | 'usage' | 'finishedAt'>): Promise<WorkforceRun> {
    result = clone(result);
    return this.mutate({}, state => {
      const run = required(state.runs, id, '工作');
      invariant(run.conversationEmployee?.mode === 'consult', '只有常驻员工咨询可通过此入口完成');
      invariant(run.status === 'running', '只有正在执行的咨询可以完成');
      invariant(run.artifacts.length === 0 && run.acceptance === undefined, '咨询不能包含工作交付或验收记录');
      run.status = 'succeeded';
      if (result.output !== undefined) run.output = result.output;
      if (result.usage !== undefined) run.usage = result.usage;
      run.finishedAt = result.finishedAt ?? now(); run.updatedAt = now(); run.version++;
      return run;
    }, state => state.runs.find(run => run.id === id && run.conversationEmployee?.mode === 'consult' && run.status === 'succeeded'));
  }
  reviewRun(id: string, input: ReviewRunInput, options: MutationOptions = {}): Promise<WorkforceRun> {
    input = clone(input); options = clone(options);
    return this.mutate(options, state => { const run = required(state.runs, id, '工作'); checkVersion(run, options); invariant(!run.workflow, '工作流步骤必须通过工作流验收入口处理'); invariant(!run.workTaskId, '项目任务必须通过交付验收入口处理'); invariant(run.status === 'awaiting-review', '只有待验收工作可以验收'); invariant(input.decision === 'accepted' || input.decision === 'rejected', '验收决定无效'); textField(input.reviewer, '验收人'); if (input.decision === 'accepted') invariant(run.artifacts.length > 0 || Boolean(run.output?.trim()), '缺少可验收的交付内容'); run.acceptance = { decision: input.decision, reviewer: input.reviewer, note: input.note ?? '', at: now() }; run.status = input.decision === 'accepted' ? 'succeeded' : 'failed'; run.finishedAt = now(); run.version++; run.updatedAt = now(); reviewConversationWorkflowRun(state, run); return run; });
  }
}
