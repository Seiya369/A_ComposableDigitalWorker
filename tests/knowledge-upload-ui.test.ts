import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlankModules } from '../src/domain/seed.js';
import type { EmployeeTemplate, ProjectEmployee, ProjectTeam, TeamTemplate } from '../src/domain/types.js';
import { KNOWLEDGE_UPLOAD_MAX_BYTES } from '../src/knowledge/upload-limits.js';
import { encodeKnowledgeUploadFile, resolveKnowledgeUploadContext, uploadKnowledgeFiles } from '../src/ui/knowledge-upload.js';

const template = (): EmployeeTemplate => ({ id: 'horse', name: '架构师', description: '', version: 3, status: 'ready', modules: createBlankModules(), createdAt: '', updatedAt: '' });
const team = (id = 'team'): TeamTemplate => ({ id, name: id, description: '', version: 2, members: [{ memberId: 'lead', templateId: 'horse' }], createdAt: '', updatedAt: '' });
const employee = (): ProjectEmployee => ({ id: 'employee', projectId: 'project', teamInstanceId: 'installed', templateId: 'horse', templateName: '架构师', templateVersion: 3, name: '项目架构师', version: 2, status: 'active', modules: createBlankModules(), createdAt: '', updatedAt: '' });
const projectTeam = (): ProjectTeam => ({ id: 'installed', name: '项目团队', projectId: 'project', teamTemplateId: 'team', teamTemplateVersion: 2, members: [{ memberId: 'lead', employeeId: 'employee' }], workflows: [], createdAt: '', updatedAt: '' });

test('upload context selects only exact saved template membership and refuses ambiguous library membership', () => {
  const record = template(), teams = [team(), team('another')];
  const ambiguous = resolveKnowledgeUploadContext({ record, isProject: false, teams });
  assert.equal(ambiguous.target, undefined);
  assert.match(ambiguous.disabledReason!, /具体团队/);
  const explicit = resolveKnowledgeUploadContext({ record, isProject: false, teams, teamId: 'team', memberId: 'lead' });
  assert.deepEqual(explicit.target, { kind: 'template', templateId: 'horse', teamId: 'team', memberId: 'lead' });
  assert.equal(explicit.disabledReason, undefined);
  assert.equal(resolveKnowledgeUploadContext({ record, isProject: false, teams, teamId: 'team', memberId: 'missing' }).target, undefined);
  assert.equal(resolveKnowledgeUploadContext({ isProject: false, teams, teamId: 'team' }).target, undefined);
});

test('saved employee memory and team librarian gates cannot be enabled by an employee draft', () => {
  const record = template(), savedTeam = team();
  record.modules.knowledge.employeeMemory = false;
  assert.match(resolveKnowledgeUploadContext({ record, isProject: false, teams: [savedTeam] }).disabledReason!, /员工记忆/);
  record.modules.knowledge.employeeMemory = true;
  savedTeam.knowledgeEnabled = false;
  assert.match(resolveKnowledgeUploadContext({ record, isProject: false, teams: [savedTeam] }).disabledReason!, /资料管理员/);
});

test('project upload context respects persisted installation membership and modern or legacy librarian gates', () => {
  const record = employee(), installation = projectTeam();
  const context = { record, isProject: true, teams: [], projectTeams: [installation], employees: [record] };
  assert.deepEqual(resolveKnowledgeUploadContext(context).target, { kind: 'project', projectId: 'project', employeeId: 'employee' });
  installation.status = 'cancelled';
  assert.match(resolveKnowledgeUploadContext(context).disabledReason!, /取消/);
  installation.status = 'active'; installation.knowledgeEnabled = false;
  assert.match(resolveKnowledgeUploadContext(context).disabledReason!, /资料管理员/);
  installation.knowledgeEnabled = true; installation.members = [];
  assert.equal(resolveKnowledgeUploadContext(context).target, undefined);
  const sibling = { ...employee(), id: 'sibling', legacyTeamKnowledgeEnabled: false };
  assert.match(resolveKnowledgeUploadContext({ ...context, projectTeams: [], employees: [record, sibling] }).disabledReason!, /资料管理员/);
  record.teamInstanceId = undefined;
  assert.equal(resolveKnowledgeUploadContext({ ...context, projectTeams: [] }).target, undefined);
  installation.members = [{ memberId: 'lead', employeeId: record.id }];
  assert.equal(resolveKnowledgeUploadContext(context).target, undefined, 'without a saved installation id the UI conservatively stays disabled');
});

test('one MiB original files encode without losing bytes and oversized files are rejected before reading', async () => {
  const bytes = Uint8Array.from({ length: KNOWLEDGE_UPLOAD_MAX_BYTES }, (_, i) => i % 251);
  const encoded = await encodeKnowledgeUploadFile(new File([bytes], '资料.pdf', { type: 'application/pdf' }));
  assert.deepEqual(Buffer.from(encoded.base64, 'base64'), Buffer.from(bytes));
  assert.equal(encoded.name, '资料.pdf');
  assert.equal(encoded.mediaType, undefined, 'browser MIME guesses must not override server validation');
  await assert.rejects(encodeKnowledgeUploadFile({ name: 'too-large.pdf', type: 'application/pdf', size: KNOWLEDGE_UPLOAD_MAX_BYTES + 1, arrayBuffer: async () => { throw new Error('must not read'); } }), /1 MiB/);
});

test('a file batch preserves confirmed archives and names every failed file without claiming all succeeded', async () => {
  const target = { kind: 'project' as const, projectId: 'project', employeeId: 'employee' };
  const archives = new Map<string, string>();
  const result = await uploadKnowledgeFiles({ uploadKnowledge: async (receivedTarget, file) => {
    assert.deepEqual(receivedTarget, target);
    if (file.name === 'bad.docx') throw new Error('无法解析文档');
    archives.set(file.name, Buffer.from(file.base64, 'base64').toString());
    return { sourceId: `upload:${file.name}`, title: file.name, version: 1, category: 'reference', status: 'archived', compilation: 'pending' };
  } }, target, [new File(['第一份'], 'first.md'), new File(['invalid'], 'bad.docx'), new File(['第三份'], 'third.txt')]);
  assert.deepEqual([...archives], [['first.md', '第一份'], ['third.txt', '第三份']]);
  assert.deepEqual(result.uploaded.map(item => item.name), ['first.md', 'third.txt']);
  assert.deepEqual(result.failed, [{ name: 'bad.docx', message: '无法解析文档' }]);
});

test('a missing archive receipt cannot become a successful upload', async () => {
  const result = await uploadKnowledgeFiles({ uploadKnowledge: async () => undefined as never }, { kind: 'project', projectId: 'p', employeeId: 'e' }, [new File(['资料'], 'source.md')]);
  assert.equal(result.uploaded.length, 0);
  assert.match(result.failed[0]!.message, /未确认/);
});

test('changing the selected target during a batch prevents sending its remaining files', async () => {
  let current = true;
  const result = await uploadKnowledgeFiles({ uploadKnowledge: async (_target, file) => {
    current = false;
    return { sourceId: `upload:${file.name}`, title: file.name, version: 1, category: 'reference', status: 'archived', compilation: 'pending' };
  } }, { kind: 'project', projectId: 'p', employeeId: 'e' }, [new File(['one'], 'one.md'), new File(['two'], 'two.md')], () => current);
  assert.deepEqual(result.uploaded.map(item => item.name), ['one.md']);
  assert.deepEqual(result.failed.map(item => item.name), ['two.md']);
  assert.match(result.failed[0]!.message, /目标已变化/);
});
