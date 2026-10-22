import type { EmployeeTemplate, TeamMember, TeamWorkflow } from '../domain/types.js';
import { NumberField, SelectField, StringList, TextField } from './fields.js';
import { Icon } from './icons.js';

export function TeamWorkflows({ workflows, members, templates, onChange }: {
  workflows: TeamWorkflow[];
  members: TeamMember[];
  templates: EmployeeTemplate[];
  onChange: (workflows: TeamWorkflow[]) => void;
}) {
  const change = (id: string, patch: Partial<TeamWorkflow>) => onChange(workflows.map(workflow => workflow.id === id ? { ...workflow, ...patch } : workflow));
  return <div className="wf-team-workflows">
    <div className="wf-team-section-title"><span>{workflows.length} 个工作流</span><button type="button" className="wf-inline-add" disabled={!members.length || workflows.length >= 50} onClick={() => onChange([...workflows, { id: crypto.randomUUID(), name: '', steps: [{ id: crypto.randomUUID(), name: '', memberId: members[0]!.memberId, instruction: '' }] }])}><Icon name="plus" size={14} />添加工作流</button></div>
    {workflows.map((workflow, index) => <WorkflowForm key={workflow.id} workflow={workflow} index={index} members={members} templates={templates} onChange={patch => change(workflow.id, patch)} onRemove={() => onChange(workflows.filter(item => item.id !== workflow.id))} />)}
  </div>;
}

export function WorkflowForm({ workflow, index = 0, members, templates, onChange: change, onRemove, assigneeLabel = '负责员工' }: {
  workflow: TeamWorkflow;
  index?: number;
  members: TeamMember[];
  templates: EmployeeTemplate[];
  onChange: (patch: Partial<TeamWorkflow>) => void;
  onRemove?: () => void;
  assigneeLabel?: string;
}) {
  return <section className="wf-team-workflow-form" aria-label={`工作流 ${index + 1}`}>
      <div className="wf-team-workflow-heading"><TextField label="工作流名称" value={workflow.name} placeholder="如：应用开发流程" onChange={name => change({ name })} />{onRemove && <button type="button" className="wf-icon-button" aria-label={`删除工作流 ${index + 1}`} onClick={onRemove}><Icon name="trash" size={15} /></button>}</div>
      <NumberField label="每步最多尝试次数" value={workflow.maxAttempts ?? 3} min={1} max={10} onChange={maxAttempts => change({ maxAttempts })} />
      {workflow.steps.map((step, stepIndex) => <div className="wf-team-workflow-step" key={step.id}>
        <div className="wf-team-workflow-step-heading"><strong>步骤 {stepIndex + 1}</strong><button type="button" className="wf-inline-add" disabled={stepIndex === 0} aria-label={`上移步骤 ${stepIndex + 1}`} onClick={() => { const steps = [...workflow.steps]; [steps[stepIndex - 1], steps[stepIndex]] = [steps[stepIndex]!, steps[stepIndex - 1]!]; change({ steps }); }}>上移</button><button type="button" className="wf-icon-button" disabled={workflow.steps.length === 1} aria-label={`删除步骤 ${stepIndex + 1}`} onClick={() => change({ steps: workflow.steps.filter(item => item.id !== step.id) })}><Icon name="close" size={14} /></button></div>
        <div className="wf-grid-two"><TextField label="步骤名称" value={step.name} placeholder="如：架构设计" onChange={name => change({ steps: workflow.steps.map(item => item.id === step.id ? { ...item, name } : item) })} /><SelectField label={assigneeLabel} value={step.memberId} onChange={memberId => change({ steps: workflow.steps.map(item => item.id === step.id ? { ...item, memberId } : item) })}><option value="" disabled>选择负责岗位</option>{members.map(member => <option value={member.memberId} key={member.memberId}>{member.name || templates.find(template => template.id === member.templateId)?.name}</option>)}</SelectField></div>
        <TextField label="步骤任务" value={step.instruction} placeholder="本步骤要完成的工作与交付要求" multiline rows={2} onChange={instruction => change({ steps: workflow.steps.map(item => item.id === step.id ? { ...item, instruction } : item) })} />
        <details className="wf-workflow-requirements"><summary>交接与验收</summary>
          {(['inputs', 'outputs', 'acceptanceCriteria'] as const).map((key, index) => <StringList key={key} label={['输入要求', '交付要求', '验收条件'][index]!} values={step[key] ?? []} onChange={values => change({ steps: workflow.steps.map(item => item.id === step.id ? { ...item, [key]: values } : item) })} />)}
          <NumberField label="步骤超时（秒）" value={(step.timeoutMs ?? 600_000) / 1000} min={1} max={3600} onChange={seconds => change({ steps: workflow.steps.map(item => item.id === step.id ? { ...item, timeoutMs: seconds * 1000 } : item) })} />
        </details>
      </div>)}
      <button type="button" className="wf-inline-add" disabled={!members.length || workflow.steps.length >= 50} onClick={() => change({ steps: [...workflow.steps, { id: crypto.randomUUID(), name: '', memberId: members[0]!.memberId, instruction: '' }] })}><Icon name="plus" size={14} />添加步骤</button>
  </section>;
}
