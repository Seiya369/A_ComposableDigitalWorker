import type { EmployeeModules } from '../domain/types.js';

/** Apply a persisted source removal without discarding unrelated, unsaved employee edits. */
export function mergeKnowledgeSourceRemoval(draft: EmployeeModules, previous: EmployeeModules, saved: EmployeeModules): EmployeeModules {
  const remaining = new Set(saved.knowledge.sources.map(source => source.id));
  const removed = new Set(previous.knowledge.sources.filter(source => !remaining.has(source.id)).map(source => source.id));
  return { ...draft, knowledge: { ...draft.knowledge, sources: draft.knowledge.sources.filter(source => !removed.has(source.id)) } };
}
