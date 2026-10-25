import { useI18n } from './i18n.js';
import { useId } from 'react';
import { Icon } from './icons.js';
import './librarian-toggle.css';

export function LibrarianToggle({ enabled, disabled, onChange, compact = false }: { enabled: boolean; disabled: boolean; onChange: (enabled: boolean) => void; compact?: boolean }) {
  const { t } = useI18n();
  const descriptionId = useId();
  if (compact) return <button type="button" className="wf-librarian-switch" role="switch" aria-label={t("资料管理员")} aria-checked={enabled} disabled={disabled} onClick={() => onChange(!enabled)}>
    <span className="wf-librarian-switch-track" aria-hidden="true"><span /></span><span>{t("资料管理员")}</span>
  </button>;
  return <div className="wf-librarian" data-testid="team-librarian">
    <div className="wf-librarian-heading">
      <label><input type="checkbox" checked={enabled} disabled={disabled} aria-describedby={descriptionId} onChange={event => onChange(event.target.checked)} /><Icon name="memory" size={17} /><strong>{t("资料管理员")}</strong></label>
      <span className={`wf-pill ${enabled ? 'wf-pill-ready' : ''}`}>{enabled ? t("已启用") : t("已关闭")}</span>
    </div>
    <p id={descriptionId}>{t("自动整理团队与员工知识，模型跟随团队负责人。关闭后停止知识归档与读取，保留已有知识和任务记录。")}</p>
  </div>;
}
