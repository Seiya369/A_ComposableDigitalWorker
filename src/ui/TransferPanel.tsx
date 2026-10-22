import { useRef, useState } from 'react';
import type { WorkforceState } from '../domain/types.js';
import { MAX_TRANSFER_BYTES, type ExportSelection, type ImportPreview, type ImportTarget, type TransferKind } from '../domain/transfer-types.js';
import type { WorkforceClient } from './client.js';
import { Icon } from './icons.js';
import { SelectField } from './fields.js';

interface Props { client: WorkforceClient; state: WorkforceState; target: ImportTarget; mode: 'import' | 'export'; onClose: () => void; onBeforeImport: () => boolean; onImported: () => Promise<unknown> }
const LABELS: Record<TransferKind, string> = { employee: '职业人', team: '团队', workflow: '工作流' };
export function TransferPanel({ client, state, target, mode, onClose, onBeforeImport, onImported }: Props) {
  const [kind, setKind] = useState<TransferKind>('team');
  const [selected, setSelected] = useState('');
  const [document, setDocument] = useState<unknown>();
  const [filename, setFilename] = useState('');
  const [preview, setPreview] = useState<ImportPreview>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const fileInput = useRef<HTMLInputElement>(null);
  const reading = useRef(false);
  const project = state.projects.find(project => project.id === target.projectId);
  const projectTeams = (state.projectTeams ?? []).filter(team => team.projectId === target.projectId && team.status !== 'cancelled');
  const choices: Array<{ key: string; name: string; id: string; teamId?: string }> = target.scope === 'template'
    ? kind === 'employee' ? state.templates.filter(item => item.status !== 'archived').map(item => ({ key: item.id, id: item.id, name: `${item.name} · v${item.version}` }))
      : kind === 'team' ? state.teams.map(item => ({ key: item.id, id: item.id, name: `${item.name} · v${item.version}` }))
      : [...(state.workflowTemplates ?? []).map(item => ({ key: item.id, id: item.id, name: `${item.name} · 通用流程 v${item.version}` })), ...state.teams.flatMap(team => (team.workflows ?? []).map(item => ({ key: `${team.id}/${item.id}`, id: item.id, teamId: team.id, name: `${item.name} · ${team.name}` })))]
    : kind === 'employee' ? state.employees.filter(item => item.projectId === target.projectId).map(item => ({ key: item.id, id: item.id, name: item.name }))
      : kind === 'team' ? projectTeams.map(item => ({ key: item.id, id: item.id, name: item.name }))
      : projectTeams.flatMap(team => team.workflows.map(item => ({ key: `${team.id}/${item.id}`, id: item.id, teamId: team.id, name: `${item.name} · ${team.name}` })));
  const selectedChoice = choices.find(choice => choice.key === selected);
  async function readFile(file?: File) {
    if (reading.current || busy) return;
    setError(''); setNotice(''); setPreview(undefined); setDocument(undefined); setFilename(file?.name ?? '');
    if (!file) return;
    if (file.size > MAX_TRANSFER_BYTES) { setError('JSON 文件超过 1 MiB，请拆分导出。'); return; }
    reading.current = true; setBusy(true);
    try {
      const content = await file.text();
      let value: unknown;
      try { value = JSON.parse(content); } catch { throw new Error('JSON 格式无效，请检查文件内容。'); }
      const next = await client.previewImport(value, target); setDocument(value); setPreview(next); requestId.current = crypto.randomUUID();
    }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { reading.current = false; setBusy(false); }
  }
  async function exportSelection() {
    if (!selectedChoice || busy) return;
    setBusy(true); setError('');
    try {
      const selection: ExportSelection = { ...target, kind, id: selectedChoice.id, ...(selectedChoice.teamId ? { teamId: selectedChoice.teamId } : {}) };
      const bundle = await client.exportBundle(selection);
      const blob = new Blob([JSON.stringify(bundle, null, 2) + '\n'], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement('a'); link.href = url; link.download = `graph-horses-${target.scope}-${kind}-${selectedChoice.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
      window.document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('JSON 已导出，包含所需配置依赖。');
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  async function importDocument() {
    if (!preview || !document || busy || !onBeforeImport()) return;
    setBusy(true); setError('');
    try {
      await client.importBundle(document, { ...target, requestId: requestId.current }, { expectedRevision: state.revision });
      setPreview(undefined); setDocument(undefined); setNotice('已导入独立副本。');
      try { await onImported(); } catch { setError('导入已完成，刷新失败。请点击刷新数据查看结果。'); }
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <section className="wf-transfer-panel" aria-label={mode === 'import' ? '导入 JSON' : '导出 JSON'}>
    <div className="wf-transfer-heading"><div><h2>{mode === 'import' ? '导入 JSON' : '导出 JSON'}</h2><p>{target.scope === 'template' ? '通用模板库' : `项目实例：${project?.name ?? '未选择项目'}`} · graph_horses v1</p></div><button className="wf-icon-button" disabled={busy} aria-label="关闭导入导出面板" onClick={onClose}><Icon name="close" size={17} /></button></div>
    {error && <p className="wf-error-box" role="alert">{error}</p>}{notice && <p className="wf-hint" role="status">{notice}</p>}
    {mode === 'export' ? <div className="wf-transfer-controls"><SelectField label="导出内容" value={kind} onChange={value => { setKind(value as TransferKind); setSelected(''); }}><option value="employee">职业人</option><option value="team">团队（含职业人和工作流）</option><option value="workflow">工作流（含必要依赖）</option></SelectField><SelectField label="选择已保存配置" value={selected} onChange={setSelected}><option value="">选择{LABELS[kind]}</option>{choices.map(choice => <option value={choice.key} key={choice.key}>{choice.name}</option>)}</SelectField><button className="wf-button wf-primary" disabled={busy || !selectedChoice} onClick={() => void exportSelection()}>{busy ? '导出中…' : '下载 JSON'}</button></div> : <>
      <div className="wf-transfer-file"><input ref={fileInput} type="file" accept=".json,application/json" aria-label="选择 graph_horses JSON 文件" disabled={busy} onChange={event => { void readFile(event.target.files?.[0]); event.target.value = ''; }} /><span className="wf-hint">{filename || '选择模板或实例配置，先预览，再确认导入。最大 1 MiB。'}</span></div>
      {busy && <p className="wf-hint" role="status">正在处理…</p>}
      {preview && <div className="wf-import-preview"><h3>{preview.name} · {LABELS[preview.kind]}</h3><dl><div><dt>导入目标</dt><dd>{target.scope === 'template' ? '通用模板库' : project?.name}</dd></div><div><dt>职业人模板</dt><dd>{preview.counts.templates}</dd></div><div><dt>团队模板</dt><dd>{preview.counts.teams}</dd></div><div><dt>通用工作流</dt><dd>{preview.counts.workflowTemplates}</dd></div><div><dt>项目职业人</dt><dd>{preview.counts.employees}</dd></div><div><dt>项目团队</dt><dd>{preview.counts.projectTeams}</dd></div></dl>
        {!!preview.warnings.length && <ul className="wf-import-warnings">{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
        <p className="wf-hint">导入生成新 ID 和独立副本，不覆盖已有配置，不自动启动任务。</p><button className="wf-button wf-primary" disabled={busy} onClick={() => void importDocument()}>确认导入独立副本</button>
      </div>}
    </>}
    <p className="wf-transfer-footnote">JSON 用于交换配置；插件安装包仍为 .tgz。项目路径、运行记录和记忆不随配置交换。</p>
  </section>;
}
