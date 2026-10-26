import type { RunUsage } from '../domain/types.js';
import { useI18n } from './i18n.js';

/** Usage fields are disjoint; missing reports are not zero-cost calls. */
export function ModelUsage({ usage, title = '模型用量' }: { usage?: Partial<RunUsage>; title?: string }) {
  const { t, locale } = useI18n();
  if (!usage) return null;
  const partial = usage.modelCalls !== undefined && usage.reportedCalls !== undefined && usage.reportedCalls < usage.modelCalls;
  const noReports = usage.reportedCalls === 0;
  const number = (value?: number) => value !== undefined && Number.isSafeInteger(value) && value >= 0
    ? value.toLocaleString(locale === 'en' ? 'en-US' : 'zh-CN') : t('未报告');
  const rows = [
    ['inputTokens', '未命中输入', usage.inputTokens],
    ['cacheReadTokens', '缓存读取', usage.cacheReadTokens],
    ['cacheWriteTokens', '缓存写入', usage.cacheWriteTokens],
    ['outputTokens', '模型输出', usage.outputTokens],
    ['totalTokens', '总量（服务商报告）', partial ? undefined : usage.totalTokens],
  ] as const;
  return <details className="wf-model-usage">
    <summary>{t(title)}</summary>
    <p>{t('模型调用：{count}', { count: number(usage.modelCalls) })} · {t('已报告调用：{count}', { count: number(usage.reportedCalls) })}</p>
    <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '4px 12px', margin: '8px 0' }}>
      {rows.map(([field, label, value]) => <div key={field} style={{ display: 'contents' }}><dt>{t(label)}</dt><dd style={{ margin: 0, textAlign: 'right' }} data-usage-field={field}>{number(noReports ? undefined : value)}</dd></div>)}
    </dl>
    {partial && <p role="status">{t('仅部分调用报告用量，已知数值是下限。')}</p>}
    <p>{t('单位为 tokens；模型输出已包含推理用量。')}</p>
  </details>;
}
