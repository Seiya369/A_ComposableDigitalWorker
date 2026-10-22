import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type {} from '@deepseek-ai/dsh-api-session-controller/client';
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
import { WorkforcePanel, WorkforceWorkspace, clearWorkforceDrafts } from '../ui/index.js';
import { ProjectTeamDialog } from '../ui/ProjectTeamDialog.js';
import { Icon } from '../ui/icons.js';
import type { WorkforceClient } from '../ui/client.js';
import type { WorkforceRun } from '../domain/types.js';
import { createWorkforceClient, request, startEmployeeRun } from './api.js';
import { createEmployeeMentionSource } from './mentions.js';
import './integration.css';
import '../ui/workforce.css';
import '../ui/capability-selector.css';

type PanelState={open:boolean;projectId?:string;view?:'configure-team'|'staffing'|'runs'|'memories'|'workflows'};
type PanelProps={usePanel:<T>(select:(state:PanelState)=>T)=>T;client:WorkforceClient;close:()=>void;navigate:(state:PanelState)=>void;openWorkspace:(projectId?:string)=>void};
function PanelOverlay({usePanel,client,close,navigate,openWorkspace}:PanelProps){
  const state=usePanel(s=>s);
  if (!state.open) return null;
  if (state.projectId && state.view === 'configure-team') return <ProjectTeamDialog key={state.projectId} client={client} projectId={state.projectId} onClose={close} onManage={()=>navigate({...state,view:'staffing'})} onOpenWorkspace={openWorkspace}/>;
  return <WorkforcePanel key={`${state.projectId||'templates'}:${state.view||'staffing'}`} client={client} projectId={state.projectId} initialView={state.view === 'configure-team' ? 'staffing' : state.view} onClose={close} onConfigureTeam={()=>navigate({...state,view:'configure-team'})} onOpenWorkspace={openWorkspace}/>;
}

type EmployeeButtonProps=PropsRuntime<'conversation.input.left'>&{configure:()=>void};
export const GRAPH_HORSES_PANEL_ID = 'graph_horses' as MainPanelId;
function GraphHorsesIcon({size}:PropsRuntime<'sidebar.panellist'>){ return <Icon name="network" size={size}/>; }
type WorkspaceNavigation={getSnapshot:()=>{projectId?:string;generation:number};subscribe:(listener:()=>void)=>()=>void};
function GraphHorsesPage({client,navigation,onOpenSession}:{client:WorkforceClient;navigation:WorkspaceNavigation;onOpenSession:(sessionId:string)=>void}){
  const state=useSyncExternalStore(navigation.subscribe,navigation.getSnapshot);
  return <WorkforceWorkspace key={state.generation} client={client} initialProjectId={state.projectId} onOpenSession={onOpenSession}/>;
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

export const inject=['slots','sessions','workspaces','locale','layout','uiWorkspace','inputTriggers'];

/** Business templates live in an official global panel; project conversation
 * entry points reuse the same durable state through the public overlay slot.
 */
export function apply(ctx:Context):void{
  let panel:PanelState={open:false};
  const listeners=new Set<()=>void>();
  const change=(next:PanelState)=>{panel=next;for(const listener of listeners)listener()};
  const openLibrary=()=>{change({open:false});ctx.layout.selectPanel(GRAPH_HORSES_PANEL_ID);};
  let workspaceSelection:{projectId?:string;generation:number}={generation:0};
  const workspaceListeners=new Set<()=>void>();
  const workspaceNavigation:WorkspaceNavigation={getSnapshot:()=>workspaceSelection,subscribe:listener=>{workspaceListeners.add(listener);return()=>workspaceListeners.delete(listener)}};
  const openWorkspace=(projectId?:string)=>{
    workspaceSelection={projectId,generation:workspaceSelection.generation+1};
    for(const listener of workspaceListeners)listener();
    openLibrary();
  };
  const configureProject=(projectId:string)=>change({open:true,projectId,view:'configure-team'});
  const showProjectRuns=(projectId:string)=>change({open:true,projectId,view:'runs'});
  const source={getSnapshot:()=>panel,subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>listeners.delete(listener)}};
  const client=createWorkforceClient({onRun:run=>{void openRun(run).catch(()=>showProjectRuns(run.projectId));}});
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
      if(run.sessionId && ctx.sessions.list.getSnapshot().byId[run.sessionId as SessionId]
        && ctx.workspaces.list.getSnapshot().items.some(project=>project.workspaceId===run.projectId && project.sessionIds.includes(run.sessionId as SessionId))){
        ctx.uiWorkspace.openSession(run.sessionId as SessionId);return;
      }
      if(run.status==='failed'||run.status==='cancelled'){showProjectRuns(run.projectId);return;}
      await new Promise(resolve=>setTimeout(resolve,250));
      const state=await client.snapshot();run=state.runs.find(r=>r.id===run.id)||run;
    }
    if(!disposed)showProjectRuns(run.projectId);
  };
  ctx.slots.inject('main',()=>ctx.slots.register({
    name:'main',key:GRAPH_HORSES_PANEL_ID,
    inject:()=>({client,navigation:workspaceNavigation,onOpenSession:(sessionId:string)=>ctx.uiWorkspace.openSession(sessionId as SessionId)}),
  },GraphHorsesPage));
  ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({
    name:'sidebar.panellist',id:GRAPH_HORSES_PANEL_ID,order:10,label:'graph_horses',
  },GraphHorsesIcon));
  ctx.slots.inject('shell.overlay',()=>ctx.slots.register({
    name:'shell.overlay',id:'workforce-config',order:50,
    inject:()=>({client,close:()=>change({open:false}),navigate:change,openWorkspace,hooks:{panel:source}}),
  },PanelOverlay));
  ctx.slots.inject('conversation.input.left',()=>ctx.slots.register({
    name:'conversation.input.left',id:'workforce-employees',order:5,
    inject:(sessionId)=>({configure:()=>{projectForSession(sessionId).then(id=>id?configureProject(id):openLibrary()).catch(openLibrary)}}),
  },EmployeeButton));
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
  ctx.effect(()=>()=>{disposed=true;listeners.clear();workspaceListeners.clear();clearWorkforceDrafts();document.querySelector('style[data-plugin="composable-workforce"]')?.remove();},'workforce: UI cleanup');
}
