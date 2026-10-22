import { useId } from 'react';
import { GRAPH_NODE_HEIGHT, GRAPH_NODE_WIDTH, layoutTaskGraph } from './task-graph.js';

export interface TaskGraphItem { id: string; title: string; owner: string; status: string; dependencyIds: string[]; warning?: string }
export function TaskGraph({ tasks, selectedId, onSelect, title = '任务依赖图', relationLabel = '前置依赖', edgeKinds }: { tasks: TaskGraphItem[]; selectedId?: string; onSelect: (id: string) => void; title?: string; relationLabel?: string; edgeKinds?: Record<string, 'revision' | 'input'> }) {
  const marker = `work-arrow-${useId().replace(/:/g, '')}`;
  const layout = layoutTaskGraph(tasks);
  const positions = new Map(layout.nodes.map(node => [node.id, node]));
  return <div className="wf-task-graph-region">
    <p className="wf-graph-legend">{edgeKinds ? '实线：引用输入版本；虚线：同一成果的后续修订。' : `箭头表示${relationLabel}。`}按 Tab 选择节点，按 Enter 查看详情。</p>
    {layout.hasCycle && <p className="wf-error-box" role="alert">关系中存在循环，请在详情里修正依赖。</p>}
    <div className="wf-task-graph-scroll" role="region" aria-label={title} tabIndex={0}>
      <svg className="wf-task-graph" width={layout.width} height={layout.height} role="group" aria-label={title}>
        <defs><marker id={marker} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" /></marker></defs>
        {layout.edges.map(edge => { const a = positions.get(edge.from)!; const b = positions.get(edge.to)!; const start = a.x + GRAPH_NODE_WIDTH; const end = b.x; const y1 = a.y + GRAPH_NODE_HEIGHT / 2; const y2 = b.y + GRAPH_NODE_HEIGHT / 2; const kind = edgeKinds?.[`${edge.from}/${edge.to}`]; return <path aria-hidden="true" className={`wf-task-edge ${kind ? `is-${kind}` : ''}`} markerEnd={`url(#${marker})`} key={`${edge.from}/${edge.to}`} d={`M ${start} ${y1} C ${start + 32} ${y1}, ${end - 32} ${y2}, ${end - 8} ${y2}`} />; })}
        {layout.nodes.map(node => { const task = tasks.find(task => task.id === node.id)!; return <foreignObject key={node.id} x={node.x} y={node.y} width={GRAPH_NODE_WIDTH} height={GRAPH_NODE_HEIGHT}><button className={`wf-task-node ${selectedId === task.id ? 'is-selected' : ''}`} aria-pressed={selectedId === task.id} title={task.title} onClick={() => onSelect(task.id)}><strong>{task.title}</strong><span>{task.owner} · {task.status}</span>{task.warning && <small>{task.warning}</small>}</button></foreignObject>; })}
      </svg>
    </div>
  </div>;
}
