import { useEffect, useId, useRef, useState } from 'react';
import type { WorkflowTemplate } from '../domain/types.js';
import { useI18n } from './i18n.js';

/** A sequential, wrapping snake; nodes always follow the editor's current order. */
export function WorkflowDiagram({ steps, roles, onSelect }: Pick<WorkflowTemplate, 'steps' | 'roles'> & { onSelect: (index: number) => void }) {
  const { t } = useI18n();
  const region = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(1);
  const marker = useId().replace(/:/g, '');
  useEffect(() => {
    const element = region.current; if (!element) return;
    const observer = new ResizeObserver(entries => setColumns(Math.max(1, Math.min(4, Math.floor(((entries[0]?.contentRect.width ?? 248) - 48) / 200)))));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  const count = Math.min(columns, steps.length), width = count * 200 + 48, height = Math.ceil(steps.length / count) * 104 + 16;
  const nodes = steps.map((step, index) => {
    const row = Math.floor(index / count), column = row % 2 ? count - 1 - index % count : index % count;
    return { step, x: 8 + column * 200, y: 8 + row * 104, row, owner: roles.find(role => role.id === step.roleId)?.name ?? t('待选择负责人') };
  });
  return <section className="wf-workflow-diagram" aria-label={t('工作流程图')}><h3>{t('流程图')}</h3>
    <div ref={region} className="wf-workflow-diagram-viewport" role="region" aria-label={t('流程图画布')} tabIndex={0}>
      <div className="wf-workflow-diagram-canvas" style={{ width, height }}>
        <svg width={width} height={height} aria-hidden="true"><defs><marker id={marker} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" /></marker><marker id={`${marker}-return`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" style={{ fill: 'var(--wf-red)' }} /></marker></defs>
          {nodes.slice(1).map((node, index) => {
            const previous = nodes[index]!;
            const path = previous.row !== node.row ? `M ${previous.x + 84} ${previous.y + 72} V ${node.y}`
              : previous.x < node.x ? `M ${previous.x + 168} ${previous.y + 36} H ${node.x}` : `M ${previous.x} ${previous.y + 36} H ${node.x + 168}`;
            return <path key={node.step.id} className="wf-workflow-diagram-edge" d={path} markerEnd={`url(#${marker})`} />;
          })}
          {nodes.map((node, index) => {
            const targetIndex = nodes.findIndex(target => target.step.id === node.step.onRejectStepId);
            if (targetIndex < 0 || targetIndex >= index) return null;
            const target = nodes[targetIndex]!, lane = width - 12, start = node.x + 84, end = target.x + 84, bend = node.y + 90;
            const path = node.row === target.row ? `M ${start} ${node.y + 72} V ${bend} H ${end} V ${target.y + 72}` : `M ${start} ${node.y + 72} V ${bend} H ${lane} V ${target.y + 90} H ${end} V ${target.y + 72}`;
            return <g key={`return-${node.step.id}`}><path className="wf-workflow-diagram-return" d={path} markerEnd={`url(#${marker}-return)`} /><text className="wf-workflow-diagram-return-label" x={node.row === target.row ? (start + end) / 2 : lane - 4} y={bend - 4} textAnchor="end">{t('不合格 → {number}', { number: targetIndex + 1 })}</text></g>;
          })}
        </svg>
        {nodes.map(({ step, x, y, owner }, index) => <button key={step.id} type="button" className="wf-workflow-diagram-node" style={{ left: x, top: y }} title={`${index + 1}. ${step.name || t('未命名步骤')} · ${owner}`} onClick={() => onSelect(index)}><strong>{index + 1}. {step.name || t('未命名步骤')}</strong><span>{owner}</span></button>)}
      </div>
    </div>
  </section>;
}
