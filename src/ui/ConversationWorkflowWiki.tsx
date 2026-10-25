import { useEffect, useMemo, useRef, useState } from 'react';
import type { KnowledgeLibraryTarget, KnowledgeLibraryView } from '../knowledge/library-api.js';
import type { WorkforceClient } from './client.js';
import { SharedWikiGraph } from './SharedWikiGraph.js';
import { useI18n } from './i18n.js';
import './conversation-workflow-wiki.css';

export type ConversationWorkflowWikiClient = Pick<WorkforceClient, 'knowledgeLibrary' | 'knowledgeWiki' | 'knowledgeSource'>;
interface Props { client: ConversationWorkflowWikiClient; target: KnowledgeLibraryTarget }
interface Loaded { context: object; view?: KnowledgeLibraryView; error?: unknown }
const targetIdentity = (target: KnowledgeLibraryTarget) => JSON.stringify([target.scope, target.projectId, target.employeeId, target.library, target.teamId]);

/** Read the existing team library. This view never schedules compilation or alters sources. */
export function ConversationWorkflowWiki({ client, target }: Props) {
  const { t, errorMessage } = useI18n();
  const key = targetIdentity(target);
  const context = useMemo(() => ({}), [client, key]);
  const [loaded, setLoaded] = useState<Loaded>();
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const current = loaded?.context === context ? loaded : undefined;
  const library = current?.view;
  const canRead = !!client.knowledgeLibrary && !!client.knowledgeWiki;

  useEffect(() => {
    let active = true;
    const own = ++generation.current;
    setLoaded(undefined);
    if (canRead) void client.knowledgeLibrary!(target).then(view => {
      if (!active || generation.current !== own) return;
      if (targetIdentity(view.target) !== key) throw new Error('项目知识库不属于当前工作流');
      setLoaded({ context, view });
    }).catch(error => { if (active && generation.current === own) setLoaded({ context, error }); });
    return () => { active = false; generation.current++; };
  }, [client, key, context, revision, canRead]);

  return <section className="wf-conversation-wiki" aria-label={t('项目知识库')} aria-busy={canRead && !current}>
    {!canRead ? <p className="wf-conversation-wiki-empty" role="status">{t('当前连接尚未提供项目知识浏览')}</p>
      : current?.error ? <div className="wf-conversation-wiki-empty" role="alert"><p>{errorMessage(current.error)}</p><button type="button" onClick={() => setRevision(value => value + 1)}>{t('重试')}</button></div>
      : !library ? <p className="wf-conversation-wiki-empty" role="status">{t('正在读取项目知识库…')}</p>
      : <>
        {library.enabled && library.status.error && <p className="wf-conversation-details-error" role="alert">{errorMessage(library.status.error)}</p>}
        {!library.enabled ? <p className="wf-conversation-wiki-empty" role="status">{t('团队资料员已停用，保留的知识当前不可读取。')}</p>
          : !library.snapshot ? <p className="wf-conversation-wiki-empty" role="status">{t(library.sources.length ? '资料已收录，等待资料员整理后显示 Wiki。' : '暂无项目知识，资料员整理后会显示在这里。')}</p>
          : <div className="wf-conversation-wiki-viewer"><SharedWikiGraph key={`${key}:${revision}`} client={client} target={library.target} library={library}/></div>}
      </>}
  </section>;
}
