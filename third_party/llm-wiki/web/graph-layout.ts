/* SPDX-License-Identifier: GPL-3.0-only
 * A deterministic concentric semantic network. Components are metadata, never artificial nodes or links.
 */
import type { WikiView } from './protocol.js';

export interface GroupLayout {
  id: string; community: number; label: string; nodeIds: string[];
  x: number; y: number; radius: number;
}
export interface GroupedLayout { positions: Map<string, { x: number; y: number }>; groups: GroupLayout[] }

/** Fit already projected ratio-one coordinates without changing any graph position. */
export function fitGraphCameraRatio(points: readonly { x: number; y: number }[], viewport: { width: number; height: number }): number | undefined {
  const finite = points.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!finite.length) return undefined;
  const xs = finite.map(point => point.x), ys = finite.map(point => point.y);
  const width = Math.max(...xs) - Math.min(...xs), height = Math.max(...ys) - Math.min(...ys);
  if (width === 0 && height === 0) return .65;
  const padding = Math.min(64, Math.max(12, Math.min(viewport.width, viewport.height) / 4));
  return Math.max(.05, Math.min(20, Math.max(width / Math.max(1, viewport.width - padding * 2), height / Math.max(1, viewport.height - padding * 2))));
}

/** Allocate regular rings, with most nodes on the perimeter and room for a small inner core. */
function ringCounts(total: number): number[] {
  if (total <= 7) return total ? [total] : [];
  const count = Math.ceil(Math.sqrt(total / 6));
  const weights = Array.from({ length: count }, (_, index) => (index + 1) * (index + 2));
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const shares = weights.map(weight => (total - count) * weight / weightSum);
  const counts = shares.map(share => 1 + Math.floor(share));
  const remainder = total - counts.reduce((sum, value) => sum + value, 0);
  const order = shares.map((share, index) => ({ index, fraction: share - Math.floor(share) }))
    .sort((a, b) => b.fraction - a.fraction || b.index - a.index);
  for (let index = 0; index < remainder; index++) counts[order[index].index]++;
  return counts;
}

/** Only real degree and adjacency influence the rings; reading, labels and color metadata never do. */
export function groupedSemanticLayout(graph: WikiView['graph'], _spaceId: string): GroupedLayout {
  const nodes = [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id));
  const byId = new Map(nodes.map(node => [node.id, node]));
  const neighbors = new Map(nodes.map(node => [node.id, new Set<string>()]));
  const strength = new Map(nodes.map(node => [node.id, 0]));
  for (const edge of [...graph.edges].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!byId.has(edge.source) || !byId.has(edge.target) || edge.source === edge.target) continue;
    neighbors.get(edge.source)!.add(edge.target); neighbors.get(edge.target)!.add(edge.source);
    const weight = Number.isFinite(edge.weight) ? Math.max(0, edge.weight) : 0;
    strength.set(edge.source, strength.get(edge.source)! + weight); strength.set(edge.target, strength.get(edge.target)! + weight);
  }
  const compareIds = (a: string, b: string) => neighbors.get(b)!.size - neighbors.get(a)!.size || strength.get(b)! - strength.get(a)! || a.localeCompare(b);
  const ranked = nodes.map(node => node.id).sort(compareIds);
  const rank = new Map(ranked.map((id, index) => [id, index]));
  const walkOrder = (ids: readonly string[]) => {
    const remaining = new Set(ids), result: string[] = [];
    for (const seed of [...ids].sort(compareIds)) {
      let current: string | undefined = remaining.has(seed) ? seed : undefined;
      while (current !== undefined) {
        result.push(current); remaining.delete(current);
        current = [...neighbors.get(current)!].filter(id => remaining.has(id)).sort(compareIds)[0];
      }
    }
    return result;
  };
  const positions = new Map<string, { x: number; y: number }>();
  const angles = new Map<string, number>();
  const counts = ringCounts(nodes.length);
  // A small star reads more clearly with its unique actual hub at the center.
  const smallHub = nodes.length >= 4 && nodes.length <= 7 && neighbors.get(ranked[0])!.size >= 3
    && neighbors.get(ranked[0])!.size > neighbors.get(ranked[1])!.size;
  const rings = smallHub ? [1, nodes.length - 1] : counts;
  let offset = 0;
  rings.forEach((count, ringIndex) => {
    const members = ranked.slice(offset, offset + count); offset += count;
    const radius = ringIndex === 0 && count === 1 ? 0 : 100 * ((ringIndex + 1) / rings.length) ** 1.2;
    const anchors = new Map<string, number>();
    for (const id of members) {
      const previous = [...neighbors.get(id)!].filter(neighbor => angles.has(neighbor));
      const x = previous.reduce((sum, neighbor) => sum + Math.cos(angles.get(neighbor)!), 0);
      const y = previous.reduce((sum, neighbor) => sum + Math.sin(angles.get(neighbor)!), 0);
      if (previous.length && Math.hypot(x, y) > 1e-9) anchors.set(id, (Math.atan2(y, x) + Math.PI * 2) % (Math.PI * 2));
    }
    const ordered = anchors.size ? [...members].sort((a, b) => (anchors.get(a) ?? Infinity) - (anchors.get(b) ?? Infinity) || rank.get(a)! - rank.get(b)!) : walkOrder(members);
    const step = Math.PI * 2 / count;
    let cosine = 0, sine = 0;
    ordered.forEach((id, index) => {
      for (const neighbor of neighbors.get(id)!) if (angles.has(neighbor)) {
        const rotation = angles.get(neighbor)! - index * step;
        cosine += Math.cos(rotation); sine += Math.sin(rotation);
      }
    });
    const rotation = Math.hypot(cosine, sine) > 1e-9 ? Math.atan2(sine, cosine) : -Math.PI / 2 + (ringIndex % 2 ? step / 2 : 0);
    ordered.forEach((id, index) => {
      const angle = rotation + index * step;
      positions.set(id, radius ? { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius } : { x: 0, y: 0 });
      if (radius) angles.set(id, angle);
    });
  });
  // Keep map iteration independent of traversal order for callers and metadata refreshes.
  const stablePositions = new Map(nodes.map(node => [node.id, positions.get(node.id)!]));

  const memberships = new Map<string, string[]>();
  const componentIds = new Map<string, string>();
  for (const node of nodes) {
    if (componentIds.has(node.id)) continue;
    const queue = [node.id]; componentIds.set(node.id, node.id);
    for (let index = 0; index < queue.length; index++) for (const next of [...neighbors.get(queue[index])!].sort()) {
      if (!componentIds.has(next)) { componentIds.set(next, node.id); queue.push(next); }
    }
  }
  for (const node of nodes) {
    const id = `component:${componentIds.get(node.id)}`;
    const members = memberships.get(id) ?? []; members.push(node.id); memberships.set(id, members);
  }
  const groups: GroupLayout[] = [...memberships].map(([id, nodeIds]) => {
    const ranked = nodeIds.map(nodeId => byId.get(nodeId)!).sort((a, b) => b.linkCount - a.linkCount || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
    const points = nodeIds.map(nodeId => stablePositions.get(nodeId)!);
    const x = (Math.min(...points.map(point => point.x)) + Math.max(...points.map(point => point.x))) / 2;
    const y = (Math.min(...points.map(point => point.y)) + Math.max(...points.map(point => point.y))) / 2;
    return { id, nodeIds, community: ranked[0].community, label: ranked[0].label, x, y,
      radius: 26 + Math.max(...points.map(point => Math.hypot(point.x - x, point.y - y)), 0) };
  }).sort((a, b) => b.nodeIds.length - a.nodeIds.length || a.nodeIds[0].localeCompare(b.nodeIds[0]));
  return { positions: stablePositions, groups };
}
