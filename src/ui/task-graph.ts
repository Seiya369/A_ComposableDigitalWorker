export interface GraphDependency { id: string; dependencyIds: string[] }
export interface GraphPosition { id: string; x: number; y: number }
export const GRAPH_NODE_WIDTH = 224;
export const GRAPH_NODE_HEIGHT = 100;

/** Pure deterministic layout: execution truth stays in the task repository. */
export function layoutTaskGraph(input: GraphDependency[]) {
  const nodes = [...input].sort((a, b) => a.id.localeCompare(b.id));
  const ids = new Set(nodes.map(node => node.id));
  const dependencies = new Map(nodes.map(node => [node.id, [...new Set(node.dependencyIds)].filter(id => ids.has(id)).sort()]));
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  let hasCycle = false;
  function visit(id: string): number {
    if (depth.has(id)) return depth.get(id)!;
    if (visiting.has(id)) { hasCycle = true; return 0; }
    visiting.add(id);
    const previous = dependencies.get(id) ?? [];
    const value = previous.length ? Math.max(...previous.map(visit)) + 1 : 0;
    visiting.delete(id); depth.set(id, value); return value;
  }
  nodes.forEach(node => visit(node.id));
  const rows = new Map<number, number>();
  const positions = nodes.map(node => {
    const column = depth.get(node.id) ?? 0;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    return { id: node.id, x: 24 + column * (GRAPH_NODE_WIDTH + 64), y: 24 + row * (GRAPH_NODE_HEIGHT + 28) };
  });
  return {
    nodes: positions,
    edges: nodes.flatMap(node => (dependencies.get(node.id) ?? []).map(from => ({ from, to: node.id }))),
    width: Math.max(320, ...positions.map(node => node.x + GRAPH_NODE_WIDTH + 24)),
    height: Math.max(180, ...positions.map(node => node.y + GRAPH_NODE_HEIGHT + 24)),
    hasCycle,
  };
}

export function relatedTaskIds(nodes: GraphDependency[], selectedId: string, direction: 'upstream' | 'downstream'): Set<string> {
  if (!nodes.some(node => node.id === selectedId)) return new Set();
  const links = new Map(nodes.map(node => [node.id, direction === 'upstream' ? node.dependencyIds : nodes.filter(other => other.dependencyIds.includes(node.id)).map(other => other.id)]));
  const visited = new Set<string>();
  const pending = [selectedId];
  while (pending.length) { const id = pending.pop()!; if (visited.has(id)) continue; visited.add(id); pending.push(...(links.get(id) ?? [])); }
  return visited;
}
