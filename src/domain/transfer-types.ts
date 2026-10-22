import type { EmployeeTemplate, ProjectEmployee, ProjectTeam, TeamTemplate, WorkflowTemplate } from './types.js';

/** Native plugin archives remain .tgz; this JSON document transports declarative assets only. */
export const MAX_TRANSFER_BYTES = 1_048_576;
export type TransferScope = 'template' | 'project';
export type TransferKind = 'employee' | 'team' | 'workflow';
export interface ExportSelection { scope: TransferScope; kind: TransferKind; id: string; projectId?: string; teamId?: string }
export interface ImportTarget { scope: TransferScope; projectId?: string }
export interface ImportOptions extends ImportTarget { requestId: string }
export type PortableEmployee = Omit<ProjectEmployee, 'projectId' | 'status' | 'importReview' | 'legacyTeamKnowledgeEnabled'>;
export type PortableProjectTeam = Omit<ProjectTeam, 'projectId' | 'status' | 'cancelledAt' | 'resumeEmployeeIds'>;
export interface TransferBundle {
  format: 'graph_horses';
  formatVersion: 1;
  scope: TransferScope;
  kind: TransferKind;
  root: { id: string; teamId?: string };
  exportedAt: string;
  data: {
    templates: EmployeeTemplate[];
    teams: TeamTemplate[];
    workflowTemplates: WorkflowTemplate[];
    employees: PortableEmployee[];
    projectTeams: PortableProjectTeam[];
  };
}
export interface ImportPreview {
  scope: TransferScope; kind: TransferKind; name: string;
  counts: { templates: number; teams: number; workflowTemplates: number; employees: number; projectTeams: number };
  warnings: string[];
}
export interface ImportResult {
  scope: TransferScope; kind: TransferKind; rootId: string;
  templateIds: string[]; teamIds: string[]; workflowTemplateIds: string[]; employeeIds: string[]; projectTeamIds: string[];
  warnings: string[];
}
