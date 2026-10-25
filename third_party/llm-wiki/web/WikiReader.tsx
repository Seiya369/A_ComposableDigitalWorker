/* SPDX-License-Identifier: GPL-3.0-only
 * Read-only adaptation of the upstream same-screen GraphPreviewPanel.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { Citation, SourcePreview, WikiEdge, WikiPage, WikiView } from './protocol.js';
import { safeMarkdown } from './markdown.js';
import { useWikiI18n } from './i18n.js';
import { TYPE_LABELS } from './graph-style.js';

export type ReaderSelection = { kind: 'page'; id: string } | { kind: 'edge'; id: string } | { kind: 'directory' };
export type GraphSelection = { kind: 'node' | 'edge'; id: string };
export interface SourceState { requestId: string; citation: Citation; source?: SourcePreview; error?: string }
export interface ReaderExploration { count: number; active: boolean; canExpand: boolean; onExpand: () => void }

export function sourceTitle(citation: Citation, pages: readonly WikiPage[], fallback = '原始资料'): string {
  return pages.find(page => page.type === 'source' && page.citations.some(c => c.sourceId === citation.sourceId && c.sourceVersion === citation.sourceVersion))?.title ?? fallback;
}

export function WikiReader({ view, selection, graphSelection, source, exploration, onPage, onSource, onBack, onClose, onLocate, onReturnToGraph }: {
  view: WikiView; selection: ReaderSelection; graphSelection?: GraphSelection; source?: SourceState;
  exploration?: ReaderExploration;
  onPage: (id: string) => void; onSource: (citation: Citation) => void; onBack: () => void; onClose: () => void;
  onLocate?: (id: string) => void; onReturnToGraph?: () => void;
}) {
  const { t, errorMessage } = useWikiI18n();
  const sourceName = (citation: Citation) => sourceTitle(citation, view.pages, t('原始资料'));
  const page = selection.kind === 'page' ? view.pages.find(p => p.id === selection.id) : undefined;
  const edge = selection.kind === 'edge' ? view.graph.edges.find(e => e.id === selection.id) : undefined;
  const contextNode = graphSelection?.kind === 'node' ? view.graph.nodes.find(node => node.id === graphSelection.id) : undefined;
  const contextEdge = graphSelection?.kind === 'edge' ? view.graph.edges.find(item => item.id === graphSelection.id) : undefined;
  const contextTitle = contextNode?.label ?? contextEdge?.relations?.map(relation => relation.predicate).join(' · ');
  const showContext = !!contextTitle && (source || selection.kind === 'page' && selection.id !== graphSelection?.id);
  const relationRoot = contextNode?.id ?? (!graphSelection && page && view.graph.nodes.some(node => node.id === page.id) ? page.id : undefined);
  const relationEdges = relationRoot ? view.graph.edges.filter(item => item.source === relationRoot || item.target === relationRoot)
    : contextEdge ? [contextEdge] : edge ? [edge] : [];
  const semanticRelations = relationEdges.flatMap(item => (item.relations ?? [])
    .filter(value => !relationRoot || value.sourceId === relationRoot || value.targetId === relationRoot)
    .map(value => ({ edge: item, value })));
  const articles = page && page.type !== 'synthesis' ? view.pages.filter(p => p.type === 'synthesis' && p.entryIds.some(id => page.entryIds.includes(id))) : [];
  const articleIds = new Set(articles.map(item => item.id));
  const otherLinks = page?.links.filter(id => !articleIds.has(id)) ?? [];
  const title = source ? source.source?.title ?? sourceName(source.citation) : page?.title ?? t(edge ? '知识关系' : '知识重组');
  const directoryGroups = [
    { title: '知识重组', pages: view.pages.filter(item => item.type === 'synthesis') },
    { title: '概念综述', pages: view.pages.filter(item => item.type === 'overview') },
    { title: '概念与实体', pages: view.pages.filter(item => item.type === 'concept' || item.type === 'entity') },
    { title: '原始资料', pages: view.pages.filter(item => item.type === 'source') },
  ];
  const close = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const html = useMemo(() => page ? safeMarkdown(page.content, view.pages) : '', [page?.id, page?.content, view.pages]);
  useEffect(() => { if (content.current) content.current.scrollTop = 0; }, [page?.id, edge?.id, source?.requestId]);
  const citationButtons = (citations: Citation[]) => {
    const unique = [...new Map(citations.map(c => [JSON.stringify(c), c])).values()];
    return unique.length > 0 ? <section className="wiki-citations" aria-label={t("资料依据")}><h4>{t("资料依据")}</h4>{unique.map(citation => <button type="button" key={JSON.stringify(citation)}
      aria-label={t('查看资料 {name} 第 {start} 至 {end} 行', { name: sourceName(citation), start: citation.startLine, end: citation.endLine })} onClick={() => onSource(citation)}>
      <span>{sourceName(citation)}<small>{t('第 {start}–{end} 行', { start: citation.startLine, end: citation.endLine })}</small></span><span aria-hidden="true">↗</span>
    </button>)}</section> : null;
  };
  const semanticLinks = relationRoot || relationEdges.length ? <section className="wiki-semantic-links" aria-label={t("语义关系")}
    data-relation-root={relationRoot ?? contextEdge?.id ?? edge?.id}>
    <details className="wiki-relation-context" key={relationRoot ?? contextEdge?.id ?? edge?.id} open={!showContext}>
      <summary>{t("语义关系")}<small>{semanticRelations.length}</small></summary>
      {semanticRelations.length ? semanticRelations.map(({ edge: item, value }) => <SemanticButton key={`${item.id}-${value.id}`} edge={item} relation={value} view={view} onPage={onPage} onSource={onSource} />)
        : <p className="wiki-no-relations">{t("暂无已确认关系")}</p>}
    </details>
  </section> : null;
  return <aside className="wiki-reader" aria-label={t(source ? '原始资料阅读' : edge ? '知识关系阅读' : '知识文章阅读')} data-page-id={page?.id}>
    <header><span title={title}>{title}</span><button type="button" ref={close} aria-label={t("关闭文章")} onClick={onClose}>×</button></header>
    {exploration && <div className="wiki-reader-actions">
      <span>{t('关联知识 {count}', { count: exploration.count })}</span>
      <button type="button" className="wiki-expand" disabled={!exploration.canExpand} onClick={exploration.onExpand}>
        {t(exploration.canExpand ? '展开关联' : exploration.active ? '已展开全部关联' : '暂无关联')}
      </button>
    </div>}
    {showContext && <div className="wiki-reading-context" role="group" aria-label={t("图谱阅读上下文")}>
      <button type="button" className="wiki-reading-origin" aria-label={t('返回图谱知识 {name}', { name: contextTitle ?? '' })} title={contextTitle} onClick={onReturnToGraph}>← {contextTitle}</button>
      {onLocate && graphSelection && <button type="button" aria-label={t('定位图谱 {name}', { name: contextTitle ?? '' })} onClick={() => onLocate(graphSelection.id)}>{t("定位图谱")}</button>}
    </div>}
    <div ref={content} className="wiki-reader-content">
      {source ? <>
        <button type="button" className="wiki-back" onClick={onBack}>{t("返回文章")}</button>
        <h2>{title}</h2>
        {semanticLinks}
        {source.error ? <p role="alert">{errorMessage(source.error)}</p> : !source.source ? <p role="status">{t("正在读取…")}</p> : <>
          <blockquote className="wiki-source-excerpt"><small>{t('引用原文 · 第 {start}–{end} 行', { start: source.citation.startLine, end: source.citation.endLine })}</small>
            <pre>{source.source.text.split('\n').slice(source.citation.startLine - 1, source.citation.endLine).join('\n')}</pre></blockquote>
          <pre className="wiki-source-text">{source.source.text}</pre>
        </>}
      </> : page ? <>
        <span className="wiki-page-type">{t(TYPE_LABELS[page.type] ?? page.type)}</span>
        {!/^#\s/.test(page.content) && <h2>{page.title}</h2>}
        <div className="wiki-markdown" onClick={event => {
          const anchor = (event.target as Element).closest<HTMLAnchorElement>('a[href]'); if (!anchor) return;
          const href = anchor.getAttribute('href') ?? '';
          event.preventDefault();
          if (href.startsWith('#wiki:')) { try { const id = decodeURIComponent(href.slice(6)); if (view.pages.some(p => p.id === id)) onPage(id); } catch { /* An invalid link remains inert. */ } }
        }} dangerouslySetInnerHTML={{ __html: html }} />
        {semanticLinks}
        {articles.length > 0 && <section aria-label={t("相关文章")}><h4>{t("相关文章")}</h4>{articles.map(article => <button type="button" key={article.id} className="wiki-page-link" aria-label={t('阅读知识 {name}', { name: article.title })} onClick={() => onPage(article.id)}>{article.title}<span aria-hidden="true">↗</span></button>)}</section>}
        {otherLinks.length > 0 && <section aria-label={t("关联知识")}><h4>{t("关联知识")}</h4>{otherLinks.map(id => {
          const linked = view.pages.find(item => item.id === id);
          return linked ? <button type="button" className="wiki-page-link" aria-label={t('阅读知识 {name}', { name: linked.title })} key={id} onClick={() => onPage(id)}>{linked.title}<span aria-hidden="true">↗</span></button> : null;
        })}</section>}
        {citationButtons(page.citations)}
      </> : edge ? <>
        <h2>{edge.relations?.[0] ? `${view.pages.find(p => p.id === edge.relations![0].sourceId)?.title} → ${view.pages.find(p => p.id === edge.relations![0].targetId)?.title}`
          : `${view.pages.find(p => p.id === edge.source)?.title} ↔ ${view.pages.find(p => p.id === edge.target)?.title}`}</h2>
        {semanticLinks}
      </> : <nav aria-label={t("知识文章目录")}>{directoryGroups.filter(group => group.pages.length).map(group => <section className="wiki-directory-group" aria-label={t(group.title)} key={group.title}>
        <h3>{t(group.title)}</h3>{group.pages.map(item => <button type="button" key={item.id} className="wiki-page-link" aria-label={t('阅读知识 {name}', { name: item.title })} onClick={() => onPage(item.id)}>
          <span className="wiki-type-dot" data-type={item.type} /><span>{item.title}</span><small>{t(TYPE_LABELS[item.type] ?? item.type)}</small>
        </button>)}
      </section>)}{view.pages.length === 0 && <p>{t("暂无知识文章")}</p>}</nav>}
    </div>
  </aside>;
}

function SemanticButton({ edge, relation, view, onPage, onSource }: {
  edge: WikiEdge; relation: NonNullable<WikiEdge['relations']>[number]; view: WikiView; onPage: (id: string) => void; onSource: (citation: Citation) => void;
}) {
  const { t } = useWikiI18n();
  const source = view.pages.find(p => p.id === relation.sourceId); const target = view.pages.find(p => p.id === relation.targetId);
  const triple = `${source?.title ?? view.graph.nodes.find(node => node.id === relation.sourceId)?.label ?? ''} → ${relation.predicate} → ${target?.title ?? view.graph.nodes.find(node => node.id === relation.targetId)?.label ?? ''}`;
  return <details className="wiki-relation-details" data-edge-id={edge.id} data-relation-id={relation.id}><summary aria-label={t('查看关系 {name}', { name: triple })}>{triple}{relation.basis === 'inferred' && <span className="wiki-inferred">{t("推断")}</span>}</summary>
    {relation.basis === 'explicit' && <span className="wiki-explicit">{t("原文明确")}</span>}{relation.summary && <p>{relation.summary}</p>}
    {relation.entryIds.map(id => { const page = view.pages.find(p => p.type === 'synthesis' && p.entryIds.includes(id)); return page ? <button type="button" className="wiki-page-link" key={id} onClick={() => onPage(page.id)}>{page.title}</button> : null; })}
    {relation.citations.map(c => <button type="button" key={JSON.stringify(c)} className="wiki-page-link" aria-label={t('查看资料 {name} 第 {start} 至 {end} 行', { name: sourceTitle(c, view.pages, t('原始资料')), start: c.startLine, end: c.endLine })} onClick={() => onSource(c)}>{sourceTitle(c, view.pages, t('原始资料'))}<small>{t('{start}–{end} 行', { start: c.startLine, end: c.endLine })}</small></button>)}
  </details>;
}
