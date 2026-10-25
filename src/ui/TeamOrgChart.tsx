import { useI18n } from './i18n.js';
import { useMemo } from 'react';
import { buildTeamHierarchy } from '../domain/team-hierarchy.js';
import type { EmployeeTemplate, TeamMember } from '../domain/types.js';
import { Icon } from './icons.js';
import './team-org-chart.css';

const CARD_WIDTH = 184;
const CARD_HEIGHT = 88;
const COLUMN_GAP = 24;
const ROW_GAP = 36;
const PADDING = 16;

type HierarchyNode = ReturnType<typeof buildTeamHierarchy>[number];
interface PositionedNode { node: HierarchyNode; x: number; y: number }

function layoutHierarchy(roots: HierarchyNode[]) {
  const widths = new Map<HierarchyNode, number>();
  const measure = (node: HierarchyNode): number => {
    const width = Math.max(CARD_WIDTH, node.children.reduce((sum, child) => sum + measure(child), 0) + Math.max(0, node.children.length - 1) * COLUMN_GAP);
    widths.set(node, width);
    return width;
  };
  const width = roots.reduce((sum, root) => sum + measure(root), 0) + Math.max(0, roots.length - 1) * COLUMN_GAP + PADDING * 2;
  const nodes: PositionedNode[] = [];
  const edges: string[] = [];
  const place = (node: HierarchyNode, left: number): PositionedNode => {
    const x = left + (widths.get(node)! - CARD_WIDTH) / 2;
    const y = PADDING + (node.level - 1) * (CARD_HEIGHT + ROW_GAP);
    const positioned = { node, x, y };
    nodes.push(positioned);
    let childLeft = left;
    const children = node.children.map(child => {
      const placed = place(child, childLeft);
      childLeft += widths.get(child)! + COLUMN_GAP;
      return placed;
    });
    if (children.length) {
      const center = x + CARD_WIDTH / 2;
      const junction = y + CARD_HEIGHT + ROW_GAP / 2;
      edges.push(`M ${center} ${y + CARD_HEIGHT} V ${junction}`);
      if (children.length > 1) edges.push(`M ${children[0]!.x + CARD_WIDTH / 2} ${junction} H ${children.at(-1)!.x + CARD_WIDTH / 2}`);
      for (const child of children) edges.push(`M ${child.x + CARD_WIDTH / 2} ${junction} V ${child.y}`);
    }
    return positioned;
  };
  let left = PADDING;
  for (const root of roots) {
    place(root, left);
    left += widths.get(root)! + COLUMN_GAP;
  }
  const height = nodes.reduce((bottom, node) => Math.max(bottom, node.y + CARD_HEIGHT), 0) + PADDING;
  return { width, height, nodes, edges };
}

export function TeamOrgChart({ members, templates, selectedMemberId, onSelect, readOnly = false }: {
  members: TeamMember[];
  templates: EmployeeTemplate[];
  selectedMemberId?: string;
  onSelect?: (memberId: string) => void;
  readOnly?: boolean;
}) {
  const { t } = useI18n();
  const layout = useMemo(() => layoutHierarchy(buildTeamHierarchy(members)), [members]);
  const templateNames = new Map(templates.map(template => [template.id, template.name]));

  if (!members.length) return <div className="wf-team-org-empty"><Icon name="network" size={26} /><p>{t("暂无团队成员")}</p></div>;

  return <div className="wf-team-org" role="region" aria-label={t("团队组织架构")} tabIndex={0}>
    <div className="wf-team-org-canvas" style={{ width: layout.width, height: layout.height }}>
      <svg className="wf-team-org-lines" width={layout.width} height={layout.height} aria-hidden="true">
        {layout.edges.map((path, index) => <path key={index} d={path} />)}
      </svg>
      {layout.nodes.map(({ node, x, y }) => {
        const templateName = templateNames.get(node.member.templateId) ?? t("未选择员工模板");
        const name = node.member.name?.trim() || templateName;
        const content = <><span className="wf-team-org-node-meta"><Icon name="person" size={16} /><span>{t('第 {level} 级', { level: node.level })}</span></span><strong>{name}</strong>{name !== templateName && <span className="wf-team-org-template">{templateName}</span>}</>;
        const style = { left: x, top: y, width: CARD_WIDTH, height: CARD_HEIGHT };
        const title = t('{name} · 第 {level} 级', { name, level: node.level });
        return readOnly ? <div key={node.member.memberId} className="wf-team-org-node is-read-only" style={style} title={title}>{content}</div> : <button
          type="button"
          key={node.member.memberId}
          className={`wf-team-org-node${selectedMemberId === node.member.memberId ? ' is-selected' : ''}`}
          style={style}
          aria-label={t('配置团队成员 {name}', { name })}
          aria-pressed={selectedMemberId === node.member.memberId}
          title={title}
          onClick={() => onSelect?.(node.member.memberId)}
        >{content}</button>;
      })}
    </div>
  </div>;
}
