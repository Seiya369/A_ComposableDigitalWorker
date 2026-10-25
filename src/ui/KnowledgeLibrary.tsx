import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { EmployeeModules } from '../domain/types.js';
import { KNOWLEDGE_SOURCE_CATEGORIES, type AutoArchiveCategory, type KnowledgeLibraryTarget, type KnowledgeLibraryView, type KnowledgeRemoveResult, type KnowledgeSourceCategory, type KnowledgeUploadFile } from '../knowledge/library-api.js';
import type { KnowledgeCitation, KnowledgeEntry, KnowledgeSource } from '../knowledge/types.js';
import type { WorkforceClient } from './client.js';
import { useI18n } from './i18n.js';
import { Icon } from './icons.js';
import { KnowledgeGraph } from './KnowledgeGraph.js';
import { SharedWikiGraph } from './SharedWikiGraph.js';

const STATUS_LABELS: Record<KnowledgeLibraryView['status']['state'], string> = { disabled: '资料库已停用', empty: '等待投喂资料', pending: '等待整理', compiling: '正在整理', ready: '已整理', stale: '资料已更新 · 待整理', failed: '整理失败' };
const targetKey = (target?: KnowledgeLibraryTarget) => target ? JSON.stringify([target.scope, target.projectId, target.employeeId, target.library, target.teamId]) : '';

/** Filters B by its actual A citations; a category is not inferred from model-written titles. */
export function filterKnowledgeEntries(view: KnowledgeLibraryView, query: string, category?: KnowledgeSourceCategory): KnowledgeEntry[] {
  const sources = new Map(view.sources.map(source => [source.id, source]));
  const text = query.trim().toLocaleLowerCase();
  return (view.snapshot?.entries ?? []).filter(entry => (!text || `${entry.title}\n${entry.content}`.toLocaleLowerCase().includes(text))
    && (!category || entry.citations.some(citation => { const source = sources.get(citation.sourceId); return source?.version === citation.sourceVersion && (source.category ?? 'reference') === category; })));
}

export function professionalKnowledgeSources(view: Pick<KnowledgeLibraryView, 'sources'>): KnowledgeSource[] {
  return view.sources.filter(source => (source.category ?? 'reference') === 'reference');
}

/** Keep exact cross-category citations visible without showing unrelated materials. */
export function filterKnowledgeGraphSources(view: Pick<KnowledgeLibraryView, 'sources'>, entries: KnowledgeEntry[], category?: KnowledgeSourceCategory): KnowledgeSource[] {
  if (!category) return view.sources;
  const citations = new Set(entries.flatMap(entry => entry.citations.map(citation => JSON.stringify([citation.sourceId, citation.sourceVersion]))));
  return view.sources.filter(source => (source.category ?? 'reference') === category || citations.has(JSON.stringify([source.id, source.version])));
}

type ReaderSelection = { source: KnowledgeSource; citation?: KnowledgeCitation; returnTo: 'graph' | 'article' };
interface KnowledgeLibraryProps {
  client: WorkforceClient;
  target?: KnowledgeLibraryTarget;
  modules: EmployeeModules;
  onChange: (modules: EmployeeModules) => void;
  onSourceRemoved?: (result: KnowledgeRemoveResult) => void;
  employeeVersion?: number;
}

export function KnowledgeLibrary({ client, target, onSourceRemoved, employeeVersion }: KnowledgeLibraryProps) {
  const { t, errorMessage } = useI18n();
  const feedback = (value: unknown): string => value && typeof value === 'object' && 'key' in value ? t(String(value.key), 'values' in value ? value.values as Record<string, string | number> : undefined) : errorMessage(value);
  const [loaded, setLoaded] = useState<{ context: object; view: KnowledgeLibraryView }>();
  const [error, setError] = useState<unknown>('');
  const [revision, setRevision] = useState(0);
  const [entryId, setEntryId] = useState('');
  const [pane, setPane] = useState<'graph' | 'article'>('graph');
  const [sourceSelection, setSourceSelection] = useState<ReaderSelection>();
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [materialSource, setMaterialSource] = useState<KnowledgeSource>();
  const [busy, setBusy] = useState(false);
  const [pendingArchive, setPendingArchive] = useState<AutoArchiveCategory>();
  const [notice, setNotice] = useState<{ key: string; values?: Record<string, string | number> }>();
  const materialDialog = useRef<HTMLDialogElement>(null);
  const materialOpener = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const key = targetKey(target);
  const context = useMemo(() => ({}), [client, key]);
  const currentContext = useRef<object>(); currentContext.current = context;
  const view = loaded?.context === context ? loaded.view : undefined;
  const setView = (next: KnowledgeLibraryView) => setLoaded({ context, view: next });
  const latestRead = useRef(0);
  const operation = useRef<object>();

  useEffect(() => {
    currentContext.current = context;
    operation.current = undefined;
    setError(''); setSourceSelection(undefined);
    setEntryId(''); setPane('graph'); setMaterialsOpen(false); setMaterialSource(undefined); setNotice(undefined); setBusy(false); setPendingArchive(undefined);
    return () => { if (currentContext.current === context) currentContext.current = undefined; };
  }, [context]);
  useEffect(() => {
    let active = true;
    const requestId = ++latestRead.current;
    if (target && client.knowledgeLibrary && operation.current !== context) void client.knowledgeLibrary(target).then(next => {
      if (active && currentContext.current === context && latestRead.current === requestId) { setView(next); setError(''); }
    }).catch(reason => { if (active && currentContext.current === context && latestRead.current === requestId) setError(reason); });
    return () => { active = false; };
  }, [client, key, revision]);
  useEffect(() => {
    if (busy || view?.status.state !== 'compiling') return;
    const timer = window.setTimeout(() => setRevision(value => value + 1), 3000);
    return () => window.clearTimeout(timer);
  }, [view, busy]);
  useEffect(() => {
    if (!materialsOpen) return;
    const element = materialDialog.current;
    element?.showModal();
    element?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { element?.close(); };
  }, [materialsOpen]);

  const entries = view?.snapshot?.entries ?? [];
  const entry = entries.find(item => item.id === entryId) ?? entries[0];
  const selectedSource = sourceSelection && view?.sources.find(source => source.id === sourceSelection.source.id && source.version === sourceSelection.source.version);
  const selectedMaterial = materialSource && view?.sources.find(source => source.id === materialSource.id && source.version === materialSource.version);
  const closeMaterials = () => { if (materialDialog.current?.open) materialDialog.current.close(); setMaterialsOpen(false); setMaterialSource(undefined); materialOpener.current?.focus(); };
  const openEntry = (id: string) => { setEntryId(id); setPane('article'); setSourceSelection(undefined); };
  const openSource = (source: KnowledgeSource, citation?: KnowledgeCitation, returnTo: 'graph' | 'article' = 'graph') => setSourceSelection({ source, citation, returnTo });
  const backToGraph = () => { setPane('graph'); setSourceSelection(undefined); };

  async function uploadFiles(files: File[]) {
    if (!target || !view || !client.uploadKnowledge || !view.enabled || !files.length || operation.current === context) return;
    let invalidFeedback: { key: string; values?: Record<string, string | number> } | undefined;
    const invalid = validateKnowledgeFiles(files, view, (key, values) => { invalidFeedback = { key, values }; return key; }); if (invalid) { setError(invalidFeedback ?? invalid); if (fileInput.current) fileInput.current.value = ''; return; }
    latestRead.current++; operation.current = context;
    setBusy(true); setError(''); setNotice(undefined);
    try {
      const uploads: KnowledgeUploadFile[] = await Promise.all(files.map(async file => ({ name: file.name, category: 'reference', base64: await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]!);
        reader.onerror = () => reject({ key: '无法读取 {name}', values: { name: file.name } }); reader.readAsDataURL(file);
      }) })));
      if (currentContext.current !== context) return;
      const result = await client.uploadKnowledge({ target: view.target, files: uploads });
      if (currentContext.current === context) { setView(result.library); setNotice({ key: '已增加 {count} 份资料。', values: { count: result.uploaded.length } }); }
    } catch (reason) { if (currentContext.current === context) setError(reason); }
    finally { if (currentContext.current === context) { operation.current = undefined; setBusy(false); if (fileInput.current) fileInput.current.value = ''; } }
  }
  async function retryCompilation() {
    if (!target || !view || !client.uploadKnowledge || !view.enabled || operation.current === context) return;
    latestRead.current++; operation.current = context; setBusy(true); setError(''); setNotice(undefined);
    try {
      const result = await client.uploadKnowledge({ target: view.target, files: [], retry: true });
      if (currentContext.current === context) { setView(result.library); setNotice({ key: '已请求重新整理。' }); }
    } catch (reason) { if (currentContext.current === context) setError(reason); }
    finally { if (currentContext.current === context) { operation.current = undefined; setBusy(false); } }
  }
  async function removeSource(source: KnowledgeSource) {
    if (!view || !client.removeKnowledge || !view.enabled || operation.current === context) return;
    latestRead.current++; operation.current = context; setBusy(true); setError(''); setNotice(undefined);
    try {
      const result = await client.removeKnowledge({ target: view.target, sourceId: source.id, version: source.version, employeeVersion });
      // Persisted employee changes still need rebasing after the user leaves this pane.
      onSourceRemoved?.(result);
      if (currentContext.current === context) {
        setView(result.library); setMaterialSource(undefined); setSourceSelection(undefined);
        setNotice({ key: '已移除。' });
      }
    } catch (reason) { if (currentContext.current === context) setError(reason); }
    finally { if (currentContext.current === context) { operation.current = undefined; setBusy(false); } }
  }

  async function updateArchivePolicy(category: AutoArchiveCategory) {
    if (!view || !client.updateKnowledgeArchivePolicy || !view.enabled || operation.current === context) return;
    const enabled = !(view.archivePolicy?.categories[category] ?? true);
    latestRead.current++; operation.current = context; setBusy(true); setPendingArchive(category); setError('');
    try {
      const next = await client.updateKnowledgeArchivePolicy({ target: view.target, category, enabled, expectedVersion: view.archivePolicy?.version ?? 1 });
      if (currentContext.current !== context) return;
      if (targetKey(next.target) !== targetKey(view.target) || next.archivePolicy?.categories[category] !== enabled) throw new Error('归档设置未保存，请刷新后重试。');
      setView(next);
    } catch (reason) { if (currentContext.current === context) setError(reason); }
    finally { if (currentContext.current === context) { operation.current = undefined; setBusy(false); setPendingArchive(undefined); } }
  }

  return <section className="wf-knowledge-library" aria-label={t("认知记忆")}>
    {Boolean(error) && !materialsOpen && <div className="wf-banner wf-banner-error" role="alert">{feedback(error)}<button type="button" className="wf-button" onClick={() => setRevision(value => value + 1)}>{t("重试")}</button></div>}
    {view && <div className="wf-knowledge-categories" role="group" aria-label={t("认知分类")}>
      {KNOWLEDGE_SOURCE_CATEGORIES.map(item => <div className="wf-knowledge-category" key={item.id} aria-label={t(item.label)}>
        <strong title={t(item.label)}>{t(item.label)}</strong>
        {item.id === 'reference' ? <button type="button" className="wf-button wf-knowledge-upload" ref={materialOpener} aria-haspopup="dialog"
          onClick={() => { setMaterialSource(undefined); setNotice(undefined); setMaterialsOpen(true); }}>{t("上传资料")}</button>
          : <KnowledgeArchiveSwitch label={item.label} enabled={view.archivePolicy?.categories[item.id] ?? true}
            pending={pendingArchive === item.id} disabled={busy || !view.enabled || !client.updateKnowledgeArchivePolicy}
            unavailable={!client.updateKnowledgeArchivePolicy ? '当前连接尚不支持保存自动归档设置' : !view.enabled ? '资料库已停用' : undefined}
            onChange={() => void updateArchivePolicy(item.id)} />}
      </div>)}
    </div>}
    <div className="wf-knowledge-browser">
      {!target ? <div className="wf-knowledge-empty"><Icon name="memory" size={26} /><strong>{t("先保存员工，再建立专属知识库")}</strong></div>
        : !client.knowledgeLibrary ? <div className="wf-knowledge-empty"><strong>{t("当前连接尚未提供资料浏览")}</strong></div>
        : !view ? <div className="wf-knowledge-empty" aria-busy={!error}>{t(error ? '认知记忆暂时无法读取。' : '正在读取认知记忆…')}</div>
        : client.knowledgeWiki ? <SharedWikiGraph key={key} client={client} target={view.target} library={view}
          onRebuild={client.uploadKnowledge && view.enabled ? () => void retryCompilation() : undefined} rebuilding={busy || view.status.state === 'compiling'} />
        : <><div className="wf-knowledge-map-view" hidden={!!selectedSource || (pane === 'article' && !!entry)}>
          <KnowledgeGraph view={view} entries={entries} onEntry={openEntry} onSource={(source, citation) => openSource(source, citation)} onRebuild={client.uploadKnowledge && view.enabled ? () => void retryCompilation() : undefined} rebuilding={busy || view.status.state === 'compiling'} />
        </div>{selectedSource ? <KnowledgeSourceReader source={selectedSource} citation={sourceSelection?.citation} onBack={() => { setSourceSelection(undefined); setPane(sourceSelection?.returnTo ?? 'graph'); }} backLabel={t(sourceSelection?.returnTo === 'article' ? '返回文章' : '返回图谱')} />
        : pane === 'article' && entry ? <article className="wf-knowledge-reader" aria-label={t("主题知识阅读")}>
          <div className="wf-knowledge-reader-heading"><button type="button" className="wf-button" onClick={backToGraph}>{t("返回图谱")}</button></div>
          <h3>{entry.title}</h3><KnowledgeMarkdown content={entry.content} />
          <div className="wf-knowledge-citations"><strong>{t("资料依据")}</strong>{entry.citations.map((citation, index) => {
            const source = view.sources.find(value => value.id === citation.sourceId && value.version === citation.sourceVersion);
            return source ? <button type="button" key={`${citation.sourceId}-${index}`} onClick={() => openSource(source, citation, 'article')}><Icon name="folder" size={13} /><span>{source.title}</span><small>{t('v{version} · {start}–{end} 行', { version: citation.sourceVersion, start: citation.startLine, end: citation.endLine })}</small><Icon name="chevron" size={12} /></button> : null;
          })}</div>
        </article> : null}</>}
    </div>
    <p className="wf-knowledge-flow" title={t("影子员工资料管理：A 原始资料 > B 知识重组 > C 概念综述")}>{t('影子员工资料管理：A 原始资料 > B 知识重组 > C 概念综述')}</p>
    {materialsOpen && view && <dialog ref={materialDialog} className="wf-materials-dialog" aria-label={t("专业资料")} onKeyDown={event => { if (event.key === 'Escape' || event.key === 'Tab') event.stopPropagation(); }} onCancel={event => { event.preventDefault(); closeMaterials(); }} onClose={() => { setMaterialsOpen(false); setMaterialSource(undefined); materialOpener.current?.focus(); }}>
      <div className="wf-materials-heading"><h3>{t("专业资料")}</h3><button type="button" className="wf-icon-button" aria-label={t("关闭专业资料")} onClick={closeMaterials}><Icon name="close" size={16} /></button></div>
      <div className="wf-materials-actions">
        <span className="wf-hint" role="status">{t(busy ? '正在处理…' : STATUS_LABELS[view.status.state])}</span>
        <button type="button" className="wf-button" aria-label={t("刷新专业资料")} disabled={busy} onClick={() => setRevision(value => value + 1)}>{t("刷新")}</button>
        {['failed', 'stale', 'pending'].includes(view.status.state) && <button type="button" className="wf-button" disabled={!view.enabled || busy || !client.uploadKnowledge} onClick={() => void retryCompilation()}>{t("重新整理")}</button>}
        <button type="button" className="wf-button wf-materials-add" aria-label={t("增加专业资料")} title={t("上传新的原始资料")} disabled={!view.enabled || busy || !client.uploadKnowledge} onClick={() => fileInput.current?.click()}>＋</button>
        <input ref={fileInput} className="wf-materials-file" type="file" aria-label={t("上传专业资料")} multiple accept={view.supportedExtensions.join(',')} disabled={!view.enabled || busy || !client.uploadKnowledge} onChange={event => { void uploadFiles(Array.from(event.target.files ?? [])); }} />
      </div>
      {Boolean(error || view.status.error) && <p className="wf-banner wf-banner-error" role="alert">{feedback(error || view.status.error)}</p>}
      {notice && <p className="wf-hint" role="status">{t(notice.key, notice.values)}</p>}
      {selectedMaterial ? <KnowledgeSourceReader source={selectedMaterial} onBack={() => setMaterialSource(undefined)} backLabel={t("返回资料列表")} /> : <ul className="wf-materials-list">{professionalKnowledgeSources(view).map(source => <li key={source.id}>
        <span title={source.title}>{source.title}</span><button type="button" className="wf-button" aria-label={t('查看 {name}', { name: source.title })} onClick={() => setMaterialSource(source)}>{t("查看")}</button>
        <button type="button" className="wf-materials-remove wf-danger-text" aria-label={t('删除 {name}', { name: source.title })} title={t("从当前资料库移除，历史引用保留")} disabled={!view.enabled || busy || !client.removeKnowledge} onClick={() => void removeSource(source)}>−</button>
      </li>)}{professionalKnowledgeSources(view).length === 0 && <li className="wf-hint">{t("暂无专业资料")}</li>}</ul>}
    </dialog>}
  </section>;
}

export function KnowledgeArchiveSwitch({ label, enabled, pending, disabled, unavailable, onChange }: { label: string; enabled: boolean; pending: boolean; disabled: boolean; unavailable?: string; onChange: () => void }) {
  const { t } = useI18n();
  return <button type="button" className="wf-knowledge-archive" role="switch" aria-label={t('{label}自动归档', { label: t(label) })} aria-checked={enabled} aria-busy={pending || undefined}
    disabled={disabled} title={unavailable ? t(unavailable) : pending ? t('正在保存…') : undefined} onClick={onChange}>
    <span className="wf-knowledge-switch-track" aria-hidden="true"><span /></span><span>{t("自动归档")}</span>
  </button>;
}

function KnowledgeSourceReader({ source, citation, onBack, backLabel }: { source: KnowledgeSource; citation?: KnowledgeCitation; onBack: () => void; backLabel: string }) {
  const { t } = useI18n();
  return <article className="wf-knowledge-reader" aria-label={t("原始资料阅读")}>
    <div className="wf-knowledge-reader-heading"><button type="button" className="wf-button" onClick={onBack}>{backLabel}</button><span className="wf-tag">{t('原始资料 · v{version}', { version: source.version })}</span></div>
    <h3>{source.title}</h3>
    {citation && <blockquote className="wf-knowledge-excerpt"><small>{t('引用原文 · 第 {start}–{end} 行', { start: citation.startLine, end: citation.endLine })}</small><div>{source.text.split('\n').slice(citation.startLine - 1, citation.endLine).join('\n')}</div></blockquote>}
    <pre className="wf-knowledge-source-text">{source.text}</pre>
  </article>;
}

/** Render useful Wiki Markdown as React nodes. Source HTML is always ordinary text. */
export function KnowledgeMarkdown({ content }: { content: string }) {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  const inline = (text: string) => text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)]+\))/g).map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/.exec(part);
    return link ? <a key={i} href={link[2]} target="_blank" rel="noreferrer noopener">{link[1]}</a> : part;
  });
  for (let index = 0; index < lines.length;) {
    const line = lines[index]!;
    if (!line.trim()) { index++; continue; }
    if (/^\s*```/.test(line)) {
      const code: string[] = []; index++;
      while (index < lines.length && !/^\s*```/.test(lines[index]!)) code.push(lines[index++]!);
      index++; blocks.push(<pre key={index}><code>{code.join('\n')}</code></pre>); continue;
    }
    const heading = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (heading) { const Heading = heading[1]!.length <= 2 ? 'h4' : 'h5'; blocks.push(<Heading key={index}>{inline(heading[2]!)}</Heading>); index++; continue; }
    const list = /^\s*(?:[-*+]\s+|\d+\.\s+)/.exec(line);
    if (list) {
      const ordered = /^\s*\d+\./.test(line); const items: ReactNode[] = [];
      const pattern = ordered ? /^\s*\d+\.\s+(.+)/ : /^\s*[-*+]\s+(.+)/;
      while (index < lines.length) { const item = pattern.exec(lines[index]!); if (!item) break; items.push(<li key={index}>{inline(item[1]!)}</li>); index++; }
      blocks.push(ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>); continue;
    }
    if (/^\s*>\s?/.test(line)) { const quote: string[] = []; while (index < lines.length && /^\s*>/.test(lines[index]!)) quote.push(lines[index++]!.replace(/^\s*>\s?/, '')); blocks.push(<blockquote key={index}>{inline(quote.join('\n'))}</blockquote>); continue; }
    const paragraph: string[] = [line]; index++;
    while (index < lines.length && lines[index]!.trim() && !/^\s*(?:#{1,6}\s|```|>|[-*+]\s|\d+\.\s)/.test(lines[index]!)) paragraph.push(lines[index++]!);
    blocks.push(<p key={index}>{inline(paragraph.join('\n'))}</p>);
  }
  return <div className="wf-knowledge-prose">{blocks}</div>;
}

export function validateKnowledgeFiles(files: Array<{ name: string; size: number }>, view: Pick<KnowledgeLibraryView, 'supportedExtensions' | 'maxFileBytes' | 'maxUploadBytes'>, t: (key: string, values?: Record<string, string | number>) => string = (key, values) => key.replace(/\{(\w+)\}/g, (match, name: string) => String(values?.[name] ?? match))): string | undefined {
  if (!files.length) return t('请选择至少一份原始文档。');
  for (const file of files) {
    if (!view.supportedExtensions.some(extension => file.name.toLocaleLowerCase().endsWith(extension.toLocaleLowerCase()))) return t('{name} 的格式暂不支持。请上传 {extensions}。', { name: file.name, extensions: view.supportedExtensions.join('、') });
    if (file.size > view.maxFileBytes) return t('{name} 超过单份文件 {limit} 的限制。', { name: file.name, limit: formatBytes(view.maxFileBytes) });
    if (!file.size) return t('{name} 是空文件。', { name: file.name });
  }
  if (files.reduce((total, file) => total + file.size, 0) > view.maxUploadBytes) return t('本次上传总大小超过 {limit}。', { limit: formatBytes(view.maxUploadBytes) });
}
const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${Math.round(bytes / 1024 / 1024 * 10) / 10} MB`;
