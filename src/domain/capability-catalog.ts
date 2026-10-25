import type { EmployeeModules } from './types.js';
/** Public registry metadata; no installation paths, provider handles or credentials. */
export interface EmployeeSkillOption { id: string; name: string; description: string; source: string }
export interface EmployeeToolOption {
  id: string; description: string;
  /** Installed and visible in the native preset. Actual execution follows native DSH policy. */
  available: boolean;
  reason?: string;
}
/** Installed package/server identity only; credentials and connection settings stay in DSH. */
export interface EmployeeIntegrationOption {
  id: string; name: string; description: string;
  available: boolean;
  reason?: string;
  /** Native management navigation only; never copied into employee capability references. */
  managementBundle?: string;
}
export interface EmployeeCapabilityCatalog {
  skills: EmployeeSkillOption[];
  plugins: EmployeeIntegrationOption[];
  mcps: EmployeeIntegrationOption[];
  pluginError?: string;
  mcpError?: string;
  defaultTools: EmployeeToolOption[];
  specialTools: EmployeeToolOption[];
  limitations: string[];
}

/** Display grouping only. This list never restricts native tool execution. */
export const NATIVE_DEFAULT_TOOLS = ['read', 'read_image', 'write', 'edit', 'glob', 'grep', 'bash', 'pwsh', 'terminal', 'web_search', 'web_fetch', 'skill', 'todo_write', 'ask_user_question', 'present'] as const;

/** @deprecated Employee preferences are not grants; native DSH owns execution policy. */
export function nativeToolEntitlement(id: string, _modules: EmployeeModules): boolean {
  return (NATIVE_DEFAULT_TOOLS as readonly string[]).includes(id);
}
