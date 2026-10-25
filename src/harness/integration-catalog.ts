import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/cordis-plugin-loader';
import type {} from '@deepseek-ai/dsh-plugin-manager';
import type { BundleInfo } from '@deepseek-ai/dsh-plugin-manager';
import type {} from '@deepseek-ai/dsh-agent-preset-registry';
import { parseDocument } from 'yaml';
import type { EmployeeCapabilityCatalog, EmployeeIntegrationOption } from '../domain/capability-catalog.js';

type IntegrationCatalog = Pick<EmployeeCapabilityCatalog, 'plugins' | 'mcps' | 'pluginError' | 'mcpError'>;
const MCP_MODULE = '@deepseek-ai/dsh-mcp-client';
const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/;
const dynamic = Symbol('unevaluated-loader-expression');
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
interface ConfiguredMcp { id: string; enabled: boolean; entryId?: string }

/** Read only literal identity fields; never evaluate a Loader expression or expose connection settings. */
function declaredMcps(rows: unknown, outerEnabled = true): { entries: ConfiguredMcp[]; incomplete: boolean } {
  const entries: ConfiguredMcp[] = [];
  let incomplete = false;
  if (!Array.isArray(rows)) return { entries, incomplete: true };
  for (const value of rows) {
    const row = object(value); if (!row) { incomplete = true; continue; }
    const disabled = row.disabled;
    const enabled = outerEnabled && !disabled;
    if (row.group === true) {
      const children = declaredMcps(row.config, enabled);
      entries.push(...children.entries); incomplete ||= children.incomplete || (children.entries.length > 0 && (disabled === dynamic || !!object(disabled)));
      continue;
    }
    if (row.name !== MCP_MODULE) continue;
    const config = object(row.config);
    if (typeof config?.serverName !== 'string' || !SERVER_NAME.test(config.serverName)) { incomplete = true; continue; }
    entries.push({ id: config.serverName, enabled });
    if (disabled === dynamic || object(disabled)) incomplete = true;
  }
  return { entries, incomplete };
}

async function installedBundles(ctx: Context): Promise<BundleInfo[]> {
  const manager = ctx.get('pluginManager');
  if (!manager) throw new Error('unavailable');
  return manager.listBundles();
}

function installedPlugins(bundles: readonly BundleInfo[]): EmployeeIntegrationOption[] {
  return bundles.filter(bundle => bundle.availability !== 'missing').map(bundle => ({
    id: bundle.name, name: bundle.name, description: bundle.description ?? '',
    available: bundle.enabled && !bundle.error,
    ...(!bundle.enabled ? { reason: '尚未启用，请先在 DSH 中启用' } : bundle.error ? { reason: 'DSH 插件当前不可用' } : {}),
  }));
}

/** Bundle row entry IDs and Loader Entry.id are the same public inventory identity. */
function managementOwners(bundles: readonly BundleInfo[]): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();
  for (const bundle of bundles) {
    if (bundle.availability === 'missing' || !bundle.enabled || bundle.error) continue;
    for (const row of bundle.rows ?? []) {
      if (row.moduleName !== MCP_MODULE || !row.entryId) continue;
      const names = owners.get(row.entryId) ?? new Set<string>();
      names.add(bundle.name); owners.set(row.entryId, names);
    }
  }
  return owners;
}

async function configuredMcps(ctx: Context, visibleTools: readonly string[], bundles: Promise<readonly BundleInfo[]>): Promise<Pick<IntegrationCatalog, 'mcps' | 'mcpError'>> {
  const entries: ConfiguredMcp[] = [];
  let read = false, incomplete = false;
  const loader = ctx.get('loader');
  if (loader) {
    try {
      // PresetTree deliberately stays outside the Host Loader tree; it is read separately below.
      for (const entry of loader.entries()) {
        if (entry.options.name !== MCP_MODULE) continue;
        const config = object(entry.options.config);
        if (typeof config?.serverName !== 'string' || !SERVER_NAME.test(config.serverName)) { incomplete = true; continue; }
        entries.push({ id: config.serverName, enabled: !entry.disabled, entryId: entry.id });
      }
      read = true;
    } catch { incomplete = true; }
  } else incomplete = true;
  const presets = ctx.get('agentPresets');
  if (presets) {
    try {
      const document = await presets.readDocument(presets.defaultId);
      // This tag handler is data-only. In particular, an expression which happens to look like a
      // valid server name remains a marker, never an installed MCP identity.
      const parsed = parseDocument(document.content, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: () => dynamic }] });
      if (parsed.errors.length || parsed.warnings.length) throw new Error('invalid declaration');
      const declared = declaredMcps(parsed.toJS({ maxAliasCount: 50 }));
      entries.push(...declared.entries); incomplete ||= declared.incomplete;
      read = true;
    } catch { incomplete = true; }
  }
  const configured = new Map<string, boolean>();
  for (const entry of entries) configured.set(entry.id, entry.enabled || configured.get(entry.id) === true);
  const owners = managementOwners(await bundles);
  const targetFor = (id: string): string | undefined => {
    // A user patch or a second preset declaration with the same service name makes the
    // effective owner ambiguous. Do not redirect to the owner of only one declaration.
    const declarations = entries.filter(entry => entry.id === id);
    const targets = declarations.map(entry => entry.entryId ? owners.get(entry.entryId) : undefined);
    if (targets.some(names => names?.size !== 1)) return undefined;
    const names = new Set(targets.flatMap(target => [...target!]));
    return names.size === 1 ? [...names][0] : undefined;
  };
  // Match known, exact configured namespaces longest-first. Never infer a server by splitting
  // a tool name: both server names and upstream tool names may themselves contain "__".
  const names = [...configured].filter(([, enabled]) => enabled).map(([name]) => name).sort((a, b) => b.length - a.length);
  const visible = new Set<string>();
  for (const tool of visibleTools) {
    const name = names.find(candidate => tool.startsWith(`mcp__${candidate}__`));
    if (name) visible.add(name);
  }
  const mcps = [...configured].map(([id, enabled]) => {
    const managementBundle = targetFor(id);
    return {
      id, name: id, description: '', available: enabled && visible.has(id),
      ...(managementBundle ? { managementBundle } : {}),
      ...(!enabled ? { reason: '尚未启用，请先在 DSH 中启用' } : !visible.has(id) ? { reason: '当前预设未提供此 MCP 的工具，请检查 DSH 连接配置' } : {}),
    };
  });
  return { mcps, ...(!read ? { mcpError: 'DSH MCP 目录服务不可用，请检查 DSH 配置后重试' } : incomplete ? { mcpError: 'MCP 目录仅显示已读取的明确配置；部分服务或动态配置无法读取' } : {}) };
}

/** Independent safe projections: one unavailable integration service does not hide the other. */
export async function listEmployeeIntegrations(ctx: Context, visibleTools: readonly string[]): Promise<IntegrationCatalog> {
  const bundles = installedBundles(ctx);
  const [plugins, mcps] = await Promise.allSettled([
    bundles.then(installedPlugins),
    configuredMcps(ctx, visibleTools, bundles.catch(() => [])),
  ]);
  return {
    ...(plugins.status === 'fulfilled' ? { plugins: plugins.value } : { plugins: [], pluginError: '无法读取 DSH 已安装插件，请检查插件管理服务后重试' }),
    ...(mcps.status === 'fulfilled' ? mcps.value : { mcps: [], mcpError: '无法读取 DSH MCP 配置，请稍后重试' }),
  };
}
