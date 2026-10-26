import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEmployeePrompt } from '../src/domain/prompt.js';
import { createBlankModules } from '../src/domain/seed.js';
import type { ProjectEmployee } from '../src/domain/types.js';

function employee(): ProjectEmployee {
  const modules = createBlankModules();
  modules.responsibilities = { mission: '把用户目标整理成可验收需求', duties: ['澄清目标和范围'], boundaries: ['不代替用户确认需求'] };
  modules.capabilities.skills = [{ id: 'requirements-review', name: '需求评审', description: '明确范围和验收标准', usage: 'required' }];
  modules.capabilities.tools = [{ id: 'lookup_project', description: '查询任务所需的项目信息' }];
  return { id: '00000000-0000-4000-8000-000000000001', projectId: '00000000-0000-4000-8000-000000000002',
    name: '产品负责人', templateId: 'product-template-internal', templateName: '产品负责人模板', templateVersion: 2,
    version: 3, modules, status: 'active', createdAt: '', updatedAt: '' };
}

test('public employee identity contains the role name while routing IDs are labelled internal execution data', () => {
  const role = employee();
  const prompt = buildEmployeePrompt(role);
  const introduction = prompt.split('\n\n', 1)[0]!;
  assert.match(introduction, /产品负责人/);
  assert.doesNotMatch(introduction, /员工 ID|项目 ID|[0-9a-f]{8}-[0-9a-f-]{27,}/);
  const internal = prompt.indexOf('内部执行资料（');
  assert.ok(internal > 0, 'internal metadata must be distinct from the public identity');
  assert.ok(prompt.indexOf(role.id) > internal, 'employee routing ID remains available only in the labelled section');
  assert.ok(prompt.indexOf(role.projectId) > internal, 'project routing ID remains available only in the labelled section');
});

test('all employee prompt modes constrain introductions and unsolicited internal detail disclosure', () => {
  for (const overviewOnly of [false, true]) {
    const prompt = buildEmployeePrompt(employee(), [], { overviewOnly });
    assert.match(prompt, /自我介绍.*你是谁.*名字.*岗位.*职责/);
    assert.match(prompt, /不主动.*(?:展示|暴露|披露).*后台/);
    for (const internalKind of ['UUID', '内部绝对路径', '配置版本', '工具协议', '上下文组织方式']) assert.ok(prompt.includes(internalKind), `${internalKind} disclosure boundary is defined`);
    assert.match(prompt, /明确要求技术排查.*最少.*非敏感/);
    assert.match(prompt, /凭据.*密钥.*令牌.*不得泄露/);
  }
});

test('presentation boundaries preserve required skills, real tool routing and relevant delivery references', () => {
  const prompt = buildEmployeePrompt(employee());
  assert.match(prompt, /把用户目标整理成可验收需求/);
  assert.match(prompt, /requirements-review/);
  assert.match(prompt, /lookup_project/);
  assert.match(prompt, /工具调用.*按需使用/);
  assert.match(prompt, /交付文件路径.*任务所需引用.*清楚说明/);
  assert.match(prompt, /DSH 原生策略/);
});

test('instances of the same role keep all shared instructions before internal routing metadata', () => {
  const first = employee();
  const second = { ...employee(), id: '00000000-0000-4000-8000-000000000003',
    projectId: '00000000-0000-4000-8000-000000000004', version: 7 };
  const firstPrompt = buildEmployeePrompt(first);
  const secondPrompt = buildEmployeePrompt(second);
  const stablePrefix = (prompt: string) => prompt.split('\n\n内部执行资料（', 1)[0]!;
  const prefix = stablePrefix(firstPrompt);
  for (const sharedRule of ['岗位职责', '职责边界', '必备 Skill', '项目协作', '项目记忆规则', '不得把临时聊天']) {
    assert.ok(prefix.includes(sharedRule), `${sharedRule} must precede per-instance metadata`);
  }
  assert.equal(stablePrefix(secondPrompt), prefix, 'routing IDs and configuration versions must not divide the shared role prefix');
  assert.ok(firstPrompt.indexOf(first.id) < firstPrompt.indexOf('以下 JSON 是筛选后的来源资料'));
  assert.ok(secondPrompt.includes(second.id) && secondPrompt.includes(second.projectId));
});
