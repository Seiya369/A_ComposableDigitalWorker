/** Optional declarations inside a delivery snapshot; acceptance is supplied separately by the workflow. */
export const CONFIRMED_ITEMS_MEDIA_TYPE = 'application/vnd.composable-workforce.confirmed-items+json';
export const CONFIRMED_ITEMS_FILE_SUFFIX = '.confirmed-items.json';
export const CONFIRMED_ITEMS_LIMITS = { documentCharacters: 100_000, items: 50, idCharacters: 120, titleCharacters: 240, contentCharacters: 20_000 } as const;

export interface ConfirmedItemDeclaration { id: string; title: string; content: string }

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const text = (value: unknown, maximum: number): value is string => typeof value === 'string' && !!value.trim() && value.length <= maximum;

/** Invalid or oversized declarations remain ordinary readable artifacts, never confirmed items. */
export function parseConfirmedItemDeclarations(artifact: { mediaType?: string; content?: string }): ConfirmedItemDeclaration[] | undefined {
  if (artifact.mediaType !== CONFIRMED_ITEMS_MEDIA_TYPE || typeof artifact.content !== 'string'
    || artifact.content.length > CONFIRMED_ITEMS_LIMITS.documentCharacters) return undefined;
  let value: unknown;
  try { value = JSON.parse(artifact.content); } catch { return undefined; }
  if (!object(value) || !keys(value, ['schemaVersion', 'items']) || value.schemaVersion !== 1
    || !Array.isArray(value.items) || value.items.length > CONFIRMED_ITEMS_LIMITS.items) return undefined;
  const ids = new Set<string>();
  const result: ConfirmedItemDeclaration[] = [];
  for (const item of value.items) {
    if (!object(item) || !keys(item, ['id', 'title', 'content']) || !text(item.id, CONFIRMED_ITEMS_LIMITS.idCharacters)
      || item.id.trim() !== item.id || /[\u0000-\u001f\u007f]/.test(item.id) || ids.has(item.id)
      || !text(item.title, CONFIRMED_ITEMS_LIMITS.titleCharacters) || !text(item.content, CONFIRMED_ITEMS_LIMITS.contentCharacters)) return undefined;
    ids.add(item.id); result.push({ id: item.id, title: item.title, content: item.content });
  }
  return result;
}
