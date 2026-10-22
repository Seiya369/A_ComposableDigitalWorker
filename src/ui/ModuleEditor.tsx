import type { EmployeeModules, EmployeeTemplate } from '../domain/types.js';
import { StringList, TextField, Toggle } from './fields.js';
import type { IconName } from './icons.js';
import type { WorkforceClient } from './client.js';
import { ModelSelector } from './ModelSelector.js';
import { CapabilitySelector } from './CapabilitySelector.js';
import { KnowledgeEditor } from './KnowledgeEditor.js';

export type ModuleKey = Exclude<keyof EmployeeModules, 'collaboration'>;
export const MODULES: { key: ModuleKey; label: string; description: string; icon: IconName }[] = [
  { key: 'responsibilities', label: '岗位定义', description: '定义岗位角色、工作职责与规则边界。', icon: 'briefcase' },
  { key: 'model', label: '模型选择', description: '从 DSH 已配置模型中为这位人员选择模型。', icon: 'model' },
  { key: 'capabilities', label: '能力组合', description: '为岗位组合技能与工具，声明执行任务需要的能力。', icon: 'layers' },
  { key: 'knowledge', label: '知识与记忆', description: '连接知识来源，并设定项目内的记忆使用范围。', icon: 'memory' },
  { key: 'permissions', label: '权限', description: '设置执行边界；工具声明与实际授权分别配置。', icon: 'shield' },
  { key: 'delivery', label: '交付标准', description: '约定成果形式和可检查的完成条件。', icon: 'delivery' },
];

interface ModuleEditorProps {
  activeModule: ModuleKey;
  modules: EmployeeModules;
  onChange: (modules: EmployeeModules) => void;
  templates: EmployeeTemplate[];
  currentTemplateId?: string;
  client: WorkforceClient;
  projectId?: string;
  onUploadKnowledge?: (files: File[]) => Promise<void>;
  knowledgeUploadDisabled?: boolean;
  knowledgeUploadAccept?: string;
}

export function ModuleEditor({ activeModule, modules, onChange, templates, currentTemplateId, client, projectId, onUploadKnowledge, knowledgeUploadDisabled, knowledgeUploadAccept }: ModuleEditorProps) {
  function update<K extends ModuleKey>(key: K, next: Partial<EmployeeModules[K]>) { onChange({ ...modules, [key]: { ...modules[key], ...next } }); }
  if (activeModule === 'responsibilities') return <div className="wf-module-form wf-role-definition">
    <TextField label="岗位角色" value={modules.responsibilities.mission} onChange={mission => update('responsibilities', { mission })} multiline rows={5} placeholder="描述员工的角色、专业定位与岗位目标" />
    <TextField label="工作职责" value={modules.responsibilities.duties.join('\n')} onChange={value => update('responsibilities', { duties: value === '' ? [] : [value] })} multiline rows={5} placeholder="描述员工需要承担的工作和责任" />
    <TextField label="规则边界" value={modules.responsibilities.boundaries.join('\n')} onChange={value => update('responsibilities', { boundaries: value === '' ? [] : [value] })} multiline rows={5} placeholder="描述工作规则、职责边界和需要上报的情况" />
  </div>;
  if (activeModule === 'capabilities') return <CapabilitySelector client={client} projectId={projectId} modules={modules} onChange={onChange} />;
  if (activeModule === 'model') return <div className="wf-module-form">
    <ModelSelector client={client} value={modules.model} onChange={model => onChange({ ...modules, model })} />
  </div>;
  if (activeModule === 'knowledge') return <KnowledgeEditor knowledge={modules.knowledge} onChange={knowledge => onChange({ ...modules, knowledge })} onUploadKnowledge={onUploadKnowledge} knowledgeUploadDisabled={knowledgeUploadDisabled} knowledgeUploadAccept={knowledgeUploadAccept} />;
  if (activeModule === 'permissions') return <div className="wf-module-form">
    <StringList label="允许调用的工具 ID" values={modules.permissions.allowedTools} onChange={allowedTools => update('permissions', { allowedTools })} hint="留空时无工具权限。" placeholder="worker_read_file" addLabel="授权工具" />
    <StringList label="允许读取的路径" values={modules.permissions.readPaths} onChange={readPaths => update('permissions', { readPaths })} placeholder="src/**" hint="项目相对路径或 glob；留空时不可读取。" addLabel="添加读取范围" />
    <StringList label="允许写入的路径" values={modules.permissions.writePaths} onChange={writePaths => update('permissions', { writePaths })} placeholder="docs/architecture/**" hint="仅限项目内这些路径。worker_write_artifact 只新建；原生 write/edit 需在能力组合中单独授权。" addLabel="添加写入范围" />
    <div className="wf-toggle-group"><Toggle label="允许 Shell 命令" checked={modules.permissions.allowShell} disabled onChange={allowShell => update('permissions', { allowShell })} hint="当前官方沙箱不能限制项目外读取和网络访问，暂不开放。" /><Toggle label="允许网络访问" checked={modules.permissions.allowNetwork} onChange={allowNetwork => update('permissions', { allowNetwork })} hint="仅影响已接入的 web_search / web_fetch；Skill 不会自动获得此权限。" /></div>
  </div>;
  return <div className="wf-module-form"><StringList label="必需交付物" values={modules.delivery.requiredArtifacts} onChange={requiredArtifacts => update('delivery', { requiredArtifacts })} placeholder="例如：架构设计文档与关键决策记录" addLabel="添加交付物" /><StringList label="验收标准" values={modules.delivery.acceptanceCriteria} onChange={acceptanceCriteria => update('delivery', { acceptanceCriteria })} placeholder="可以逐项检查的完成条件" addLabel="添加验收标准" /><div className="wf-toggle-group"><Toggle label="交付后需要验收" checked disabled onChange={reviewRequired => update('delivery', { reviewRequired })} hint="暂不支持自动验收。" /></div></div>;
}

/** Informational completeness, never a replacement for server-side validation. */
export function moduleReady(key: ModuleKey, modules: EmployeeModules): boolean {
  switch (key) {
    case 'responsibilities': return !!modules.responsibilities.mission.trim() && modules.responsibilities.duties.some(d => d.trim());
    case 'capabilities': return modules.capabilities.skills.length + modules.capabilities.tools.length > 0;
    case 'model': return modules.model.mode === 'inherit' || !!modules.model.provider && !!modules.model.model;
    case 'knowledge': return modules.knowledge.sources.length > 0 || modules.knowledge.projectMemory || modules.knowledge.employeeMemory;
    case 'permissions': return true;
    case 'delivery': return modules.delivery.requiredArtifacts.some(v => v.trim()) && modules.delivery.acceptanceCriteria.some(v => v.trim());
  }
}
