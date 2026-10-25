export interface GraphPosition { id: string; x: number; y: number; width: number; height: number }
export interface GraphTransform { x: number; y: number; scale: number }
interface ConceptNode { id: string; name: string }
interface RelationEdge { sourceId: string; targetId: string }

const hash = (id: string) => { let value = 2166136261; for (const char of id) { value ^= char.codePointAt(0)!; value = Math.imul(value, 16777619); } return value >>> 0; };

/** Stable force layout: reordering identical input does not reposition the graph. */
export function layoutConceptGraph(concepts: ConceptNode[], relations: RelationEdge[]): Map<string, GraphPosition> {
  const nodes = [...new Map(concepts.map(node => [node.id, node])).values()].sort((a, b) => a.id.localeCompare(b.id));
  const count = nodes.length; const radius = Math.max(150, Math.sqrt(count) * 78);
  const positions = nodes.map((node, index) => {
    const angle = index * Math.PI * 2 / Math.max(count, 1) + (hash(node.id) % 100) * .001;
    const width = Math.max(104, Math.min(208, [...node.name].reduce((total, char) => total + (char.charCodeAt(0) > 255 ? 13 : 7), 0) + 28));
    return { id: node.id, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, width, height: 44 };
  });
  const byId = new Map(positions.map((node, index) => [node.id, index]));
  const edges = relations.flatMap(edge => {
    const from = byId.get(edge.sourceId); const to = byId.get(edge.targetId);
    return from === undefined || to === undefined || from === to ? [] : [{ from, to }];
  }).sort((a, b) => a.from - b.from || a.to - b.to);
  const iterations = count > 250 ? 90 : 180;
  for (let iteration = 0; iteration < iterations; iteration++) {
    const delta = positions.map(() => ({ x: 0, y: 0 })); const temperature = 20 * (1 - iteration / iterations) + .4;
    for (let a = 0; a < count; a++) for (let b = a + 1; b < count; b++) {
      const dx = positions[a].x - positions[b].x; const dy = positions[a].y - positions[b].y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const collision = Math.abs(dx) < (positions[a].width + positions[b].width) / 2 + 38 && Math.abs(dy) < 94;
      const force = Math.min(80, 9500 / (distance * distance) + (collision ? 12 : 0));
      const x = dx / distance * force; const y = dy / distance * force;
      delta[a].x += x; delta[a].y += y; delta[b].x -= x; delta[b].y -= y;
    }
    for (const edge of edges) {
      const a = positions[edge.from]; const b = positions[edge.to]; const dx = b.x - a.x; const dy = b.y - a.y;
      const distance = Math.max(1, Math.hypot(dx, dy)); const desired = Math.max(220, (a.width + b.width) / 2 + 100);
      const force = (distance - desired) * .025;
      delta[edge.from].x += dx / distance * force; delta[edge.from].y += dy / distance * force;
      delta[edge.to].x -= dx / distance * force; delta[edge.to].y -= dy / distance * force;
    }
    positions.forEach((node, index) => {
      const force = delta[index]; force.x -= node.x * .0018; force.y -= node.y * .0018;
      const distance = Math.max(1, Math.hypot(force.x, force.y));
      node.x += force.x / distance * Math.min(distance, temperature); node.y += force.y / distance * Math.min(distance, temperature);
    });
  }
  if (count === 1) { positions[0].x = 0; positions[0].y = 0; }
  return new Map(positions.map(node => [node.id, node]));
}

export function fitGraph(positions: Map<string, GraphPosition>, width: number, height: number): GraphTransform {
  if (!positions.size || width <= 0 || height <= 0) return { x: width / 2, y: height / 2, scale: 1 };
  const nodes = [...positions.values()];
  const left = Math.min(...nodes.map(node => node.x - node.width / 2)) - 45;
  const right = Math.max(...nodes.map(node => node.x + node.width / 2)) + 45;
  const top = Math.min(...nodes.map(node => node.y - node.height / 2)) - 55;
  const bottom = Math.max(...nodes.map(node => node.y + node.height / 2)) + 55;
  const scale = Math.max(.01, Math.min(1.2, (width - 32) / (right - left), (height - 32) / (bottom - top)));
  return { scale, x: width / 2 - (left + right) / 2 * scale, y: height / 2 - (top + bottom) / 2 * scale };
}

export function relationGeometry(from: GraphPosition, to: GraphPosition, index = 0, total = 1) {
  if (from.id === to.id) return { path: `M ${from.x - 20} ${from.y - from.height / 2} C ${from.x - 100} ${from.y - 130}, ${from.x + 100} ${from.y - 130}, ${from.x + 20} ${from.y - from.height / 2 - 5}`, labelX: from.x, labelY: from.y - 101 };
  const dx = to.x - from.x; const dy = to.y - from.y; const distance = Math.max(1, Math.hypot(dx, dy));
  const fromRatio = Math.min((from.width / 2 + 7) / Math.max(.001, Math.abs(dx)), (from.height / 2 + 7) / Math.max(.001, Math.abs(dy)), .45);
  const toRatio = Math.min((to.width / 2 + 11) / Math.max(.001, Math.abs(dx)), (to.height / 2 + 11) / Math.max(.001, Math.abs(dy)), .45);
  const x1 = from.x + dx * fromRatio; const y1 = from.y + dy * fromRatio;
  const x2 = to.x - dx * toRatio; const y2 = to.y - dy * toRatio;
  const direction = from.id.localeCompare(to.id) < 0 ? 1 : -1; const bend = (index - (total - 1) / 2) * 58 * direction;
  const cx = (x1 + x2) / 2 - dy / distance * bend; const cy = (y1 + y2) / 2 + dx / distance * bend;
  return { path: `M ${x1} ${y1} Q ${cx} ${cy}, ${x2} ${y2}`, labelX: (x1 + 2 * cx + x2) / 4, labelY: (y1 + 2 * cy + y2) / 4 };
}
