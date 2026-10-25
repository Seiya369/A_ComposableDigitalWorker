import type { MutationOptions, ReviewRunInput, SaveEmployeeConfigurationInput, SaveTeamInput, WorkforceState } from '../domain/types.js';
import type { WorkflowCommandInput } from '../workflow/types.js';
import type { SaveWorkflowTemplateInput } from '../domain/types.js';
import type { TransferBundle } from '../domain/transfer-types.js';
import type { EmployeeModelCatalog } from '../domain/model-catalog.js';
import type { WorkCommandOptions } from '../work/types.js';
import type { EmployeeCapabilityCatalog } from '../domain/capability-catalog.js';
import type { KnowledgeArchivePolicyRequest, KnowledgeLibraryTarget, KnowledgeLibraryView, KnowledgeRemoveRequest, KnowledgeRemoveResult, KnowledgeUploadRequest, KnowledgeUploadResult } from '../knowledge/library-api.js';
import type { WikiLibraryView } from '../knowledge/wiki-types.js';
import type { KnowledgeSource } from '../knowledge/types.js';
import type { EmployeeRoleDraftInput, EmployeeRoleDraftResult } from '../domain/employee-role.js';
import type { ReorderLibraryInput } from '../domain/library-order.js';

/** Transport contract. Every mutation is persisted by the host, then reloaded. */
export interface WorkforceClient {
  reorderLibrary(input: ReorderLibraryInput, options: { expectedRevision: number }): Promise<unknown>;
  /** Generate an editable role draft without persisting employee or knowledge state. */
  generateEmployeeRole?(input: EmployeeRoleDraftInput, signal?: AbortSignal): Promise<EmployeeRoleDraftResult>;
  /** Public DSH navigation only; package installation and activation remain native actions. */
  openNativePlugins?(bundleName?: string): void;
  knowledgeLibrary?(target: KnowledgeLibraryTarget): Promise<KnowledgeLibraryView>;
  updateKnowledgeArchivePolicy?(input: KnowledgeArchivePolicyRequest): Promise<KnowledgeLibraryView>;
  knowledgeWiki?(target: KnowledgeLibraryTarget): Promise<WikiLibraryView>;
  knowledgeSource?(target: KnowledgeLibraryTarget, sourceId: string, version: number): Promise<KnowledgeSource>;
  uploadKnowledge?(input: KnowledgeUploadRequest): Promise<KnowledgeUploadResult>;
  removeKnowledge?(input: KnowledgeRemoveRequest): Promise<KnowledgeRemoveResult>;
  workCommand(action: string, payload: unknown, options?: WorkCommandOptions): Promise<unknown>;
  listCapabilities(projectId?: string): Promise<EmployeeCapabilityCatalog>;
  listModels(): Promise<EmployeeModelCatalog>;
  snapshot(): Promise<WorkforceState>;
  saveWorkflowTemplate(input: SaveWorkflowTemplateInput, options?: MutationOptions): Promise<unknown>;
  deleteWorkflowTemplate(id: string, options?: MutationOptions): Promise<unknown>;
  saveSettingsBundle(bundle: TransferBundle, options?: MutationOptions): Promise<unknown>;
  saveEmployeeConfiguration(input: SaveEmployeeConfigurationInput, options?: MutationOptions): Promise<unknown>;
  saveTeam(input: SaveTeamInput, options?: MutationOptions): Promise<unknown>;
  controlWorkflow(input: WorkflowCommandInput): Promise<unknown>;
  archiveTemplate(id: string, options?: MutationOptions): Promise<unknown>;
  deleteTeam(id: string, options?: MutationOptions): Promise<unknown>;
  cancelRun(id: string, options?: MutationOptions): Promise<unknown>;
  reviewRun(id: string, input: ReviewRunInput, options?: MutationOptions): Promise<unknown>;
}
