/** Test-only public LlmAdapter. Its JSON is deterministic; it never makes network requests. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { resolveCliInstallation } from '../../integration/harness-baseline.mjs';
import { prepareOfficialRuntimeDependencies } from './official-plugin-runtime.mjs';

export const employeeSettingsProvider = 'employee-settings-fixture';
export async function installEmployeeSettingsFixture(profile, root, installation) {
  installation ??= await resolveCliInstallation(root);
  const directory = resolve(profile, 'node_modules/dsh-plugin-employee-settings-fixture');
  const llmCallsPath = resolve(directory, 'llm-calls.jsonl');
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'package.json'), JSON.stringify({ name: 'dsh-plugin-employee-settings-fixture', version: '0.0.0', description: '员工能力测试插件', type: 'module', main: 'index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } }));
  const officialSdk = await prepareOfficialRuntimeDependencies(directory, root, installation, { production: false });
  await writeFile(resolve(directory, 'index.js'), `
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export const name = 'employee-settings-fixture';
export const inject = ['llm'];
class OfflineKnowledgeAdapter extends LlmAdapter {
  listModels(provider) { return Promise.resolve([{ provider, id: 'offline', name: '离线验证模型' }, { provider, id: 'offline-role-reasoning', name: '岗位智填验证模型' }]); }
  resolveModel(provider, model) { return Promise.resolve({ provider, id: model, name: model, ...(model === 'offline-role-reasoning' ? { reasoning: { efforts: [{ id: 'low', name: '低' }, { id: 'high', name: '高' }], defaultEffort: 'low' } } : {}) }); }
  async *stream(request) {
    const texts = request.messages.flatMap(message => Array.isArray(message.content) ? message.content.filter(block => block.type === 'text').map(block => block.text) : []);
    if (String(request.system).startsWith('你是数字员工岗位配置助手。')) {
      const roleInput = texts.map(text => { try { return JSON.parse(text); } catch { return undefined; } }).find(value => typeof value?.name === 'string');
      if (!roleInput) throw new Error('Missing role draft fixture input');
      await appendFile(${JSON.stringify(llmCallsPath)}, JSON.stringify({ stage: 'role-draft', name: roleInput.name, provider: request.provider, model: request.model, reasoningEffort: request.reasoningEffort }) + '\\n');
      if (roleInput.name.includes('ROLE_DRAFT_ERROR_UI')) throw new Error('OFFLINE_ROLE_DRAFT_ERROR_PRIVATE_DETAIL');
      if (roleInput.name.includes('ROLE_DRAFT_SLOW_UI')) await new Promise(done => setTimeout(done, 1000));
      const text = JSON.stringify({ responsibilities: { mission: roleInput.name + '：负责将需求转化为可核验的岗位成果。', duties: ['澄清目标与输入条件。', '完成专业分析并提交可检查的结果。'], boundaries: ['重要决定由用户确认。', '资料不足时说明不确定性，不编造事实。'] } });
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text };
      yield { type: 'block-end', index: 0, block: { type: 'text', text } };
      yield { type: 'usage', usage: { inputTokens: 30, outputTokens: 50 } };
      yield { type: 'finish', reason: { kind: 'stop' } };
      return;
    }
    const input = texts.map(text => { try { return JSON.parse(text); } catch { return undefined; } }).find(value => Array.isArray(value?.sources));
    const analysis = String(request.system).includes('You are an expert research analyst.');
    await appendFile(${JSON.stringify(llmCallsPath)}, JSON.stringify({ stage: analysis ? 'analysis' : 'generation', space: input?.space, sourceIds: (input?.sources ?? []).map(source => source.id), dependencySources: (input?.dependencySources ?? []).map(source => ({ id: source.id, excerpts: source.excerpts })), affectedEntryIds: (input?.affected?.entries ?? []).map(entry => entry.id), previousIncluded: Boolean(input?.previous) }) + '\\n');
    // The shared LLM Wiki flow analyzes first and generates structured knowledge
    // second. Identify the analysis prompt, never a global first-call counter:
    // multiple employee and team spaces use the same adapter concurrently.
    if (analysis) {
      const text = '资料分析：仅使用本次提供的来源。保留来源标识、原文证据和已有知识；区分实体、概念、来源与概览；不将共同出现当作因果关系。';
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text };
      yield { type: 'block-end', index: 0, block: { type: 'text', text } };
      yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 100 } };
      yield { type: 'finish', reason: { kind: 'stop' } };
      return;
    }
    if (!input) throw new Error('The offline fixture accepts only knowledge analysis and generation requests');
    const changedIds = new Set(input.sources.map(source => source.id));
    const sources = [...input.sources, ...(input.dependencySources ?? []).filter(source => !changedIds.has(source.id)).map(source => {
      const lines = Array.from({ length: source.lineCount }, () => '');
      for (const excerpt of source.excerpts) lines.splice(excerpt.startLine - 1, excerpt.endLine - excerpt.startLine + 1, ...excerpt.text.split('\\n'));
      return { ...source, text: lines.join('\\n') };
    })];
    const entries = sources.map(source => ({
      id: 'topic-' + createHash('sha256').update(source.id).digest('hex').slice(0, 16),
      title: '知识主题：' + source.title,
      content: '## 原始资料要点\\n\\n' + source.text + '\\n\\n- 适用范围：仅用于本次离线 UI 验证。\\n- 未经独立核验，仍为候选知识。',
      citations: source.excerpts ? source.excerpts.map(excerpt => ({ sourceId: source.id, sourceVersion: source.version, startLine: excerpt.startLine, endLine: excerpt.endLine })) : [{ sourceId: source.id, sourceVersion: source.version, startLine: 1, endLine: source.lineCount }],
    }));
    // These concepts come from explicit fixture sentences, never from filenames.
    const conceptGraph = { schemaVersion: 1, concepts: [], relations: [] };
    const architectureIndex = sources.findIndex(source => source.text.includes('模块划分依据职责边界。'));
    if (architectureIndex >= 0) {
      const source = sources[architectureIndex];
      const lines = source.text.split('\\n');
      const citation = sentence => { const line = lines.findIndex(value => value.includes(sentence)) + 1; return { sourceId: source.id, sourceVersion: source.version, startLine: line, endLine: line }; };
      const entryIds = [entries[architectureIndex].id];
      conceptGraph.concepts = [
        { id: 'module-partition', name: '模块划分', kind: 'entity', summary: '将系统拆分为职责明确的组成部分。', entryIds, citations: [citation('模块划分：')] },
        { id: 'responsibility-boundary', name: '职责边界', summary: '每个模块负责的范围。', entryIds, citations: [citation('职责边界：')] },
        { id: 'delivery-acceptance', name: '交付验收', summary: '核对交付结果是否达标。', entryIds, citations: [citation('交付验收：')] },
        { id: 'acceptance-criteria', name: '验收标准', summary: '交付前约定的判定条件。', entryIds, citations: [citation('验收标准：')] },
      ];
      conceptGraph.relations = [
        { id: 'partition-based-on-boundary', sourceId: 'module-partition', targetId: 'responsibility-boundary', predicate: '依据', summary: '模块划分依据职责边界。', basis: 'explicit', entryIds, citations: [citation('模块划分依据职责边界。')] },
        { id: 'acceptance-based-on-criteria', sourceId: 'delivery-acceptance', targetId: 'acceptance-criteria', predicate: '依据', summary: '交付验收依据验收标准。', basis: 'explicit', entryIds, citations: [citation('交付验收依据验收标准。')] },
      ];
    } else {
      const isolatedIndex = sources.findIndex(source => source.text.includes('ISOLATED_CONCEPTS_UI_916'));
      if (isolatedIndex >= 0) {
        const source = sources[isolatedIndex];
        const entryIds = [entries[isolatedIndex].id];
        const citations = [{ sourceId: source.id, sourceVersion: source.version, startLine: 1, endLine: source.lineCount }];
        conceptGraph.concepts = [
          { id: 'isolated-alpha', name: '独立概念甲', summary: '用于描述甲类职责。', entryIds, citations },
          { id: 'isolated-beta', name: '独立概念乙', summary: '用于描述乙类职责。', entryIds, citations },
        ];
      }
    }
    // Only the dedicated exploration document enables this extra component.
    // Existing architecture and isolated-space fixtures keep their exact graphs.
    const explorationIndex = sources.findIndex(source => source.text.includes('EXPLORATION_CHAIN_UI_826'));
    if (explorationIndex >= 0) {
      const source = sources[explorationIndex];
      const lines = source.text.split('\\n');
      const entryIds = [entries[explorationIndex].id];
      const citation = sentence => {
        const startLine = lines.findIndex(line => line.includes(sentence)) + 1;
        if (!startLine) throw new Error('Exploration fixture is missing original evidence: ' + sentence);
        return { sourceId: source.id, sourceVersion: source.version, startLine, endLine: startLine };
      };
      const nodes = [
        ['alpha', '链路甲', 'concept', '关联探索的起点。'],
        ['beta', '链路乙', 'concept', '关联探索的第一层邻居。'],
        ['gamma', '链路丙', 'entity', '关联探索中的实体桥接点。'],
        ['delta', '链路丁', 'concept', '关联探索的末端。'],
        ['isolated', '孤立戊', 'concept', '没有已记录关联的独立概念。'],
      ];
      conceptGraph.concepts.push(...nodes.map(([id, name, kind, summary]) => ({ id: 'exploration-' + id, name, kind, summary, entryIds, citations: [citation(name + '：')] })));
      conceptGraph.relations.push(...[
        ['alpha', 'beta', '依据', '链路甲依据链路乙。'],
        ['beta', 'gamma', '驱动', '链路乙驱动链路丙。'],
        ['gamma', 'delta', '产出', '链路丙产出链路丁。'],
      ].map(([from, to, predicate, summary]) => ({ id: 'exploration-' + from + '-' + to, sourceId: 'exploration-' + from, targetId: 'exploration-' + to, predicate, summary, basis: 'explicit', entryIds, citations: [citation(summary)] })));
    }
    const text = JSON.stringify({ entries, overview: entries.map(entry => ({ id: 'map-' + entry.id, title: '知识入口', summary: '可阅读本次离线验证资料。', entryIds: [entry.id] })), conceptGraph });
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 100 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
export function apply(ctx) { ctx.llm.registerAdapter(['employee-settings-fixture'], new OfflineKnowledgeAdapter()); }
`);
  const mcpServerPath = resolve(directory, 'mcp-server.mjs');
  await writeFile(mcpServerPath, `
import { createInterface } from 'node:readline';
const input = createInterface({ input: process.stdin });
input.on('line', line => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result;
  if (request.method === 'initialize') result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'employee-fixture', version: '1.0.0' } };
  else if (request.method === 'tools/list') result = { tools: [{ name: 'lookup', description: '只读查询测试资料', inputSchema: { type: 'object', properties: {} } }] };
  else if (request.method === 'tools/call') result = { content: [{ type: 'text', text: 'OFFLINE_MCP_LOOKUP_OK' }] };
  else if (request.method === 'resources/list') result = { resources: [] };
  else if (request.method === 'resources/templates/list') result = { resourceTemplates: [] };
  else if (request.method === 'ping') result = {};
  else { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Unknown method' } }) + '\\n'); return; }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');
});
`);
  await writeFile(resolve(directory, 'cordis.patch.yml'), `- insert:\n    - id: employee-settings-fixture\n      name: dsh-plugin-employee-settings-fixture\n    - id: bundle-disabled-fixture-mcp\n      name: '@deepseek-ai/dsh-mcp-client'\n      disabled: true\n      config:\n        serverName: bundle-disabled-fixture\n        transport: stdio\n        command: ${JSON.stringify(process.execPath)}\n        args: [${JSON.stringify(mcpServerPath)}]\n`);
  const disabledDirectory = resolve(profile, 'node_modules/dsh-plugin-employee-disabled-fixture');
  await mkdir(disabledDirectory, { recursive: true });
  await writeFile(resolve(disabledDirectory, 'package.json'), JSON.stringify({ name: 'dsh-plugin-employee-disabled-fixture', version: '0.0.0', description: '未启用的员工能力测试插件', type: 'module', main: 'index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } }));
  await writeFile(resolve(disabledDirectory, 'index.js'), "export const name = 'employee-disabled-fixture'; export function apply() {}\n");
  await writeFile(resolve(disabledDirectory, 'cordis.patch.yml'), '- insert:\n    - id: employee-disabled-fixture\n      name: dsh-plugin-employee-disabled-fixture\n');
  return { mcpServerPath, llmCallsPath, officialSdk };
}

export async function seedEmployeeSettingsFixture(command, state) {
  const architect = state.templates.find(item => item.id === 'employee-template-architect');
  if (!architect) throw new Error('Expected the bundled architect employee');
  const modules = structuredClone(architect.modules);
  modules.model = { mode: 'override', provider: employeeSettingsProvider, model: 'offline' };
  modules.knowledge.sources = [{ id: 'configured-delete-fixture', title: '可删除配置资料', kind: 'text', value: 'CONFIGURED_DELETE_UI_713' }];
  modules.capabilities.skills = [
    { id: 'architecture-analysis', name: '架构分析', description: '每份工作单先分析目标与证据。', usage: 'required' },
    { id: 'architecture-design', name: '架构设计', description: '设计任务优先采用架构设计方法。', usage: 'preferred', useWhen: '业务涉及架构设计时' },
  ];
  modules.capabilities.tools = [{ id: 'read', description: '读取资料', useWhen: '需要读取项目资料时优先使用' }];
  const { result: employee } = await command('template.save', { id: architect.id, name: architect.name, description: architect.description, status: architect.status, modules });
  const peerModules = structuredClone(modules);
  peerModules.knowledge.sources = [];
  const { result: peer } = await command('template.save', { name: 'QA-Wiki隔离员工', description: '第二个共享引擎隔离空间', status: 'ready', modules: peerModules });
  const { result: team } = await command('team.save', { name: 'QA-员工设置隔离团队', knowledgeEnabled: true, members: [{ memberId: 'lead', templateId: employee.id }, { memberId: 'peer', templateId: peer.id, reportsTo: 'lead' }] });
  return { employee, peer, team };
}
