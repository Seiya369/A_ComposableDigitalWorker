import type { WorkDeliverable, WorkTask } from '../work/types.js';
import { TaskGraph, type TaskGraphItem } from './TaskGraph.js';
import { Icon } from './icons.js';
import { timeLabel } from './ProjectPanels.js';
import { deliverableStatus } from './workbench-state.js';

export function WorkDeliverables({ items, tasks, selectedId, graph, onSelect }: { items: WorkDeliverable[]; tasks: WorkTask[]; selectedId?: string; graph: boolean; onSelect: (id: string) => void }) {
  if (!items.length) return <div className="wf-work-empty"><Icon name="delivery" size={28} /><h3>还没有成果</h3><p>创建任务时声明预期成果，执行后保存版本；也可以手动补充成果。</p></div>;
  if (graph) {
    const keys = new Map<string, string>();
    const edgeKinds: Record<string, 'revision' | 'input'> = {};
    const nodes: TaskGraphItem[] = items.flatMap(item => item.revisions.map((revision, index) => {
      const id = JSON.stringify([item.id, revision.version]); keys.set(id, item.id);
      const dependencyIds = revision.inputVersions.map(ref => JSON.stringify([ref.deliverableId, ref.version]));
      dependencyIds.forEach(from => { edgeKinds[`${from}/${id}`] = 'input'; });
      if (index > 0) { const from = JSON.stringify([item.id, item.revisions[index - 1]!.version]); dependencyIds.push(from); edgeKinds[`${from}/${id}`] = 'revision'; }
      return { id, title: `${item.title} · v${revision.version}`, owner: tasks.find(task => task.id === item.taskId)?.title ?? '生产任务', status: deliverableStatus(revision), dependencyIds, ...(revision.invalidatedAt ? { warning: '历史验收已失效' } : {}) };
    }));
    return nodes.length ? <><div className="wf-work-desktop-graph"><TaskGraph tasks={nodes} title="成果版本关系图" edgeKinds={edgeKinds} selectedId={selectedId ? JSON.stringify([selectedId, items.find(item => item.id === selectedId)?.revisions.at(-1)?.version]) : undefined} onSelect={id => { const itemId = keys.get(id); if (itemId) onSelect(itemId); }} /></div><div className="wf-work-mobile-graph"><p className="wf-hint">窄屏以列表显示成果，版本引用与修订记录在详情中查看。</p><WorkDeliverables items={items} tasks={tasks} graph={false} selectedId={selectedId} onSelect={onSelect} /></div></> : <p className="wf-hint">成果尚未产出版本。版本保存后会显示引用与修订关系。</p>;
  }
  return <div className="wf-work-deliverables">{items.map(item => { const latest = item.revisions.at(-1); const task = tasks.find(task => task.id === item.taskId); return <button className={`wf-work-deliverable ${selectedId === item.id ? 'is-selected' : ''}`} key={item.id} onClick={() => onSelect(item.id)}><Icon name="delivery" size={19} /><div><strong>{item.title}</strong><span>{task?.title ?? '任务已移除'} · {latest ? `v${latest.version}` : '待产出'}</span></div><span className="wf-tag">{deliverableStatus(latest)}</span><time>{timeLabel(item.updatedAt)}</time></button>; })}</div>;
}
