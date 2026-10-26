import type { WorkforceClient } from '../ui/client.js';
import type { WorkforceRun, WorkforceState } from '../domain/types.js';
import type { EmployeeModelCatalog } from '../domain/model-catalog.js';
import type { EmployeeCapabilityCatalog } from '../domain/capability-catalog.js';
import type { KnowledgeLibraryView, KnowledgeRemoveResult, KnowledgeUploadResult } from '../knowledge/library-api.js';
import type { WikiLibraryView } from '../knowledge/wiki-types.js';
import type { KnowledgeSource } from '../knowledge/types.js';
import type { EmployeeRoleDraftResult } from '../domain/employee-role.js';
import type { EmployeeMentionRunInput } from './mentions.js';

export const API_PREFIX = '/digital-workers/api';

/** Same-origin API only. Error text is rendered by React, never inserted as HTML. */
export async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_PREFIX}${path}`, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', signal,
    headers: { 'Accept': 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-DSH-Graph-Horses': '1' }) },
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
export function createWorkforceClient(options: { onChange?: () => void; onOpenNativePlugins?: (bundleName?: string) => void } = {}): WorkforceClient {
  const command = async (action: string, payload: unknown, mutationOptions?: unknown) => {
    const result = await request('/command', { action, payload, options: mutationOptions });
    options.onChange?.();
    return result;
  };
  return {
    reorderLibrary: (input, opts) => command('library.reorder', input, opts),
    generateEmployeeRole: (input, signal) => request<EmployeeRoleDraftResult>('/employee-role-draft', input, signal),
    ...(options.onOpenNativePlugins ? { openNativePlugins: options.onOpenNativePlugins } : {}),
    knowledgeLibrary: target => {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(target)) if (value !== undefined) query.set(key, value);
      return request<KnowledgeLibraryView>(`/knowledge?${query}`);
    },
    updateKnowledgeArchivePolicy: async input => {
      const result = await request<KnowledgeLibraryView>('/knowledge/archive-policy', input);
      options.onChange?.();
      return result;
    },
    knowledgeWiki: target => {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(target)) if (value !== undefined) query.set(key, value);
      return request<WikiLibraryView>(`/knowledge/wiki?${query}`);
    },
    knowledgeSource: async (target, sourceId, version) => {
      const query = new URLSearchParams({ layer: 'A', id: sourceId, version: String(version) });
      for (const [key, value] of Object.entries(target)) if (value !== undefined) query.set(key, value);
      return (await request<{ document: KnowledgeSource }>(`/knowledge?${query}`)).document;
    },
    uploadKnowledge: async input => {
      const result = await request<KnowledgeUploadResult>('/knowledge/upload', input);
      options.onChange?.();
      return result;
    },
    removeKnowledge: async input => {
      const result = await request<KnowledgeRemoveResult>('/knowledge/remove', input);
      options.onChange?.();
      return result;
    },
    workCommand: (action, payload, opts) => command(action, payload, opts),
    listCapabilities: projectId => request<EmployeeCapabilityCatalog>(`/capabilities${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`),
    snapshot: () => request<WorkforceState>('/state'),
    listModels: () => request<EmployeeModelCatalog>('/models'),
    saveEmployeeConfiguration: (input, opts) => command('employee.configuration.save', input, opts),
    saveTeam: (input, opts) => command('team.save', input, opts),
    saveWorkflowTemplate: (input, opts) => command('workflow.template.save', input, opts),
    deleteWorkflowTemplate: (id, opts) => command('workflow.template.delete', { id }, opts),
    saveSettingsBundle: (bundle, opts) => command('settings.bundle.save', { bundle }, opts),
    controlWorkflow: input => command('workflow.control', input),
    archiveTemplate: (id, opts) => command('template.archive', { id }, opts),
    deleteTeam: (id, opts) => command('team.delete', { id }, opts),
    cancelRun: (id, opts) => command('run.cancel', { id }, opts),
    reviewRun: (id, input, opts) => command('run.review', { id, input }, opts),
  };
}

export async function startEmployeeRun(input: EmployeeMentionRunInput): Promise<WorkforceRun> {
  return (await request<{ run: WorkforceRun }>('/run', input)).run;
}
