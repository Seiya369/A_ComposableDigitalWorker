import { useId } from 'react';
import { Icon } from './icons.js';
import './librarian-toggle.css';

export function LibrarianToggle({ enabled, disabled, onChange }: { enabled: boolean; disabled: boolean; onChange: (enabled: boolean) => void }) {
  const descriptionId = useId();
  return <div className="wf-librarian" data-testid="team-librarian">
    <div className="wf-librarian-heading">
      <label><input type="checkbox" checked={enabled} disabled={disabled} aria-describedby={descriptionId} onChange={event => onChange(event.target.checked)} /><Icon name="memory" size={17} /><strong>资料管理员</strong></label>
      <span className={`wf-pill ${enabled ? 'wf-pill-ready' : ''}`}>{enabled ? '已启用' : '已关闭'}</span>
    </div>
    <p id={descriptionId}>自动整理团队与员工知识，模型跟随团队负责人。关闭后停止知识归档与读取，保留已有知识和任务记录。</p>
  </div>;
}
