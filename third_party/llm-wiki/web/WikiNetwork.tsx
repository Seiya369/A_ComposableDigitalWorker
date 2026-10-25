/* SPDX-License-Identifier: GPL-3.0-only
 * Adapted from nashsu/llm_wiki src/components/graph/graph-view.tsx
 * at e08cfce65aad8b76b13546a081c1a8d4422b70c3.
 * Changes: controlled JSON data, per-space lifecycle, keyboard equivalent,
 * deterministic initial coordinates, no Tauri/store/research dependencies.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import type { NodeLabelDrawingFunction } from 'sigma/rendering';
import { useWikiI18n } from './i18n.js';
import { semanticGraphForDisplay, type WikiEdge, type WikiNode, type WikiView } from './protocol.js';
import { COMMUNITY_COLORS, TYPE_COLORS, mixColor, nodeSize } from './graph-style.js';
import { fitGraphCameraRatio, groupedSemanticLayout } from './graph-layout.js';
import { semanticFocus, visibleSemanticNodeIds } from './graph-focus.js';

type NodeGeometry = { id: string; x: number; y: number; screenX: number; screenY: number; size: number };
const LABEL_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
interface NetworkProps {
  view: WikiView; colorMode: 'type' | 'community'; hiddenTypes: Set<string>; query: string; dark: boolean;
  selectedNode?: string; selectedEdge?: string;
  explorationNodeIds?: readonly string[];
  focusRequest?: { id: string; nonce: number; nodeIds?: readonly string[] };
  onNode: (id: string) => void; onEdge: (id: string) => void; onClear: () => void; onOverview?: () => void;
}

export function WikiNetwork(props: NetworkProps) {
  const { t } = useWikiI18n();
  const { colorMode, hiddenTypes, query, dark, selectedNode, selectedEdge } = props;
  const semanticGraph = useMemo(() => semanticGraphForDisplay(props.view), [props.view]);
  const view = { ...props.view, graph: semanticGraph };
  const holder = useRef<HTMLDivElement>(null);
  const renderer = useRef<Sigma>();
  const graphRef = useRef<Graph>();
  const callbacks = useRef(props); callbacks.current = props;
  const [hover, setHover] = useState<string>();
  const [camera, setCamera] = useState({ ratio: 1, x: .5, y: .5 });
  const [geometry, setGeometry] = useState<NodeGeometry[]>([]);
  const [renderFailed, setRenderFailed] = useState(false);
  const [viewport, setViewport] = useState({ width: 1, height: 1 });
  const appliedFocus = useRef<string>();
  const key = JSON.stringify([view.spaceId, view.version,
    view.graph.nodes.map(n => [n.id, n.linkCount]).sort(), view.graph.edges.map(e => [e.id, e.source, e.target, e.weight]).sort()]);
  // Visual metadata can refresh without changing topology or resetting the user's layout.
  const nodeMetadataKey = JSON.stringify(view.graph.nodes.map(n => [n.id, n.type, n.label, n.community]).sort());
  const nodesById = useMemo(() => new Map(view.graph.nodes.map(n => [n.id, n])), [key, nodeMetadataKey]);
  const layout = useMemo(() => groupedSemanticLayout(view.graph, view.spaceId), [key, nodeMetadataKey]);
  const needle = query.trim().toLocaleLowerCase();
  const matchingNodes = new Set(view.graph.nodes.filter(node => !needle || [node.label, node.type,
    ...(view.pages.find(page => page.id === node.id)?.aliases ?? [])].some(value => value.toLocaleLowerCase().includes(needle))).map(node => node.id));
  const visibleIds = visibleSemanticNodeIds(view, hiddenTypes, query, selectedNode);
  const visibleNodes = view.graph.nodes.filter(node => visibleIds.has(node.id));
  const visibleEdges = view.graph.edges.filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target));
  const explorationNodes = props.explorationNodeIds === undefined ? undefined : new Set(props.explorationNodeIds.filter(id => visibleIds.has(id)));
  const explorationKey = explorationNodes === undefined ? undefined : JSON.stringify([...explorationNodes].sort());
  const activeNode = hover ?? selectedNode;
  const focus = semanticFocus(view.graph, activeNode, selectedEdge, explorationNodes);
  const hasFocus = explorationNodes !== undefined || focus.nodeIds.size > 0;
  const focusEdgeIds = new Set(focus.edges.map(edge => edge.id));
  const highlightedNodes = [...focus.nodeIds].filter(id => visibleIds.has(id));
  const highlightedEdges = focus.edges.filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target));

  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    const graph = new Graph({ type: 'undirected' });
    const maxDegree = Math.max(...view.graph.nodes.map(n => n.linkCount), 1);
    for (const node of view.graph.nodes) graph.addNode(node.id, {
      ...layout.positions.get(node.id), size: nodeSize(node.linkCount, maxDegree, view.graph.nodes.length),
      label: node.label, color: TYPE_COLORS[node.type] ?? '#94a3b8', type: 'circle', nodeType: node.type, community: node.community,
    });
    const maxWeight = Math.max(...view.graph.edges.map(e => e.weight), 1);
    for (const edge of view.graph.edges) {
      if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target) || graph.hasEdge(edge.source, edge.target)) continue;
      const normalizedWeight = edge.weight / maxWeight;
      graph.addEdgeWithKey(edge.id, edge.source, edge.target, {
        weight: edge.weight, size: .8 + normalizedWeight * .4,
        color: `rgba(100,116,139,${(40 + normalizedWeight * 150) / 255})`,
        sourceNode: edge.source, targetNode: edge.target,
      });
    }
    graphRef.current = graph;
    let sigma: Sigma | undefined;
    let disposed = false;
    let fallbackStarted = false;
    let dragNode: string | undefined;
    let moved = false;
    let dragStart: { x: number; y: number } | undefined;
    let signature = '';
    const interactionState = (event?: string) => {
      const network = element.parentElement;
      if (!network || !sigma || disposed) return;
      network.dataset.cameraPanningEnabled = String(sigma.getCamera().enabledPanning);
      network.dataset.captorEnabled = String(sigma.getMouseCaptor().enabled);
      network.dataset.captorDown = String(sigma.getMouseCaptor().isMouseDown);
      if (event) network.dataset.sigmaEvent = event;
    };
    const synchronize = () => {
      if (!sigma || disposed) return;
      interactionState();
      const nextCamera = sigma.getCamera().getState();
      const nextNodes = view.graph.nodes.map(node => {
        const p = graph.getNodeAttributes(node.id); const screen = sigma!.graphToViewport({ x: p.x, y: p.y });
        return { id: node.id, x: p.x, y: p.y, screenX: screen.x, screenY: screen.y, size: p.size };
      });
      const nextSignature = JSON.stringify([nextCamera, nextNodes]);
      if (nextSignature === signature) return;
      signature = nextSignature; setCamera({ ratio: nextCamera.ratio, x: nextCamera.x, y: nextCamera.y }); setGeometry(nextNodes);
    };
    const releaseDrag = () => { dragNode = undefined; dragStart = undefined; interactionState(); };
    const start = () => {
      if (disposed || sigma || fallbackStarted || element.clientWidth === 0 || element.clientHeight === 0) return;
      try {
        const drawBoundedLabel: NodeLabelDrawingFunction = (context, data, settings) => {
          if (!data.label) return;
          context.save();
          context.font = `${settings.labelWeight} ${settings.labelSize}px ${settings.labelFont}`;
          const label = fitNodeLabel(data.label, data.x, data.y, data.size, element.clientWidth, element.clientHeight,
            settings.labelSize, text => context.measureText(text).width);
          if (label) {
            context.fillStyle = settings.labelColor.attribute ? String(data[settings.labelColor.attribute] || settings.labelColor.color || '#000') : settings.labelColor.color || '#000';
            context.textAlign = label.anchor === 'start' ? 'left' : 'right'; context.textBaseline = 'alphabetic';
            context.fillText(label.text, label.x, label.y);
          }
          context.restore();
        };
        sigma = new Sigma(graph, element, {
          defaultNodeType: 'circle', defaultEdgeColor: '#94a3b8', minEdgeThickness: 1, antiAliasingFeather: .4, labelSize: 12, labelWeight: '600',
          labelFont: LABEL_FONT, defaultDrawNodeLabel: drawBoundedLabel, defaultDrawNodeHover: drawBoundedLabel,
          labelColor: { color: '#1e293b' }, stagePadding: 42, zIndex: true,
          renderEdgeLabels: false, hideEdgesOnMove: true, hideLabelsOnMove: true,
          enableEdgeEvents: true, allowInvalidContainer: true, minCameraRatio: .05, maxCameraRatio: 20,
          labelDensity: graph.order > 600 ? .24 : .5, labelRenderedSizeThreshold: graph.order > 600 ? 10 : 6,
        });
        renderer.current = sigma; setRenderFailed(false);
        sigma.on('afterRender', synchronize);
        sigma.on('clickNode', ({ node }) => { if (!moved) callbacks.current.onNode(node); });
        sigma.on('clickEdge', ({ edge }) => { if (!moved) callbacks.current.onEdge(edge); });
        sigma.on('clickStage', () => { if (!moved) callbacks.current.onClear(); });
        sigma.on('enterNode', ({ node }) => { setHover(node); element.style.cursor = 'pointer'; });
        sigma.on('leaveNode', () => { setHover(undefined); element.style.cursor = 'grab'; });
        sigma.on('downNode', ({ node, event }) => {
          dragNode = node; moved = false; dragStart = { x: event.x, y: event.y };
          event.preventSigmaDefault();
        });
        sigma.getMouseCaptor().on('mousemovebody', event => {
          // A mouseup outside this sandbox can be delivered to another document.
          // Never leave a stale stage/node gesture when the pointer returns.
          if ('buttons' in event.original && event.original.buttons === 0 && sigma!.getMouseCaptor().isMouseDown) { sigma!.getMouseCaptor().handleUp(event.original); releaseDrag(); return; }
          if (!dragNode) return;
          event.preventSigmaDefault(); event.original.preventDefault(); event.original.stopPropagation();
          if (!moved && dragStart && Math.hypot(event.x - dragStart.x, event.y - dragStart.y) <= 4) return;
          moved = true; const position = sigma!.viewportToGraph(event);
          graph.setNodeAttribute(dragNode, 'x', position.x); graph.setNodeAttribute(dragNode, 'y', position.y);
        });
        sigma.getMouseCaptor().on('mousedown', () => interactionState('mousedown'));
        sigma.getMouseCaptor().on('mouseup', () => { releaseDrag(); interactionState('mouseup'); synchronize(); });
        sigma.on('downStage', () => { moved = false; });
        synchronize();
      } catch {
        sigma?.kill(); sigma = undefined; renderer.current = undefined; fallbackStarted = true; setRenderFailed(true);
        const coords = view.graph.nodes.map(node => { const p = graph.getNodeAttributes(node.id); return { id: node.id, x: p.x, y: p.y, screenX: 0, screenY: 0, size: p.size }; });
        setGeometry(coords);
      }
    };
    document.addEventListener('pointerup', releaseDrag, true);
    document.addEventListener('pointercancel', releaseDrag, true);
    document.addEventListener('mouseup', releaseDrag, true);
    window.addEventListener('blur', releaseDrag);
    const observer = new ResizeObserver(() => {
      setViewport({ width: element.clientWidth, height: element.clientHeight });
      if (!sigma) start(); else { sigma.resize(); synchronize(); }
    });
    observer.observe(element); start();
    return () => {
      disposed = true; observer.disconnect(); document.removeEventListener('pointerup', releaseDrag, true);
      document.removeEventListener('pointercancel', releaseDrag, true); document.removeEventListener('mouseup', releaseDrag, true);
      window.removeEventListener('blur', releaseDrag); sigma?.kill();
      if (renderer.current === sigma) renderer.current = undefined; graphRef.current = undefined;
    };
  }, [key]);

  useEffect(() => {
    const sigma = renderer.current; const graph = graphRef.current;
    if (!sigma || !graph) return;
    const neighbors = focus.nodeIds;
    const muted = dark ? '#42464e' : '#dce1e8';
    sigma.setSettings({ labelColor: { color: dark ? '#edf0f5' : '#253044' },
      nodeReducer: (id, attrs) => {
        const node = nodesById.get(id); const color = colorMode === 'community'
          ? COMMUNITY_COLORS[(node?.community ?? 0) % COMMUNITY_COLORS.length] : TYPE_COLORS[node?.type ?? ''] ?? '#94a3b8';
        const selected = selectedNode === id, hovered = hover === id;
        const dimmed = hasFocus && !neighbors.has(id) && !selected && !hovered;
        return { ...attrs, hidden: !visibleIds.has(id), color: dimmed ? mixColor(color, muted, .72) : color,
          label: dimmed ? '' : node?.label ?? '', size: attrs.size * (selected ? 1.2 : hovered ? 1.12 : dimmed ? .7 : 1),
          forceLabel: neighbors.has(id) || selected || hovered || !!needle && matchingNodes.has(id), zIndex: selected ? 10 : hovered ? 5 : 0 };
      },
      edgeReducer: (id, attrs) => {
        const source = String(attrs.sourceNode); const target = String(attrs.targetNode);
        const active = focusEdgeIds.has(id), selected = selectedEdge === id;
        return { ...attrs, hidden: !visibleIds.has(source) || !visibleIds.has(target),
          color: active || selected ? dark ? '#cbd5e1' : '#64748b' : hasFocus ? dark ? '#464b52' : '#e4e9f0' : dark ? '#77839470' : attrs.color,
          size: selected ? 1.6 : active ? 1.4 : attrs.size };
      },
    });
    sigma.refresh();
  }, [key, nodeMetadataKey, colorMode, hiddenTypes, query, dark, selectedNode, selectedEdge, hover, explorationKey, geometry.length]);

  const fitCurrentNodes = (ids: readonly string[], duration: number, legacyLocate = false): boolean => {
    const sigma = renderer.current;
    if (sigma) {
      // The reader can change the canvas width in the same render as a fit request.
      sigma.resize();
      const points = ids.map(id => sigma.getNodeDisplayData(id)).filter((point): point is NonNullable<typeof point> => !!point);
      if (!points.length) return false;
      const center = pointBoundsCenter(points);
      const projected = points.map(point => sigma.framedGraphToViewport(point, { cameraState: { ...center, ratio: 1, angle: 0 } }));
      const ratio = legacyLocate ? Math.min(sigma.getCamera().ratio, .65) : fitGraphCameraRatio(projected, sigma.getDimensions());
      if (ratio === undefined) return false;
      void sigma.getCamera().animate({ ...center, ratio, ...(legacyLocate ? {} : { angle: 0 }) }, { duration });
      return true;
    }
    if (!renderFailed) return false;
    const positions = new Map(geometry.map(point => [point.id, point]));
    const points = ids.map(id => positions.get(id)).filter((point): point is NodeGeometry => !!point);
    if (!points.length) return false;
    const center = pointBoundsCenter(points), bounds = worldBounds(layout.positions);
    const dimensions = { width: holder.current?.clientWidth ?? viewport.width, height: holder.current?.clientHeight ?? viewport.height };
    const scale = Math.max(1, Math.min(dimensions.width - 84, dimensions.height - 84)) / bounds.range;
    const projected = points.map(point => ({ x: dimensions.width / 2 + (point.x - center.x) * scale, y: dimensions.height / 2 - (point.y - center.y) * scale }));
    const ratio = legacyLocate ? Math.min(camera.ratio, .65) : fitGraphCameraRatio(projected, dimensions);
    if (ratio === undefined) return false;
    setCamera({ ratio, x: .5 + (center.x - bounds.x) / bounds.range, y: .5 + (center.y - bounds.y) / bounds.range });
    return true;
  };

  const requestedNodeKey = props.focusRequest?.nodeIds === undefined ? undefined : JSON.stringify([...new Set(props.focusRequest.nodeIds)].sort());
  useEffect(() => {
    const request = props.focusRequest; if (!request || viewport.width <= 1 || viewport.height <= 1) return;
    const signature = `${key}:${request.id}:${request.nonce}:${requestedNodeKey ?? ''}`;
    if (appliedFocus.current === signature) return;
    if (!request.id && request.nodeIds === undefined) {
      if (fitCurrentNodes([...visibleIds], 180)) appliedFocus.current = signature;
      return;
    }
    const edge = view.graph.edges.find(item => item.id === request.id);
    const candidates = request.nodeIds ?? (nodesById.has(request.id) ? [request.id] : edge ? [edge.source, edge.target] : []);
    const ids = [...new Set(candidates)].filter(id => nodesById.has(id) && visibleIds.has(id));
    if (!ids.length) { appliedFocus.current = signature; return; }
    if (fitCurrentNodes(ids, 220, request.nodeIds === undefined)) appliedFocus.current = signature;
  }, [key, props.focusRequest?.id, props.focusRequest?.nonce, requestedNodeKey, viewport.width, viewport.height, geometry.length, renderFailed]);

  const zoom = (factor: number) => {
    const c = renderer.current?.getCamera(); if (c) void c.animate({ ratio: Math.max(.05, Math.min(20, c.ratio * factor)) }, { duration: 160 });
    else if (renderFailed) setCamera(current => ({ ...current, ratio: Math.max(.05, Math.min(20, current.ratio * factor)) }));
  };
  const resetCamera = () => { fitCurrentNodes([...visibleIds], 160); };
  const bounds = worldBounds(layout.positions);
  const fallbackScale = Math.max(1, Math.min(viewport.width - 84, viewport.height - 84)) / bounds.range / camera.ratio;
  const displayGeometry = renderFailed ? geometry.map(point => ({ ...point,
    screenX: viewport.width / 2 + (point.x - bounds.x - (camera.x - .5) * bounds.range) * fallbackScale,
    screenY: viewport.height / 2 - (point.y - bounds.y - (camera.y - .5) * bounds.range) * fallbackScale,
  })) : geometry;
  const positionMap = new Map(displayGeometry.map(n => [n.id, n]));
  return <div className="wiki-network" role="region" aria-label={t("知识网络")} data-camera-ratio={camera.ratio} data-camera-x={camera.x} data-camera-y={camera.y}
    data-layout-kind="semantic-network" data-group-count={layout.groups.length} data-selected-node={selectedNode ?? ''} data-selected-edge={selectedEdge ?? ''}
    data-exploration-nodes={JSON.stringify([...(explorationNodes ?? [])].sort())} data-highlighted-nodes={JSON.stringify(highlightedNodes.sort())} data-highlighted-edges={JSON.stringify(highlightedEdges.map(edge => edge.id).sort())}
    data-focus-request={props.focusRequest ? `${props.focusRequest.id}:${props.focusRequest.nonce}` : ''}
    onKeyDown={event => {
      if (event.target !== event.currentTarget) return;
      const c = renderer.current?.getCamera();
      if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1 / 1.2); }
      else if (event.key === '-') { event.preventDefault(); zoom(1.2); }
      else if (event.key === '0') { event.preventDefault(); resetCamera(); }
      else {
        const delta = ({ ArrowLeft: [-.06, 0], ArrowRight: [.06, 0], ArrowUp: [0, .06], ArrowDown: [0, -.06] } as Record<string, number[]>)[event.key];
        if (delta) { event.preventDefault(); if (c) c.setState({ x: c.x + delta[0] * c.ratio, y: c.y + delta[1] * c.ratio });
          else setCamera(current => ({ ...current, x: current.x + delta[0] * current.ratio, y: current.y + delta[1] * current.ratio })); }
      }
    }} tabIndex={0}>
    <div className="wiki-sigma" ref={holder} aria-hidden="true" />
    {renderFailed && <FallbackNetwork nodes={visibleNodes} edges={visibleEdges} geometry={displayGeometry} viewport={viewport} ratio={camera.ratio} colorMode={colorMode}
      focus={focus} hasFocus={hasFocus} selectedNode={selectedNode} selectedEdge={selectedEdge} hoveredNode={hover} onNode={props.onNode} onEdge={props.onEdge} onClear={props.onClear} onZoom={zoom} onHover={setHover}
      onPan={(x, y) => setCamera(current => ({ ...current, x: current.x - x / fallbackScale / bounds.range, y: current.y + y / fallbackScale / bounds.range }))}
      onDragNode={(id, x, y) => setGeometry(current => current.map(point => point.id === id ? { ...point, x: point.x + x / fallbackScale, y: point.y - y / fallbackScale } : point))} />}
    <NetworkOverlay geometry={displayGeometry} edges={highlightedEdges} />
    {needle && !matchingNodes.size && <div className="wiki-network-empty" role="status">{t("未找到知识")}</div>}
    <div className="wiki-zoom" aria-label={t("图谱视图")}>
      <button type="button" aria-label={t("放大图谱")} title={t("放大")} onClick={() => zoom(1 / 1.2)}>＋</button>
      <button type="button" aria-label={t("缩小图谱")} title={t("缩小")} onClick={() => zoom(1.2)}>−</button>
      <button type="button" aria-label={t("适配图谱")} title={t("适配")} onClick={props.onOverview ?? resetCamera}>⛶</button>
    </div>
    <div className="wiki-keyboard-nodes" aria-label={t("图谱页面")}>{visibleNodes.map(node => {
      const p = positionMap.get(node.id);
      return <button type="button" key={node.id} data-node-id={node.id} data-x={p?.x} data-y={p?.y} data-screen-x={p?.screenX} data-screen-y={p?.screenY}
        data-highlighted={focus.nodeIds.has(node.id)} data-dimmed={hasFocus && !focus.nodeIds.has(node.id) && node.id !== selectedNode && node.id !== hover}
        aria-label={t('阅读知识 {name}', { name: node.label })} onFocus={() => setHover(node.id)} onBlur={() => setHover(undefined)} onClick={() => props.onNode(node.id)}>{node.label}</button>;
    })}{visibleEdges.flatMap(edge => (edge.relations ?? []).map((relation, index) => <button type="button" key={`${edge.id}-${index}`} data-edge-id={edge.id}
      aria-label={t('查看关系 {name}', { name: relation.predicate })} onClick={() => props.onEdge(edge.id)}>{relation.predicate}</button>))}</div>
  </div>;
}

function pointBoundsCenter(points: readonly { x: number; y: number }[]) {
  return { x: (Math.min(...points.map(point => point.x)) + Math.max(...points.map(point => point.x))) / 2,
    y: (Math.min(...points.map(point => point.y)) + Math.max(...points.map(point => point.y))) / 2 };
}

function worldBounds(positions: Map<string, { x: number; y: number }>) {
  const points = [...positions.values()]; const xs = points.map(point => point.x); const ys = points.map(point => point.y);
  const left = Math.min(...xs, 0); const right = Math.max(...xs, 0); const bottom = Math.min(...ys, 0); const top = Math.max(...ys, 0);
  return { x: (left + right) / 2, y: (bottom + top) / 2, range: Math.max(right - left, top - bottom, 1) };
}

/** Keep 12px labels readable at the viewport edge without shrinking the graph. */
function fitNodeLabel(text: string, x: number, y: number, radius: number, width: number, height: number, fontSize: number, measure: (text: string) => number): { text: string; anchor: 'start' | 'end'; x: number; y: number } | undefined {
  const padding = 4; const rightX = Math.max(padding, Math.min(width - padding, x + radius + 4));
  const leftX = Math.max(padding, Math.min(width - padding, x - radius - 4));
  const right = width - padding - rightX; const left = leftX - padding;
  const fullWidth = measure(text); const anchor = fullWidth <= right || right >= left ? 'start' : 'end';
  const available = Math.max(0, anchor === 'start' ? right : left);
  if (fullWidth > available) {
    const characters = [...text]; let low = 0; let high = characters.length;
    while (low < high) { const middle = Math.ceil((low + high) / 2); if (measure(`${characters.slice(0, middle).join('')}…`) <= available) low = middle; else high = middle - 1; }
    text = low ? `${characters.slice(0, low).join('')}…` : '';
  }
  if (!text || height < fontSize + padding * 2) return undefined;
  return { text, anchor, x: anchor === 'start' ? rightX : leftX,
    y: Math.max(fontSize + padding, Math.min(height - padding, y + fontSize / 3)) };
}

function NetworkOverlay({ geometry, edges }: { geometry: NodeGeometry[]; edges: WikiEdge[] }) {
  const positions = new Map(geometry.map(point => [point.id, point]));
  return <svg className="wiki-group-overlay wiki-semantic-overlay" aria-hidden="true">
    {edges.map(edge => {
      const a = positions.get(edge.source); const b = positions.get(edge.target); if (!a || !b) return null;
      const label = [...new Set((edge.relations ?? []).map(relation => relation.predicate))].join(' / ');
      const text = label.length > 18 ? `${label.slice(0, 18)}…` : label;
      const width = Math.min(200, [...text].reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 10 : 6), 16));
      const x = (a.screenX + b.screenX) / 2; const y = (a.screenY + b.screenY) / 2;
      return <g key={edge.id} className="wiki-relation-label"><rect x={x - width / 2} y={y - 10} width={width} height={20} rx={3} /><text x={x} y={y + 3} textAnchor="middle">{text}</text></g>;
    })}
  </svg>;
}

function FallbackNetwork({ nodes, edges, geometry, viewport, ratio, colorMode, focus, hasFocus, selectedNode, selectedEdge, hoveredNode, onNode, onEdge, onClear, onZoom, onHover, onPan, onDragNode }: {
  nodes: WikiNode[]; edges: WikiEdge[]; geometry: NodeGeometry[]; viewport: { width: number; height: number }; ratio: number;
  colorMode: 'type' | 'community'; focus: ReturnType<typeof semanticFocus>; hasFocus: boolean; selectedNode?: string; selectedEdge?: string; hoveredNode?: string;
  onNode: (id: string) => void; onEdge: (id: string) => void; onClear: () => void; onZoom: (factor: number) => void;
  onHover: (id?: string) => void;
  onPan: (x: number, y: number) => void; onDragNode: (id: string, x: number, y: number) => void;
}) {
  const { t } = useWikiI18n();
  const positions = new Map(geometry.map(p => [p.id, p]));
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; startX: number; startY: number; id?: string; edgeId?: string; moved: boolean }>();
  const latestZoom = useRef(onZoom); latestZoom.current = onZoom;
  const labelContext = useMemo(() => {
    const context = document.createElement('canvas').getContext('2d');
    if (context) context.font = `600 12px ${LABEL_FONT}`;
    return context;
  }, []);
  useEffect(() => {
    const element = svg.current; if (!element) return;
    const wheel = (event: WheelEvent) => { event.preventDefault(); latestZoom.current(Math.exp(Math.max(-300, Math.min(300, event.deltaY)) * .002)); };
    element.addEventListener('wheel', wheel, { passive: false }); return () => element.removeEventListener('wheel', wheel);
  }, []);
  return <svg ref={svg} className="wiki-fallback" aria-label={t("知识网络备用画布")} viewBox={`0 0 ${Math.max(viewport.width, 1)} ${Math.max(viewport.height, 1)}`}
    onPointerDown={event => {
      if (event.button !== 0) return;
      const id = (event.target as Element).closest('[data-fallback-node]')?.getAttribute('data-fallback-node') ?? undefined;
      const edgeId = (event.target as Element).closest('[data-fallback-edge]')?.getAttribute('data-fallback-edge') ?? undefined;
      drag.current = { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, id, edgeId, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={event => {
      const current = drag.current; if (!current) return;
      if (!current.moved && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) <= 4) return;
      current.moved = true; const x = event.clientX - current.x; const y = event.clientY - current.y;
      if (current.id) onDragNode(current.id, x, y); else onPan(x, y);
      current.x = event.clientX; current.y = event.clientY;
    }} onPointerUp={event => {
      const current = drag.current; drag.current = undefined;
      if (current && !current.moved) {
        if (current.id) onNode(current.id); else if (current.edgeId) onEdge(current.edgeId); else onClear();
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }} onPointerCancel={() => { drag.current = undefined; }}>
    {edges.map(edge => {
      const a = positions.get(edge.source); const b = positions.get(edge.target); const active = focus.edges.some(item => item.id === edge.id), selected = edge.id === selectedEdge;
      return a && b ? <line key={edge.id} data-fallback-edge={edge.id} x1={a.screenX} y1={a.screenY} x2={b.screenX} y2={b.screenY}
        className="wiki-fallback-edge" opacity={hasFocus && !active && !selected ? .2 : 1} strokeWidth={selected ? .95 : active ? .75 : .5} /> : null;
    })}
    {nodes.map(node => {
      const p = positions.get(node.id); const selected = node.id === selectedNode, hovered = node.id === hoveredNode;
      const dimmed = hasFocus && !focus.nodeIds.has(node.id) && !selected && !hovered;
      const radius = p ? p.size / Math.sqrt(ratio) * (selected ? 1.2 : hovered ? 1.12 : dimmed ? .7 : 1) : 0;
      const label = p ? fitNodeLabel(node.label, p.screenX, p.screenY, radius, viewport.width, viewport.height, 12,
        text => labelContext?.measureText(text).width ?? [...text].reduce((width, character) => width + (character.charCodeAt(0) > 255 ? 12 : 7.2), 0)) : undefined;
      return p ? <g key={node.id} data-fallback-node={node.id} opacity={dimmed ? .28 : 1} onPointerEnter={() => onHover(node.id)} onPointerLeave={() => onHover(undefined)}>
        <title>{node.label}</title>
        <circle cx={p.screenX} cy={p.screenY} r={radius} fill={colorMode === 'type' ? TYPE_COLORS[node.type] ?? '#94a3b8' : COMMUNITY_COLORS[node.community % COMMUNITY_COLORS.length]} />
        {label && !dimmed && <text x={label.x} y={label.y} textAnchor={label.anchor} fontWeight={600}>{label.text}</text>}
      </g> : null;
    })}
  </svg>;
}
