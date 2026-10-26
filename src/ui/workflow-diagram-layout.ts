import type { WorkflowTemplate } from '../domain/types.js';

type Steps = WorkflowTemplate['steps'];
export interface WorkflowDiagramNode {
  index: number; row: number; x: number; y: number; width: number; height: number;
}
export interface WorkflowDiagramReturn {
  source: number; target: number; path: string; label: { x: number; y: number };
}

/** Allocate row tracks and exterior lanes before placing any nodes.
 * Every return has its own row track, including distinct arrival/departure tracks.
 * Incomplete snake rows stay at the preceding row's turning edge.
 */
export function workflowDiagramLayout(steps: Steps, availableWidth: number) {
  const width = Math.max(180, Math.floor(Number.isFinite(availableWidth) ? availableWidth : 720));
  const padding = 16, gap = 44, nodeHeight = 106, trackHeight = 24;
  const returns = steps.flatMap((step, source) => {
    const target = steps.findIndex(candidate => candidate.id === step.onRejectStepId);
    return target >= 0 && target < source ? [{ source, target }] : [];
  });
  const columns = Math.max(1, Math.min(3, steps.length || 1, Math.floor((width - 104 + gap) / (192 + gap))));
  const rowCount = Math.ceil(steps.length / columns);
  const crossRow = returns.filter(edge => Math.floor(edge.source / columns) !== Math.floor(edge.target / columns));
  const exteriorBudget = Math.max(24, width - padding * 2 - columns * 120 - (columns - 1) * gap);
  const laneSpacing = crossRow.length ? Math.min(12, (exteriorBudget - 24) / crossRow.length) : 0;
  const exterior = crossRow.length ? 24 + crossRow.length * laneSpacing : 0;
  const nodeWidth = Math.max(80, (width - padding * 2 - exterior - (columns - 1) * gap) / columns);
  const tracks = Array.from({ length: rowCount }, () => [] as number[]);
  returns.forEach((edge, index) => {
    const sourceRow = Math.floor(edge.source / columns), targetRow = Math.floor(edge.target / columns);
    tracks[sourceRow]!.push(index);
    if (sourceRow !== targetRow) tracks[targetRow]!.push(index);
  });
  const rows: number[] = [];
  let height = padding;
  for (let row = 0; row < rowCount; row++) {
    rows.push(height);
    height += nodeHeight + 32 + tracks[row]!.length * trackHeight;
  }
  height += padding;
  const nodes: WorkflowDiagramNode[] = steps.map((_, index) => {
    const row = Math.floor(index / columns);
    const column = row % 2 ? columns - 1 - index % columns : index % columns;
    return { index, row, x: padding + column * (nodeWidth + gap), y: rows[row]!, width: nodeWidth, height: nodeHeight };
  });
  const forwardEdges = nodes.slice(1).map((node, index) => {
    const previous = nodes[index]!;
    return previous.row !== node.row
      ? `M ${previous.x + nodeWidth / 2} ${previous.y + nodeHeight} V ${node.y}`
      : previous.x < node.x
        ? `M ${previous.x + nodeWidth} ${previous.y + nodeHeight / 2} H ${node.x}`
        : `M ${previous.x} ${previous.y + nodeHeight / 2} H ${node.x + nodeWidth}`;
  });
  const trackY = (row: number, edge: number) => rows[row]! + nodeHeight + 20 + tracks[row]!.indexOf(edge) * trackHeight;
  const returnEdges: WorkflowDiagramReturn[] = returns.map((edge, index) => {
    const source = nodes[edge.source]!, target = nodes[edge.target]!;
    // Distinct bottom ports keep a return arrow separate from the sequence's turning arrow.
    const start = source.x + nodeWidth * .72, end = target.x + nodeWidth * .28;
    const departure = trackY(source.row, index), arrival = trackY(target.row, index);
    const lane = width - padding - 8 - crossRow.findIndex(candidate => candidate === edge) * laneSpacing;
    const path = source.row === target.row
      ? `M ${start} ${source.y + nodeHeight} V ${departure} H ${end} V ${target.y + nodeHeight}`
      : `M ${start} ${source.y + nodeHeight} V ${departure} H ${lane} V ${arrival} H ${end} V ${target.y + nodeHeight}`;
    // Keep labels between the sequence's center turn and the red departure port.
    return { ...edge, path, label: { x: source.x + nodeWidth * .61, y: departure - 4 } };
  });
  return { width, height: Math.max(80, height), columns, nodeWidth, nodes, forwardEdges, returnEdges };
}
