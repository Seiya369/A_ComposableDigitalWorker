/* SPDX-License-Identifier: GPL-3.0-only */
import { isSemanticType, semanticGraphForDisplay, type WikiEdge, type WikiView } from './protocol.js';

/** Highlight only actual one-hop semantic relationships; never infer links from page navigation. */
export function semanticFocus(graph: WikiView['graph'], nodeId?: string, edgeId?: string, explorationNodeIds?: ReadonlySet<string>): { nodeIds: Set<string>; edges: WikiEdge[] } {
  if (explorationNodeIds !== undefined) {
    const eligible = new Set(graph.nodes.filter(node => isSemanticType(node.type)).map(node => node.id));
    const nodeIds = new Set([...explorationNodeIds].filter(id => eligible.has(id)));
    return { nodeIds, edges: graph.edges.filter(edge => edge.source !== edge.target && nodeIds.has(edge.source) && nodeIds.has(edge.target)) };
  }
  const nodeIds = new Set<string>();
  const selected = nodeId && graph.nodes.some(node => node.id === nodeId) ? nodeId : undefined;
  if (selected) nodeIds.add(selected);
  const edges = graph.edges.filter(edge => selected ? edge.source === selected || edge.target === selected : edge.id === edgeId);
  for (const edge of edges) { nodeIds.add(edge.source); nodeIds.add(edge.target); }
  return { nodeIds, edges };
}

export interface SemanticExploration {
  readonly spaceId: string;
  readonly version: number;
  readonly rootId: string;
  readonly nodeIds: ReadonlySet<string>;
  readonly depth: number;
}
export interface SemanticExplorationProjection {
  rootId?: string;
  depth: number;
  nodeIds: Set<string>;
  edges: WikiEdge[];
  nextNodeIds: Set<string>;
  expandableCount: number;
  canExpand: boolean;
}

/** Search context is one real hop only; type filters apply after that context is formed. */
export function visibleSemanticNodeIds(view: WikiView, hiddenTypes: ReadonlySet<string>, query: string, selectedNode?: string): Set<string> {
  const graph = semanticGraphForDisplay(view);
  const pages = new Map(view.pages.map(page => [page.id, page]));
  const needle = query.trim().toLocaleLowerCase();
  const matching = new Set(graph.nodes.filter(node => !needle || [node.label, node.type, ...(pages.get(node.id)?.aliases ?? [])]
    .some(value => value.toLocaleLowerCase().includes(needle))).map(node => node.id));
  const context = new Set(matching);
  if (needle && selectedNode && matching.has(selectedNode)) for (const edge of graph.edges) if (edge.source === selectedNode || edge.target === selectedNode) {
    context.add(edge.source); context.add(edge.target);
  }
  return new Set(graph.nodes.filter(node => !hiddenTypes.has(node.type) && context.has(node.id)).map(node => node.id));
}

/** Start one visible semantic hop; document reading is deliberately outside this state. */
export function startSemanticExploration(view: WikiView, rootId: string, visibleIds: ReadonlySet<string>): SemanticExploration | undefined {
  const graph = semanticGraphForDisplay(view);
  if (!visibleIds.has(rootId) || !graph.nodes.some(node => node.id === rootId)) return undefined;
  const visible = { ...graph, nodes: graph.nodes.filter(node => visibleIds.has(node.id)), edges: graph.edges.filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target)) };
  return { spaceId: view.spaceId, version: view.version, rootId, nodeIds: semanticFocus(visible, rootId).nodeIds, depth: 1 };
}

const emptyProjection = (): SemanticExplorationProjection => ({ depth: 0, nodeIds: new Set(), edges: [], nextNodeIds: new Set(), expandableCount: 0, canExpand: false });

/** Project only the explored component still reachable from the root through visible explored nodes. */
export function projectSemanticExploration(view: WikiView, state: SemanticExploration | undefined, visibleIds: ReadonlySet<string>): SemanticExplorationProjection {
  if (!state || state.spaceId !== view.spaceId || state.version !== view.version || !visibleIds.has(state.rootId) || !state.nodeIds.has(state.rootId)) return emptyProjection();
  const graph = semanticGraphForDisplay(view);
  const allowed = new Set(graph.nodes.filter(node => visibleIds.has(node.id)).map(node => node.id));
  if (!allowed.has(state.rootId)) return emptyProjection();
  const adjacency = new Map([...allowed].map(id => [id, new Set<string>()]));
  for (const edge of graph.edges) if (allowed.has(edge.source) && allowed.has(edge.target)) {
    adjacency.get(edge.source)!.add(edge.target); adjacency.get(edge.target)!.add(edge.source);
  }
  const nodeIds = new Set([state.rootId]), queue = [state.rootId];
  for (let index = 0; index < queue.length; index++) for (const neighbor of adjacency.get(queue[index]!) ?? []) {
    if (!state.nodeIds.has(neighbor) || nodeIds.has(neighbor)) continue;
    nodeIds.add(neighbor); queue.push(neighbor);
  }
  const nextNodeIds = new Set<string>();
  for (const id of nodeIds) for (const neighbor of adjacency.get(id) ?? []) if (!nodeIds.has(neighbor)) nextNodeIds.add(neighbor);
  return { rootId: state.rootId, depth: state.depth, nodeIds, edges: graph.edges.filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target)), nextNodeIds,
    expandableCount: nextNodeIds.size, canExpand: nextNodeIds.size > 0 };
}

/** Add one BFS frontier without changing the graph, prior state, evidence direction or document content. */
export function expandSemanticExploration(view: WikiView, state: SemanticExploration | undefined, visibleIds: ReadonlySet<string>): SemanticExploration | undefined {
  const projection = projectSemanticExploration(view, state, visibleIds);
  if (!state || projection.rootId === undefined) return undefined;
  if (!projection.canExpand) return state;
  return { ...state, nodeIds: new Set([...state.nodeIds, ...projection.nextNodeIds]), depth: state.depth + 1 };
}
