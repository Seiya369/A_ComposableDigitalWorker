/** Test-only provider and data. Never included in the production npm package. */
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function installWorkflowFixture(profile, root) {
  const directory = resolve(profile, 'node_modules/dsh-plugin-workflow-ui-fixture');
  await mkdir(directory, { recursive: true });
  await symlink(resolve(root, 'node_modules'), resolve(directory, 'node_modules'), 'dir');
  await writeFile(resolve(directory, 'package.json'), JSON.stringify({ name: 'dsh-plugin-workflow-ui-fixture', type: 'module', main: 'index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } }));
  await writeFile(resolve(directory, 'cordis.patch.yml'), '- insert:\n    - id: workflow-ui-fixture\n      name: dsh-plugin-workflow-ui-fixture\n');
  await writeFile(resolve(directory, 'index.js'), `
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
export const name = 'workflow-ui-fixture';
export const inject = ['llm'];
class OfflineAdapter extends LlmAdapter {
  async *stream(request) {
    const content = JSON.stringify(request.messages);
    if (content.includes('TEST_SLOW')) await new Promise((done, reject) => {
      const timer = setTimeout(done, 30000);
      const abort = () => { clearTimeout(timer); reject(new Error('Offline fixture aborted')); };
      if (request.signal?.aborted) abort(); else request.signal?.addEventListener('abort', abort, { once: true });
    });
    const text = content.includes('步骤 2/2')
      ? '离线验收：已依据前序方案完成评审，模块边界明确，权限与项目记忆保持隔离。'
      : '离线方案：界面、流程调度与员工执行各自负责独立职责。验收通过后再交接下一员工。';
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 8 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
export function apply(ctx) { ctx.llm.registerAdapter(['workflow-fixture'], new OfflineAdapter()); }
`);
}

export async function seedWorkflowFixture(command, state, workspace) {
  const modules = structuredClone(state.templates.find(item => item.id === 'employee-template-architect').modules);
  modules.model = { mode: 'override', provider: 'workflow-fixture', model: 'offline' };
  modules.capabilities.skills = [];
  const { result: template } = await command('template.save', { name: 'QA-离线工作流员工', status: 'ready', modules });
  const { result: team } = await command('team.save', {
    name: 'QA-工作流团队', members: [{ memberId: 'lead', templateId: template.id, name: '方案负责人' }, { memberId: 'reviewer', templateId: template.id, name: '评审负责人', reportsTo: 'lead' }],
    workflows: [{ id: 'delivery', name: '方案交付流程', maxAttempts: 3, steps: [
      { id: 'plan', name: '方案设计', memberId: 'lead', instruction: '完成模块划分与方案设计', inputs: ['项目目标'], outputs: ['方案摘要'], acceptanceCriteria: ['说明模块边界和权限边界'], timeoutMs: 60000 },
      { id: 'review', name: '方案评审', memberId: 'reviewer', instruction: '评审前序已经验收的方案', inputs: ['已验收方案'], outputs: ['评审结论'], acceptanceCriteria: ['确认边界与可测试性'], timeoutMs: 60000 },
    ] }],
  });
  const { result: projectTeam } = await command('project.team.configure', { projectId: workspace.workspaceId, teamId: team.id, teamVersion: team.version, templateVersions: { [template.id]: template.version } });
  return { team, projectTeam };
}
