import { useI18n } from './i18n.js';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { buildTeamHierarchy } from '../domain/team-hierarchy.js';
import type { EmployeeTemplate, TeamMember } from '../domain/types.js';
import { Icon } from './icons.js';
import { fitTeamOrgChart, layoutTeamHierarchy, TEAM_ORG_CARD_HEIGHT, TEAM_ORG_CARD_WIDTH, zoomTeamOrgChart, type TeamOrgTransform } from './team-org-layout.js';
import './team-org-chart.css';

export function TeamOrgChart({ members, templates, selectedMemberId, onSelect, readOnly = false }: {
  members: TeamMember[];
  templates: EmployeeTemplate[];
  selectedMemberId?: string;
  onSelect?: (memberId: string) => void;
  readOnly?: boolean;
}) {
  const { t } = useI18n();
  const layout = useMemo(() => layoutTeamHierarchy(buildTeamHierarchy(members)), [members]);
  const structure = JSON.stringify(members.map(member => [member.memberId, member.reportsTo]));
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 360 });
  const [view, setView] = useState<TeamOrgTransform>({ x: 0, y: 0, scale: 1 });
  const drag = useRef<{ pointerId: number; clientX: number; clientY: number; x: number; y: number }>();
  const [panning, setPanning] = useState(false);
  const templateNames = new Map(templates.map(template => [template.id, template.name]));
  const fit = () => fitTeamOrgChart(layout, size);
  const zoom = (factor: number) => setView(previous => zoomTeamOrgChart(previous, factor, size.width / 2, size.height / 2, fit().scale));

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width > 0 && height > 0) setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    };
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(element); window.addEventListener('resize', measure); measure();
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [members.length > 0]);
  // A name edit does not reset a user's zoom; relationship changes and resizes refit the whole tree.
  useEffect(() => { setView(fitTeamOrgChart(layout, size)); }, [structure, layout.width, layout.height, size.width, size.height]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = element.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1);
      setView(previous => zoomTeamOrgChart(previous, Math.exp(-Math.max(-400, Math.min(400, delta)) * .0015), event.clientX - bounds.left, event.clientY - bounds.top, fitTeamOrgChart(layout, size).scale));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [members.length > 0, layout.width, layout.height, size.width, size.height]);

  const startPan = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button'))) return;
    drag.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: view.x, y: view.y };
    event.currentTarget.setPointerCapture?.(event.pointerId); setPanning(true);
  };
  const pan = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (start?.pointerId === event.pointerId) setView(previous => ({ ...previous, x: start.x + event.clientX - start.clientX, y: start.y + event.clientY - start.clientY }));
  };
  const endPan = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = undefined; setPanning(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const direction = ({ ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] } as Record<string, number[]>)[event.key];
    if (direction) { event.preventDefault(); setView(previous => ({ ...previous, x: previous.x + direction[0]!, y: previous.y + direction[1]! })); }
    else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.2); }
    else if (event.key === '-') { event.preventDefault(); zoom(1 / 1.2); }
    else if (event.key === '0' || event.key === 'Home') { event.preventDefault(); setView(fit()); }
  };

  if (!members.length) return <div className="wf-team-org-empty"><Icon name="network" size={26} /><p>{t("暂无团队成员")}</p></div>;

  return <div className="wf-team-org" role="region" aria-label={t("团队组织架构")}>
    <div className="wf-team-org-controls" role="toolbar" aria-label={t("图谱视图")}>
      <button type="button" aria-label={t("放大")} title={t("放大")} onClick={() => zoom(1.2)}>＋</button>
      <output aria-live="off">{Math.round(view.scale * 100)}%</output>
      <button type="button" aria-label={t("缩小")} title={t("缩小")} onClick={() => zoom(1 / 1.2)}>−</button>
      <button type="button" aria-label={t("适配视图")} title={`${t("适配视图")} · 0`} onClick={() => setView(fit())}><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M7 3H3v4m10-4h4v4M3 13v4h4m10-4v4h-4" /></svg></button>
    </div>
    <div className={`wf-team-org-viewport${panning ? ' is-panning' : ''}`} ref={viewport} tabIndex={0} aria-label={t("团队组织架构")} onKeyDown={navigate} onPointerDown={startPan} onPointerMove={pan} onPointerUp={endPan} onPointerCancel={endPan} onLostPointerCapture={endPan}>
      <div className="wf-team-org-canvas" data-scale={view.scale} style={{ width: layout.width, height: layout.height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
        <svg className="wf-team-org-lines" width={layout.width} height={layout.height} aria-hidden="true">
          {layout.edges.map((path, index) => <path key={index} d={path} />)}
        </svg>
        {layout.nodes.map(({ node, x, y }) => {
          const templateName = templateNames.get(node.member.templateId) ?? t("未选择员工模板");
          const name = node.member.name?.trim() || templateName;
          const content = <><span className="wf-team-org-node-meta"><Icon name="person" size={16} /><span>{t('第 {level} 级', { level: node.level })}</span></span><strong>{name}</strong>{name !== templateName && <span className="wf-team-org-template">{templateName}</span>}</>;
          const style = { left: x, top: y, width: TEAM_ORG_CARD_WIDTH, height: TEAM_ORG_CARD_HEIGHT };
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
    </div>
  </div>;
}
