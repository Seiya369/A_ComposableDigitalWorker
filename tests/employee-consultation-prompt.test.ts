import assert from 'node:assert/strict';
import test from 'node:test';
import { createBlankModules } from '../src/domain/seed.js';
import { buildEmployeeConsultationPrompt, buildEmployeePrompt } from '../src/domain/prompt.js';
import type { ProjectEmployee } from '../src/domain/types.js';

test('explicit consultation has professional responsibilities without internal execution or knowledge payload', () => {
  const modules = createBlankModules();
  modules.responsibilities = { mission: '明确目标与验收', duties: ['梳理需求'], boundaries: ['不擅自发布'] };
  modules.knowledge.sources = [{ id: 'private-source-id', kind: 'text', title: 'Private', value: 'PRIVATE_KNOWLEDGE_BODY' }];
  const employee: ProjectEmployee = { id: 'PRIVATE_EMPLOYEE_ID', projectId: 'PRIVATE_PROJECT_ID', name: '产品负责人', templateId: 'template',
    templateName: 'Template', templateVersion: 1, modules, version: 1, status: 'active', createdAt: '2026-10-26', updatedAt: '2026-10-26' };
  const prompt = buildEmployeeConsultationPrompt(employee);
  assert.match(prompt, /产品负责人|明确目标与验收|梳理需求|不擅自发布/);
  assert.match(prompt, /不主动输出|不执行工具|不委派|切换到工具执行|不声称已加载技能/);
  assert.doesNotMatch(prompt, /PRIVATE_EMPLOYEE_ID|PRIVATE_PROJECT_ID|private-source-id|PRIVATE_KNOWLEDGE_BODY|worker_/);
  assert.ok(Buffer.byteLength(prompt) < Buffer.byteLength(buildEmployeePrompt(employee)), 'consultation omits the complete execution contract');
});
