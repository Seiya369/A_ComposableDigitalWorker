import { useCallback, useEffect, useRef, useState } from 'react';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import type { ProjectTeam } from '../domain/types.js';
import { activeProjectTeams } from '../domain/project-roster.js';
import type { WorkforceClient } from '../ui/client.js';
import { Icon } from '../ui/icons.js';

type Props = PropsRuntime<'sidebar.workspaces.menu.action'> & {
  client: WorkforceClient;
  configureProject: (projectId: string) => void;
  viewProject: (projectId: string) => void;
};

/** The menu reads persisted installation state each time the host opens it. */
export function ProjectTeamMenu({ workspaceId, onClose, client, configureProject, viewProject }: Props) {
  const [teams, setTeams] = useState<ProjectTeam[]>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(false);
  const pending = useRef(false);
  const refresh = useCallback(async () => {
    const state = await client.snapshot();
    if (mounted.current) setTeams(activeProjectTeams(state, workspaceId));
  }, [client, workspaceId]);
  const load = useCallback(async () => {
    setLoading(true);
    try { await refresh(); }
    catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : String(error)); }
    finally { if (mounted.current) setLoading(false); }
  }, [refresh]);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; };
  }, [load]);

  const open = (navigate: Props['viewProject']) => { onClose(); navigate(workspaceId); };
  async function cancel() {
    if (pending.current || !teams?.length) return;
    pending.current = true; setBusy(true); setError('');
    try {
      await client.cancelProjectTeams({ projectId: workspaceId, teams: teams.map(team => ({ id: team.id, version: team.version ?? 1 })) });
      if (mounted.current) onClose();
    } catch (error) {
      if (mounted.current) {
        setError(error instanceof Error ? error.message : String(error));
        await load();
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return <>
    {loading ? <button role="menuitem" className="wf-workspace-menu-item" disabled><Icon name="people" size={16} /><span>加载团队…</span></button>
      : !teams ? <button role="menuitem" className="wf-workspace-menu-item" onClick={() => { setError(''); void load(); }}><Icon name="refresh" size={16} /><span>重新加载团队</span></button>
      : teams.length ? <>
        <button role="menuitem" className="wf-workspace-menu-item" disabled={busy} onClick={() => open(viewProject)}><Icon name="people" size={16} /><span>查看团队</span></button>
        <button role="menuitem" className="wf-workspace-menu-item" disabled={busy} onClick={() => void cancel()}><Icon name="close" size={16} /><span>{busy ? '取消中…' : '取消团队'}</span></button>
      </> : <button role="menuitem" className="wf-workspace-menu-item" disabled={busy} onClick={() => open(configureProject)}><Icon name="people" size={16} /><span>配置团队</span></button>}
    {error && <p className="wf-workspace-menu-error" role="alert">{error}</p>}
  </>;
}
