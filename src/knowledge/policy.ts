import { createHash } from 'node:crypto';
import type { EmployeeModules, KnowledgeCategory } from '../domain/types.js';
import type { KnowledgePolicy, KnowledgePolicyTask } from './types.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export interface PolicyMember { id: string; modules: EmployeeModules }

function categories(modules: EmployeeModules): KnowledgeOrganization['categories'] {
  const declared = modules.knowledge.organization?.categories;
  if (declared?.length) return structuredClone(declared);
  const duties = [...new Set(modules.responsibilities.duties.map(value => value.trim()).filter(Boolean))].slice(0, 12);
  return [
    ...duties.map(duty => ({ id: `duty-${hash(duty).slice(0, 12)}`, title: duty.slice(0, 120), description: duty })),
    { id: 'professional-foundations', title: '专业基础与原则', description: '专业定义、基础概念、适用条件与原则。' },
    { id: 'task-experience', title: '任务经验与核验', description: '任务证据、失败观察、反思假设和待核验经验；不自动视为事实。' },
  ];
}

/** Only role metadata and public task fields enter shared policy; never private source bodies or concept rules. */
export function buildKnowledgePolicy(members: PolicyMember[], memberId: string | undefined, description: string, tasks: KnowledgePolicyTask[]): KnowledgePolicy {
  const ordered = [...members].sort((a, b) => a.id.localeCompare(b.id));
  const member = memberId === undefined ? undefined : ordered.find(item => item.id === memberId);
  if (memberId !== undefined && !member) throw new Error('知识政策所属员工不存在');
  const selected = member ? [member] : ordered;
  const roles = selected.map(item => ({ memberId: item.id, mission: item.modules.responsibilities.mission,
    duties: [...item.modules.responsibilities.duties], boundaries: [...item.modules.responsibilities.boundaries],
    skills: item.modules.capabilities.skills.map(skill => ({ id: skill.id, name: skill.name, description: skill.description })) }));
  const organization = member?.modules.knowledge.organization;
  return {
    version: 1, scope: member ? 'employee' : 'team',
    profession: member ? organization?.profession.trim() || member.modules.responsibilities.mission : description,
    taskScope: member ? organization?.taskScope ?? '' : description,
    conceptRules: member ? organization?.conceptRules ?? '' : '',
    categories: member ? categories(member.modules) : selected.flatMap(item => categories(item.modules).map(category => ({
      id: `m-${hash(item.id).slice(0, 12)}-${category.id}`, title: `${item.modules.responsibilities.mission.slice(0, 60) || '成员专业'}：${category.title}`,
      // Shared categories expose navigation labels, not employee-private explanatory rules.
      description: '团队公开岗位的专业分类；只据团队已授权来源编纂。',
    }))),
    roles, tasks: structuredClone(tasks.filter(task => !member || task.employeeId === member.id).slice(-16)),
  };
}

export function knowledgePolicyFingerprint(policy: KnowledgePolicy): string { return hash(JSON.stringify(policy)); }
