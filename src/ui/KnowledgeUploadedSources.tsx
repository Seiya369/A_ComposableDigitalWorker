import { useEffect, useState } from 'react';
import type { KnowledgeUploadedSource, KnowledgeUploadTarget } from '../knowledge/types.js';
import type { WorkforceClient } from './client.js';

export function KnowledgeUploadedSources({ client, target, revision }: { client: WorkforceClient; target: KnowledgeUploadTarget; revision: number }) {
  const [sources, setSources] = useState<KnowledgeUploadedSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const targetKey = JSON.stringify(target);
  useEffect(() => {
    let current = true;
    setLoading(true); setError(''); setSources([]);
    void client.listUploadedKnowledge(target).then(result => {
      if (!Array.isArray(result)) throw new Error('服务器未返回有效的资料列表。');
      if (current) setSources(result);
    }).catch(error => { if (current) setError(error instanceof Error ? error.message : String(error)); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [client, targetKey, revision, retry]);
  return <div className="wf-knowledge-uploaded" aria-busy={loading}>
    {loading ? <p className="wf-hint" role="status">读取已上传资料…</p> : error ? <div className="wf-knowledge-list-error"><p className="wf-error-box" role="alert">资料列表读取失败：{error}</p><button type="button" className="wf-inline-add" onClick={() => setRetry(value => value + 1)}>重新读取资料列表</button></div> : <KnowledgeUploadedSourceList sources={sources} />}
  </div>;
}

/** Only A's durable receipts are displayed; no compilation completion is inferred. */
export function KnowledgeUploadedSourceList({ sources }: { sources: KnowledgeUploadedSource[] }) {
  return sources.length ? <details className="wf-knowledge-uploaded-list" open>
    <summary>已上传资料（A） · {sources.length}</summary>
    <ul>{sources.map(source => <li key={source.sourceId}>
      <div><strong>{source.title}</strong><span>v{source.version}</span></div>
      <p className="wf-hint">原件 SHA-256 <code title={source.attachment.sha256}>{source.attachment.sha256.slice(0, 12)}…</code></p>
    </li>)}</ul>
    <p className="wf-hint">原件已入库；知识编纂另行排队，此处不表示已完成。</p>
  </details> : <p className="wf-hint">尚无已上传资料。手工来源与自动归档不计入此列表。</p>;
}
