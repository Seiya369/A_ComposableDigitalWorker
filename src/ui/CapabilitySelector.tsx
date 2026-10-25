import { useI18n } from './i18n.js';
import { useEffect, useId, useRef, useState } from 'react';
import type { EmployeeCapabilityCatalog, EmployeeIntegrationOption, EmployeeSkillOption, EmployeeToolOption } from '../domain/capability-catalog.js';
import type { CapabilityReference, EmployeeModules } from '../domain/types.js';
import type { WorkforceClient } from './client.js';

/** Skill routing is independent from native tool availability and permissions. */
export function selectSkillUsage(modules: EmployeeModules, skill: EmployeeSkillOption, usage?: 'required' | 'preferred'): EmployeeModules {
  const existing = modules.capabilities.skills.find(item => item.id === skill.id);
  return { ...modules, capabilities: { ...modules.capabilities, skills: [
    ...modules.capabilities.skills.filter(item => item.id !== skill.id),
    ...(usage ? [{ ...existing, id: skill.id, name: skill.name, description: existing?.description ?? skill.description, usage }] : []),
  ] } };
}

/** Saved labels may be old aliases; the DSH catalog remains the naming authority. */
export function resolveSelectedSkillName(skill: Pick<CapabilityReference, 'id'>, skills?: readonly EmployeeSkillOption[]): string {
  return skills?.find(option => option.id === skill.id)?.name ?? skill.id;
}

const skillSources: Record<string, string> = {
  bundled: '随包提供', runtime: '插件注册',
  'project-dsh': '项目目录', 'project-agents': '项目共享目录',
  'user-dsh': '用户 DSH 目录', 'user-agents': '用户共享目录',
  custom: '自定义来源',
};
const skillSourceLabel = (source: string) => skillSources[source] ?? '自定义来源';

/** Retained for legacy preferences; the page now selects packages and MCP servers. */
export function selectPreferredTool(modules: EmployeeModules, tool: EmployeeToolOption, selected: boolean): EmployeeModules {
  const existing = modules.capabilities.tools.find(item => item.id === tool.id);
  return { ...modules, capabilities: { ...modules.capabilities, tools: [
    ...modules.capabilities.tools.filter(item => item.id !== tool.id),
    ...(selected ? [existing ?? { id: tool.id, description: tool.description }] : []),
  ] } };
}

export function selectPreferredIntegration(modules: EmployeeModules, kind: 'plugins' | 'mcps', option: EmployeeIntegrationOption, selected: boolean): EmployeeModules {
  if (selected && !option.available) return modules;
  const entries = modules.capabilities[kind] ?? [];
  if (selected && entries.some(item => item.id === option.id)) return modules;
  return { ...modules, capabilities: { ...modules.capabilities, [kind]: [
    ...entries.filter(item => item.id !== option.id),
    ...(selected ? [{ id: option.id, name: option.name, description: option.description }] : []),
  ] } };
}

const groups = [
  { id: 'required', label: '必备 Skill', hint: '每次任务' },
  { id: 'preferred', label: '优先 Skill' },
  { id: 'plugins', label: '优先插件' },
  { id: 'mcps', label: '优先 MCP' },
] as const;
type GroupId = typeof groups[number]['id'];
type CapabilityOption = EmployeeSkillOption | EmployeeIntegrationOption;

/** References only; installation and connection settings remain in DSH. */
export function CapabilitySelector({ client, projectId, modules, onChange }: { client: WorkforceClient; projectId?: string; modules: EmployeeModules; onChange: (modules: EmployeeModules) => void }) {
  const { t, errorMessage } = useI18n();
  const [catalog, setCatalog] = useState<EmployeeCapabilityCatalog>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [generation, setGeneration] = useState(0);
  const [picker, setPicker] = useState<GroupId>();
  const [query, setQuery] = useState('');
  const [actionError, setActionError] = useState('');
  const [showMcpGuide, setShowMcpGuide] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>();
  const search = useRef<HTMLInputElement>(null);
  const guideHeading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(''); setCatalog(undefined);
    void client.listCapabilities(projectId).then(value => { if (alive) setCatalog(value); }).catch(value => {
      if (alive) setError(value instanceof Error ? value.message : "能力目录读取失败");
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [client, projectId, generation]);
  useEffect(() => {
    if (!picker) return;
    const element = dialog.current;
    element?.showModal(); search.current?.focus();
    return () => { element?.close(); };
  }, [picker]);
  useEffect(() => {
    if (picker) (showMcpGuide ? guideHeading.current : search.current)?.focus();
  }, [picker, showMcpGuide]);

  const entriesFor = (kind: GroupId): CapabilityReference[] => kind === 'required' || kind === 'preferred'
    ? modules.capabilities.skills.filter(skill => kind === 'preferred' ? skill.usage === 'preferred' : skill.usage !== 'preferred')
    : modules.capabilities[kind] ?? [];
  const optionsFor = (kind: GroupId): CapabilityOption[] => kind === 'required' || kind === 'preferred' ? catalog?.skills ?? [] : catalog?.[kind] ?? [];
  const errorFor = (kind: GroupId) => error || (kind === 'plugins' ? catalog?.pluginError : kind === 'mcps' ? catalog?.mcpError : undefined);
  const closePicker = () => { dialog.current?.close(); setPicker(undefined); opener.current?.focus(); };
  const openNativePlugins = (bundleName?: string) => {
    setActionError('');
    try {
      if (!client.openNativePlugins) throw new Error('unavailable');
      client.openNativePlugins(bundleName);
      closePicker();
    } catch {
      setActionError("无法打开 DSH 插件页面，请稍后重试或从 DSH 侧栏打开“插件”。");
    }
  };
  const manage = (kind: GroupId, option: CapabilityOption) => {
    if (kind === 'plugins') openNativePlugins(option.id);
    else if (kind === 'mcps') {
      const integration = option as EmployeeIntegrationOption;
      if (integration.managementBundle) openNativePlugins(integration.managementBundle);
      else { setActionError(''); setShowMcpGuide(true); }
    }
  };
  const remove = (kind: GroupId, item: CapabilityReference) => {
    onChange(kind === 'required' || kind === 'preferred'
      ? selectSkillUsage(modules, { ...item, source: '' })
      : selectPreferredIntegration(modules, kind, { ...item, available: true }, false));
  };
  const add = (kind: GroupId, option: CapabilityOption) => {
    onChange(kind === 'required' || kind === 'preferred'
      ? selectSkillUsage(modules, option as EmployeeSkillOption, kind)
      : selectPreferredIntegration(modules, kind, option as EmployeeIntegrationOption, true));
    closePicker();
  };
  const selectedGroup = groups.find(group => group.id === picker);
  const pickerError = picker ? errorFor(picker) : undefined;
  const options = picker ? optionsFor(picker).filter(option => `${option.name} ${option.id} ${option.description}`.toLowerCase().includes(query.trim().toLowerCase())) : [];

  return <section className="wf-capability-selector" aria-label={t("能力组合")}>
    {groups.map(group => <section className="wf-capability-group" aria-label={t(group.label)} key={group.id}>
      <div className="wf-capability-group-heading"><h3>{t(group.label)}{'hint' in group && <small>{t('（{text}）', { text: t(group.hint) })}</small>}</h3>
        <button type="button" className="wf-capability-action" aria-label={t('添加{group}', { group: t(group.label) })} title={t('添加{group}', { group: t(group.label) })} onClick={event => { opener.current = event.currentTarget; setQuery(''); setActionError(''); setShowMcpGuide(false); setPicker(group.id); }}>＋</button>
      </div>
      {entriesFor(group.id).length > 0 ? <ul className="wf-capability-list">{entriesFor(group.id).map(item => {
        const option = optionsFor(group.id).find(option => option.id === item.id);
        const isSkill = group.id === 'required' || group.id === 'preferred';
        const displayName = isSkill ? resolveSelectedSkillName(item, catalog?.skills) : item.name;
        const source = isSkill && option && 'source' in option ? skillSourceLabel(option.source) : undefined;
        const title = isSkill && item.name !== displayName ? `${item.name}：${item.description}` : item.description;
        const unavailable = !!catalog && (option ? 'available' in option && !option.available : !errorFor(group.id));
        return <li className="wf-capability-selection-row" key={item.id}><span className="wf-capability-selection-name" title={title}>{displayName}{source && <small className="wf-capability-source">{t(source)}</small>}</span>
          {unavailable && <small className="wf-capability-unavailable" title={option && 'reason' in option ? option.reason ? errorMessage(option.reason) : undefined : undefined}>{t("当前不可用")}</small>}
          <button type="button" className="wf-capability-action wf-danger-text" aria-label={t('移除 {name}', { name: displayName ?? item.id })} title={t('移除 {name}', { name: displayName ?? item.id })} onClick={() => remove(group.id, item)}>−</button>
        </li>;
      })}</ul> : <p className="wf-capability-empty">{t("未添加")}</p>}
    </section>)}
    {picker && <dialog ref={dialog} className="wf-capability-picker" aria-labelledby={headingId} onCancel={event => { event.preventDefault(); closePicker(); }} onClose={closePicker}>
      <div className="wf-capability-picker-heading"><h3 id={headingId}>{t('添加{group}', { group: selectedGroup ? t(selectedGroup.label) : '' })}</h3><button type="button" className="wf-capability-action" aria-label={t("关闭能力选择")} onClick={closePicker}>×</button></div>
      {actionError && <p className="wf-banner wf-banner-error" role="alert">{errorMessage(actionError)}</p>}
      {showMcpGuide ? <section className="wf-capability-mcp-guide" aria-label={t("MCP 接入说明")}>
        <h4 ref={guideHeading} tabIndex={-1}>{t("接入 MCP")}</h4>
        <p>{t("当前 DSH 版本通过连接配置接入 MCP，尚无独立的原生 MCP 添加页面。")}</p>
        <ol>
          <li>{t("准备本地 MCP 程序，或取得远程服务地址及认证方式。")}</li>
          <li>{t("将连接配置合并到")} <code>$DSH_HOME/profiles/web/cordis.patch.yml</code>{t("，保留已有内容。")}</li>
          <li>{t("重载配置或重启 DSH，验证连接后返回这里刷新并选择。")}</li>
        </ol>
        <table><thead><tr><th>{t("类型")}</th><th>{t("连接配置")}</th></tr></thead><tbody><tr><td>{t("本地程序")}</td><td><code>stdio</code>{t("、启动命令、参数及环境变量")}</td></tr><tr><td>{t("远程服务")}</td><td><code>streamable-http</code>{t("、服务 URL 及认证请求头")}</td></tr></tbody></table>
        <p><a href="https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/docs/user/guide/mcp-memory.zh.md" target="_blank" rel="noreferrer">{t("查看 DSH 官方配置示例")}</a></p>
        <button type="button" className="wf-button" onClick={() => setShowMcpGuide(false)}>{t("返回 MCP 列表")}</button>
      </section> : <>
      <div className="wf-capability-picker-search"><input ref={search} type="search" aria-label={t("搜索已安装能力")} placeholder={picker === 'plugins' ? t("搜索 DSH 已装插件") : picker === 'mcps' ? t("搜索 DSH 已装 MCP") : t("搜索 DSH 已有 Skill")} value={query} onChange={event => setQuery(event.target.value)} />
        <button type="button" className="wf-button" disabled={loading} onClick={() => setGeneration(value => value + 1)}>{pickerError ? t("重试") : t("刷新")}</button></div>
      {picker === 'plugins' && <div className="wf-capability-picker-actions"><button type="button" className="wf-button" title={t("打开 DSH 原生插件页，在页面中点击“添加插件”")} onClick={() => openNativePlugins()}>{t("在 DSH 中添加插件")}</button></div>}
      {picker === 'mcps' && <div className="wf-capability-picker-actions"><button type="button" className="wf-button" onClick={() => setShowMcpGuide(true)}>{t("如何接入 MCP")}</button></div>}
      {loading ? <p className="wf-hint" role="status">{t("正在读取 DSH 目录…")}</p> : <>
        {pickerError && <p className="wf-banner wf-banner-error" role="alert">{errorMessage(pickerError)}</p>}
        <ul className="wf-capability-picker-list">{options.map(option => {
          const selected = entriesFor(picker).some(item => item.id === option.id);
          const unavailable = 'available' in option && !option.available;
          const managementLabel = picker === 'plugins' ? t("去启用") : 'managementBundle' in option && option.managementBundle ? t("去配置") : t("接入说明");
          const buttonLabel = unavailable ? managementLabel : selected ? t("已添加") : t("添加");
          return <li key={option.id}><span><strong>{option.name}</strong>{option.name !== option.id && <small>{option.id}</small>}{'source' in option && <small className="wf-capability-source">{t(skillSourceLabel(option.source))}</small>}{option.description && <small>{option.description}</small>}{unavailable && <small className="wf-capability-unavailable">{option.reason ? errorMessage(option.reason) : t("当前不可用")}</small>}</span>
            <button type="button" className="wf-button" aria-label={`${buttonLabel} ${option.name}`} disabled={selected && !unavailable} onClick={() => unavailable ? manage(picker, option) : add(picker, option)}>{buttonLabel}</button></li>;
        })}</ul>
        {!pickerError && options.length === 0 && <p className="wf-hint" role="status">{query.trim() ? t("没有匹配的项目。") : picker === 'plugins' ? t("暂无已安装插件。请先在 DSH 安装插件，再刷新。") : picker === 'mcps' ? t("暂无已配置 MCP。请先在 DSH 配置 MCP，再刷新。") : t("暂无可选 Skill。请先在 DSH 添加 Skill，再刷新。")}</p>}
      </>}
      </>}
    </dialog>}
  </section>;
}
