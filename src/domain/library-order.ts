import type { WorkforceState } from './types.js';
import { invariant } from './validation.js';

export type LibraryKind = 'employee' | 'team' | 'workflow';
export interface ReorderLibraryInput { kind: LibraryKind; orderedIds: string[] }

/** A filtered list may reorder its occupied slots without moving hidden records. */
export function mergeVisibleOrder(allIds: string[], visibleIds: string[]): string[] {
  const visible = new Set(visibleIds);
  let index = 0;
  return allIds.map(id => visible.has(id) ? visibleIds[index++]! : id);
}

/** Reordering changes presentation only: identities, versions and snapshots stay intact. */
export function reorderLibrary(state: WorkforceState, input: ReorderLibraryInput): void {
  invariant(input && typeof input === 'object' && ['employee', 'team', 'workflow'].includes(input.kind), '排序对象必须为自由职业人库、团队或工作流');
  const rows = input.kind === 'employee' ? state.templates.filter(row => row.status !== 'archived') : input.kind === 'team' ? state.teams : state.workflowTemplates ?? [];
  invariant(Array.isArray(input.orderedIds) && input.orderedIds.every(id => typeof id === 'string'), '排序必须提供完整 ID 列表');
  const ids = new Set(input.orderedIds);
  invariant(ids.size === input.orderedIds.length && ids.size === rows.length && rows.every(row => ids.has(row.id)), '排序列表已改变或包含重复、缺失、跨库记录，请刷新后重试');
  const byId = new Map(rows.map(row => [row.id, row]));
  if (input.kind === 'employee') {
    let index = 0;
    state.templates = state.templates.map(row => row.status === 'archived' ? row : byId.get(input.orderedIds[index++]!) as typeof row);
  } else if (input.kind === 'team') state.teams = input.orderedIds.map(id => byId.get(id) as WorkforceState['teams'][number]);
  else if (state.workflowTemplates) state.workflowTemplates = input.orderedIds.map(id => byId.get(id) as NonNullable<WorkforceState['workflowTemplates']>[number]);
}
