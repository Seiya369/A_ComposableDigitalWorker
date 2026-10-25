import { useEffect, useMemo, useRef, useState } from 'react';
import type { KnowledgeCitation, KnowledgeSource } from '../knowledge/types.js';
import type { KnowledgeLibraryTarget, KnowledgeLibraryView } from '../knowledge/library-api.js';
import type { WikiLibraryView } from '../knowledge/wiki-types.js';
import type { WorkforceClient } from './client.js';

import { useI18n } from './i18n.js';

const NAMESPACE = 'workforce-llm-wiki';
const PROTOCOL_VERSION = 1;
type Theme = { mode: 'light' | 'dark'; colors: { background: string; text: string; border: string } };
interface Binding { channel: string; epoch: number; spaceId: string; version: number }
interface LoadedWiki { context: object; dataKey: string; view: WikiLibraryView }
interface SharedWikiGraphProps {
  client: Pick<WorkforceClient, 'knowledgeWiki' | 'knowledgeSource'>; target: KnowledgeLibraryTarget; library: KnowledgeLibraryView;
  onRebuild?: () => void; rebuilding?: boolean;
}
const citationKey = (c: KnowledgeCitation) => JSON.stringify([c.sourceId, c.sourceVersion, c.startLine, c.endLine]);
const citationsFor = (view: WikiLibraryView) => new Set([...view.pages.flatMap(page => page.citations), ...view.graph.edges.flatMap(edge => (edge.relations ?? []).flatMap(relation => relation.citations))].map(citationKey));

/** The separately licensed Wiki is loaded once per viewer from one shared program URL. */
export function SharedWikiGraph({ client, target, library, onRebuild, rebuilding }: SharedWikiGraphProps) {
  const { t, locale, errorMessage } = useI18n();
  const holder = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const targetKey = JSON.stringify([target.scope, target.projectId, target.employeeId, target.library, target.teamId]);
  const context = useMemo(() => ({}), [client, targetKey]);
  const dataKey = JSON.stringify([library.snapshot?.version ?? 0, library.enabled, library.sources.map(source => [source.id, source.version])]);
  const [loaded, setLoaded] = useState<LoadedWiki>();
  const [error, setError] = useState<unknown>('');
  const [revision, setRevision] = useState(0);
  const [ready, setReady] = useState(false);
  const initialized = useRef(false);
  const [theme, setTheme] = useState<Theme>({ mode: 'light', colors: { background: '#fafbfd', text: '#263142', border: '#e0e5ec' } });
  const channel = useRef(crypto.randomUUID());
  const epoch = useRef(0);
  const previousBinding = useRef('');
  const latestRead = useRef(0);
  const wiki = loaded?.context === context && loaded.dataKey === dataKey ? loaded.view : undefined;
  const bindingId = wiki ? JSON.stringify([targetKey, wiki.spaceId, wiki.version, dataKey]) : '';
  if (bindingId !== previousBinding.current) { epoch.current++; previousBinding.current = bindingId; }
  const binding: Binding | undefined = wiki ? { channel: channel.current, epoch: epoch.current, spaceId: wiki.spaceId, version: wiki.version } : undefined;
  const active = useRef({ context, client, target, wiki, binding, library, onRebuild, rebuilding, theme, locale });
  active.current = { context, client, target, wiki, binding, library, onRebuild, rebuilding, theme, locale };

  useEffect(() => {
    let current = true; const requestId = ++latestRead.current;
    setError('');
    if (client.knowledgeWiki) void client.knowledgeWiki(target).then(view => {
      if (current && requestId === latestRead.current) setLoaded({ context, dataKey, view });
    }).catch(reason => { if (current && requestId === latestRead.current) setError(reason); });
    return () => { current = false; };
  }, [client, targetKey, dataKey, revision]);

  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    let animation: number | undefined;
    const sync = () => {
      const style = getComputedStyle(element);
      const background = style.backgroundColor;
      const rgb = /rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/.exec(background);
      const dark = style.colorScheme === 'dark' || style.colorScheme !== 'light' && !!rgb && (+rgb[1] * .2126 + +rgb[2] * .7152 + +rgb[3] * .0722) < 128;
      const next: Theme = { mode: dark ? 'dark' : 'light', colors: { background, text: style.color, border: style.borderTopColor } };
      setTheme(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const observer = new MutationObserver(() => { if (animation === undefined) animation = requestAnimationFrame(() => { animation = undefined; sync(); }); });
    observer.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['class', 'style', 'data-theme'] });
    const media = window.matchMedia('(prefers-color-scheme: dark)'); media.addEventListener('change', sync); sync();
    return () => { observer.disconnect(); media.removeEventListener('change', sync); if (animation !== undefined) cancelAnimationFrame(animation); };
  }, []);

  const postView = (type: 'init' | 'update') => {
    const current = active.current;
    if (!current.wiki || !current.binding) return;
    frame.current?.contentWindow?.postMessage({ namespace: NAMESPACE, protocolVersion: PROTOCOL_VERSION, type: initialized.current ? type : 'init',
      channel: current.binding.channel, epoch: current.binding.epoch,
      view: { ...current.wiki, status: current.library.status }, theme: current.theme, locale: current.locale,
      rebuilding: !!current.rebuilding, canRebuild: !!current.onRebuild && current.library.enabled,
    }, '*');
    initialized.current = true;
  };
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== 'null') return;
      const message = event.data;
      if (!message || typeof message !== 'object' || message.namespace !== NAMESPACE || message.protocolVersion !== PROTOCOL_VERSION) return;
      if (message.type === 'ready') { setReady(true); postView('init'); return; }
      const current = active.current; const bound = current.binding;
      if (!bound || message.channel !== bound.channel || message.epoch !== bound.epoch || message.spaceId !== bound.spaceId || message.version !== bound.version) return;
      if (message.type === 'rebuild-request') {
        if (current.library.enabled && !current.rebuilding && current.library.status.state !== 'compiling') current.onRebuild?.();
      } else if (message.type === 'source-request') {
        const citation = message.citation as KnowledgeCitation | undefined;
        if (!citation || typeof citation.sourceId !== 'string' || !Number.isSafeInteger(citation.sourceVersion)
          || !Number.isSafeInteger(citation.startLine) || citation.startLine < 1 || !Number.isSafeInteger(citation.endLine) || citation.endLine < citation.startLine
          || typeof message.requestId !== 'string' || message.requestId.length > 128 || !current.wiki || !citationsFor(current.wiki).has(citationKey(citation))) return;
        if (!current.library.sources.some(item => item.id === citation.sourceId)) return;
        const exactSource = current.library.sources.find(item => item.id === citation.sourceId && item.version === citation.sourceVersion);
        const requestContext = current.context;
        const stillAuthorized = () => {
          const latest = active.current; const latestBinding = latest.binding;
          return latest.context === requestContext && !!latestBinding && latestBinding.channel === bound.channel
            && latestBinding.epoch === bound.epoch && latestBinding.spaceId === bound.spaceId && latestBinding.version === bound.version
            && latest.wiki?.spaceId === bound.spaceId && latest.wiki.version === bound.version
            && latest.library.sources.some(item => item.id === citation.sourceId)
            && citationsFor(latest.wiki).has(citationKey(citation));
        };
        const respond = (source?: KnowledgeSource) => {
          if (!stillAuthorized()) return;
          const valid = source?.id === citation.sourceId && source.version === citation.sourceVersion
            && typeof source.text === 'string' && citation.endLine <= source.text.split('\n').length;
          frame.current?.contentWindow?.postMessage({ namespace: NAMESPACE, protocolVersion: PROTOCOL_VERSION, type: 'source-response', ...bound,
            requestId: message.requestId, citation,
            ...(valid ? { source: { id: source.id, version: source.version, title: source.title, text: source.text } } : { error: '原始资料暂不可用' }),
          }, '*');
        };
        if (exactSource) respond(exactSource);
        else if (current.client.knowledgeSource) void current.client.knowledgeSource(current.target, citation.sourceId, citation.sourceVersion)
          .then(respond).catch(() => respond());
        else respond();
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);
  useEffect(() => { if (ready && wiki) postView('update'); }, [ready, wiki, library.status, rebuilding, onRebuild, theme, locale]);

  return <div className="wf-shared-wiki" ref={holder} aria-busy={!wiki && !error}>
    {!wiki && <div className="wf-shared-wiki-status" role={error ? 'alert' : 'status'}>{error ? errorMessage(error) : t('正在读取知识图谱…')}{Boolean(error) && <button type="button" className="wf-button" onClick={() => setRevision(value => value + 1)}>{t("重试")}</button>}</div>}
    <iframe ref={frame} title={t("Wiki知识图谱")} src="/digital-workers/api/wiki" sandbox="allow-scripts" referrerPolicy="no-referrer" hidden={!wiki}
      onLoad={() => { initialized.current = false; setReady(true); postView('init'); }} />
  </div>;
}
