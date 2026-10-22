import type { WorkflowRun } from '../workflow/types.js';
import type { WorkforceClient } from '../ui/client.js';
import type { CreateRunInput, WorkforceRun, WorkforceState } from '../domain/types.js';
import type { ImportPreview, ImportResult, TransferBundle } from '../domain/transfer-types.js';
import type { EmployeeModelCatalog } from '../domain/model-catalog.js';
import type { EmployeeCapabilityCatalog } from '../domain/capability-catalog.js';
import type { KnowledgeUploadResult, KnowledgeUploadedSource } from '../knowledge/types.js';

export const API_PREFIX = '/digital-workers/api';

/** Same-origin API only. Error text is rendered by React, never inserted as HTML. */
export async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_PREFIX}${path}`, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', signal,
    headers: { 'Accept': 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json() as T & { error?: string | { message?: string }; message?: string };
  if (!response.ok) {
    const error = typeof result.error === 'string' ? result.error : result.error?.message;
    throw new Error(error || result.message || `请求失败 (${response.status})`);
  }
  return result;
}

/** Build the panel transport over the same durable host used by @ submissions. */
export function createWorkforceClient(options: { onChange?: () => void; onRun?: (run: WorkforceRun) => void } = {}): WorkforceClient {
  const command = async (action: string, payload: unknown, mutationOptions?: unknown) => {
    const result = await request('/command', { action, payload, options: mutationOptions });
    options.onChange?.();
    return result;
  };
  return {
    uploadKnowledge: async (target, file) => (await command('knowledge.upload', { target, file }) as { result: KnowledgeUploadResult }).result,
    listUploadedKnowledge: async target => (await command('knowledge.uploads.list', { target }) as { result: KnowledgeUploadedSource[] }).result,
    workCommand: (action, payload, opts) => command(action, payload, opts),
    listCapabilities: projectId => request<EmployeeCapabilityCatalog>(`/capabilities${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`),
    snapshot: () => request<WorkforceState>('/state'),
    listModels: () => request<EmployeeModelCatalog>('/models'),
    saveTemplate: (input, opts) => command('template.save', input, opts),
    saveEmployeeConfiguration: (input, opts) => command('employee.configuration.save', input, opts),
    saveTeam: (input, opts) => command('team.save', input, opts),
    saveWorkflowTemplate: (input, opts) => command('workflow.template.save', input, opts),
    deleteWorkflowTemplate: (id, opts) => command('workflow.template.delete', { id }, opts),
    bindTeamWorkflow: (teamId, workflowTemplateId, bindings, opts) => command('workflow.template.bind', { teamId, workflowTemplateId, bindings }, opts),
    exportBundle: async input => (await command('bundle.export', input) as { result: TransferBundle }).result,
    previewImport: async (document, target) => (await command('bundle.preview', { document, target }) as { result: ImportPreview }).result,
    importBundle: async (document, target, opts) => (await command('bundle.import', { document, target }, opts) as { result: ImportResult }).result,
    createEmployee: (input, opts) => command('employee.create', input, opts),
    createProjectEmployees: (input, opts) => command('project.employees.create', input, opts),
    instantiateTeam: (projectId, teamId, opts) => command('team.instantiate', { projectId, teamId }, opts),
    configureProjectTeam: input => command('project.team.configure', input),
    setProjectTeamKnowledge: input => command('project.team.knowledge', input),
    cancelProjectTeams: input => command('project.team.cancel', input),
    saveProjectWorkflow: input => command('workflow.save', input),
    startWorkflow: async input => { const response = await command('workflow.start', input) as { result: WorkflowRun }; return response.result; },
    controlWorkflow: input => command('workflow.control', input),
    updateEmployee: (id, input, opts) => command('employee.update', { id, input }, opts),
    archiveTemplate: (id, opts) => command('template.archive', { id }, opts),
    deleteTeam: (id, opts) => command('team.delete', { id }, opts),
    deleteEmployee: (id, opts) => command('employee.delete', { id }, opts),
    saveMemory: (input, opts) => command('memory.save', input, opts),
    deleteMemory: (id, opts) => command('memory.delete', { id }, opts),
    createRun: async (input) => {
      // A project panel can target a different project than the current chat.
      // Both entry points use the person's explicitly selected model.
      const { run } = await request<{ run: WorkforceRun }>('/run', input);
      options.onChange?.(); options.onRun?.(run); return run;
    },
    cancelRun: (id, opts) => command('run.cancel', { id }, opts),
    reviewRun: (id, input, opts) => command('run.review', { id, input }, opts),
  };
}

export async function startEmployeeRun(input: CreateRunInput & { sourceSessionId: string }): Promise<WorkforceRun> {
  return (await request<{ run: WorkforceRun }>('/run', input)).run;
}
