/** GPL-3.0 adapter: only the current authorized in-memory Wiki can be read. */
export interface VirtualFile { name: string; path: string; is_dir: boolean; children?: VirtualFile[] }
let root = '';
let files = new Map<string, { id: string; markdown: string }>();
let revision = 0;

export function installWikiFiles(projectRoot: string, values: ReadonlyArray<{ id: string; path: string; markdown: string }>): void {
  root = `${projectRoot}/wiki`;
  const next = new Map<string, { id: string; markdown: string }>();
  for (const file of values) {
    if (!/^p-[a-f0-9]{64}$/.test(file.id) || !/^wiki\/(entities|concepts|sources|synthesis)\/p-[a-f0-9]{64}\.md$|^wiki\/overview\.md$/.test(file.path)) {
      throw new Error('Invalid virtual Wiki path');
    }
    const fullPath = `${projectRoot}/${file.path}`;
    if (next.has(fullPath)) throw new Error('Duplicate virtual Wiki page');
    next.set(fullPath, { id: file.id, markdown: file.markdown });
  }
  files = next;
  revision += 1;
}
export function clearWikiFiles(): void { root = ''; files.clear(); }
export async function readFile(path: string): Promise<string> {
  const value = files.get(path);
  if (value === undefined) throw new Error('Wiki path is outside the authorized snapshot');
  return value.markdown;
}
export async function listDirectory(path: string): Promise<VirtualFile[]> {
  if (!root || path !== root) throw new Error('Wiki directory is outside the authorized snapshot');
  return [...files].map(([file, value]) => ({ name: `${value.id}.md`, path: file, is_dir: false }));
}
export const useWikiStore = { getState: () => ({ dataVersion: revision }) };
