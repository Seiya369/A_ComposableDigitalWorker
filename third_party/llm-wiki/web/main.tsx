/* SPDX-License-Identifier: GPL-3.0-only
 * Shared, sandboxed web entry. No Tauri runtime, filesystem, model key or write API.
 */
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NAMESPACE, PROTOCOL_VERSION, bindingMatches, isParentUpdate, semanticGraphForDisplay, validCitation, type Binding, type ParentUpdate, type SourceResponse, type Theme, type WikiView } from './protocol.js';
import { TYPE_COLORS, TYPE_LABELS } from './graph-style.js';
import { WikiNetwork } from './WikiNetwork.js';
import { WikiReader, type GraphSelection, type ReaderSelection, type SourceState } from './WikiReader.js';
import { startSemanticExploration, projectSemanticExploration, expandSemanticExploration, visibleSemanticNodeIds, type SemanticExploration } from './graph-focus.js';
import './styles.css';
import { WikiI18nProvider, wikiI18n, type WikiLocale } from './i18n.js';

interface State { locale: WikiLocale; view: WikiView; theme: Theme; binding: Binding; rebuilding: boolean; canRebuild: boolean }
function send(type: string, fields: object = {}) {
  window.parent.postMessage({ namespace: NAMESPACE, protocolVersion: PROTOCOL_VERSION, type, ...fields }, '*');
}

function SharedWiki() {
  const [state, setState] = useState<State>();
  const { t } = wikiI18n(state?.locale ?? 'zh');
  const current = useRef<State>(); current.current = state;
  const channel = useRef<string>();
  const [selection, setSelection] = useState<ReaderSelection>();
  const [graphSelection, setGraphSelection] = useState<GraphSelection>();
  const [exploration, setExploration] = useState<SemanticExploration>();
  const [focusRequest, setFocusRequest] = useState<{ id: string; nonce: number; nodeIds?: readonly string[] }>();
  const focusNonce = useRef(0);
  const [source, setSource] = useState<SourceState>();
  const request = useRef<SourceState>(); request.current = source;
  const [colorMode, setColorMode] = useState<'type' | 'community'>('community');
  const [hiddenTypes, setHiddenTypes] = useState(new Set<string>());
  const [query, setQuery] = useState('');
  const bindingKey = state ? JSON.stringify([state.binding.epoch, state.binding.spaceId, state.binding.version]) : '';
  useEffect(() => {
    const view = current.current?.view;
    setSelection(view && !view.graph.nodes.length && view.pages.some(page => page.type === 'synthesis') ? { kind: 'directory' } : undefined);
    setGraphSelection(undefined); setExploration(undefined); setFocusRequest(undefined); setSource(undefined); setQuery(''); setHiddenTypes(new Set()); setColorMode('community');
  }, [bindingKey]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      if (isParentUpdate(event.data)) {
        const message: ParentUpdate = event.data;
        if (channel.current && message.channel !== channel.current) return;
        const previous = current.current;
        if (previous && (message.epoch < previous.binding.epoch || message.epoch === previous.binding.epoch
          && (message.view.spaceId !== previous.binding.spaceId || message.view.version !== previous.binding.version))) return;
        channel.current = message.channel;
        const binding = { channel: message.channel, epoch: message.epoch, spaceId: message.view.spaceId, version: message.view.version };
        const next = { locale: message.locale ?? 'zh', view: { ...message.view, graph: semanticGraphForDisplay(message.view) }, theme: message.theme, binding, rebuilding: !!message.rebuilding, canRebuild: !!message.canRebuild };
        current.current = next; setState(next); send('ack', binding);
      } else if (event.data?.namespace === NAMESPACE && event.data.protocolVersion === PROTOCOL_VERSION && event.data.type === 'source-response') {
        const response = event.data as SourceResponse; const pending = request.current; const active = current.current;
        if (!active || !pending || !bindingMatches(response, active.binding) || response.requestId !== pending.requestId
          || !validCitation(response.citation) || JSON.stringify(response.citation) !== JSON.stringify(pending.citation)) return;
        const returned = response.source;
        if (returned && (returned.id !== pending.citation.sourceId || returned.version !== pending.citation.sourceVersion
          || typeof returned.text !== 'string' || typeof returned.title !== 'string')) return;
        setSource({ ...pending, source: returned, error: returned ? undefined : typeof response.error === 'string' ? response.error : '原始资料暂不可用' });
      }
    };
    window.addEventListener('message', receive); send('ready');
    return () => window.removeEventListener('message', receive);
  }, []);
  useEffect(() => {
    if (!state) return;
    document.documentElement.dataset.theme = state.theme.mode;
    document.documentElement.lang = state.locale === 'en' ? 'en' : 'zh-CN';
    const colors = state.theme.colors;
    for (const [property, value] of Object.entries({ '--wiki-bg': colors?.background, '--wiki-text': colors?.text, '--wiki-line': colors?.border })) {
      if (value && CSS.supports('color', value) && !value.includes('var(')) document.documentElement.style.setProperty(property, value);
      else document.documentElement.style.removeProperty(property);
    }
  }, [state?.theme, state?.locale]);

  if (!state) return <div className="wiki-loading" role="status">{t("正在读取知识图谱…")}</div>;
  const { view } = state;
  const counts = view.graph.nodes.reduce<Record<string, number>>((all, node) => { all[node.type] = (all[node.type] ?? 0) + 1; return all; }, {});
  const semanticRelationCount = view.graph.edges.reduce((total, edge) => total + (edge.relations?.length ?? 0), 0);
  const nodeStats = [counts.concept ? counts.concept === 1 ? t('1 概念') : t('{count} 概念', { count: counts.concept }) : '', counts.entity ? counts.entity === 1 ? t('1 实体') : t('{count} 实体', { count: counts.entity }) : ''].filter(Boolean);
  if (!nodeStats.length) nodeStats.push(t('{count} 概念', { count: 0 }));
  const hasArticles = view.pages.some(page => page.type === 'synthesis');
  const selectedNode = graphSelection?.kind === 'node' ? graphSelection.id : undefined;
  const selectedEdge = graphSelection?.kind === 'edge' ? graphSelection.id : undefined;
  const visibleIds = visibleSemanticNodeIds(view, hiddenTypes, query, selectedNode);
  const projected = projectSemanticExploration(view, exploration, visibleIds);
  const initialExploration = selectedNode ? startSemanticExploration(view, selectedNode, visibleIds) : undefined;
  const initialProjection = projectSemanticExploration(view, initialExploration, visibleIds);
  const readerExploration = initialExploration ? {
    count: Math.max(0, (exploration ? projected : initialProjection).nodeIds.size - 1),
    active: !!projected.rootId,
    canExpand: exploration ? projected.canExpand : initialProjection.nodeIds.size > 1,
    onExpand: () => {
      const next = exploration ? expandSemanticExploration(view, exploration, visibleIds) : initialExploration;
      const nextProjection = projectSemanticExploration(view, next, visibleIds);
      if (!next || !nextProjection.rootId || nextProjection.nodeIds.size < 2) return;
      setExploration(next);
      setFocusRequest({ id: nextProjection.rootId, nonce: ++focusNonce.current, nodeIds: [...nextProjection.nodeIds] });
    },
  } : undefined;
  const locate = (id: string) => setFocusRequest({ id, nonce: ++focusNonce.current });
  const openPage = (id: string) => {
    const page = view.pages.find(item => item.id === id);
    if (!page) return;
    setSource(undefined); setSelection({ kind: 'page', id });
    if (view.graph.nodes.some(node => node.id === id)) {
      if (graphSelection?.kind !== 'node' || graphSelection.id !== id) setExploration(undefined);
      setGraphSelection({ kind: 'node', id });
    } else if (graphSelection) {
      const entryIds = graphSelection.kind === 'node' ? [
        ...(view.pages.find(item => item.id === graphSelection.id)?.entryIds ?? []),
        ...view.graph.edges.filter(edge => edge.source === graphSelection.id || edge.target === graphSelection.id)
          .flatMap(edge => edge.relations?.flatMap(relation => relation.entryIds) ?? []),
      ]
        : view.graph.edges.find(edge => edge.id === graphSelection.id)?.relations?.flatMap(relation => relation.entryIds) ?? [];
      if (!page.entryIds.some(entryId => entryIds.includes(entryId))) { setGraphSelection(undefined); setExploration(undefined); }
    }
  };
  const openEdge = (id: string) => {
    if (!view.graph.edges.some(edge => edge.id === id)) return;
    setSource(undefined); setSelection({ kind: 'edge', id }); setGraphSelection({ kind: 'edge', id }); setExploration(undefined);
  };
  const clearSelection = () => { setSelection(undefined); setGraphSelection(undefined); setExploration(undefined); setSource(undefined); };
  const changeQuery = (text: string) => {
    setQuery(text); setGraphSelection(undefined); setExploration(undefined);
    if (!text.trim()) locate('');
  };
  const toggleType = (type: string) => {
    setHiddenTypes(previous => { const next = new Set(previous); if (next.has(type)) next.delete(type); else next.add(type); return next; });
    setExploration(undefined); setGraphSelection(undefined);
  };
  const openSource = (citation: SourceState['citation']) => {
    const next = { requestId: crypto.randomUUID(), citation };
    request.current = next; setSource(next); send('source-request', { ...state.binding, ...next });
  };
  const busy = state.rebuilding || view.status.state === 'compiling';
  const emptyText = busy ? '正在整理知识图谱…' : hasArticles ? '暂无概念图谱' : view.status.state === 'failed' ? '知识整理失败'
    : view.status.state === 'empty' ? '暂无概念图谱' : '概念图谱待整理';
  return <WikiI18nProvider locale={state.locale}><section className="wiki-app" aria-label={t("Wiki知识图谱")} data-space-id={view.spaceId} data-version={view.version}
    data-exploration-root={projected.rootId ?? ''} data-exploration-depth={projected.depth}
    onKeyDown={event => { if (event.key === 'Escape') { if (source) setSource(undefined); else if (selection) setSelection(undefined); else { setGraphSelection(undefined); setExploration(undefined); } } }}>
    <header className="wiki-toolbar"><strong>{t("知识图谱")}</strong>
      <div className="wiki-color-mode" role="group" aria-label={t("图谱着色")}><button type="button" aria-pressed={colorMode === 'type'} onClick={() => setColorMode('type')}>{t("节点类别")}</button><button type="button" aria-pressed={colorMode === 'community'} onClick={() => setColorMode('community')}>{t("知识分组")}</button></div>
      <span className="wiki-stats">{[...nodeStats, semanticRelationCount === 1 ? t('1 语义关系') : t('{count} 语义关系', { count: semanticRelationCount })].join(' · ')}</span>
      <div className="wiki-toolbar-end"><input type="search" aria-label={t("搜索知识")} placeholder={t("搜索知识")} value={query} onChange={event => changeQuery(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') {
          event.preventDefault(); const text = query.trim().toLocaleLowerCase();
          const node = view.graph.nodes.find(item => !hiddenTypes.has(item.type) && [item.label, ...(view.pages.find(p => p.id === item.id)?.aliases ?? [])].some(value => value.toLocaleLowerCase().includes(text)));
          if (node) { openPage(node.id); locate(node.id); }
        } else if (event.key === 'Escape') { event.stopPropagation(); changeQuery(''); } }} />
        {view.status.state === 'failed' && <span className="wiki-failed" role="status">{t("整理失败")}</span>}
        {state.canRebuild && <button type="button" className="wiki-rebuild" aria-label={t("重新整理图谱")} title={t(busy ? '正在整理' : view.status.state === 'failed' ? '整理失败，点击重试' : '重新整理')} disabled={busy} onClick={() => send('rebuild-request', state.binding)}>{busy ? t('整理中…') : '↻'}</button>}
      </div>
    </header>
    <div className="wiki-body"><div className="wiki-network-area">
      <WikiNetwork key={`${view.spaceId}:${view.version}`} view={view} colorMode={colorMode} hiddenTypes={hiddenTypes} query={query} dark={state.theme.mode === 'dark'} selectedNode={selectedNode} selectedEdge={selectedEdge} focusRequest={focusRequest}
        explorationNodeIds={projected.rootId ? [...projected.nodeIds] : undefined}
        onNode={openPage} onEdge={openEdge} onClear={clearSelection} onOverview={() => { clearSelection(); setQuery(''); setHiddenTypes(new Set()); locate(''); }} />
      {!view.graph.nodes.length && <div className="wiki-network-empty" role="status">{t(emptyText)}</div>}
      {view.graph.nodes.length > 0 && <div className="wiki-legend" role="group" aria-label={t(colorMode === 'type' ? '节点类别' : '知识分组')}>
        {colorMode === 'type' ? Object.entries(counts).map(([type, count]) => <button type="button" key={type} aria-label={t(hiddenTypes.has(type) ? '显示{type}' : '隐藏{type}', { type: t(TYPE_LABELS[type] ?? type) })} aria-pressed={!hiddenTypes.has(type)} onClick={() => toggleType(type)}><span className="wiki-type-dot" style={{ background: TYPE_COLORS[type] ?? '#94a3b8' }} /><span>{t(TYPE_LABELS[type] ?? type)}</span><small>{count}</small></button>)
          : view.graph.communities.map(community => <div key={community.id}><span className="wiki-community-dot" style={{ background: ['#60a5fa', '#4ade80', '#fb923c', '#c084fc', '#f87171', '#2dd4bf', '#facc15', '#f472b6', '#a78bfa', '#38bdf8', '#34d399', '#fbbf24'][community.id % 12] }} /><span title={community.topNodes.join('、')}>{community.topNodes[0] ?? t('分组 {number}', { number: community.id + 1 })}</span><small>{community.nodeCount}</small></div>)}
      </div>}
    </div>
      {selection && <WikiReader view={view} selection={selection} graphSelection={graphSelection} source={source} exploration={readerExploration} onPage={openPage} onSource={openSource} onBack={() => setSource(undefined)} onClose={() => { setSelection(undefined); setSource(undefined); }}
        onLocate={locate} onReturnToGraph={() => { if (graphSelection?.kind === 'node') openPage(graphSelection.id); else if (graphSelection) openEdge(graphSelection.id); }} />}
    </div>
  </section></WikiI18nProvider>;
}

const container = document.getElementById('root') ?? document.body.appendChild(document.createElement('div'));
createRoot(container).render(<SharedWiki />);
