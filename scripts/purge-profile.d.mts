export const pluginName: 'dsh-plugin-composable-workforce';
interface FileIdentity { path: string; dev: number; ino: number }
interface KnowledgeTree {
  statePath: string; root: string; canonicalRoot?: string; absent?: boolean;
  directories?: FileIdentity[]; files?: Array<FileIdentity & { sha256: string }>;
}
export interface PurgePlan {
  home: string; profile: string; serviceRoot?: string;
  files: Array<{ path: string; sha256: string }>;
  knowledgeTrees: KnowledgeTree[];
  logs: string[];
  patches: Array<{ path: string; text?: string; next?: string; statePaths: string[]; count: number }>;
}
export function planPurge(options: { home: string; profile?: string; ownedStatePath?: string; serviceRoot?: string }): Promise<PurgePlan>;
export function applyPurge(plan: PurgePlan): Promise<{
  removedState: string[]; removedKnowledge: string[]; removedConfigRows: number;
  removedLogs: string[]; preserved: string[];
}>;
