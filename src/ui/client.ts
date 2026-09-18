import type { CreateEmployeeInput, CreateProjectEmployeesInput, CreateRunInput, MutationOptions, ReviewRunInput, SaveEmployeeConfigurationInput, SaveMemoryInput, SaveTeamInput, SaveTemplateInput, UpdateEmployeeInput, WorkforceState } from '../domain/types.js';
import type { CancelProjectTeamsInput, ConfigureProjectTeamInput } from '../domain/types.js';
import type { SaveProjectWorkflowInput, StartWorkflowInput, WorkflowCommandInput, WorkflowRun } from '../workflow/types.js';

/** Transport contract. Every mutation is persisted by the host, then reloaded. */
export interface WorkforceClient {
  snapshot(): Promise<WorkforceState>;
  saveTemplate(input: SaveTemplateInput, options?: MutationOptions): Promise<unknown>;
  saveEmployeeConfiguration(input: SaveEmployeeConfigurationInput, options?: MutationOptions): Promise<unknown>;
  saveTeam(input: SaveTeamInput, options?: MutationOptions): Promise<unknown>;
  createEmployee(input: CreateEmployeeInput, options?: MutationOptions): Promise<unknown>;
  createProjectEmployees(input: CreateProjectEmployeesInput, options?: MutationOptions): Promise<unknown>;
  instantiateTeam(projectId: string, teamId: string, options?: MutationOptions): Promise<unknown>;
  configureProjectTeam(input: ConfigureProjectTeamInput): Promise<unknown>;
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
