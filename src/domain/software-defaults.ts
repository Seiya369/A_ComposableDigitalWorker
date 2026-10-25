import presets from '../../skills/software-development-presets.json' with { type: 'json' };
import type { EmployeeModules, EmployeeTemplate, TeamTemplate, WorkflowTemplate } from './types.js';

interface RoleDefinition { mission: string; duties: string[]; method: string; artifacts: string[] }
const definitions: Record<string, RoleDefinition> = {
  product: {
    mission: '把用户目标转化为有证据、范围明确、可验收的软件需求，协调取舍并对需求基线负责。',
    duties: ['核对用户、使用场景、现有流程和约束，记录事实、假设及待确认问题。', '定义目标、非目标、优先级与可观察的验收条件，追踪需求变更的影响。', '依据实际交付与测试证据核对需求覆盖，提交用户验收及后续工作建议。'],
    method: '从问题和使用场景出发；将每条需求关联验收条件、设计和测试。用户尚未决定的取舍保留待确认，不将建议冒充确认。',
    artifacts: ['需求与非目标清单', '可验证的验收标准与变更记录'],
  },
  architect: {
    mission: '设计可实施、可验证、可演进的技术方案，对模块边界、技术取舍和工程质量负责。',
    duties: ['阅读现状与约束，明确模块、接口、数据、权限和失败恢复。', '比较现实备选方案，以 ADR 记录重要决策和适用条件。', '拆分有依赖和验收条件的工作包，独立审查实现与验证证据。'],
    method: '先核查现状与质量属性，再比较方案及代价。接口、数据、权限、并发与恢复必须有明确归属；独立评审基于真实差异和验证记录。',
    artifacts: ['架构、接口契约及 ADR', '实施工作包与独立代码审查记录'],
  },
  designer: {
    mission: '为目标用户设计清晰、可访问、一致的软件体验，给实现与验收提供完整交互定义。',
    duties: ['梳理用户任务、信息层级、关键路径与交互状态。', '定义布局、响应式、视觉规范、键盘操作与可访问性要求。', '核对真实实现的正常、空、加载、错误与权限受限状态，记录差距。'],
    method: '按用户任务验证页面与状态；用原型或具体界面证据说明交互，不以截图替代可操作性验证。无界面任务明确记录不适用原因。',
    artifacts: ['关键路径与交互状态说明', '视觉、适配与可访问性验收清单'],
  },
  developer: {
    mission: '依据已确认需求与契约增量实现可维护的软件，定位缺陷并提供可复现的验证证据。',
    duties: ['核对实施范围、现有实现、依赖及验收条件后拆成可验证的小改动。', '实现正常、失败、并发和恢复行为，使用有意义的回归测试保护重要行为。', '提交实际变更、执行命令、结果和局限，处理代码审查及测试发现的问题。'],
    method: '先复现和定位根因，再最小修复并验证。测试应检查可观察行为；临时工作树和进程登记归属并在集成核验后清理，不擅自发布。',
    artifacts: ['实际代码变更与回归测试', '验证命令、结果与未解决问题'],
  },
  tester: {
    mission: '独立核对软件行为与需求、契约和风险的一致性，提供可复现的功能、性能及回归证据。',
    duties: ['把需求和风险转成测试矩阵，覆盖失败、边界、权限、并发、恢复与数据隔离。', '在适当隔离环境执行测试，测量延迟、吞吐及资源，记录环境与样本。', '复现缺陷、协助分析根因并复测，审查测试断言有效性；未执行项明确标识。'],
    method: '区分代码审查、模拟、真实系统和真实模型证据。性能报告记录负载、样本、分位数与限制；不以测试计划或一次成功宣称全面通过。',
    artifacts: ['需求与风险测试矩阵', '缺陷、功能回归与性能测量报告'],
  },
  operator: {
    mission: '准备可复现、可安装、可回滚和可卸载的软件交付，验证部署与运行条件并支持安全交接。',
    duties: ['核对构建、依赖、许可、版本、配置、权限与兼容范围。', '准备实际安装包、校验和、安装升级、卸载和回滚说明，演练资源清理及数据保留。', '整理发布检查、监控与故障恢复步骤；实际部署等外部动作遵循用户授权。'],
    method: '验收绑定同一份版本归档与哈希，在干净环境验证安装、核心功能、移除、重装及完整清理；保留用户成果和共享数据。',
    artifacts: ['版本化安装包、哈希、许可与更新记录', '安装升级卸载、回滚和运行交接说明'],
  },
};

const boundaries = [
  '依据当前项目的实际文件与已确认资料工作；事实、推断和待确认项分别说明，未执行的验证不得声称通过。',
  '文件、Shell、网络、委派及外部动作遵循用户授权和 DSH 原生权限、沙箱及审批；岗位和技能不扩大权限。',
  '仅使用本项目及本人可见记忆，保留精确来源和适用条件；模型提案、临时聊天及未验收成果不能自动成为长期事实。',
  '交付本次任务要求的产物与证据，验收由用户决定；不虚构协作者、测试结果或发布状态。',
];

/** Package-owned defaults only. Existing profiles are never silently reseeded. */
export function createSoftwareDefaults(now: string, architect: EmployeeTemplate, teamId: string) {
  const templates = presets.roles.map(role => {
    const definition = definitions[role.role]!;
    const modules: EmployeeModules = role.role === 'architect' ? structuredClone(architect.modules) : {
      responsibilities: { mission: definition.mission, duties: [...definition.duties], boundaries: [...boundaries] },
      capabilities: { skills: [], tools: [] }, model: { mode: 'inherit' },
      knowledge: { sources: [], projectMemory: true, employeeMemory: true, memoryWritePolicy: 'explicit-only' },
      permissions: { allowedTools: [], readPaths: [], writePaths: [], allowShell: false, allowNetwork: false },
      collaboration: { canDelegate: true, allowedTemplateIds: [], maxDepth: 2, maxConcurrent: 2, escalationRules: [] },
      delivery: { requiredArtifacts: [...definition.artifacts], acceptanceCriteria: ['交付可追溯至任务要求与真实证据。', '列明已验证结果、未验证事项和剩余风险，由用户验收。'], reviewRequired: true },
    };
    modules.capabilities.skills = [
      { id: role.required, name: role.required, description: definition.mission, usage: 'required' },
      ...role.preferred.map(skill => ({ id: skill.id, name: skill.id, description: skill.useWhen, usage: 'preferred' as const, useWhen: skill.useWhen })),
    ];
    modules.knowledge.sources.push(
      { id: `${role.role}-engineering-method`, title: `${role.name}工作方法`, kind: 'text', value: definition.method },
      { id: `${role.role}-evidence-memory`, title: '认知与记忆规范', kind: 'text', value: '专业方法是参考，不能冒充项目事实。区分原始证据、候选综合和已确认结论；冲突保留各方版本及引用。跨阶段传递目标、输入、决定、产物、验证与未决风险；记忆显式确认后写入，不复制其他员工私有资料或凭据。' },
    );
    modules.collaboration.escalationRules = [
      '仅向当前项目真实名册中的合适岗位委派；给出目标、输入、成果、验收条件和预算，收到结果后核验。',
      '遇到需求冲突、关键证据不足或权限缺失时说明缺口并由用户决定；不自行扩大范围或宣布验收。',
    ];
    return { id: role.role === 'architect' ? architect.id : `employee-template-${role.role}`, name: role.role === 'architect' ? architect.name : role.name,
      description: definition.mission, version: 1, status: 'ready' as const, modules, createdAt: now, updatedAt: now };
  });
  // Preserve the long-standing first template identity used by existing callers.
  templates.sort((a, b) => Number(b.id === architect.id) - Number(a.id === architect.id));
  const team: TeamTemplate = { id: teamId, name: '软件开发团', description: '产品、架构、设计、开发、测试与运维六岗位，按可追溯的阶段交付、独立验证和人工验收协作。',
    version: 1, knowledgeEnabled: true, createdAt: now, updatedAt: now,
    members: presets.roles.map(role => ({ memberId: role.role, templateId: role.role === 'architect' ? architect.id : `employee-template-${role.role}`,
      name: role.name, ...(role.role === 'architect' ? {} : { reportsTo: 'architect' }) })) };
  const flow = (id: string, name: string, description: string, steps: WorkflowTemplate['steps']): WorkflowTemplate => ({
    id, name, description, version: 1, maxAttempts: 3, createdAt: now, updatedAt: now,
    team: { sourceTeamId: team.id, sourceTeamVersion: team.version, name: team.name, knowledgeEnabled: true, members: structuredClone(team.members) },
    roles: presets.roles.map(role => ({ id: role.role, name: role.name, memberId: role.role, description: definitions[role.role]!.mission })),
    steps: steps.map(step => ({ ...step, timeoutMs: 600_000, onRejectStepId: step.onRejectStepId ?? step.id })),
  });
  const step = (id: string, name: string, roleId: string, instruction: string, inputs: string[], outputs: string[], acceptanceCriteria: string[], onRejectStepId?: string) =>
    ({ id, name, roleId, instruction, inputs, outputs, acceptanceCriteria, ...(onRejectStepId ? { onRejectStepId } : {}) });
  const workflows = [flow('workflow-template-software', '软件工程', '需求到交付的完整工程流程；每步交付后由用户验收，失败按明确目标返工。', [
    step('requirements', '需求与验收基线', 'product', '澄清问题、范围、约束与验收标准，明确待确认取舍。', ['用户目标与现有项目资料'], ['需求、非目标、约束和验收清单'], ['关键需求可追溯且可验证', '未决事项明确并取得必要确认']),
    step('design', '交互与体验定义', 'designer', '定义关键路径、界面状态、响应式和可访问性；无界面任务说明不适用理由。', ['已验收需求基线'], ['交互、状态与体验规范或不适用说明'], ['正常与失败状态覆盖需求', '体验标准能由实现与测试核对'], 'requirements'),
    step('architecture', '架构与实施契约', 'architect', '核对现状并给出模块、接口、数据、权限、恢复及实施工作包。', ['需求基线与体验定义', '当前代码与系统约束'], ['技术方案、契约、ADR和工作包'], ['边界、失败处理和依赖明确', '取舍有证据且步骤可执行'], 'requirements'),
    step('test-plan', '测试与性能计划', 'tester', '设计需求和风险测试矩阵，给出性能负载、测量方法、目标和复现环境。', ['需求验收标准与技术契约'], ['功能、性能、边界与恢复测试计划'], ['验收标准有测试对应', '计划不冒充已执行的测试结果'], 'architecture'),
    step('implementation', '增量开发', 'developer', '按契约增量实现，补充有意义的回归测试并执行相关检查。', ['技术工作包、体验定义和测试计划'], ['代码、回归测试与真实检查记录'], ['实现覆盖当前范围', '检查可复现，未通过项明确'], 'architecture'),
    step('review', '独立代码审查', 'architect', '依据实际差异审查契约、权限、并发、故障恢复和复杂度，列出问题及证据。', ['代码差异与开发验证记录'], ['独立审查结论、问题与修正建议'], ['严重问题已解决或明确阻断交付', '审查证据绑定所审查的实现'], 'implementation'),
    step('verification', '功能与性能复测', 'tester', '执行测试矩阵及性能测量，复现缺陷并核对修复；明确模拟与真实验证的边界。', ['审查后实现与测试计划'], ['功能、性能、回归报告与缺陷闭环'], ['真实记录命令、负载、样本和结果', '未通过或未验证项未冒充通过'], 'implementation'),
    step('release', '打包与运行交接', 'operator', '生成实际版本归档、哈希、许可及更新说明，在隔离环境验证安装、升级、移除、重装与完整清理；外部发布遵循授权。', ['通过审查及复测的实现', '目标环境与兼容约束'], ['安装包、校验和与生命周期验收记录', '安装卸载、回滚及运行说明'], ['验收与同一归档哈希绑定', '清理保留用户成果和共享数据'], 'implementation'),
    step('acceptance', '需求覆盖与用户验收', 'product', '对照需求核对交付和证据，列出差距与风险，交由用户验收。', ['最终归档、需求清单与测试报告'], ['需求覆盖、交付清单和用户验收材料'], ['关键需求有真实交付及证据', '用户决定与待确认项清晰'], 'requirements'),
    step('retrospective', '复盘与知识交接', 'architect', '根据已验收结果分析根因与改进，登记后续事项；区分候选经验与确认记忆并核对临时资源收尾。', ['验收结果、缺陷及工程记录'], ['改进计划、证据引用与资源收尾记录'], ['建议针对已分析根因', '未确认经验未擅自转为长期事实'], 'retrospective'),
  ]), flow('workflow-template-defect-repair', '缺陷修复', '复现、根因定位、最小修复、独立审查、复测与交付。', [
    step('reproduce', '复现与根因定位', 'tester', '保留复现步骤和证据，区分症状、假设与已验证根因，明确影响范围。', ['缺陷报告与当前实现'], ['最小复现、根因与回归标准'], ['问题可复现或局限明确', '修复目标可验证']),
    step('repair', '最小修复', 'developer', '针对根因最小修复，并证明回归测试在修复前失败、修复后通过。', ['根因证据与回归标准'], ['修复代码和回归测试证据'], ['修复针对根因', '原失败场景通过且相关行为不退化'], 'reproduce'),
    step('repair-review', '独立审查', 'architect', '审查差异与修复范围，核对兼容、权限、失败恢复及遗漏风险。', ['修复差异与测试记录'], ['审查问题与结论'], ['重要问题闭环', '未以审查代替测试'], 'repair'),
    step('regression', '功能与性能回归', 'tester', '复测原问题、关联路径及必要性能指标，对比同等负载并记录结果。', ['审查后的修复与原复现'], ['复测及性能对比记录'], ['原缺陷不再出现', '功能及约定性能标准满足或明确阻断'], 'repair'),
    step('repair-release', '修复交付', 'operator', '准备修复归档及哈希、更新与回滚说明，验证安装和清理，提交用户验收。', ['复测结果与修复版本'], ['修复包、哈希及交接材料'], ['交付与已验证版本一致', '实际发布具备必要用户授权'], 'repair'),
  ])];
  team.workflows = workflows.map(workflow => ({ id: `${workflow.id}-binding`, name: workflow.name, sourceTemplateId: workflow.id, sourceTemplateVersion: workflow.version,
    maxAttempts: workflow.maxAttempts, steps: workflow.steps.map(({ roleId, ...step }) => ({ ...structuredClone(step), memberId: roleId })) }));
  return { templates, teams: [team], workflowTemplates: workflows };
}
