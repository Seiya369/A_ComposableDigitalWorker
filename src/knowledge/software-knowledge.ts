import type { EmployeeModules } from '../domain/types.js';
import type { KnowledgeCitation, KnowledgeCompilation, KnowledgeSource } from './types.js';

type Concept = [id: string, name: string, definition: string];
type Relation = [from: string, predicate: string, to: string];
interface ProfessionalReference { role: string; title: string; concepts: Concept[]; relations: Relation[] }
const memoryConcepts: Concept[] = [
  ['evidence', '原始证据', '能够定位到具体文件、资料版本和行号的观察或记录；参考方法不能替代项目证据。'],
  ['candidate', '候选综合', '由资料整理或分析得到、尚未经过人工确认的解释，应保留来源、不确定性与适用条件。'],
  ['review', '人工验收', '用户依据约定标准检查真实交付及证据，并决定接受、退回或保留待确认事项。'],
  ['memory', '已确认记忆', '经用户明确确认或有已验收成果支持的长期记录，保留来源、版本、适用范围及重新核验条件。'],
];
const memoryRelations: Relation[] = [['candidate', '依据', 'evidence'], ['review', '核对', 'evidence'], ['memory', '经过', 'review'], ['memory', '保留来源', 'evidence']];
const references: ProfessionalReference[] = [
  { role: 'product', title: '产品负责人的需求与验收知识', concepts: [
    ['requirements', '用户需求', '描述用户目标、当前问题、约束与成功条件；未确认假设单列，不替用户决定关键取舍。'],
    ['scope', '范围边界', '定义本次交付覆盖的需求、明确的非目标和依赖，变更时核对成本与影响。'],
    ['criteria', '验收标准', '为需求给出可观察、可验证的完成条件，包括正常、失败和边界行为。'],
    ['priority', '需求优先级', '结合用户价值、风险、依赖与资源安排实施顺序，关键取舍由用户确认。'],
    ['coverage', '需求覆盖', '将需求关联到实际交付与测试证据，标明未实现、未验证及剩余风险。'],
  ], relations: [['requirements', '限定', 'scope'], ['requirements', '定义', 'criteria'], ['priority', '排序', 'requirements'], ['coverage', '追溯', 'requirements'], ['coverage', '引用', 'evidence'], ['review', '依据', 'criteria']] },
  { role: 'architect', title: '技术负责人的架构与契约知识', concepts: [
    ['quality', '质量属性', '从业务目标提取性能、可靠性、安全、可维护性等质量要求，并给出具体场景与测量条件。'],
    ['boundary', '模块边界', '按职责与变化原因划分模块，明确数据归属、依赖方向与生命周期。'],
    ['contract', '接口契约', '定义输入、输出、不变量、错误、并发、权限及兼容要求，供实现和验证共同核对。'],
    ['decision', '架构决策', '记录现状证据、备选方案、取舍、适用条件及后果；结论随关键证据变化重新评估。'],
    ['recovery', '故障恢复', '针对超时、取消、重试、部分失败与进程重启定义恢复行为，防止重复执行和数据丢失。'],
  ], relations: [['quality', '约束', 'decision'], ['decision', '划分', 'boundary'], ['boundary', '通过接口协作', 'contract'], ['contract', '规定', 'recovery'], ['decision', '依据', 'evidence'], ['review', '核验', 'contract']] },
  { role: 'designer', title: '设计师的交互与体验知识', concepts: [
    ['task', '用户任务', '从用户目标及使用场景组织关键路径，明确操作前提、反馈与完成状态。'],
    ['information', '信息架构', '按用户任务安排内容层级、导航、命名和信息优先级，避免概念混用。'],
    ['state', '交互状态', '定义正常、空、加载、错误、禁用和权限受限状态，以及取消、重试与恢复路径。'],
    ['accessibility', '可访问性', '保证键盘操作、焦点顺序、语义标签、文本对比和非颜色反馈，兼顾不同窗口尺寸。'],
    ['experience', '体验验收', '在真实界面核对任务路径、状态、响应式和可访问性；截图不能替代可操作性验证。'],
  ], relations: [['task', '组织', 'information'], ['task', '需要', 'state'], ['state', '遵循', 'accessibility'], ['experience', '核对', 'task'], ['experience', '引用', 'evidence'], ['review', '依据', 'experience']] },
  { role: 'developer', title: '开发人员的实现与修复知识', concepts: [
    ['contract', '实施契约', '在修改前确认输入输出、不变量、边界、依赖和验收条件，并核对现有实现。'],
    ['increment', '增量实现', '把改动拆成可独立验证的小工作包，覆盖正常、失败、并发与恢复行为。'],
    ['regression', '回归测试', '用能复现实际缺陷或检查可观察行为的断言保护契约，避免只镜像实现细节。'],
    ['cause', '根因分析', '从稳定复现、日志、输入和状态变化形成可证伪解释，验证修复消除了原因而不只是现象。'],
    ['delivery', '代码交付', '提供实际变更、执行命令、测试结果及未解决限制，经过独立审查和验收后交接。'],
  ], relations: [['increment', '遵循', 'contract'], ['regression', '保护', 'contract'], ['cause', '依据', 'evidence'], ['cause', '指导', 'increment'], ['delivery', '附带', 'regression'], ['review', '核对', 'delivery']] },
  { role: 'tester', title: '测试负责人的验证与性能知识', concepts: [
    ['risk', '风险测试矩阵', '把需求、关键质量风险和失败模式映射为测试场景，明确环境、步骤、预期与覆盖缺口。'],
    ['functional', '功能验证', '核对正常、失败、边界、权限、并发、恢复与数据隔离，区分模拟与真实系统证据。'],
    ['load', '性能负载', '记录数据规模、并发、预热、样本、分位数及资源环境；一次测量不能代表生产容量。'],
    ['reproduction', '缺陷复现', '保留输入、前置状态、步骤、预期和实际结果，使问题可独立重复定位。'],
    ['regression', '回归证据', '在修复后的相同条件重跑相关场景并核对相邻风险，未执行检查必须明确列出。'],
  ], relations: [['risk', '组织', 'functional'], ['risk', '定义', 'load'], ['reproduction', '提供', 'evidence'], ['regression', '复核', 'reproduction'], ['regression', '补充', 'functional'], ['review', '依据', 'regression']] },
  { role: 'operator', title: '运维负责人的交付与生命周期知识', concepts: [
    ['build', '可复现构建', '固定源版本、依赖与构建命令，说明工具和环境条件，产出可审查的实际制品。'],
    ['archive', '版本归档', '将安装包、版本、SHA-256、许可、变更和验收记录绑定，避免用旧证据证明新包。'],
    ['compatibility', '兼容验证', '在声明范围内的干净官方环境验证安装、核心功能和原生功能，不仅修改版本号放行。'],
    ['rollback', '回滚方案', '记录可恢复的旧制品、配置与数据兼容条件，在变更前明确失败时的恢复步骤。'],
    ['uninstall', '完整卸载', '停止插件运行资源并按归属移除专属配置、数据、缓存和服务，保留用户成果与共享凭据。'],
  ], relations: [['build', '生成', 'archive'], ['compatibility', '验证', 'archive'], ['rollback', '依赖', 'archive'], ['compatibility', '演练', 'uninstall'], ['archive', '绑定', 'evidence'], ['review', '检查', 'compatibility']] },
  { role: 'team', title: '软件开发团的协作与知识交接', concepts: [
    ['product', '产品负责人', '作为团队负责人统一需求、范围、优先级与用户验收，处理关键业务取舍。'],
    ['architect', '技术负责人/架构师', '向产品负责人汇报，负责架构契约、技术拆解、独立代码审查和技术风险协调。'],
    ['specialists', '专业负责人', 'UX/UI设计师、测试负责人、运维负责人直接向产品负责人汇报，与技术负责人平级，分别独立负责体验、质量验证和发布运行准备。'],
    ['developer', '开发人员', '向技术负责人/架构师汇报，依据确认契约实施与修复；实现仍需独立技术审查、质量验证和用户验收。'],
    ['handover', '跨岗位交付契约', '每一步明确负责人、输入、产物、验收标准与返工目标。设计、技术、测试和运维协同交接目标、决定、证据及风险；切换负责人不等于工作完成。'],
  ], relations: [['architect', '汇报给', 'product'], ['specialists', '汇报给', 'product'], ['developer', '汇报给', 'architect'], ['developer', '遵循', 'handover'], ['review', '核对', 'handover'], ['handover', '传递', 'evidence']] },
];
const allConcepts = (reference: ProfessionalReference): Concept[] => [...reference.concepts, ...memoryConcepts];
const allRelations = (reference: ProfessionalReference): Relation[] => [...reference.relations, ...memoryRelations];
const conceptLine = ([, name, definition]: Concept) => `${name}：${definition}`;
function relationLine(reference: ProfessionalReference, [from, predicate, to]: Relation): string {
  const names = new Map(allConcepts(reference).map(([id, name]) => [id, name]));
  return `${names.get(from)} —${predicate}→ ${names.get(to)}。`;
}
function referenceText(reference: ProfessionalReference): string {
  return [`# ${reference.title}`, '本资料是插件随包提供的专业参考定义，不代表任何用户项目已经执行、通过验收或形成已确认记忆。', '', '## 专业概念',
    ...allConcepts(reference).map(conceptLine), '', '## 明确关系', ...allRelations(reference).map(relation => relationLine(reference, relation))].join('\n');
}
export function softwareKnowledgeSources(role: string): EmployeeModules['knowledge']['sources'] {
  const reference = references.find(item => item.role === role && role !== 'team');
  return reference ? [{ id: `software-knowledge-v1-${role}`, title: reference.title, kind: 'text', value: referenceText(reference) }] : [];
}
export const softwareTeamKnowledgeDescription = referenceText(references.find(item => item.role === 'team')!);

/** Compile only exact bundled definitions. No guessed links, provider call or fabricated project facts.
 * Other plain-text configuration is retained verbatim as reference entries, never inferred as concepts.
 * Uploads/runtime evidence use the normal incremental compiler instead of being silently skipped.
 */
export function bundledSoftwareKnowledge(sources: KnowledgeSource[]): KnowledgeCompilation | undefined {
  // A permits much larger custom references than a single B entry. Leave those
  // libraries to normal compilation rather than letting optional bootstrap fail activation.
  if (!sources.length || sources.length > 100 || sources.some(source => source.text.length > 64_000
    || (!source.provenance.startsWith('configuration:text:') && !source.provenance.startsWith('team:')))) return;
  const matched = sources.flatMap(source => references.flatMap(reference => source.content === referenceText(reference)
    && (reference.role === 'team' ? source.provenance.startsWith('team:') : source.provenance === `configuration:text:software-knowledge-v1-${reference.role}`) ? [{ source, reference }] : []));
  if (matched.length !== 1) return;
  const { source, reference } = matched[0]!;
  const lines = source.text.split('\n');
  const citation = (text: string): KnowledgeCitation[] => {
    const index = lines.findIndex(line => line === text);
    if (index < 0) throw new Error('随包知识的来源行与定义不匹配');
    return [{ sourceId: source.id, sourceVersion: source.version, startLine: index + 1, endLine: index + 1 }];
  };
  const entryId = (id: string) => `software-${reference.role}-${id}`;
  const concepts = allConcepts(reference).map(concept => ({ id: `concept-${entryId(concept[0])}`, name: concept[1], kind: 'concept' as const,
    summary: concept[2], entryIds: [entryId(concept[0])], citations: citation(conceptLine(concept)) }));
  const entries = allConcepts(reference).map(concept => ({ id: entryId(concept[0]), title: concept[1], content: concept[2], citations: citation(conceptLine(concept)) }));
  const relations = allRelations(reference).map((relation, index) => {
    const text = relationLine(reference, relation); const id = `software-${reference.role}-relation-${index}`;
    entries.push({ id, title: text.slice(0, -1), content: text, citations: citation(text) });
    return { id: `relation-${id}`, sourceId: `concept-${entryId(relation[0])}`, targetId: `concept-${entryId(relation[2])}`, predicate: relation[1], basis: 'explicit' as const, summary: text, entryIds: [id], citations: citation(text) };
  });
  for (const [index, other] of sources.filter(item => item !== source).entries()) entries.push({ id: `software-reference-${index}`, title: other.title, content: other.text,
    citations: [{ sourceId: other.id, sourceVersion: other.version, startLine: 1, endLine: other.text.split('\n').length }] });
  const compilation: KnowledgeCompilation = { entries, overview: [{ id: `software-${reference.role}-overview`, title: reference.title,
    summary: '随包专业参考：概念和关系逐条引用原始定义，项目事实与已确认记忆仍须实际证据和人工确认。', entryIds: entries.map(entry => entry.id) }],
    conceptGraph: { schemaVersion: 1, concepts, relations }, compilationTrace: { revision: 'strict-incremental-v1', changedSourceIds: sources.map(item => item.id), removedSourceIds: [], modelCalls: 0 } };
  return new TextEncoder().encode(JSON.stringify(compilation)).byteLength <= 1_500_000 ? compilation : undefined;
}
