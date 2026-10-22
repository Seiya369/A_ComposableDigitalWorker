import type { ProjectEmployee, WorkforceProject, WorkforceState } from '../domain/types.js';
import { activeProjectTeams, projectEmployees } from '../domain/project-roster.js';
import { EmptyState } from './ProjectPanels.js';
import { Icon } from './icons.js';
import { LibrarianToggle } from './LibrarianToggle.js';
import './project-team.css';

interface ProjectStaffingProps {
  state: WorkforceState;
  project: WorkforceProject;
  busy: boolean;
  onConfigureTeam: () => void;
  onEdit: (employeeId: string) => void;
  onSetKnowledge: (teamId: string, enabled: boolean, version: number) => void;
}

/** Project installations retain their employees, permissions and workflow assignments. */
export function ProjectStaffing({ state, project, busy, onConfigureTeam, onEdit, onSetKnowledge }: ProjectStaffingProps) {
  const employees = projectEmployees(state, project.id);
  const teams = activeProjectTeams(state, project.id);
  const assigned = new Set(teams.flatMap(team => team.members.map(member => member.employeeId)));
  const unassigned = employees.filter(employee => !assigned.has(employee.id));
  const legacyGroups = new Map<string, ProjectEmployee[]>();
  for (const employee of unassigned) if (employee.teamInstanceId) legacyGroups.set(employee.teamInstanceId, [...(legacyGroups.get(employee.teamInstanceId) ?? []), employee]);
  const standalone = unassigned.filter(employee => !employee.teamInstanceId);
  function employeeCards(members: ProjectEmployee[]) {
    return <div className="wf-project-employee-grid">{members.map(employee => <article className="wf-project-employee" key={employee.id} data-testid={`project-employee-${employee.id}`}>
      <div className="wf-project-employee-heading"><span className="wf-avatar"><Icon name="person" size={17} /></span><div><h3>{employee.name}</h3><span>{employee.templateName}</span></div><span className={`wf-pill ${employee.status === 'active' ? 'wf-pill-ready' : ''}`}>{employee.status === 'active' ? '已启用' : '待启用'}</span></div>
      <dl className="wf-staffing-properties"><div><dt>所属上级</dt><dd>{employees.find(item => item.id === employee.managerId)?.name || '无'}</dd></div><div><dt>文件写入</dt><dd>{employee.modules.permissions.writePaths.join('、') || '无'}</dd></div></dl>
      <div className="wf-project-employee-bottom"><span>{state.memories.filter(memory => memory.scope === 'employee' && memory.employeeId === employee.id).length} 条员工记忆</span><button className="wf-button" disabled={busy} onClick={() => onEdit(employee.id)}>岗位配置</button></div>
    </article>)}</div>;
  }
  return <main className="wf-staffing" data-testid="project-staffing"><div className="wf-staffing-scroll">
    <div className="wf-content-heading"><div><h2>项目团队</h2><p>{employees.length} 位员工 · {teams.reduce((count, team) => count + team.workflows.length, 0)} 个工作流</p></div><button className="wf-button" disabled={busy} onClick={onConfigureTeam}><Icon name="people" size={16} />配置团队</button></div>
    {!employees.length && <EmptyState title="尚未配置团队" />}
    {teams.map(team => <section className="wf-project-team-section" key={team.id} aria-label={team.name}>
      <h3>{team.name}</h3>
      <LibrarianToggle enabled={team.knowledgeEnabled ?? true} disabled={busy} onChange={enabled => onSetKnowledge(team.id, enabled, team.version ?? 1)} />
      {employeeCards(team.members.flatMap(member => { const employee = employees.find(employee => employee.id === member.employeeId); return employee ? [employee] : []; }))}
      {team.workflows.map(workflow => <details className="wf-project-workflow" key={workflow.id}>
        <summary>{workflow.name} · {workflow.steps.length} 个步骤</summary>
        <ol>{workflow.steps.map(step => <li key={step.id}><strong>{step.name}</strong><span>{employees.find(employee => employee.id === step.employeeId)?.name}</span><p>{step.instruction}</p></li>)}</ol>
      </details>)}
    </section>)}
    {[...legacyGroups].map(([id, members], index) => <section className="wf-project-team-section" key={id} aria-label={`历史团队 ${index + 1}`}>
      <h3>历史团队 · {index + 1}</h3>
      <LibrarianToggle enabled={members.every(member => member.legacyTeamKnowledgeEnabled !== false)} disabled={busy} onChange={enabled => onSetKnowledge(id, enabled, Math.max(...members.map(member => member.version)))} />
      {employeeCards(members)}
    </section>)}
    {!!standalone.length && <section className="wf-project-team-section">{(teams.length > 0 || legacyGroups.size > 0) && <h3>其他项目员工</h3>}{employeeCards(standalone)}</section>}
  </div></main>;
}
