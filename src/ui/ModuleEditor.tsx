import { useI18n } from './i18n.js';
import type { ReactNode } from 'react';
import type { EmployeeModules, EmployeeTemplate } from '../domain/types.js';
import type { KnowledgeLibraryTarget, KnowledgeRemoveResult } from '../knowledge/library-api.js';
import { TextField } from './fields.js';
import type { IconName } from './icons.js';
import type { WorkforceClient } from './client.js';
import { ModelSelector } from './ModelSelector.js';
import { CapabilitySelector } from './CapabilitySelector.js';
import { KnowledgeLibrary } from './KnowledgeLibrary.js';

export type ModuleKey = 'responsibilities' | 'model' | 'capabilities' | 'knowledge';
export const MODULES: { key: ModuleKey; label: string; description: string; icon: IconName }[] = [
  { key: 'model', label: '模型配置', description: '跟随 DSH 默认模型，或选择岗位模型。', icon: 'model' },
  { key: 'responsibilities', label: '岗位定义', description: '定义岗位角色、工作职责与通用工作规范。', icon: 'briefcase' },
  { key: 'capabilities', label: '能力组合', description: '配置必备 Skill、优先 Skill、优先插件与优先 MCP。', icon: 'layers' },
  { key: 'knowledge', label: '认知记忆', description: '浏览主题知识图谱、阅读知识与管理专业资料。', icon: 'memory' },
];

export function ModuleEditor({ activeModule, modules, onChange, client, projectId, knowledgeTarget, employeeVersion, onSourceRemoved, responsibilitiesAction }: { activeModule: ModuleKey; modules: EmployeeModules; onChange: (modules: EmployeeModules) => void; templates?: EmployeeTemplate[]; currentTemplateId?: string; client: WorkforceClient; projectId?: string; knowledgeTarget?: KnowledgeLibraryTarget; employeeVersion?: number; onSourceRemoved?: (result: KnowledgeRemoveResult) => void; responsibilitiesAction?: ReactNode }) {
  const { t } = useI18n();
  function update<K extends ModuleKey>(key: K, next: Partial<EmployeeModules[K]>) { onChange({ ...modules, [key]: { ...modules[key], ...next } }); }
  if (activeModule === 'responsibilities') return <div className="wf-module-form wf-role-definition">
    <TextField label={t("岗位角色")} labelAction={responsibilitiesAction} value={modules.responsibilities.mission} onChange={mission => update('responsibilities', { mission })} multiline rows={3} placeholder={t("描述员工的角色、专业定位与岗位目标")} />
    <TextField label={t("工作职责")} value={modules.responsibilities.duties.join('\n')} onChange={value => update('responsibilities', { duties: value === '' ? [] : [value] })} multiline rows={4} placeholder={t("描述员工需要承担的工作和责任")} />
    <TextField label={t("工作规范与边界")} value={modules.responsibilities.boundaries.join('\n')} onChange={value => update('responsibilities', { boundaries: value === '' ? [] : [value] })} multiline rows={3} placeholder={t("描述通用质量规范、职责边界与需要上报的情况；具体交付物和验收条件在任务中设置")} />
  </div>;
  if (activeModule === 'capabilities') return <CapabilitySelector client={client} projectId={projectId} modules={modules} onChange={onChange} />;
  if (activeModule === 'knowledge') return <KnowledgeLibrary client={client} target={knowledgeTarget} modules={modules} onChange={onChange} employeeVersion={employeeVersion} onSourceRemoved={onSourceRemoved} />;
  return <div className="wf-module-form"><ModelSelector client={client} value={modules.model} onChange={model => onChange({ ...modules, model })} /></div>;
}

/** Informational completeness, never a replacement for server-side validation. */
export function moduleReady(key: ModuleKey, modules: EmployeeModules): boolean {
  switch (key) {
    case 'responsibilities': return !!modules.responsibilities.mission.trim() && modules.responsibilities.duties.some(d => d.trim());
    case 'capabilities': return true;
    case 'model': return modules.model.mode === 'inherit' || !!modules.model.provider && !!modules.model.model;
    case 'knowledge': return true;
  }
}
