export interface ConversationWorkflowLayoutStep {
  id: string;
  name?: string;
  onRejectStepId?: string;
}

export interface ConversationWorkflowLayoutInput {
  steps: readonly ConversationWorkflowLayoutStep[];
  visibleIds: readonly string[];
  width: number;
  beforeWidth?: number;
  afterWidth?: number;
  /** Legacy caller field; no longer changes the native row or the node anchor. */
  belowSpace?: number;
  /** Plugin-only visual translation to the native tab text baseline. */
  offsetY?: number;
  /** Measured free space above the fixed slot, bounded by the native header. */
  aboveSpace?: number;
  /** Without native tabs, keep a compact circle-only contribution inside the existing row. */
  showLabels?: boolean;
}

export interface ConversationWorkflowLayoutNode {
  id: string;
  /** Position in the complete, frozen workflow definition. */
  index: number;
  left: number;
  width: number;
  x: number;
  y: number;
}

export interface ConversationWorkflowLayoutEdge {
  id: string;
  kind: 'sequence' | 'continuation' | 'reject';
  sourceId: string;
  targetId: string;
  sourceIndex: number;
  targetIndex: number;
  lane?: number;
  path: string;
}

/** Display only cross-step returns; self retry remains an execution rule. */
export interface ConversationWorkflowLayoutReturn {
  sourceId: string;
  targetId: string;
  sourceIndex: number;
  targetIndex: number;
  sourceName: string;
  targetName: string;
  visible: boolean;
  drawn: boolean;
}

export interface ConversationWorkflowLayout {
  width: number;
  height: number;
  drawingHeight: number;
  drawingTop: number;
  contentHeight: number;
  reserveTop: number;
  /** Content translation inside the native header; never changes the row's layout height. */
  offsetY: number;
  nodeY: number;
  nodeWidth: number;
  nodes: ConversationWorkflowLayoutNode[];
  edges: ConversationWorkflowLayoutEdge[];
  returns: ConversationWorkflowLayoutReturn[];
  /** Visible returns that could not fit the three available lanes. */
  overflowReturnCount: number;
}

const RADIUS = 14;
const LANE_SPACING = 5;
const MAX_LANES = 3;
const DRAW_PADDING = 1;
const CONTINUATION_LENGTH = 12;
const finiteSize = (value: number | undefined) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
const coordinate = (value: number) => Number(value.toFixed(3));

/** Keep the active step at the middle slot after the leading steps, clamped at both ends. */
export function selectConversationWorkflowWindow(total: number, width: number, currentIndex: number) {
  if (total <= 0) return { start: 0, count: 0, beforeWidth: 0, afterWidth: 0 };
  const available = finiteSize(width);
  const overflow = total * 88 > available;
  const count = Math.min(total, Math.max(1, Math.floor((available - (overflow ? 48 : 0)) / 88)));
  const current = Number.isFinite(currentIndex) ? Math.max(0, Math.min(total - 1, currentIndex)) : 0;
  const start = Math.max(0, Math.min(total - count, current - Math.floor((count - 1) / 2)));
  // Reserve both ellipsis slots throughout an overflowing workflow so its nodes never reflow at either end.
  // Below one circle plus two controls, keep the current node and let the external Details button list hidden steps.
  const gutter = overflow && available >= RADIUS * 2 + 48 ? 24 : 0;
  return { start, count, beforeWidth: gutter, afterWidth: gutter };
}

/** Only geometry is derived here. It neither changes progress nor invents a transition. */
export function layoutConversationWorkflow(input: ConversationWorkflowLayoutInput): ConversationWorkflowLayout {
  const width = finiteSize(input.width);
  const beforeWidth = Math.min(width, finiteSize(input.beforeWidth));
  const afterWidth = Math.min(width - beforeWidth, finiteSize(input.afterWidth));
  const selected = new Set(input.visibleIds);
  const unique = new Map<string, { step: ConversationWorkflowLayoutStep; index: number }>();
  input.steps.forEach((step, index) => { if (!unique.has(step.id)) unique.set(step.id, { step, index }); });
  const visible = [...unique.values()].filter(({ step }) => selected.has(step.id));
  const available = width - beforeWidth - afterWidth;
  const nodeWidth = visible.length ? available / visible.length : 0;
  // An unmeasured or impossibly narrow strip must not paint overlapping circles.
  const nodes: ConversationWorkflowLayoutNode[] = nodeWidth >= RADIUS * 2 ? visible.map(({ step, index }, offset) => ({
    id: step.id, index, left: beforeWidth + offset * nodeWidth, width: nodeWidth,
    x: beforeWidth + (offset + .5) * nodeWidth, y: 0,
  })) : [];
  const byId = new Map(nodes.map(node => [node.id, node]));
  const height = 30;
  const reserveTop = 0;
  const offsetY = finiteSize(input.offsetY);
  const nodeY = 16 + offsetY;
  const contentHeight = input.showLabels === false ? 30 : 52;
  const aboveSpace = finiteSize(input.aboveSpace);
  const crownY = nodeY - RADIUS;
  // A one-pixel corner leaves a complete five-pixel downward arrow stem at the crown.
  const trackYForLane = (lane: number) => crownY - 6 - lane * LANE_SPACING;
  const laneCapacity = Math.max(0, Math.min(MAX_LANES, Math.floor((trackYForLane(0) + aboveSpace - DRAW_PADDING) / LANE_SPACING) + 1));
  const returns: ConversationWorkflowLayoutReturn[] = [];
  for (const { step, index } of unique.values()) {
    const destination = step.onRejectStepId ? unique.get(step.onRejectStepId) : undefined;
    if (!destination || destination.index >= index) continue;
    returns.push({ sourceId: step.id, targetId: destination.step.id, sourceIndex: index, targetIndex: destination.index,
      sourceName: step.name ?? step.id, targetName: destination.step.name ?? destination.step.id,
      visible: byId.has(step.id) && byId.has(destination.step.id), drawn: false });
  }

  const candidates = returns.filter(item => item.visible).map(item => {
    const source = byId.get(item.sourceId)!, target = byId.get(item.targetId)!;
    return { item, source, target, left: target.x, right: source.x, lane: -1 };
  }).sort((a, b) => a.left - b.left || a.right - b.right || a.item.sourceIndex - b.item.sourceIndex);
  const laneEnds: number[] = [];
  for (const candidate of candidates) {
    let lane = laneEnds.findIndex(end => candidate.left >= end + 6);
    if (lane < 0 && laneEnds.length < laneCapacity) lane = laneEnds.length;
    if (lane < 0) continue;
    laneEnds[lane] = candidate.right;
    candidate.lane = lane; candidate.item.drawn = true;
  }

  nodes.forEach(node => { node.y = nodeY; });
  const edges: ConversationWorkflowLayoutEdge[] = [];
  for (const source of nodes) {
    const target = byId.get(input.steps[source.index + 1]?.id ?? '');
    if (!target || target.index !== source.index + 1) continue;
    edges.push({ id: `sequence:${source.index}:${target.index}`, kind: 'sequence', sourceId: source.id, targetId: target.id,
      sourceIndex: source.index, targetIndex: target.index,
      path: `M ${coordinate(source.x + RADIUS)} ${nodeY} H ${coordinate(target.x - RADIUS)}` });
  }
  // Only the two window boundaries can continue toward real omitted adjacent steps.
  // These short strokes stop before the static ellipses and never invent a jump across a gap.
  const first = nodes[0], last = nodes.at(-1);
  const previous = first && input.steps[first.index - 1];
  if (first && previous && !byId.has(previous.id) && first.x - RADIUS > 0) {
    edges.push({ id: `continuation:${first.index - 1}:${first.index}`, kind: 'continuation', sourceId: previous.id, targetId: first.id,
      sourceIndex: first.index - 1, targetIndex: first.index,
      path: `M ${coordinate(Math.max(0, first.x - RADIUS - CONTINUATION_LENGTH))} ${nodeY} H ${coordinate(first.x - RADIUS)}` });
  }
  const next = last && input.steps[last.index + 1];
  if (last && next && !byId.has(next.id) && last.x + RADIUS < width) {
    edges.push({ id: `continuation:${last.index}:${last.index + 1}`, kind: 'continuation', sourceId: last.id, targetId: next.id,
      sourceIndex: last.index, targetIndex: last.index + 1,
      path: `M ${coordinate(last.x + RADIUS)} ${nodeY} H ${coordinate(Math.min(width, last.x + RADIUS + CONTINUATION_LENGTH))}` });
  }
  for (const { item, source, target, lane } of candidates) {
    if (lane < 0) continue;
    const trackY = coordinate(trackYForLane(lane));
    const sourceX = coordinate(source.x), targetX = coordinate(target.x), top = coordinate(crownY);
    const path = `M ${sourceX} ${top} V ${trackY + 1} Q ${sourceX} ${trackY} ${coordinate(source.x - 1)} ${trackY} H ${coordinate(target.x + 1)} Q ${targetX} ${trackY} ${targetX} ${trackY + 1} V ${top}`;
    edges.push({ id: `reject:${item.sourceIndex}:${item.targetIndex}`, kind: 'reject', sourceId: item.sourceId,
      targetId: item.targetId, sourceIndex: item.sourceIndex, targetIndex: item.targetIndex, lane, path });
  }
  const drawingTop = coordinate(Math.min(0, ...candidates.filter(item => item.lane >= 0).map(item => trackYForLane(item.lane) - DRAW_PADDING)));
  return { width, height, drawingTop, drawingHeight: coordinate(Math.max(height, contentHeight + offsetY) - drawingTop), contentHeight, reserveTop, offsetY, nodeY, nodeWidth: nodes.length ? nodeWidth : 0, nodes, edges, returns,
    overflowReturnCount: returns.filter(item => item.visible && !item.drawn).length };
}
