import { useEffect, useState } from 'react';
import type { ProjectEmployee } from '../domain/types.js';
import type { ProjectBrief, SaveBriefInput, SaveDeliverableInput, SaveWorkTaskInput, WorkDeliverable, WorkTask } from '../work/types.js';
import { activateUiDraft, readUiDraft, removeUiDraft, writeUiDraft } from './drafts.js';
import { Field, SelectField, TextField } from './fields.js';

export const splitWorkLines = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean);
type FormProps<T> = { projectId: string; busy: boolean; onDirty: (dirty: boolean) => void; onSave: (value: T, requestId: string) => Promise<boolean>; onCancel: () => void };

function useWorkDraft<T>(key: string, initial: () => T, onDirty: (dirty: boolean) => void) {
  const restored = readUiDraft<{ value: T; requestId: string }>(key);
  const [value, setValue] = useState<T>(() => restored?.value ?? initial());
  const [requestId, setRequestId] = useState(restored?.requestId ?? crypto.randomUUID());
  const [dirty, setDirty] = useState(!!restored);
  useEffect(() => { activateUiDraft(key); if (dirty) writeUiDraft(key, { value, requestId }); else removeUiDraft(key); }, [key, value, requestId, dirty]);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  const change = (patch: Partial<T>) => { setValue(value => ({ ...value, ...patch })); setDirty(true); setRequestId(crypto.randomUUID()); };
  const clear = () => { removeUiDraft(key); setDirty(false); onDirty(false); };
  return { value, change, requestId, clear };
}

export function ProjectBriefEditor({ projectId, brief, deliverables, busy, onDirty, onSave, onCancel }: FormProps<SaveBriefInput> & { brief?: ProjectBrief; deliverables: WorkDeliverable[] }) {
  const { value, change, requestId, clear } = useWorkDraft(`work-brief:${projectId}`, () => ({ goal: brief?.goal ?? '', scope: brief?.scope ?? '', completion: brief?.completionCriteria.join('\n') ?? '', required: brief?.requiredDeliverableIds ?? [], concurrent: brief?.maxConcurrent ?? 1 }), onDirty);
  return <form className="wf-work-form" aria-label="项目目标配置" onSubmit={event => { event.preventDefault(); void onSave({ projectId, goal: value.goal.trim(), scope: value.scope.trim(), completionCriteria: splitWorkLines(value.completion), requiredDeliverableIds: value.required, maxConcurrent: value.concurrent }, requestId).then(ok => { if (ok) clear(); }); }}>
    <h3>项目目标与完成标准</h3><fieldset disabled={busy}>
      <TextField label="项目目标" value={value.goal} onChange={goal => change({ goal })} multiline rows={3} placeholder="这个项目最终要解决什么问题？" />
      <TextField label="范围与边界" value={value.scope} onChange={scope => change({ scope })} multiline rows={2} />
      <TextField label="完成标准（每行一项）" value={value.completion} onChange={completion => change({ completion })} multiline rows={3} placeholder="填写可以检查的完成条件" />
      <Field label="最大并行任务数" hint="启动项目后，仅派发已满足依赖的任务。共享文件的任务需要先安排依赖。"><input type="number" min={1} max={8} value={value.concurrent} onChange={event => change({ concurrent: Math.max(1, Math.min(8, Number(event.target.value) || 1)) })} /></Field>
      {deliverables.length > 0 && <fieldset className="wf-work-checklist"><legend>项目必交成果</legend>{deliverables.map(item => <label key={item.id}><input type="checkbox" checked={value.required.includes(item.id)} onChange={event => change({ required: event.target.checked ? [...value.required, item.id] : value.required.filter(id => id !== item.id) })} />{item.title}</label>)}</fieldset>}
    </fieldset><FormActions busy={busy} disabled={!value.goal.trim() || !splitWorkLines(value.completion).length} onCancel={() => { clear(); onCancel(); }} saveLabel="保存项目目标" />
  </form>;
}

export function WorkTaskEditor({ projectId, task, tasks, employees, busy, onDirty, onSave, onCancel }: FormProps<SaveWorkTaskInput> & { task?: WorkTask; tasks: WorkTask[]; employees: ProjectEmployee[] }) {
  const { value, change, requestId, clear } = useWorkDraft(`work-task:${projectId}:${task?.id ?? 'new'}`, () => ({ title: task?.title ?? '', goal: task?.goal ?? '', employeeId: task?.employeeId ?? '', inputs: task?.inputs.join('\n') ?? '', criteria: task?.acceptanceCriteria.join('\n') ?? '', dependencies: task?.dependencyTaskIds ?? [], outputs: '' }), onDirty);
  return <form className="wf-work-form" aria-label={task ? '编辑项目任务' : '新建项目任务'} onSubmit={event => { event.preventDefault(); void onSave({ projectId, ...(task ? { id: task.id, requiredDeliverableIds: task.requiredDeliverableIds } : {}), title: value.title.trim(), goal: value.goal.trim(), employeeId: value.employeeId, inputs: splitWorkLines(value.inputs), acceptanceCriteria: splitWorkLines(value.criteria), dependencyTaskIds: value.dependencies, ...(!task && splitWorkLines(value.outputs).length ? { deliverableTitles: splitWorkLines(value.outputs) } : {}) }, requestId).then(ok => { if (ok) clear(); }); }}>
    <h3>{task ? '编辑任务' : '新建任务'}</h3><fieldset disabled={busy}>
      <TextField label="任务名称" value={value.title} onChange={title => change({ title })} placeholder="例如：确定注册接口约定" />
      <TextField label="任务目标" value={value.goal} onChange={goal => change({ goal })} multiline rows={3} />
      <SelectField label="负责人" value={value.employeeId} onChange={employeeId => change({ employeeId })}><option value="">选择项目人员</option>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}{employee.status !== 'active' ? '（已暂停）' : ''}</option>)}</SelectField>
      <TextField label="必要输入（每行一项）" value={value.inputs} onChange={inputs => change({ inputs })} multiline rows={2} />
      <TextField label="验收标准（每行一项）" value={value.criteria} onChange={criteria => change({ criteria })} multiline rows={3} />
      {!task && <TextField label="预期成果（每行一项）" value={value.outputs} onChange={outputs => change({ outputs })} multiline rows={2} hint="未填写时建立一份默认成果；执行后保存具体版本。" />}
      <fieldset className="wf-work-checklist"><legend>前置任务</legend><p className="wf-hint">选中的任务验收通过后，本任务才可执行。后端会检查循环依赖。</p>{tasks.filter(item => item.id !== task?.id && item.status !== 'cancelled').map(item => <label key={item.id}><input type="checkbox" checked={value.dependencies.includes(item.id)} onChange={event => change({ dependencies: event.target.checked ? [...value.dependencies, item.id] : value.dependencies.filter(id => id !== item.id) })} />{item.title}</label>)}{tasks.filter(item => item.id !== task?.id).length === 0 && <p className="wf-hint">暂无其他任务，可以直接开始。</p>}</fieldset>
    </fieldset><FormActions busy={busy} disabled={!value.title.trim() || !value.goal.trim() || !value.employeeId || !splitWorkLines(value.criteria).length} onCancel={() => { clear(); onCancel(); }} saveLabel="保存任务" />
  </form>;
}

export function DeliverableEditor({ projectId, item, tasks, initialTaskId, busy, onDirty, onSave, onCancel }: FormProps<SaveDeliverableInput> & { item?: WorkDeliverable; tasks: WorkTask[]; initialTaskId?: string }) {
  const revision = item?.revisions.at(-1);
  const { value, change, requestId, clear } = useWorkDraft(`work-deliverable:${projectId}:${item?.id ?? initialTaskId ?? 'new'}`, () => ({ title: item?.title ?? '', taskId: item?.taskId ?? initialTaskId ?? '', content: revision?.content ?? '', path: revision?.path ?? '', mediaType: revision?.mediaType ?? 'text/markdown' }), onDirty);
  return <form className="wf-work-form" aria-label={item ? '修订成果' : '新增成果'} onSubmit={event => { event.preventDefault(); void onSave({ projectId, ...(item ? { id: item.id } : {}), taskId: value.taskId, title: value.title.trim(), ...(value.content.trim() ? { content: value.content.trim() } : {}), ...(value.path.trim() ? { path: value.path.trim() } : {}), mediaType: value.mediaType.trim() }, requestId).then(ok => { if (ok) clear(); }); }}>
    <h3>{item ? `修订成果 · v${(revision?.version ?? 0) + 1}` : '新增成果'}</h3><fieldset disabled={busy}>
      <TextField label="成果名称" value={value.title} onChange={title => change({ title })} />
      <SelectField label="生产任务" value={value.taskId} onChange={taskId => change({ taskId })}><option value="">选择任务</option>{tasks.filter(task => !item || task.id === item.taskId).map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</SelectField>
      <TextField label="项目内文件路径" value={value.path} onChange={path => change({ path })} placeholder="例如：docs/api.md" />
      <TextField label="成果内容" value={value.content} onChange={content => change({ content })} multiline rows={8} />
      <TextField label="内容类型" value={value.mediaType} onChange={mediaType => change({ mediaType })} />
      {item && <p className="wf-hint">修订会保留旧版本，引用旧版的下游任务将需要重新验证。</p>}
    </fieldset><FormActions busy={busy} disabled={!value.title.trim() || !value.taskId || (!value.path.trim() && !value.content.trim())} onCancel={() => { clear(); onCancel(); }} saveLabel={item ? '保存新版本' : '保存成果'} />
  </form>;
}

function FormActions({ busy, disabled, onCancel, saveLabel }: { busy: boolean; disabled: boolean; onCancel: () => void; saveLabel: string }) { return <div className="wf-form-actions"><button type="button" className="wf-button" disabled={busy} onClick={onCancel}>取消</button><button type="submit" className="wf-button wf-primary" disabled={busy || disabled}>{busy ? '保存中…' : saveLabel}</button></div>; }
