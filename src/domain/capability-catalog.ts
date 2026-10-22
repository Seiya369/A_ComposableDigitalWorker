import type { EmployeeModules } from './types.js';
/** Safe public inventory; no installation paths, provider handles or configuration. */
export interface EmployeeSkillOption {
  id: string;
  name: string;
  description: string;
  source: string;
}
export interface EmployeeToolOption {
  id: string;
  description: string;
  /** Whether this adapter can safely expose this installed tool. Permissions still apply. */
  available: boolean;
  reason?: string;
}
export interface EmployeeCapabilityCatalog {
  skills: EmployeeSkillOption[];
  defaultTools: EmployeeToolOption[];
  specialTools: EmployeeToolOption[];
  limitations: string[];
}

/** Shared adapter defaults; individual permissions may narrow these, never enlarge them. */
export const NATIVE_DEFAULT_TOOLS = ['read', 'read_image', 'write', 'edit', 'glob', 'grep', 'web_search', 'web_fetch', 'skill', 'todo_write', 'ask_user_question', 'present'] as const;
export const BASH_UNAVAILABLE = '当前官方 Bash 沙箱不能限制项目外读取或网络访问，无法兑现人员路径与网络权限，暂不开放。';
export const UNKNOWN_TOOL_UNAVAILABLE = '此工具尚未提供可由本插件验证的路径、网络和委派权限适配，暂不开放。';

/** One entitlement rule shared by editor and executor; path checks remain per operation. */
export function nativeToolEntitlement(id: string, modules: EmployeeModules): boolean {
  if (!(NATIVE_DEFAULT_TOOLS as readonly string[]).includes(id)) return false;
  const { permissions, capabilities } = modules;
  const legacy = (name: string): boolean => permissions.allowedTools.includes(name) && capabilities.tools.some(tool => tool.id === name);
  if (id === 'skill' || id === 'todo_write' || id === 'ask_user_question') return true;
  if (id === 'web_search' || id === 'web_fetch') return permissions.allowNetwork;
  if (id === 'write' || id === 'edit') return permissions.allowedTools.includes(id);
  if (permissions.allowedTools.includes(id)) return true;
  if (id === 'read' || id === 'read_image' || id === 'present') return legacy('worker_read_file');
  if (id === 'glob' || id === 'grep') return legacy('worker_list_files');
  return false;
}
