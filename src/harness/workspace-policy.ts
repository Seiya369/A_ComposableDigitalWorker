import { posix } from 'node:path';

/** Ordinary Chat workspaces support explicit employees, not project workflows.
 * Use the public workspace path so renaming its display title cannot change routing.
 */
export function conversationWorkflowsEnabled(workspace: { path: string }): boolean {
  const directory = posix.basename(posix.normalize(workspace.path.replaceAll('\\', '/')));
  return directory.toLowerCase() !== 'chat';
}
