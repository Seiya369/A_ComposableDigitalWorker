import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { EmployeeModules, KnowledgeOrganization, KnowledgeSource } from '../domain/types.js';
import { KNOWLEDGE_SOURCE_CATEGORIES, type KnowledgeSourceCategory } from '../knowledge/categories.js';
import { SelectField, TextField, Toggle } from './fields.js';
import { Icon } from './icons.js';

const SOURCE_GROUPS: Record<KnowledgeSourceCategory, { title: string; hint: string }> = {
  reference: { title: '投喂马料', hint: '上传岗位资料，供资料管理员整理。' },
  'requirements-decisions': { title: '需求决策', hint: '保留目标、验收条件与决策依据。' },
  'task-evidence': { title: '任务证据', hint: '收集任务过程、结果与核验记录。' },
  'incidents-reflections': { title: '失败反思', hint: '记录失败原因、教训与改进。' },
  'environment-constraints': { title: '环境约束', hint: '说明运行环境、限制与适用条件。' },
  'preferences-capabilities': { title: '偏好能力', hint: '记录工作偏好与能力边界。' },
};

interface KnowledgeEditorProps {
  knowledge: EmployeeModules['knowledge'];
  onChange: (knowledge: EmployeeModules['knowledge']) => void;
  onUploadKnowledge?: (files: File[]) => Promise<void>;
  knowledgeUploadDisabled?: boolean;
  knowledgeUploadAccept?: string;
  knowledgeUploadTargetLabel?: string;
  knowledgeUploadDisabledReason?: string;
  knowledgeUploadedSources?: ReactNode;
}

export function KnowledgeEditor({ knowledge, onChange, onUploadKnowledge, knowledgeUploadDisabled = false, knowledgeUploadAccept, knowledgeUploadTargetLabel, knowledgeUploadDisabledReason, knowledgeUploadedSources }: KnowledgeEditorProps) {
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [openGroups, setOpenGroups] = useState<Set<KnowledgeSourceCategory>>(() => new Set());
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const uploadDisabled = uploading || knowledgeUploadDisabled || !onUploadKnowledge;
  const uploadDisabledReason = knowledgeUploadDisabledReason || (!onUploadKnowledge ? '请先保存员工并启用资料管理员' : '');
  const update = (next: Partial<EmployeeModules['knowledge']>) => onChange({ ...knowledge, ...next });
  const setGroupOpen = (category: KnowledgeSourceCategory, open: boolean) => setOpenGroups(current => {
    if (current.has(category) === open) return current;
    const next = new Set(current);
    if (open) next.add(category); else next.delete(category);
    return next;
  });
  const changeSource = (index: number, next: Partial<KnowledgeSource>) => {
    if (next.category) setGroupOpen(next.category, true);
    update({ sources: knowledge.sources.map((source, n) => n === index ? { ...source, ...next } : source) });
  };
  const addSource = (category: KnowledgeSourceCategory) => {
    setGroupOpen(category, true);
    update({ sources: [...knowledge.sources, { id: `knowledge-${crypto.randomUUID()}`, title: '', kind: 'text', value: '', category }] });
  };
  async function upload(files: File[]) {
    if (!files.length || uploadDisabled || !onUploadKnowledge) return;
    setUploading(true);
    setUploadError('');
    setUploadStatus(`正在上传 ${files.length} 份资料…`);
    try {
      await onUploadKnowledge(files);
      setUploadStatus(`已入库 ${files.length} 份资料；知识编纂另行排队。`);
    } catch (error) {
      setUploadStatus('');
      setUploadError(error instanceof Error && error.message ? error.message : '资料上传失败，请重试。');
    } finally {
      setUploading(false);
    }
  }

  return <div className="wf-module-form wf-knowledge-editor">
    <p className="wf-hint wf-knowledge-scope">手工来源随配置保存，上传资料独立入库。</p>
    <div className="wf-knowledge-groups">
      {KNOWLEDGE_SOURCE_CATEGORIES.map(category => {
        const group = SOURCE_GROUPS[category];
        const sources = knowledge.sources.map((source, index) => ({ source, index })).filter(({ source }) => (source.category ?? 'reference') === category);
        return <section className="wf-knowledge-group" key={category} aria-labelledby={`${id}-${category}`}>
          <div className="wf-knowledge-heading">
            <div><h3 id={`${id}-${category}`}>{group.title}</h3><p className="wf-hint">{group.hint}</p></div>
            {category === 'reference' && <div className="wf-knowledge-upload" aria-busy={uploading}>
              <button type="button" className="wf-button" disabled={uploadDisabled} aria-describedby={`${id}-upload-help${uploadDisabledReason ? ` ${id}-upload-unavailable` : ''}`} onClick={() => fileInput.current?.click()}><Icon name="folder" size={14} />{uploading ? '上传中…' : '上传资料'}</button>
              <input ref={fileInput} type="file" hidden multiple accept={knowledgeUploadAccept} aria-label="选择投喂资料" disabled={uploadDisabled} onChange={event => {
                const files = Array.from(event.currentTarget.files ?? []);
                const disabled = event.currentTarget.matches(':disabled');
                event.currentTarget.value = '';
                if (!disabled && files.length) void upload(files);
              }} />
            </div>}
          </div>
          {category === 'reference' && <>
            <p className="wf-hint wf-knowledge-upload-help" id={`${id}-upload-help`}>支持 PDF、DOCX、UTF-8 文本，单文件 ≤ 1 MiB。<br />扫描件 OCR 与旧 DOC 暂不支持。</p>
            {knowledgeUploadTargetLabel && <p className="wf-hint wf-knowledge-upload-target">归档到：{knowledgeUploadTargetLabel}</p>}
            {uploadDisabledReason && <p className="wf-hint" id={`${id}-upload-unavailable`}>{uploadDisabledReason}</p>}
            <p className="wf-hint wf-knowledge-upload-status" role="status" aria-live="polite">{uploadStatus}</p>
            {uploadError && <p className="wf-error-box" role="alert">上传结果：{uploadError}</p>}
            {knowledgeUploadedSources}
          </>}
          {sources.length > 0 && <details className="wf-knowledge-sources" open={openGroups.has(category)} onToggle={event => setGroupOpen(category, event.currentTarget.open)}>
            <summary>手工来源 · {sources.length}</summary>
            <div className="wf-knowledge-source-list">{sources.map(({ source, index }) => <KnowledgeSourceRecord key={source.id} source={source} index={index} onChange={next => changeSource(index, next)} onDelete={() => update({ sources: knowledge.sources.filter((_, n) => n !== index) })} />)}</div>
          </details>}
          <button type="button" className="wf-inline-add" aria-label={`为${group.title}添加知识来源`} onClick={() => addSource(category)}><Icon name="plus" size={14} />添加知识来源</button>
        </section>;
      })}
    </div>
    <KnowledgeCompilationRules knowledge={knowledge} onChange={update} />
  </div>;
}

function KnowledgeSourceRecord({ source, index, onChange, onDelete }: { source: KnowledgeSource; index: number; onChange: (next: Partial<KnowledgeSource>) => void; onDelete: () => void }) {
  return <div className="wf-record">
    <div className="wf-record-title"><Icon name="memory" size={15} /><strong>{source.title || `来源 ${index + 1}`}</strong><button type="button" className="wf-icon-button" aria-label={`删除知识来源 ${source.title || index + 1}`} onClick={onDelete}><Icon name="trash" size={14} /></button></div>
    <div className="wf-grid-two">
      <TextField label="标题" value={source.title} onChange={title => onChange({ title })} />
      <SelectField label="来源类型" value={source.kind} onChange={kind => onChange({ kind: kind as KnowledgeSource['kind'] })}><option value="project-file">项目文件</option><option value="url">网页地址</option><option value="text">内置知识</option></SelectField>
    </div>
    <SelectField label="资料主类别" value={source.category ?? 'reference'} onChange={category => onChange({ category: category as KnowledgeSourceCategory })} hint="按主类别归档，不代表批准或核验。">
      {KNOWLEDGE_SOURCE_CATEGORIES.map(category => <option key={category} value={category}>{SOURCE_GROUPS[category].title}</option>)}
    </SelectField>
    <TextField label={source.kind === 'project-file' ? '项目相对路径' : source.kind === 'url' ? 'URL' : '知识内容'} value={source.value} hint={source.kind === 'url' ? '仅保存引用，不自动读取网页。' : undefined} multiline={source.kind === 'text'} rows={5} onChange={value => onChange({ value })} />
  </div>;
}

function KnowledgeCompilationRules({ knowledge, onChange }: { knowledge: EmployeeModules['knowledge']; onChange: (next: Partial<EmployeeModules['knowledge']>) => void }) {
  // Legacy settings remain a draft until the user changes a field.
  const organization: KnowledgeOrganization = knowledge.organization ?? { version: 1, profession: '', taskScope: '', conceptRules: '', categories: [] };
  const organize = (next: Partial<KnowledgeOrganization>) => onChange({ organization: { ...organization, ...next } });
  return <details className="wf-knowledge-rules">
    <summary><h3>编纂规则</h3><span className="wf-hint">专业组织、概念提取与记忆范围</span></summary>
    <div className="wf-knowledge-rules-content">
      <div className="wf-section-label">专业知识组织</div>
      <p className="wf-hint">资料管理员按岗位职责、技能和以下规则整理知识。留空时采用岗位默认规则。</p>
      <TextField label="专业说明" value={organization.profession} onChange={profession => organize({ profession })} multiline rows={3} hint={`${organization.profession.length}/2000 UTF-16 字符`} placeholder="例如：支付接口与分布式事务" />
      <TextField label="任务范围" value={organization.taskScope} onChange={taskScope => organize({ taskScope })} multiline rows={3} hint={`${organization.taskScope.length}/4000 UTF-16 字符`} placeholder="描述需要整理、复用知识的工作范围" />
      <TextField label="概念提取规则" value={organization.conceptRules} onChange={conceptRules => organize({ conceptRules })} multiline rows={4} hint={`${organization.conceptRules.length}/8000 UTF-16 字符`} placeholder="补充概念边界、别名、同名消歧、适用版本及条件" />
      <div className="wf-field">
        <div className="wf-field-label">知识分类<span className="wf-count">{organization.categories.length}/24</span></div>
        <p className="wf-hint">用于组织专业知识。改名保留分类 ID；换 ID 或删除分类会重编知识。</p>
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
      {knowledge.organization && <button type="button" className="wf-inline-add" onClick={() => onChange({ organization: undefined })}>恢复岗位默认知识组织</button>}
      <div className="wf-section-label">记忆范围</div>
      <div className="wf-toggle-group"><Toggle label="使用项目共享记忆" checked={knowledge.projectMemory} onChange={projectMemory => onChange({ projectMemory })} /><Toggle label="使用员工项目记忆" checked={knowledge.employeeMemory} onChange={employeeMemory => onChange({ employeeMemory })} /></div>
      <p className="wf-hint">长期记忆需在“项目记忆”中确认保存。</p>
    </div>
  </details>;
}
