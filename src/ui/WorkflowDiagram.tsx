import { useEffect, useId, useRef, useState } from 'react';
import type { WorkflowTemplate } from '../domain/types.js';
import { useI18n } from './i18n.js';
import { workflowDiagramLayout } from './workflow-diagram-layout.js';
import './workflow-diagram.css';

/** Sequence and explicit rework routes share a responsive, non-clipping canvas. */
export function WorkflowDiagram({ steps, roles, onSelect }: Pick<WorkflowTemplate, 'steps' | 'roles'> & { onSelect: (index: number) => void }) {
  const { t } = useI18n();
  const region = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const marker = useId().replace(/:/g, '');
  useEffect(() => {
    const element = region.current; if (!element) return;
    const observer = new ResizeObserver(entries => setWidth(entries[0]?.contentRect.width ?? element.clientWidth));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  const layout = workflowDiagramLayout(steps, width);
  return <section className="wf-workflow-diagram wf-workflow-map" aria-label={t('工作流程图')}>
    <h3>{t('流程图')}</h3>
    <p className="wf-workflow-map-legend">{t('实线表示步骤顺序，虚线表示验收不合格时退回。')}</p>
    <div ref={region} className="wf-workflow-map-viewport" role="region" aria-label={t('流程图画布')} tabIndex={0}>
      {steps.length === 0 ? <p className="wf-workflow-map-empty">{t('新建工作流，按顺序添加步骤。')}</p> :
        <div className="wf-workflow-map-canvas" style={{ width: layout.width, height: layout.height }}>
          <svg width={layout.width} height={layout.height} aria-hidden="true">
            <defs>
              <marker id={marker} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" /></marker>
              <marker id={`${marker}-return`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" className="wf-workflow-map-return-marker" /></marker>
            </defs>
            {layout.forwardEdges.map((path, index) => <path key={steps[index + 1]!.id} className="wf-workflow-map-edge" d={path} markerEnd={`url(#${marker})`} />)}
            {layout.returnEdges.map(edge => <g key={`return-${steps[edge.source]!.id}`} data-workflow-return={`${edge.source + 1}-${edge.target + 1}`}>
              <path className="wf-workflow-diagram-return wf-workflow-map-return" d={edge.path} markerEnd={`url(#${marker}-return)`} />
              <text className="wf-workflow-map-return-label" x={edge.label.x} y={edge.label.y} textAnchor="middle">{edge.source + 1} → {edge.target + 1}</text>
            </g>)}
          </svg>
          {layout.nodes.map(node => {
            const step = steps[node.index]!, owner = roles.find(role => role.id === step.roleId)?.name ?? t('待选择负责人');
            const target = steps.findIndex(candidate => candidate.id === step.onRejectStepId);
            const rejection = target >= 0 && target < node.index ? t('退回第 {number} 步返工', { number: target + 1 }) : t('本步骤返工');
            return <button key={step.id} type="button" className="wf-workflow-diagram-node wf-workflow-map-node" style={{ left: node.x, top: node.y, width: node.width, height: node.height }} title={`${node.index + 1}. ${step.name || t('未命名步骤')} · ${owner} · ${rejection}`} onClick={() => onSelect(node.index)}>
              <strong>{node.index + 1}. {step.name || t('未命名步骤')}</strong>
              <span>{owner}</span>
              <small>{rejection}</small>
            </button>;
          })}
        </div>}
    </div>
  </section>;
}
