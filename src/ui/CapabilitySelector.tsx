import { useEffect, useState } from 'react';
import { nativeToolEntitlement, type EmployeeCapabilityCatalog, type EmployeeToolOption } from '../domain/capability-catalog.js';
import type { EmployeeModules } from '../domain/types.js';
import type { WorkforceClient } from './client.js';
import { TextField } from './fields.js';

const PROJECT_TOOLS = [
  ['worker_read_file', '读取项目授权文件'],
  ['worker_list_files', '列出项目授权文件'],
  ['worker_write_artifact', '新建成果文件，不覆盖已有文件'],
  ['worker_memory_search', '检索本项目及个人记忆'],
  ['worker_memory_write', '从已验收成果保存可追溯记忆'],
  ['worker_delegate', '按协作规则向本项目人员委派子任务'],
] as const;

/** A person must request and authorize plugin tools; editing never mutates the source snapshot. */
export function selectProjectTool(modules: EmployeeModules, id: string, checked: boolean): EmployeeModules {
  const definition = PROJECT_TOOLS.find(tool => tool[0] === id);
  if (!definition) throw new Error('项目工具不存在');
  const existing = modules.capabilities.tools.find(tool => tool.id === id);
  return { ...modules,
    capabilities: { ...modules.capabilities, tools: [...modules.capabilities.tools.filter(tool => tool.id !== id), ...(checked ? [existing ?? { id, description: definition[1] }] : [])] },
    permissions: { ...modules.permissions, allowedTools: [...modules.permissions.allowedTools.filter(tool => tool !== id), ...(checked ? [id] : [])] },
  };
}

/** The public registries are read on demand; selections never install code or grant tools. */
export function CapabilitySelector({ client, projectId, modules, onChange }: { client: WorkforceClient; projectId?: string; modules: EmployeeModules; onChange: (modules: EmployeeModules) => void }) {
  const [catalog, setCatalog] = useState<EmployeeCapabilityCatalog>();
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let alive = true;
    setCatalog(undefined); setError('');
    void client.listCapabilities(projectId).then(value => { if (alive) setCatalog(value); }).catch(value => { if (alive) setError(value instanceof Error ? value.message : '能力目录读取失败'); });
    return () => { alive = false; };
  }, [client, projectId, generation]);
  const selected = new Set(modules.capabilities.skills.map(skill => skill.id));
  const skills = catalog?.skills.filter(skill => `${skill.name} ${skill.description}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  const missing = catalog ? modules.capabilities.skills.filter(skill => !catalog.skills.some(item => item.id === skill.id)) : [];
  const selectSkill = (id: string, checked: boolean) => {
    const skill = catalog?.skills.find(item => item.id === id);
    onChange({ ...modules, capabilities: { ...modules.capabilities, skills: checked && skill ? [...modules.capabilities.skills, { id: skill.id, name: skill.name, description: skill.description }] : modules.capabilities.skills.filter(item => item.id !== id) } });
  };
  const grant = (tool: EmployeeToolOption, checked: boolean) => {
    if (tool.id === 'web_search' || tool.id === 'web_fetch') { onChange({ ...modules, permissions: { ...modules.permissions, allowNetwork: checked } }); return; }
    const allowedTools = modules.permissions.allowedTools.filter(id => id !== tool.id);
    if (checked) allowedTools.push(tool.id);
    onChange({ ...modules, permissions: { ...modules.permissions, allowedTools } });
  };
  return <section className="wf-capability-selector" aria-label="DSH 能力目录">
    <div className="wf-content-heading"><div><h3>个人 Skills</h3><p className="wf-hint">从 DSH 已安装技能中组合岗位能力；选择技能不会自动放宽工具或网络权限。</p></div><button type="button" className="wf-button" onClick={() => setGeneration(value => value + 1)}>刷新目录</button></div>
    <details className="wf-capability-tools"><summary>项目协作与记忆工具</summary><p className="wf-hint">勾选后为当前人员草稿同时声明和授权此工具，保存后生效。目录权限、记忆来源与协作规则仍单独约束。</p>{PROJECT_TOOLS.map(([id, description]) => <label className="wf-capability-tool" key={id}><input type="checkbox" checked={modules.capabilities.tools.some(tool => tool.id === id) && modules.permissions.allowedTools.includes(id)} onChange={event => onChange(selectProjectTool(modules, id, event.target.checked))} /><span><strong>{id}</strong><small>{description}</small></span></label>)}</details>
    {error ? <div className="wf-banner wf-banner-error" role="alert">{error}</div> : !catalog ? <p role="status">正在读取 DSH 技能与工具…</p> : <>
      <TextField label="搜索已安装技能" value={query} onChange={setQuery} placeholder="名称或用途，例如 grill" />
      <div className="wf-capability-skills">{skills.map(skill => <label className="wf-capability-skill" key={skill.id}><input type="checkbox" checked={selected.has(skill.id)} onChange={event => selectSkill(skill.id, event.target.checked)} /><span><strong>{skill.name}</strong><small>{skill.description}</small><span className="wf-hint">{skill.source}</span></span></label>)}{!skills.length && <p className="wf-hint">没有匹配的已安装技能。安装后刷新此目录。</p>}</div>
      {missing.length > 0 && <div className="wf-callout"><span>这些已配置技能当前未安装或不适用于本项目：</span>{missing.map(skill => <div key={skill.id}><code>{skill.id}</code><button type="button" className="wf-button" onClick={() => selectSkill(skill.id, false)}>移除</button></div>)}</div>}
      {modules.capabilities.skills.length > 0 && <details><summary>岗位使用说明 · {modules.capabilities.skills.length}</summary>{modules.capabilities.skills.map(skill => <TextField key={skill.id} label={skill.name} value={skill.description} onChange={description => onChange({ ...modules, capabilities: { ...modules.capabilities, skills: modules.capabilities.skills.map(item => item.id === skill.id ? { ...item, description } : item) } })} multiline rows={2} />)}</details>}
      <details className="wf-capability-tools"><summary>统一基础工具 · {catalog.defaultTools.filter(tool => tool.available).length} 项已接入</summary><p className="wf-hint">所有人员使用同一基础工具目录，实际调用受个人路径与网络权限限制。勾选增加工具授权；已有 worker_* 权限继续有效，由旧授权提供的读取能力可在“权限”中撤销。覆盖写入和编辑须单独勾选。</p>{catalog.defaultTools.map(tool => <label className="wf-capability-tool" key={tool.id}><input type="checkbox" checked={nativeToolEntitlement(tool.id, modules)} disabled={!tool.available || ['skill', 'todo_write', 'ask_user_question'].includes(tool.id) || (nativeToolEntitlement(tool.id, modules) && !modules.permissions.allowedTools.includes(tool.id) && tool.id !== 'web_search' && tool.id !== 'web_fetch')} onChange={event => grant(tool, event.target.checked)} /><span><strong>{tool.id}</strong><small>{tool.description}</small>{tool.reason && <span className="wf-hint">{tool.reason}</span>}</span><span className="wf-tag">{tool.available ? '已接入' : '不可用'}</span></label>)}</details>
      <details className="wf-capability-tools"><summary>个人特殊工具 · {catalog.specialTools.length}</summary><p className="wf-hint">仅对这个人员选择相关工具，不在团队层重复配置。</p>{catalog.specialTools.map(tool => <label className="wf-capability-tool" key={tool.id}><input type="checkbox" disabled={!tool.available} checked={modules.capabilities.tools.some(item => item.id === tool.id)} onChange={event => onChange({ ...modules, capabilities: { ...modules.capabilities, tools: event.target.checked ? [...modules.capabilities.tools, { id: tool.id, description: tool.description }] : modules.capabilities.tools.filter(item => item.id !== tool.id) } })} /><span><strong>{tool.id}</strong><small>{tool.description}</small>{tool.reason && <span className="wf-hint">{tool.reason}</span>}</span></label>)}{!catalog.specialTools.length && <p className="wf-hint">DSH 尚未注册其他特殊工具。</p>}</details>
    </>}
  </section>;
}
