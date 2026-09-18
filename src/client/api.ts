import type { WorkflowRun } from '../workflow/types.js';
import type { WorkforceClient } from '../ui/client.js';
import type { CreateRunInput, WorkforceRun, WorkforceState } from '../domain/types.js';

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
    snapshot: () => request<WorkforceState>('/state'),
    saveTemplate: (input, opts) => command('template.save', input, opts),
    saveEmployeeConfiguration: (input, opts) => command('employee.configuration.save', input, opts),
    saveTeam: (input, opts) => command('team.save', input, opts),
    createEmployee: (input, opts) => command('employee.create', input, opts),
    createProjectEmployees: (input, opts) => command('project.employees.create', input, opts),
    instantiateTeam: (projectId, teamId, opts) => command('team.instantiate', { projectId, teamId }, opts),
    configureProjectTeam: input => command('project.team.configure', input),
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
      // Panel runs inherit the deployment model; @ runs carry their verified source separately.
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
