import { useState } from 'react';
import type { WorkforceState } from '../domain/types.js';
import type { TransferKind } from '../domain/transfer-types.js';
import type { WorkforceClient } from './client.js';
import { SelectField } from './fields.js';
import { Icon } from './icons.js';

export function ProjectTemplateInstaller({ client, state, projectId, onClose, onInstalled }: { client: WorkforceClient; state: WorkforceState; projectId: string; onClose: () => void; onInstalled: () => Promise<unknown> }) {
  const [kind, setKind] = useState<TransferKind>('team');
  const [selectedId, setSelectedId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const templates = state.templates.filter(item => item.status === 'ready');
  const workflows = state.workflowTemplates ?? [];
  const projectTeams = (state.projectTeams ?? []).filter(team => team.projectId === projectId && team.status !== 'cancelled');
  const selectedWorkflow = workflows.find(workflow => workflow.id === selectedId);
  const selectedTeam = state.teams.find(team => team.id === selectedId);
  const targetTeam = projectTeams.find(team => team.id === teamId);
  const choices = kind === 'employee' ? templates : kind === 'team' ? state.teams : workflows;
  const installedTeam = kind === 'team' && projectTeams.some(team => team.teamTemplateId === selectedId);
  const valid = !!selectedId && (kind === 'workflow' ? !!targetTeam && !!selectedWorkflow && selectedWorkflow.roles.every(role => !!bindings[role.id]) : kind === 'team' ? !!selectedTeam?.members.length && selectedTeam.members.every(member => templates.some(template => template.id === member.templateId)) && !installedTeam : true);
  async function install() {
    if (busy || !valid) return;
    setBusy(true); setError('');
    try {
      if (kind === 'employee') await client.createEmployee({ projectId, templateId: selectedId });
      else if (kind === 'team' && selectedTeam) {
        const previous = state.projectTeams?.find(team => team.projectId === projectId && team.teamTemplateId === selectedTeam.id && team.status === 'cancelled');
        await client.configureProjectTeam({ projectId, teamId: selectedTeam.id, teamVersion: selectedTeam.version, templateVersions: Object.fromEntries(selectedTeam.members.map(member => [member.templateId, templates.find(template => template.id === member.templateId)!.version])), ...(previous ? { restoreVersion: previous.version ?? 1 } : {}) });
      }
      else if (selectedWorkflow && targetTeam) await client.saveProjectWorkflow({ projectId, projectTeamId: targetTeam.id, expectedVersion: 0, workflow: { id: `workflow-${crypto.randomUUID()}`, templateWorkflowId: selectedWorkflow.id, templateWorkflowVersion: selectedWorkflow.version, name: selectedWorkflow.name, maxAttempts: selectedWorkflow.maxAttempts, steps: selectedWorkflow.steps.map(({ roleId, ...step }) => ({ ...step, id: `step-${crypto.randomUUID()}`, employeeId: bindings[roleId]! })) } });
      try { await onInstalled(); onClose(); } catch { setError('模板已引入，刷新失败。请关闭此面板并刷新数据。'); }
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <section className="wf-transfer-panel" aria-label="引入通用模板"><div className="wf-transfer-heading"><div><h2>引入通用模板</h2><p>创建本项目的独立实例，保留模板来源和版本。</p></div><button className="wf-icon-button" aria-label="关闭模板引入" disabled={busy} onClick={onClose}><Icon name="close" size={16} /></button></div>
    {error && <p className="wf-error-box" role="alert">{error}</p>}
    <fieldset className="wf-team-workflow-fields" disabled={busy}><div className="wf-transfer-controls"><SelectField label="模板类型" value={kind} onChange={value => { setKind(value as TransferKind); setSelectedId(''); setBindings({}); }}><option value="employee">职业人</option><option value="team">团队</option><option value="workflow">工作流</option></SelectField><SelectField label="通用模板" value={selectedId} onChange={value => { setSelectedId(value); setBindings({}); }}><option value="">选择模板</option>{choices.map(item => <option value={item.id} key={item.id}>{item.name} · v{item.version}</option>)}</SelectField><button className="wf-button wf-primary" disabled={!valid} onClick={() => void install()}>{busy ? '引入中…' : installedTeam ? '团队已引入' : '创建项目实例'}</button></div>
      {!choices.length && <p className="wf-hint">暂无可引入模板。职业人须先完成配置；请在通用模板库中创建。</p>}
      {kind === 'team' && selectedTeam && <p className="wf-hint">{selectedTeam.members.length} 位职业人 · {selectedTeam.workflows?.length ?? 0} 个工作流。{!valid && !installedTeam ? '请先完善团队中的职业人配置。' : ''}</p>}
      {kind === 'workflow' && selectedWorkflow && <div className="wf-grid-two"><SelectField label="本项目团队" value={teamId} onChange={value => { setTeamId(value); setBindings({}); }}><option value="">选择项目团队</option>{projectTeams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</SelectField>{targetTeam && selectedWorkflow.roles.map(role => <SelectField key={role.id} label={role.name} value={bindings[role.id] ?? ''} onChange={employeeId => setBindings(current => ({ ...current, [role.id]: employeeId }))}><option value="">选择负责职业人</option>{targetTeam.members.map(member => <option key={member.employeeId} value={member.employeeId}>{state.employees.find(employee => employee.id === member.employeeId)?.name}</option>)}</SelectField>)}</div>}
    </fieldset><p className="wf-transfer-footnote">引入仅保存配置，不启动模型任务。模板后续修改不会自动覆盖项目实例。</p>
  </section>;
}
