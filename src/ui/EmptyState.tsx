import { useI18n } from './i18n.js';
import { Icon } from './icons.js';

export function EmptyState({ title, description, icon = 'people' }: { title: string; description?: string; icon?: Parameters<typeof Icon>[0]['name'] }) {
  const { t } = useI18n();
  return <div className="wf-empty"><span className="wf-empty-icon"><Icon name={icon} size={26} /></span><h3>{t(title)}</h3>{description && <p>{t(description)}</p>}</div>;
}
