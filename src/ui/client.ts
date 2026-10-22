import type { CreateEmployeeInput, CreateProjectEmployeesInput, CreateRunInput, MutationOptions, ReviewRunInput, SaveEmployeeConfigurationInput, SaveMemoryInput, SaveTeamInput, SaveTemplateInput, UpdateEmployeeInput, WorkforceState } from '../domain/types.js';
import type { CancelProjectTeamsInput, ConfigureProjectTeamInput, SetProjectTeamKnowledgeInput } from '../domain/types.js';
import type { SaveProjectWorkflowInput, StartWorkflowInput, WorkflowCommandInput, WorkflowRun } from '../workflow/types.js';
import type { SaveWorkflowTemplateInput } from '../domain/types.js';
import type { ExportSelection, ImportOptions, ImportPreview, ImportResult, ImportTarget, TransferBundle } from '../domain/transfer-types.js';
import type { EmployeeModelCatalog } from '../domain/model-catalog.js';
import type { WorkCommandOptions } from '../work/types.js';
import type { EmployeeCapabilityCatalog } from '../domain/capability-catalog.js';
import type { KnowledgeUploadFile, KnowledgeUploadResult, KnowledgeUploadTarget, KnowledgeUploadedSource } from '../knowledge/types.js';

/** Transport contract. Every mutation is persisted by the host, then reloaded. */
export interface WorkforceClient {
  uploadKnowledge(target: KnowledgeUploadTarget, file: KnowledgeUploadFile): Promise<KnowledgeUploadResult>;
  listUploadedKnowledge(target: KnowledgeUploadTarget): Promise<KnowledgeUploadedSource[]>;
  workCommand(action: string, payload: unknown, options?: WorkCommandOptions): Promise<unknown>;
  listCapabilities(projectId?: string): Promise<EmployeeCapabilityCatalog>;
  listModels(): Promise<EmployeeModelCatalog>;
  snapshot(): Promise<WorkforceState>;
  saveWorkflowTemplate(input: SaveWorkflowTemplateInput, options?: MutationOptions): Promise<unknown>;
  deleteWorkflowTemplate(id: string, options?: MutationOptions): Promise<unknown>;
  bindTeamWorkflow(teamId: string, workflowTemplateId: string, bindings: Record<string, string>, options?: MutationOptions): Promise<unknown>;
  exportBundle(input: ExportSelection): Promise<TransferBundle>;
  previewImport(document: unknown, target: ImportTarget): Promise<ImportPreview>;
  importBundle(document: unknown, target: ImportOptions, options?: MutationOptions): Promise<ImportResult | unknown>;
  saveTemplate(input: SaveTemplateInput, options?: MutationOptions): Promise<unknown>;
  saveEmployeeConfiguration(input: SaveEmployeeConfigurationInput, options?: MutationOptions): Promise<unknown>;
  saveTeam(input: SaveTeamInput, options?: MutationOptions): Promise<unknown>;
  createEmployee(input: CreateEmployeeInput, options?: MutationOptions): Promise<unknown>;
  createProjectEmployees(input: CreateProjectEmployeesInput, options?: MutationOptions): Promise<unknown>;
  instantiateTeam(projectId: string, teamId: string, options?: MutationOptions): Promise<unknown>;
  configureProjectTeam(input: ConfigureProjectTeamInput): Promise<unknown>;
  setProjectTeamKnowledge(input: SetProjectTeamKnowledgeInput): Promise<unknown>;
  cancelProjectTeams(input: CancelProjectTeamsInput): Promise<unknown>;
  saveProjectWorkflow(input: SaveProjectWorkflowInput): Promise<unknown>;
  startWorkflow(input: StartWorkflowInput): Promise<WorkflowRun>;
  controlWorkflow(input: WorkflowCommandInput): Promise<unknown>;
  updateEmployee(id: string, input: UpdateEmployeeInput, options?: MutationOptions): Promise<unknown>;
  archiveTemplate(id: string, options?: MutationOptions): Promise<unknown>;
  deleteTeam(id: string, options?: MutationOptions): Promise<unknown>;
  deleteEmployee(id: string, options?: MutationOptions): Promise<unknown>;
  saveMemory(input: SaveMemoryInput, options?: MutationOptions): Promise<unknown>;
  deleteMemory(id: string, options?: MutationOptions): Promise<unknown>;
  createRun(input: CreateRunInput, options?: MutationOptions): Promise<unknown>;
  cancelRun(id: string, options?: MutationOptions): Promise<unknown>;
  reviewRun(id: string, input: ReviewRunInput, options?: MutationOptions): Promise<unknown>;
}
