import type { WorkflowRun, WorkflowStepRequirements, WorkflowTaskLink } from '../workflow/types.js';
/** Domain data is JSON-only. IDs remain stable when names or paths change. */
export interface ResponsibilitiesModule {
  mission: string;
  duties: string[];
  boundaries: string[];
}
export interface SkillReference { id: string; name: string; description: string }
export interface ToolReference { id: string; description: string }
export interface CapabilitiesModule { skills: SkillReference[]; tools: ToolReference[] }
export interface ModelModule {
  mode: 'inherit' | 'override';
  provider?: string;
  model?: string;
  reasoningEffort?: string;
}
export interface KnowledgeSource {
  id: string;
  title: string;
  kind: 'project-file' | 'url' | 'text';
  value: string;
}
export interface KnowledgeModule {
  sources: KnowledgeSource[];
  projectMemory: boolean;
  employeeMemory: boolean;
  memoryWritePolicy: 'explicit-only';
}
export interface PermissionsModule {
  allowedTools: string[];
  readPaths: string[];
  writePaths: string[];
  allowShell: boolean;
  allowNetwork: boolean;
}
export interface CollaborationModule {
  canDelegate: boolean;
  allowedTemplateIds: string[];
  maxDepth: number;
  maxConcurrent: number;
  escalationRules: string[];
}
export interface DeliveryModule {
  requiredArtifacts: string[];
  acceptanceCriteria: string[];
  reviewRequired: boolean;
}
/** The seven editable modules shared by templates and project snapshots. */
export interface EmployeeModules {
  responsibilities: ResponsibilitiesModule;
  capabilities: CapabilitiesModule;
  model: ModelModule;
  knowledge: KnowledgeModule;
  permissions: PermissionsModule;
  collaboration: CollaborationModule;
  delivery: DeliveryModule;
}
export type TemplateStatus = 'draft' | 'ready' | 'archived';
export interface EmployeeTemplate {
  id: string;
  name: string;
  description: string;
  version: number;
  status: TemplateStatus;
  modules: EmployeeModules;
  createdAt: string;
  updatedAt: string;
}
/** memberId is local to this blueprint; reportsTo names another memberId. */
export interface TeamMember { memberId: string; templateId: string; name?: string; reportsTo?: string }
/** Ordered hand-offs; member references are resolved to project employees on installation. */
export interface TeamWorkflowStep extends WorkflowStepRequirements { id: string; name: string; memberId: string; instruction: string }
export interface TeamWorkflow { id: string; name: string; steps: TeamWorkflowStep[]; maxAttempts?: number }
export interface TeamTemplate {
  id: string;
  name: string;
  description: string;
  version: number;
  members: TeamMember[];
  workflows?: TeamWorkflow[];
  createdAt: string;
  updatedAt: string;
}
export interface ProjectWorkflow {
  id: string;
  templateWorkflowId: string;
  name: string;
  version?: number;
  maxAttempts?: number;
  steps: Array<Omit<TeamWorkflowStep, 'memberId'> & { employeeId: string }>;
}
/** One detached installation of a platform team in a project. */
export interface ProjectTeam {
  id: string;
  projectId: string;
  teamTemplateId: string;
  teamTemplateVersion: number;
  name: string;
  /** Missing lifecycle fields mean an active legacy installation. */
  status?: 'active' | 'cancelled';
  version?: number;
  cancelledAt?: string;
  resumeEmployeeIds?: string[];
  members: Array<{ memberId: string; employeeId: string }>;
  workflows: ProjectWorkflow[];
  createdAt: string;
  updatedAt: string;
}
export interface ConfigureProjectTeamInput {
  projectId: string;
  teamId: string;
  teamVersion: number;
  templateVersions: Record<string, number>;
  restoreVersion?: number;
}
export interface CancelProjectTeamsInput { projectId: string; teams: Array<{ id: string; version: number }> }
export interface WorkforceProject {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
}
export interface ProjectEmployee {
  id: string;
  projectId: string;
  name: string;
  templateId: string;
  templateName: string;
  templateVersion: number;
  /** Detached effective snapshot; changing a template never mutates this. */
  modules: EmployeeModules;
  version: number;
  managerId?: string;
  teamInstanceId?: string;
  status: 'active' | 'paused';
  createdAt: string;
  updatedAt: string;
}
/** user-confirmed is accepted only from a trusted human-facing host route. */
export type MemorySource =
  | { kind: 'user-confirmed'; reference: string }
  | { kind: 'project-file'; path: string }
  | { kind: 'accepted-artifact'; runId: string; artifactId: string };
export interface MemoryRecord {
  id: string;
  projectId: string;
  scope: 'project' | 'employee';
  employeeId?: string;
  title: string;
  content: string;
  source: MemorySource;
  verifiedAt: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface RunArtifact {
  id: string;
  title: string;
  /** A relative project path, or a text artifact when content is supplied. */
  path?: string;
  content?: string;
  mediaType?: string;
}
export type RunStatus = 'queued' | 'running' | 'blocked' | 'awaiting-review' | 'succeeded' | 'failed' | 'cancelled';
export interface RunAcceptance {
  decision: 'accepted' | 'rejected';
  reviewer: string;
  note: string;
  at: string;
}
export interface WorkforceRun {
  id: string;
  projectId: string;
  employeeId: string;
  request: string;
  status: RunStatus;
  employeeSnapshot: ProjectEmployee;
  parentRunId?: string;
  workflow?: WorkflowTaskLink;
  sessionId?: string;
  artifacts: RunArtifact[];
  acceptance?: RunAcceptance;
  error?: string;
  output?: string;
  usage?: { inputTokens: number; outputTokens: number };
  startedAt?: string;
  finishedAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface WorkforceState {
  schemaVersion: 1;
  revision: number;
  templates: EmployeeTemplate[];
  teams: TeamTemplate[];
  projects: WorkforceProject[];
  employees: ProjectEmployee[];
  memories: MemoryRecord[];
  runs: WorkforceRun[];
  /** Optional for states created before project team installations were recorded. */
  projectTeams?: ProjectTeam[];
  workflowRuns?: WorkflowRun[];
  /** Durable receipts prevent a lost HTTP response from creating the same team twice. */
  staffingBatches?: StaffingBatchReceipt[];
}
export interface StaffingBatchReceipt {
  requestId: string;
  projectId: string;
  fingerprint: string;
  employeeIds: string[];
  createdAt: string;
}
export interface MutationOptions { expectedRevision?: number; expectedVersion?: number }
export interface SaveTemplateInput {
  id?: string;
  name: string;
  description?: string;
  status?: TemplateStatus;
  modules: EmployeeModules;
}
/** Save the seven modules and the selected team membership in one transaction. */
export interface SaveEmployeeConfigurationInput {
  template: SaveTemplateInput;
  membership?: {
    source?: { teamId: string; memberId: string; teamVersion: number };
    target?: { teamId: string; memberId: string; teamVersion: number; reportsTo?: string };
  };
}
export interface SaveTeamInput { id?: string; name: string; description?: string; members: TeamMember[]; workflows?: TeamWorkflow[] }
export interface SaveProjectInput { id?: string; name: string; rootPath: string }
export interface CreateEmployeeInput {
  projectId: string;
  templateId: string;
  name?: string;
  managerId?: string;
}
/** A selected platform template, with overrides for one project instance. */
export interface ProjectEmployeeDraft {
  /** Temporary identity within this creation batch; it is not a persisted employee ID. */
  key: string;
  templateId: string;
  templateVersion: number;
  name?: string;
  modules?: EmployeeModules;
  /** Another selected draft, or an existing employee in the same project. */
  managerKey?: string;
  managerId?: string;
  status?: 'active' | 'paused';
}
export interface CreateProjectEmployeesInput {
  projectId: string;
  employees: ProjectEmployeeDraft[];
  requestId?: string;
}
export interface UpdateEmployeeInput {
  name?: string;
  modules?: EmployeeModules;
  /** null removes the current manager. */
  managerId?: string | null;
  status?: 'active' | 'paused';
}
export interface SaveMemoryInput {
  id?: string;
  projectId: string;
  scope: 'project' | 'employee';
  employeeId?: string;
  title: string;
  content: string;
  source: MemorySource;
}
export interface CreateRunInput { projectId: string; employeeId: string; request: string; parentRunId?: string }
export interface UpdateRunInput {
  status?: Exclude<RunStatus, 'succeeded'>;
  sessionId?: string;
  artifacts?: RunArtifact[];
  error?: string;
  output?: string;
  usage?: { inputTokens: number; outputTokens: number };
  startedAt?: string;
  finishedAt?: string;
}
export interface ReviewRunInput { decision: 'accepted' | 'rejected'; reviewer: string; note?: string }
