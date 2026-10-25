import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { KnowledgeLibraryView } from '../knowledge/library-api.js';
import type { KnowledgeCitation, KnowledgeConcept, KnowledgeEntry, KnowledgeRelation, KnowledgeSource } from '../knowledge/types.js';
import { fitGraph, layoutConceptGraph, relationGeometry, type GraphTransform } from './knowledge-graph-layout.js';

import { useI18n } from './i18n.js';

const sourceKey = (id: string, version: number) => JSON.stringify([id, version]);

/** The main graph contains grounded concepts and relations, never invented title links. */
export function buildKnowledgeGraph(view: KnowledgeLibraryView, entries: KnowledgeEntry[]) {
  const articles = [...new Map(entries.map(entry => [entry.id, entry])).values()];
  const articleIds = new Set(articles.map(entry => entry.id));
  const conceptGraph = view.snapshot?.conceptGraph;
  const concepts = [...new Map((conceptGraph?.concepts ?? []).map(concept => [concept.id, concept])).values()]
    .filter(concept => concept.entryIds.some(id => articleIds.has(id)))
    .map(concept => ({ ...concept, entryIds: [...new Set(concept.entryIds)].filter(id => articleIds.has(id)) }));
  const conceptIds = new Set(concepts.map(concept => concept.id));
  const relations = [...new Map((conceptGraph?.relations ?? []).map(relation => [relation.id, relation])).values()]
    .filter(relation => conceptIds.has(relation.sourceId) && conceptIds.has(relation.targetId))
    .map(relation => ({ ...relation, entryIds: [...new Set(relation.entryIds)].filter(id => articleIds.has(id)) }));
  const sources = new Map(view.sources.map(source => [sourceKey(source.id, source.version), source]));
  return { concepts, relations, articles, sources };
}

interface KnowledgeGraphProps {
  view: KnowledgeLibraryView;
  entries: KnowledgeEntry[];
  onEntry: (id: string) => void;
  onSource: (source: KnowledgeSource, citation?: KnowledgeCitation) => void;
  onRebuild?: () => void;
  rebuilding?: boolean;
}
type Selection = { kind: 'concept' | 'relation'; id: string } | { kind: 'articles' };
type Drag = { pointerId: number; startX: number; startY: number; x: number; y: number; nodeId?: string; moved: boolean; capture: Element };

export function KnowledgeGraph({ view, entries, onEntry, onSource, onRebuild, rebuilding }: KnowledgeGraphProps) {
  const { t } = useI18n();
  const graph = useMemo(() => buildKnowledgeGraph(view, entries), [view, entries]);
  const layoutKey = JSON.stringify([graph.concepts.map(concept => [concept.id, concept.name]).sort(),
    graph.relations.map(relation => [relation.sourceId, relation.targetId]).sort()]);
  const initialPositions = useMemo(() => layoutConceptGraph(graph.concepts, graph.relations), [layoutKey]);
  const [positions, setPositions] = useState(initialPositions);
  const [transform, setTransform] = useState<GraphTransform>({ x: 0, y: 0, scale: 1 });
  const [size, setSize] = useState({ width: 800, height: 480 });
  const [selection, setSelection] = useState<Selection>();
  const [query, setQuery] = useState('');
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag>();
  const suppressClick = useRef(false);
  const nodeButtons = useRef(new Map<string, HTMLButtonElement>());
  const markerId = `wf-concept-arrow-${useId().replaceAll(':', '')}`;
  const selectedConcept = selection?.kind === 'concept' ? graph.concepts.find(concept => concept.id === selection.id) : undefined;
  const selectedRelation = selection?.kind === 'relation' ? graph.relations.find(relation => relation.id === selection.id) : undefined;
  const detail = selectedConcept ?? selectedRelation;
  const showingArticles = selection?.kind === 'articles';
  const conceptMap = new Map(graph.concepts.map(concept => [concept.id, concept]));
  const needle = query.trim().toLocaleLowerCase();
  const matches = new Set(graph.concepts.filter(concept => !needle || [concept.name, ...(concept.aliases ?? [])].some(name => name.toLocaleLowerCase().includes(needle))).map(concept => concept.id));
  const neighbors = new Set(selectedConcept ? [selectedConcept.id, ...graph.relations.filter(relation => relation.sourceId === selectedConcept.id || relation.targetId === selectedConcept.id)
    .flatMap(relation => [relation.sourceId, relation.targetId])] : selectedRelation ? [selectedRelation.sourceId, selectedRelation.targetId] : []);
  const busy = rebuilding || view.status.state === 'compiling';
  const failed = view.status.state === 'failed';
  const emptyStatus = busy ? '正在整理概念图谱…' : failed ? '图谱整理失败'
    : view.status.state === 'ready' && view.snapshot?.conceptGraph ? '暂无可展示概念' : '概念图谱待整理';

  useEffect(() => { setPositions(initialPositions); setSelection(undefined); }, [initialPositions]);
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      if (bounds.width > 0 && bounds.height > 0) setSize(previous => previous.width === bounds.width && previous.height === bounds.height
        ? previous : { width: bounds.width, height: bounds.height });
    };
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(element); window.addEventListener('resize', measure); measure();
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [graph.concepts.length > 0]);
  useEffect(() => { setTransform(fitGraph(initialPositions, size.width, size.height)); }, [initialPositions, size]);

  const zoomAt = (factor: number, x = size.width / 2, y = size.height / 2) => setTransform(previous => {
    const scale = Math.max(.03, Math.min(3, previous.scale * factor)); const ratio = scale / previous.scale;
    return { scale, x: x - (x - previous.x) * ratio, y: y - (y - previous.y) * ratio };
  });
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = element.getBoundingClientRect(); const x = event.clientX - bounds.left; const y = event.clientY - bounds.top;
      setTransform(previous => {
        const scale = Math.max(.03, Math.min(3, previous.scale * Math.exp(-event.deltaY * .0015))); const ratio = scale / previous.scale;
        return { scale, x: x - (x - previous.x) * ratio, y: y - (y - previous.y) * ratio };
      });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [graph.concepts.length > 0]);

  const startDrag = (event: ReactPointerEvent, nodeId?: string) => {
    if (event.button !== 0 || !svg.current) return;
    event.stopPropagation();
    const node = nodeId ? positions.get(nodeId) : undefined;
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      x: node?.x ?? transform.x, y: node?.y ?? transform.y, nodeId, moved: false, capture: event.currentTarget };
    suppressClick.current = false; event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const moveDrag = (event: ReactPointerEvent) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.startX; const dy = event.clientY - active.startY;
    if (Math.hypot(dx, dy) > 4) active.moved = true;
    if (!active.moved) return;
    if (active.nodeId) setPositions(previous => {
      const node = previous.get(active.nodeId!);
      return node ? new Map(previous).set(active.nodeId!, { ...node, x: active.x + dx / transform.scale, y: active.y + dy / transform.scale }) : previous;
    });
    else setTransform(previous => ({ ...previous, x: active.x + dx, y: active.y + dy }));
  };
  const finishDrag = (event: ReactPointerEvent) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    suppressClick.current = active.moved; drag.current = undefined;
    if (active.capture.hasPointerCapture?.(event.pointerId)) active.capture.releasePointerCapture(event.pointerId);
  };
  const choose = (value: Selection) => { if (!suppressClick.current) setSelection(value); suppressClick.current = false; };
  const focusMatch = () => {
    const id = graph.concepts.find(concept => matches.has(concept.id))?.id;
    const position = id ? positions.get(id) : undefined;
    if (!id || !position) return;
    setSelection({ kind: 'concept', id });
    setTransform(previous => ({ ...previous, x: size.width / 2 - position.x * previous.scale, y: size.height / 2 - position.y * previous.scale }));
    nodeButtons.current.get(id)?.focus();
  };
  const nodeKey = (event: ReactKeyboardEvent, concept: KnowledgeConcept) => {
    if (event.key === 'Enter' && selectedConcept?.id === concept.id && concept.entryIds[0]) {
      event.preventDefault(); event.stopPropagation(); onEntry(concept.entryIds[0]); return;
    }
    const direction = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[event.key];
    const origin = positions.get(concept.id);
    if (!direction || !origin) return;
    event.preventDefault(); event.stopPropagation();
    const next = [...positions.values()].filter(node => node.id !== concept.id && (node.x - origin.x) * direction[0] + (node.y - origin.y) * direction[1] > 0)
      .sort((a, b) => Math.hypot(a.x - origin.x, a.y - origin.y) - Math.hypot(b.x - origin.x, b.y - origin.y))[0];
    if (next) nodeButtons.current.get(next.id)?.focus();
  };
  const canvasKey = (event: ReactKeyboardEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget) return;
    const delta = ({ ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] } as Record<string, number[]>)[event.key];
    if (delta) { event.preventDefault(); setTransform(previous => ({ ...previous, x: previous.x + delta[0], y: previous.y + delta[1] })); }
    else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomAt(1.2); }
    else if (event.key === '-') { event.preventDefault(); zoomAt(1 / 1.2); }
    else if (event.key === '0') { event.preventDefault(); setTransform(fitGraph(positions, size.width, size.height)); }
    else if (event.key === 'Escape') setSelection(undefined);
  };

  const evidence = (citations: KnowledgeCitation[]) => [...new Map(citations.map(citation => [JSON.stringify([citation.sourceId, citation.sourceVersion, citation.startLine, citation.endLine]), citation])).values()];
  const renderDetail = (value: KnowledgeConcept | KnowledgeRelation) => <>
    {value.summary && <p className="wf-concept-summary">{value.summary}</p>}
    {selectedRelation?.basis === 'inferred' && <span className="wf-concept-inferred">{t("模型推断")}</span>}
    {value.entryIds.length > 0 && <section aria-label={t("关联文章")}><h4>{t("关联文章")}</h4>{value.entryIds.map(id => {
      const article = graph.articles.find(entry => entry.id === id);
      return article ? <button type="button" className="wf-concept-detail-link" key={id} aria-label={t('阅读知识 {name}', { name: article.title })} onClick={() => onEntry(id)}>{article.title}<span aria-hidden="true">↗</span></button> : null;
    })}</section>}
    {value.citations.length > 0 && <section aria-label={t("来源依据")}><h4>{t("来源依据")}</h4>{evidence(value.citations).map(citation => {
      const source = graph.sources.get(sourceKey(citation.sourceId, citation.sourceVersion));
      return <button type="button" className="wf-concept-detail-link" key={JSON.stringify(citation)} disabled={!source}
        aria-label={source ? t('查看资料 {name} 第 {start} 至 {end} 行', { name: source.title, start: citation.startLine, end: citation.endLine }) : t('引用资料不可用')} onClick={() => source && onSource(source, citation)}>
        <span>{source?.title ?? t('引用资料不可用')}<small>{t('第 {start}–{end} 行 · v{version}', { start: citation.startLine, end: citation.endLine, version: citation.sourceVersion })}</small></span><span aria-hidden="true">↗</span></button>;
    })}</section>}
  </>;
  const articlePanel = <aside className="wf-concept-detail" aria-label={t("知识文章目录")}>
    <header><div><h3>{t("知识文章")}</h3></div><button type="button" aria-label={t("关闭图谱详情")} onClick={() => setSelection(undefined)}>×</button></header>
    {graph.articles.map(article => <button type="button" key={article.id} className="wf-concept-detail-link" aria-label={t('阅读知识 {name}', { name: article.title })} onClick={() => onEntry(article.id)}>{article.title}<span aria-hidden="true">↗</span></button>)}
  </aside>;

  return <section className="wf-knowledge-graph" aria-label={t("概念知识图谱")} onKeyDown={event => { if (event.key === 'Escape') setSelection(undefined); }}>
    <div className="wf-concept-toolbar"><strong>{t("知识图谱")}</strong>
      {graph.articles.length > 0 && <button type="button" className="wf-concept-articles" aria-label={t("打开知识文章")} aria-pressed={showingArticles} onClick={() => setSelection(showingArticles ? undefined : { kind: 'articles' })}>{t("文章")}</button>}
      {graph.concepts.length > 0 && <><form role="search" onSubmit={event => { event.preventDefault(); focusMatch(); }}>
        <input type="search" aria-label={t("搜索概念")} placeholder={t("搜索概念")} value={query} onChange={event => setQuery(event.target.value)} />
        <button type="submit" aria-label={t("定位概念")} title={t("定位概念")}>⌕</button>
      </form><div className="wf-concept-controls" aria-label={t("图谱视图")}>
        <button type="button" aria-label={t("放大图谱")} title={t("放大")} onClick={() => zoomAt(1.2)}>＋</button>
        <button type="button" aria-label={t("缩小图谱")} title={t("缩小")} onClick={() => zoomAt(1 / 1.2)}>−</button>
        <button type="button" aria-label={t("适配图谱")} title={t("适配视图")} onClick={() => setTransform(fitGraph(positions, size.width, size.height))}>⛶</button>
      </div></>}
      {graph.concepts.length > 0 && failed && <span className="wf-concept-failed" role="status">{t("图谱整理失败")}</span>}
      {onRebuild && view.sources.length > 0 && <button type="button" className="wf-concept-rebuild" aria-label={t("重新整理图谱")} title={t(failed ? '整理失败，点击重试' : '重新整理图谱')} disabled={busy} onClick={onRebuild}>{busy ? t('整理中…') : '↻'}</button>}
    </div>
    {graph.concepts.length ? <div className="wf-concept-body"><div className="wf-concept-stage">
      {needle && !matches.size && <span className="wf-concept-no-match" role="status">{t("未找到概念")}</span>}
      <svg ref={svg} className="wf-concept-canvas" aria-label={t("概念图谱画布")} tabIndex={0} viewBox={`0 0 ${size.width} ${size.height}`}
        onPointerDown={event => startDrag(event)} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}
        onKeyDown={canvasKey} onClick={event => { if (event.target === event.currentTarget && !suppressClick.current) setSelection(undefined); suppressClick.current = false; }}>
        <defs><marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 1 1 L 9 5 L 1 9 z" /></marker>
          <marker id={`${markerId}-active`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 1 1 L 9 5 L 1 9 z" className="is-active" /></marker></defs>
        <g className="wf-concept-scene" transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
          {graph.relations.map(relation => {
            const from = positions.get(relation.sourceId); const to = positions.get(relation.targetId);
            if (!from || !to) return null;
            const parallel = graph.relations.filter(edge => JSON.stringify([edge.sourceId, edge.targetId].sort()) === JSON.stringify([relation.sourceId, relation.targetId].sort()));
            const geometry = relationGeometry(from, to, parallel.indexOf(relation), parallel.length);
            const active = selectedRelation?.id === relation.id || selectedConcept && (relation.sourceId === selectedConcept.id || relation.targetId === selectedConcept.id);
            const dimmed = needle ? !matches.has(relation.sourceId) && !matches.has(relation.targetId) : neighbors.size > 0 && !active;
            const label = `${conceptMap.get(relation.sourceId)?.name} ${relation.predicate} ${conceptMap.get(relation.targetId)?.name}`;
            return <g key={relation.id} className={`wf-concept-relation${active ? ' is-active' : ''}${dimmed ? ' is-dimmed' : ''}${relation.basis === 'inferred' ? ' is-inferred' : ''}`}>
              <path d={geometry.path} className="wf-concept-edge" markerEnd={`url(#${markerId}${active ? '-active' : ''})`} />
              <path d={geometry.path} className="wf-concept-edge-hit" onPointerDown={event => event.stopPropagation()} onClick={() => choose({ kind: 'relation', id: relation.id })} />
              <foreignObject x={geometry.labelX - 52} y={geometry.labelY - 12} width="104" height="24" className="wf-concept-edge-label">
                <button type="button" title={label} aria-label={t('查看关系 {name}', { name: label })} aria-pressed={selectedRelation?.id === relation.id}
                  onPointerDown={event => event.stopPropagation()} onClick={() => choose({ kind: 'relation', id: relation.id })}>{relation.predicate}</button>
              </foreignObject>
            </g>;
          })}
          {graph.concepts.map(concept => {
            const position = positions.get(concept.id);
            if (!position) return null;
            const dimmed = needle ? !matches.has(concept.id) : neighbors.size > 0 && !neighbors.has(concept.id);
            return <foreignObject key={concept.id} x={position.x - position.width / 2} y={position.y - position.height / 2} width={position.width} height={position.height}
              className={`wf-concept-node${selectedConcept?.id === concept.id ? ' is-selected' : ''}${dimmed ? ' is-dimmed' : ''}${needle && matches.has(concept.id) ? ' is-match' : ''}`}>
              <button type="button" ref={element => { if (element) nodeButtons.current.set(concept.id, element); else nodeButtons.current.delete(concept.id); }}
                title={concept.name} aria-label={t('查看概念 {name}', { name: concept.name })} aria-pressed={selectedConcept?.id === concept.id}
                onPointerDown={event => startDrag(event, concept.id)} onClick={() => choose({ kind: 'concept', id: concept.id })} onKeyDown={event => nodeKey(event, concept)}>{concept.name}</button>
            </foreignObject>;
          })}
        </g>
      </svg>
    </div>{detail && <aside className="wf-concept-detail" aria-label={t(selectedConcept ? '概念详情' : '关系详情')}>
      <header><div><h3>{selectedConcept?.name ?? selectedRelation?.predicate}</h3>{selectedConcept?.aliases?.length ? <p>{selectedConcept.aliases.join('、')}</p> : null}</div>
        <button type="button" aria-label={t("关闭图谱详情")} onClick={() => setSelection(undefined)}>×</button></header>
      {selectedRelation && <p className="wf-concept-direction">{conceptMap.get(selectedRelation.sourceId)?.name}<span aria-hidden="true"> → </span>{conceptMap.get(selectedRelation.targetId)?.name}</p>}
      {renderDetail(detail)}
    </aside>}{showingArticles && articlePanel}</div> : <div className="wf-concept-body"><div className="wf-concept-empty"><p role="status">{t(emptyStatus)}</p></div>{showingArticles && articlePanel}</div>}
  </section>;
}
