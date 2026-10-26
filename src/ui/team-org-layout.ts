import type { TeamHierarchyNode } from '../domain/team-hierarchy.js';

export const TEAM_ORG_CARD_WIDTH = 184;
export const TEAM_ORG_CARD_HEIGHT = 88;
const COLUMN_GAP = 24;
const ROW_GAP = 36;
const PADDING = 16;

export interface TeamOrgTransform { x: number; y: number; scale: number }
export interface TeamOrgExtent { width: number; height: number }
export interface TeamOrgPosition { node: TeamHierarchyNode; x: number; y: number }

/** Arrange complete subtrees without overlapping cards, including multiple roots. */
export function layoutTeamHierarchy(roots: TeamHierarchyNode[]) {
  const widths = new Map<TeamHierarchyNode, number>();
  const measure = (node: TeamHierarchyNode): number => {
    const width = Math.max(TEAM_ORG_CARD_WIDTH, node.children.reduce((sum, child) => sum + measure(child), 0) + Math.max(0, node.children.length - 1) * COLUMN_GAP);
    widths.set(node, width);
    return width;
  };
  const width = roots.reduce((sum, root) => sum + measure(root), 0) + Math.max(0, roots.length - 1) * COLUMN_GAP + PADDING * 2;
  const nodes: TeamOrgPosition[] = [];
  const edges: string[] = [];
  const place = (node: TeamHierarchyNode, left: number): TeamOrgPosition => {
    const x = left + (widths.get(node)! - TEAM_ORG_CARD_WIDTH) / 2;
    const y = PADDING + (node.level - 1) * (TEAM_ORG_CARD_HEIGHT + ROW_GAP);
    const positioned = { node, x, y };
    nodes.push(positioned);
    let childLeft = left;
    const children = node.children.map(child => {
      const placed = place(child, childLeft);
      childLeft += widths.get(child)! + COLUMN_GAP;
      return placed;
    });
    if (children.length) {
      const center = x + TEAM_ORG_CARD_WIDTH / 2;
      const junction = y + TEAM_ORG_CARD_HEIGHT + ROW_GAP / 2;
      edges.push(`M ${center} ${y + TEAM_ORG_CARD_HEIGHT} V ${junction}`);
      if (children.length > 1) edges.push(`M ${children[0]!.x + TEAM_ORG_CARD_WIDTH / 2} ${junction} H ${children.at(-1)!.x + TEAM_ORG_CARD_WIDTH / 2}`);
      for (const child of children) edges.push(`M ${child.x + TEAM_ORG_CARD_WIDTH / 2} ${junction} V ${child.y}`);
    }
    return positioned;
  };
  let left = PADDING;
  for (const root of roots) {
    place(root, left);
    left += widths.get(root)! + COLUMN_GAP;
  }
  const height = nodes.reduce((bottom, node) => Math.max(bottom, node.y + TEAM_ORG_CARD_HEIGHT), 0) + PADDING;
  return { width, height, nodes, edges };
}

/** Largest centered scale that keeps the full chart inside the visible viewport. */
export function fitTeamOrgChart(chart: TeamOrgExtent, viewport: TeamOrgExtent): TeamOrgTransform {
  const width = Math.max(1, viewport.width);
  const height = Math.max(1, viewport.height);
  const scale = Math.min(width / Math.max(1, chart.width), height / Math.max(1, chart.height));
  return { scale, x: (width - chart.width * scale) / 2, y: (height - chart.height * scale) / 2 };
}

/** Zoom about the pointer, so the person under the cursor does not drift. */
export function zoomTeamOrgChart(view: TeamOrgTransform, factor: number, x: number, y: number, fitScale: number): TeamOrgTransform {
  const scale = Math.max(Math.min(.05, fitScale), Math.min(Math.max(4, fitScale * 4), view.scale * factor));
  const ratio = scale / view.scale;
  return { scale, x: x - (x - view.x) * ratio, y: y - (y - view.y) * ratio };
}
