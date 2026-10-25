import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type { LocaleRuntime, LocaleSnapshot } from '@deepseek-ai/dsh-client-locale/client';
import { commonEn } from './locales/common.js';
import { libraryEn } from './locales/library.js';
import { workflowEn } from './locales/workflow.js';
import { knowledgeEn } from './locales/knowledge.js';
import { errorsEn } from './locales/errors.js';

export type UiLocale = 'zh' | 'en';
export type TranslationValues = Record<string, string | number>;
export type UiTranslate = (message: string, values?: TranslationValues) => string;
export const WORKFORCE_LOCALE_NAMESPACE = 'composable-workforce';
export const englishMessages: Readonly<Record<string, string>> = Object.freeze({ ...commonEn, ...libraryEn, ...workflowEn, ...knowledgeEn, ...errorsEn });
export const chineseMessages: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(Object.keys(englishMessages).map(key => [key, key])));

const interpolate = (message: string, values: TranslationValues = {}) => message.replace(/\{([A-Za-z][\w]*)\}/g, (token, name: string) => Object.hasOwn(values, name) ? String(values[name]) : token);
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Error matching is deliberately narrower than UI interpolation. An arbitrary
// external error ending in “步骤” must not match a decorative “{name}步骤” label.
const errorTemplates = Object.entries(errorsEn).filter(([key]) => /\{[A-Za-z][\w]*\}/.test(key)).map(([key, english]) => {
  const names: string[] = []; let end = 0; let expression = '^';
  for (const match of key.matchAll(/\{([A-Za-z][\w]*)\}/g)) {
    expression += escapeRegex(key.slice(end, match.index)) + '([\\s\\S]+?)'; names.push(match[1]!); end = match.index! + match[0].length;
  }
  return { expression: new RegExp(expression + escapeRegex(key.slice(end)) + '$'), names, english };
});

/** Also used for errors created before the host language changed. Never translate arbitrary document content. */
export function translateUiText(message: string, locale: UiLocale, values?: TranslationValues): string {
  if (locale === 'zh') return interpolate(message, values);
  const exact = Object.hasOwn(englishMessages, message) ? englishMessages[message] : undefined;
  if (exact !== undefined) return interpolate(exact, values);
  if (!values) for (const template of errorTemplates) {
    const match = template.expression.exec(message);
    if (match) return interpolate(template.english, Object.fromEntries(template.names.map((name, i) => {
      const value = match[i + 1]!;
      return [name, name === 'label' && Object.hasOwn(englishMessages, value) ? englishMessages[value]! : value];
    })));
  }
  return interpolate(message, values);
}

/** Honor the public host's fallback chain, including third-party language packs. */
export function workforceLocale(snapshot: Pick<LocaleSnapshot, 'active' | 'locales'>): UiLocale {
  let id: string | undefined = snapshot.active; const seen = new Set<string>();
  while (id && !seen.has(id)) {
    if (id === 'zh' || id === 'en') return id;
    seen.add(id); id = snapshot.locales.find(locale => locale.id === id)?.fallback;
  }
  return 'en';
}

export function createWorkforceI18n(runtime: Pick<LocaleRuntime, 'bind' | 'getSnapshot'>) {
  const bound = runtime.bind(WORKFORCE_LOCALE_NAMESPACE);
  const t: UiTranslate = (message, values) => bound(message, values);
  const errorMessage = (error: unknown) => translateUiText(error instanceof Error ? error.message : String(error), workforceLocale(runtime.getSnapshot()));
  return { t, errorMessage };
}

/** Register dictionaries only; this plugin never writes or stores a language preference. */
export function registerWorkforceLocales(runtime: Pick<LocaleRuntime, 'register'>): () => void {
  const disposers: Array<() => void> = [];
  try { disposers.push(runtime.register(WORKFORCE_LOCALE_NAMESPACE, 'zh', { ...chineseMessages })); disposers.push(runtime.register(WORKFORCE_LOCALE_NAMESPACE, 'en', { ...englishMessages })); }
  catch (error) { for (const dispose of disposers.reverse()) dispose(); throw error; }
  let disposed = false;
  return () => { if (disposed) return; disposed = true; for (const dispose of disposers.reverse()) dispose(); };
}

interface I18nValue { locale: UiLocale; t: UiTranslate; errorMessage(error: unknown): string }
const defaultValue: I18nValue = { locale: 'zh', t: (message, values) => interpolate(message, values), errorMessage: error => error instanceof Error ? error.message : String(error) };
const I18nContext = createContext<I18nValue>(defaultValue);
export function WorkforceI18nProvider({ runtime, children }: { runtime: LocaleRuntime; children: ReactNode }) {
  const snapshot = useSyncExternalStore(listener => runtime.subscribe(listener), () => runtime.getSnapshot(), () => runtime.getSnapshot());
  const value = useMemo(() => ({ ...createWorkforceI18n(runtime), locale: workforceLocale(snapshot) }), [runtime, snapshot]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
export function useI18n(): I18nValue { return useContext(I18nContext); }
