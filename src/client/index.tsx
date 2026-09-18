import { useEffect, useState } from 'react';
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { WorkforcePanel } from '../ui/index.js';
import { ProjectTeamDialog } from '../ui/ProjectTeamDialog.js';
import { ProjectTeamMenu } from './ProjectTeamMenu.js';
import { Icon } from '../ui/icons.js';
import type { WorkforceClient } from '../ui/client.js';
import type { WorkforceRun } from '../domain/types.js';
import { createWorkforceClient, request, startEmployeeRun } from './api.js';
import { createEmployeeMentionSource } from './mentions.js';
import './integration.css';
import '../ui/workforce.css';

type PanelState={open:boolean;projectId?:string;view?:'configure-team'|'staffing'|'runs'|'memories'|'workflows'};
type PanelProps={usePanel:<T>(select:(state:PanelState)=>T)=>T;client:WorkforceClient;close:()=>void;navigate:(state:PanelState)=>void};
function PanelOverlay({usePanel,client,close,navigate}:PanelProps){
  const state=usePanel(s=>s);
  if (!state.open) return null;
  if (state.projectId && state.view === 'configure-team') return <ProjectTeamDialog key={state.projectId} client={client} projectId={state.projectId} onClose={close} onManage={()=>navigate({...state,view:'staffing'})}/>;
  return <WorkforcePanel key={`${state.projectId||'templates'}:${state.view||'staffing'}`} client={client} projectId={state.projectId} initialView={state.view === 'configure-team' ? 'staffing' : state.view} onClose={close} onConfigureTeam={()=>navigate({...state,view:'configure-team'})}/>;
}

type EmployeeButtonProps=PropsRuntime<'conversation.input.left'>&{configure:()=>void};
type LibraryButtonProps=PropsRuntime<'sidebar.workspaces.header.action'>&{openLibrary:()=>void};
function LibraryButton({openLibrary}:LibraryButtonProps){
  return <button className="wf-workspace-action" aria-label="数字员工模板" title="数字员工模板" onClick={openLibrary}><Icon name="people" size={16}/></button>;
}
function EmployeeButton({configure}:EmployeeButtonProps){
  return <button className="wf-native-button" title="配置项目团队" aria-label="配置项目团队" onClick={configure}><Icon name="people" size={16}/><span>团队</span></button>;
}
type RunDockProps=PropsRuntime<'conversation.input.dock'>&{load:()=>Promise<WorkforceRun|undefined>;review:()=>void};
function RunDock({load,review}:RunDockProps){
  const [run,setRun]=useState<WorkforceRun>();
  useEffect(()=>{
    let alive=true;const refresh=()=>{load().then(r=>{if(alive)setRun(r)}).catch(()=>{/* Main panel owns surfaced API errors; this optional dock retains the last known status. */});};
    refresh();const timer=setInterval(refresh,2500);return()=>{alive=false;clearInterval(timer)};
  },[load]);
  if(!run)return null;
  const labels={queued:'排队中',running:'执行中',blocked:'已退回', 'awaiting-review':'待验收',succeeded:'已验收',failed:'执行失败',cancelled:'已取消'};
  return <div className="wf-native-dock"><Icon name="person" size={16}/><b>{run.employeeSnapshot.name}</b><span>{labels[run.status]}</span><button onClick={review}>任务与交付</button></div>;
}

export const inject=['slots','sessions','workspaces','locale','connection','inputTriggers'];

/** Host-derived UI data stays on the API; the browser keeps only modal state.
 * Native slot and trigger APIs are pinned in integration/README.md.
 */
export function apply(ctx:ClientContext):void{
  let panel:PanelState={open:false};
  const listeners=new Set<()=>void>();
  const change=(next:PanelState)=>{panel=next;for(const listener of listeners)listener()};
  const openLibrary=()=>change({open:true});
  const configureProject=(projectId:string)=>change({open:true,projectId,view:'configure-team'});
  const viewProject=(projectId:string)=>change({open:true,projectId,view:'staffing'});
  const showProjectRuns=(projectId:string)=>change({open:true,projectId,view:'runs'});
  const source={getSnapshot:()=>panel,subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>listeners.delete(listener)}};
  const client=createWorkforceClient();
  const projectForSession=async(sessionId:string):Promise<string|undefined>=>{
    const response=await request<{projectId?:string}>(`/session-project?sessionId=${encodeURIComponent(sessionId)}`);
    return response.projectId;
  };
  let disposed=false;
  const openRun=async(initial:WorkforceRun)=>{
    // Admission returns immediately. Open the native session only after the host
    // attaches it to the workspace, including when a queued task starts later.
    let run=initial;
    for(let attempt=0;attempt<40&&!disposed;attempt++){
      if(run.sessionId && ctx.sessions.list.getSnapshot().byId[run.sessionId]
        && ctx.workspaces.list.getSnapshot().items.some(project=>project.workspaceId===run.projectId && project.sessionIds.includes(run.sessionId as SessionId))){
        ctx.sessions.open(run.sessionId as SessionId);return;
      }
      if(run.status==='failed'||run.status==='cancelled'){showProjectRuns(run.projectId);return;}
      await new Promise(resolve=>setTimeout(resolve,250));
      const state=await client.snapshot();run=state.runs.find(r=>r.id===run.id)||run;
    }
    if(!disposed)showProjectRuns(run.projectId);
  };
  ctx.slots.inject('sidebar.workspaces.header.action',()=>ctx.slots.register({
    name:'sidebar.workspaces.header.action',id:'workforce-library',order:20,
    inject:()=>({openLibrary}),
  },LibraryButton));
  ctx.slots.inject('sidebar.workspaces.menu.action',()=>ctx.slots.register({
    name:'sidebar.workspaces.menu.action',id:'workforce-configure-project',order:20,
    inject:()=>({client,configureProject,viewProject}),
  },ProjectTeamMenu));
  ctx.slots.inject('shell.overlay',()=>ctx.slots.register({
    name:'shell.overlay',id:'workforce-config',order:50,
    inject:()=>({client,close:()=>change({open:false}),navigate:change,hooks:{panel:source}}),
  },PanelOverlay));
  ctx.slots.inject('conversation.input.left',()=>ctx.slots.register({
    name:'conversation.input.left',id:'workforce-employees',order:5,
    inject:(sessionId)=>({configure:()=>{projectForSession(sessionId).then(id=>id?configureProject(id):openLibrary()).catch(openLibrary)}}),
  },EmployeeButton));
  ctx.slots.inject('sidebar.footer.action',()=>ctx.slots.register({
    name:'sidebar.footer.action',id:'workforce-library',order:20,
    inject:()=>({openLibrary}),
  },({wide,openLibrary}:{wide:boolean;openLibrary:()=>void})=>wide?null:<button className="wf-native-button" aria-label="数字员工模板" title="数字员工模板" onClick={openLibrary}><Icon name="people"/></button>));
  ctx.slots.inject('conversation.input.dock',()=>ctx.slots.register({
    name:'conversation.input.dock',id:'workforce-run',order:30,
    inject:(sessionId)=>({
      load:async()=> (await client.snapshot()).runs.find(run=>run.sessionId===sessionId),
      review:()=>{projectForSession(sessionId).then(id=>id?showProjectRuns(id):openLibrary()).catch(openLibrary)},
    }),
  },RunDock));
  ctx.effect(()=>ctx.inputTriggers.registerSource(createEmployeeMentionSource({
    snapshot:client.snapshot,projectForSession,run:startEmployeeRun,
    onStarted:run=>{void openRun(run).catch(()=>showProjectRuns(run.projectId));},
  })),'workforce: employee mentions');
  ctx.effect(()=>()=>{disposed=true;listeners.clear();document.querySelector('style[data-plugin="composable-workforce"]')?.remove();},'workforce: UI cleanup');
}
