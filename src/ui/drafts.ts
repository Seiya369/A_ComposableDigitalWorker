/** Unsaved UI state lives only in this plugin module, never in host storage. */
const drafts = new Map<string, unknown>();
let activeDraft: string | undefined;
export function readUiDraft<T>(key: string): T | undefined { const value = drafts.get(key); return value === undefined ? undefined : structuredClone(value) as T; }
export function writeUiDraft<T>(key: string, value: T): void { drafts.set(key, structuredClone(value)); }
export function activateUiDraft(key: string): void { activeDraft = key; }
export function removeUiDraft(key: string): void { drafts.delete(key); }
export function discardActiveUiDraft(): void { if (activeDraft) drafts.delete(activeDraft); }
/** Called by the public plugin disposal effect, together with UI subscription cleanup. */
export function clearWorkforceDrafts(): void { activeDraft = undefined; drafts.clear(); }
