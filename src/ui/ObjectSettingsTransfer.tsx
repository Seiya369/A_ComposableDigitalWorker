import { useI18n } from './i18n.js';
import { useEffect, useRef, useState } from 'react';
import type { EmployeeTemplate, TeamTemplate, WorkforceState, WorkflowTemplate } from '../domain/types.js';
import { MAX_TRANSFER_BYTES, type TransferBundle, type TransferKind } from '../domain/transfer-types.js';
import { exportSettingsBundle, prepareSettingsImport } from '../domain/settings-transfer.js';
import './object-settings-transfer.css';

interface Props {
  state: WorkforceState;
  kind: TransferKind;
  root: EmployeeTemplate | TeamTemplate | WorkflowTemplate;
  stagedBundle?: TransferBundle;
  disabled?: boolean;
  onImport: (bundle: TransferBundle) => void;
  onBusyChange?: (busy: boolean) => void;
}

const LABELS: Record<TransferKind, string> = { employee: '自由职业人', team: '团队', workflow: '工作流' };

export function ObjectSettingsTransfer({ state, kind, root, stagedBundle, disabled, onImport, onBusyChange }: Props) {
  const { t, errorMessage } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  const reading = useRef(false);
  const downloads = useRef(new Map<string, number>());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const context = useRef({ state, kind, rootId: root.id, disabled, onImport });
  context.current = { state, kind, rootId: root.id, disabled, onImport };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; for (const [url, timer] of downloads.current) { window.clearTimeout(timer); URL.revokeObjectURL(url); } downloads.current.clear(); }; }, []);
  useEffect(() => { generation.current++; reading.current = false; setBusy(false); setError(''); onBusyChange?.(false); }, [root.id, kind]);
  useEffect(() => { if (disabled) { generation.current++; reading.current = false; setBusy(false); onBusyChange?.(false); } }, [disabled]);

  async function importFile(file?: File) {
    if (!file || disabled || reading.current) return;
    setError('');
    if (file.size > MAX_TRANSFER_BYTES) { setError("配置文件超过 1 MiB。"); return; }
    const ticket = ++generation.current;
    reading.current = true; setBusy(true); onBusyChange?.(true);
    try {
      const content = await file.text();
      if (!mounted.current || ticket !== generation.current) return;
      const latest = context.current;
      if (latest.disabled || latest.rootId !== root.id || latest.kind !== kind) return;
      const bundle = prepareSettingsImport(latest.state, content, latest.kind, latest.rootId);
      if (mounted.current && ticket === generation.current && !context.current.disabled) context.current.onImport(bundle);
    } catch (cause) {
      if (mounted.current && ticket === generation.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mounted.current && ticket === generation.current) { reading.current = false; setBusy(false); onBusyChange?.(false); }
    }
  }

  function exportFile() {
    if (disabled || reading.current) return;
    setError('');
    try {
      const bundle = exportSettingsBundle(state, kind, root, stagedBundle);
      const blob = new Blob([JSON.stringify(bundle, null, 2) + '\n'], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `graph-horses-template-${kind}-${root.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
      document.body.append(link); link.click(); link.remove();
      const timer = window.setTimeout(() => { URL.revokeObjectURL(url); downloads.current.delete(url); }, 1000);
      downloads.current.set(url, timer);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  return <div className="wf-settings-transfer" aria-busy={busy || undefined}>
    <input ref={input} type="file" hidden accept=".json,application/json" aria-label={t('导入{kind}设置文件', { kind: t(LABELS[kind]) })} disabled={disabled || busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void importFile(file); }} />
    <button type="button" className="wf-button" disabled={disabled || busy} title={t("导入兼容配置并覆盖当前表单，保存后生效")} onClick={() => input.current?.click()}>{busy ? t("导入中…") : t("导入")}</button>
    <button type="button" className="wf-button" disabled={disabled || busy} title={t('导出当前{kind}配置', { kind: t(LABELS[kind]) })} onClick={exportFile}>{t("导出")}</button>
    {error && <span className="wf-settings-transfer-error" role="alert">{errorMessage(error)}</span>}
  </div>;
}
