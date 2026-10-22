import type { EmployeeTemplate, ProjectEmployee, ProjectTeam, TeamTemplate } from '../domain/types.js';
import type { KnowledgeUploadFile, KnowledgeUploadResult, KnowledgeUploadTarget } from '../knowledge/types.js';
import { KNOWLEDGE_UPLOAD_MAX_BYTES } from '../knowledge/upload-limits.js';
import type { WorkforceClient } from './client.js';

export interface KnowledgeUploadContext {
  record?: EmployeeTemplate | ProjectEmployee;
  isProject: boolean;
  teams: TeamTemplate[];
  projectTeams?: ProjectTeam[];
  employees?: ProjectEmployee[];
  teamId?: string;
  memberId?: string;
}
export interface ResolvedKnowledgeUploadContext { target?: KnowledgeUploadTarget; label?: string; disabledReason?: string }

/** Only persisted records enter this resolver; an editor draft never determines A's owner. */
export function resolveKnowledgeUploadContext({ record, isProject, teams, projectTeams = [], employees = [], teamId, memberId }: KnowledgeUploadContext): ResolvedKnowledgeUploadContext {
  if (!record) return { disabledReason: '请先保存员工并启用资料管理员' };
  if (isProject) {
    if (!('projectId' in record) || !record.teamInstanceId) return { disabledReason: '请先将项目员工加入已保存的团队。' };
    const matching = projectTeams.filter(team => team.projectId === record.projectId && team.members.some(member => member.employeeId === record.id));
    const installed = projectTeams.find(team => team.projectId === record.projectId && team.id === record.teamInstanceId);
    if (matching.length > 1 || (installed ? matching.length !== 1 || matching[0]!.id !== installed.id : matching.length > 0)) return { disabledReason: '项目员工的团队关系已变化，请重新选择。' };
    const librarianOff = installed ? installed.knowledgeEnabled === false : [record, ...employees.filter(employee => employee.projectId === record.projectId && employee.teamInstanceId === record.teamInstanceId)].some(employee => employee.legacyTeamKnowledgeEnabled === false);
    return {
      target: { kind: 'project', projectId: record.projectId, employeeId: record.id },
      label: `${installed?.name ?? '项目团队'} / ${record.name} · 项目私有资料`,
      disabledReason: installed?.status === 'cancelled' ? '此项目团队已取消，请先恢复团队。' : librarianOff ? '请先启用此项目团队的资料管理员。' : !record.modules.knowledge.employeeMemory ? '请先启用员工记忆并保存。' : undefined,
    };
  }
  if ('projectId' in record || record.status === 'archived') return { disabledReason: '此职业人不可上传，请重新选择。' };
  const memberships = teams.flatMap(team => team.members.filter(member => member.templateId === record.id).map(member => ({ team, member })));
  const membership = teamId || memberId
    ? memberships.find(item => item.team.id === teamId && item.member.memberId === memberId)
    : memberships.length === 1 ? memberships[0] : undefined;
  if (!membership) return { disabledReason: teamId || memberId ? '员工的已保存团队关系已变化，请重新选择。' : memberships.length > 1 ? '此员工属于多个团队，请从具体团队进入后上传。' : '请先将员工保存到具体团队并启用资料管理员。' };
  return {
    target: { kind: 'template', teamId: membership.team.id, memberId: membership.member.memberId, templateId: record.id },
    label: `${membership.team.name} / ${membership.member.name || record.name} · 模板私有资料`,
    disabledReason: membership.team.knowledgeEnabled === false ? '请先启用此团队的资料管理员。' : !record.modules.knowledge.employeeMemory ? '请先启用员工记忆并保存。' : undefined,
  };
}

export async function encodeKnowledgeUploadFile(file: Pick<File, 'name' | 'size' | 'arrayBuffer'> & { type?: string }): Promise<KnowledgeUploadFile> {
  if (file.size > KNOWLEDGE_UPLOAD_MAX_BYTES) throw new Error('单文件不得超过 1 MiB。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > KNOWLEDGE_UPLOAD_MAX_BYTES) throw new Error('单文件不得超过 1 MiB。');
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  // Browsers often report an incorrect MIME type; the server validates the original bytes.
  return { name: file.name, base64: btoa(chunks.join('')) };
}

export interface KnowledgeUploadBatchResult {
  uploaded: Array<{ name: string; result: KnowledgeUploadResult }>;
  failed: Array<{ name: string; message: string }>;
}

/** Sequential requests preserve per-file outcomes without committing employee configuration. */
export async function uploadKnowledgeFiles(client: Pick<WorkforceClient, 'uploadKnowledge'>, target: KnowledgeUploadTarget, files: File[], canContinue: () => boolean = () => true): Promise<KnowledgeUploadBatchResult> {
  const outcome: KnowledgeUploadBatchResult = { uploaded: [], failed: [] };
  for (const file of files) {
    try {
      if (!canContinue()) throw new Error('上传目标已变化，未继续上传。');
      const input = await encodeKnowledgeUploadFile(file);
      if (!canContinue()) throw new Error('上传目标已变化，未继续上传。');
      const result = await client.uploadKnowledge(target, input);
      if (!result || result.status !== 'archived' || result.compilation !== 'pending' || !result.sourceId || !Number.isSafeInteger(result.version) || result.version < 1) throw new Error('服务器未确认资料已入库，请刷新列表核对。');
      outcome.uploaded.push({ name: file.name, result });
    } catch (error) {
      outcome.failed.push({ name: file.name, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return outcome;
}

export function knowledgeUploadFailureMessage(outcome: KnowledgeUploadBatchResult): string {
  const saved = outcome.uploaded.length ? `已入库：${outcome.uploaded.map(item => item.name).join('、')}。编纂另行排队。\n` : '';
  return `${saved}未确认入库，请核对资料列表：${outcome.failed.map(item => `${item.name}（${item.message}）`).join('；')}`;
}
