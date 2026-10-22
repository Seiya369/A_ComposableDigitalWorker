import type { EmployeeModules, EmployeeTemplate, KnowledgeOrganization, KnowledgeSource } from '../domain/types.js';
import { KNOWLEDGE_SOURCE_CATEGORIES, KNOWLEDGE_SOURCE_CATEGORY_LABELS } from '../knowledge/categories.js';
import { SelectField, StringList, TextField, Toggle } from './fields.js';
import { Icon, type IconName } from './icons.js';
import type { WorkforceClient } from './client.js';
import { ModelSelector } from './ModelSelector.js';
import { CapabilitySelector } from './CapabilitySelector.js';

export type ModuleKey = Exclude<keyof EmployeeModules, 'collaboration'>;
export const MODULES: { key: ModuleKey; label: string; description: string; icon: IconName }[] = [
  { key: 'responsibilities', label: '岗位定义', description: '定义岗位角色、工作职责与规则边界。', icon: 'briefcase' },
  { key: 'model', label: '模型选择', description: '从 DSH 已配置模型中为这位人员选择模型。', icon: 'model' },
  { key: 'capabilities', label: '能力组合', description: '为岗位组合技能与工具，声明执行任务需要的能力。', icon: 'layers' },
  { key: 'knowledge', label: '知识与记忆', description: '连接知识来源，并设定项目内的记忆使用范围。', icon: 'memory' },
  { key: 'permissions', label: '权限', description: '设置执行边界；工具声明与实际授权分别配置。', icon: 'shield' },
  { key: 'delivery', label: '交付标准', description: '约定成果形式和可检查的完成条件。', icon: 'delivery' },
];

export function ModuleEditor({ activeModule, modules, onChange, templates, currentTemplateId, client, projectId }: { activeModule: ModuleKey; modules: EmployeeModules; onChange: (modules: EmployeeModules) => void; templates: EmployeeTemplate[]; currentTemplateId?: string; client: WorkforceClient; projectId?: string }) {
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
  if (activeModule === 'knowledge') {
    // Render an empty draft for legacy settings without persisting until the user edits.
    const organization: KnowledgeOrganization = modules.knowledge.organization ?? { version: 1, profession: '', taskScope: '', conceptRules: '', categories: [] };
    function organize(next: Partial<KnowledgeOrganization>) { update('knowledge', { organization: { ...organization, ...next } }); }
    return <div className="wf-module-form">
      <div className="wf-field">
        <div className="wf-field-label">知识来源<span className="wf-count">{modules.knowledge.sources.length}</span></div>
        {modules.knowledge.sources.map((source, i) => <div className="wf-record" key={source.id}>
          <div className="wf-record-title"><Icon name="memory" size={15} /><strong>来源 {i + 1}</strong><button type="button" className="wf-icon-button" aria-label={`删除知识来源 ${i + 1}`} onClick={() => update('knowledge', { sources: modules.knowledge.sources.filter((_, n) => n !== i) })}><Icon name="trash" size={14} /></button></div>
          <div className="wf-grid-two">
            <TextField label="标题" value={source.title} onChange={title => update('knowledge', { sources: modules.knowledge.sources.map((s, n) => n === i ? { ...s, title } : s) })} />
            <SelectField label="来源类型" value={source.kind} onChange={kind => update('knowledge', { sources: modules.knowledge.sources.map((s, n) => n === i ? { ...s, kind: kind as KnowledgeSource['kind'] } : s) })}><option value="project-file">项目文件</option><option value="url">网页地址</option><option value="text">内置知识</option></SelectField>
          </div>
          <SelectField label="资料主类别" value={source.category ?? 'reference'} onChange={category => update('knowledge', { sources: modules.knowledge.sources.map((s, n) => n === i ? { ...s, category: category as KnowledgeSource['category'] } : s) })} hint="A 按主类别归档；分类不代表批准或核验。">
            {KNOWLEDGE_SOURCE_CATEGORIES.map(category => <option key={category} value={category}>{KNOWLEDGE_SOURCE_CATEGORY_LABELS[category]}</option>)}
          </SelectField>
          <TextField label={source.kind === 'project-file' ? '项目相对路径' : source.kind === 'url' ? 'URL' : '知识内容'} value={source.value} hint={source.kind === 'url' ? '仅保存引用，不自动读取网页。' : undefined} multiline={source.kind === 'text'} rows={5} onChange={value => update('knowledge', { sources: modules.knowledge.sources.map((s, n) => n === i ? { ...s, value } : s) })} />
        </div>)}
        <button type="button" className="wf-inline-add" onClick={() => update('knowledge', { sources: [...modules.knowledge.sources, { id: `knowledge-${crypto.randomUUID()}`, title: '', kind: 'text', value: '', category: 'reference' }] })}><Icon name="plus" size={14} />添加知识来源</button>
      </div>
      <div className="wf-section-label">专业知识组织</div>
      <p className="wf-hint">资料管理员按岗位职责、技能和以下规则重组 B，并提取 C。留空时采用岗位默认规则；这些设置不改变权限或成果验收。</p>
      <TextField label="专业说明" value={organization.profession} onChange={profession => organize({ profession })} multiline rows={3} hint={`${organization.profession.length}/2000 UTF-16 字符`} placeholder="例如：支付接口与分布式事务" />
      <TextField label="任务范围" value={organization.taskScope} onChange={taskScope => organize({ taskScope })} multiline rows={3} hint={`${organization.taskScope.length}/4000 UTF-16 字符`} placeholder="描述需要整理、复用知识的工作范围" />
      <TextField label="概念提取规则" value={organization.conceptRules} onChange={conceptRules => organize({ conceptRules })} multiline rows={4} hint={`${organization.conceptRules.length}/8000 UTF-16 字符`} placeholder="补充概念边界、别名、同名消歧、适用版本及条件" />
      <div className="wf-field">
        <div className="wf-field-label">知识分类<span className="wf-count">{organization.categories.length}/24</span></div>
        <p className="wf-hint">用于组织 B 的专业知识，区别于 A 的六类资料。分类 ID 是稳定标识；改名时保留 ID，换 ID 或删除分类会重编知识。</p>
        {organization.categories.map((category, i) => <div className="wf-record" key={i}>
          <div className="wf-record-title"><strong>知识分类 {i + 1}</strong><button type="button" className="wf-icon-button" aria-label={`删除知识分类 ${i + 1}`} onClick={() => organize({ categories: organization.categories.filter((_, n) => n !== i) })}><Icon name="trash" size={14} /></button></div>
          <div className="wf-grid-two">
            <TextField label="分类 ID" value={category.id} onChange={id => organize({ categories: organization.categories.map((c, n) => n === i ? { ...c, id } : c) })} hint="1–64 位，以小写字母开头，仅小写字母、数字和连字符。" />
            <TextField label="分类名称" value={category.title} onChange={title => organize({ categories: organization.categories.map((c, n) => n === i ? { ...c, title } : c) })} hint={`${category.title.length}/120 UTF-16 字符`} />
          </div>
          <TextField label="分类说明" value={category.description} onChange={description => organize({ categories: organization.categories.map((c, n) => n === i ? { ...c, description } : c) })} multiline rows={3} hint={`${category.description.length}/2000 UTF-16 字符`} />
        </div>)}
        <button type="button" className="wf-inline-add" disabled={organization.categories.length >= 24} onClick={() => organize({ categories: [...organization.categories, { id: `topic-${crypto.randomUUID().slice(0, 8)}`, title: '', description: '' }] })}><Icon name="plus" size={14} />添加知识分类</button>
      </div>
      {modules.knowledge.organization && <button type="button" className="wf-inline-add" onClick={() => update('knowledge', { organization: undefined })}>恢复岗位默认知识组织</button>}
      <div className="wf-section-label">记忆范围</div><div className="wf-toggle-group"><Toggle label="使用项目共享记忆" checked={modules.knowledge.projectMemory} onChange={projectMemory => update('knowledge', { projectMemory })} /><Toggle label="使用员工项目记忆" checked={modules.knowledge.employeeMemory} onChange={employeeMemory => update('knowledge', { employeeMemory })} /></div><p className="wf-hint">长期记忆需在“项目记忆”中确认保存。</p>
    </div>;
  }
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
