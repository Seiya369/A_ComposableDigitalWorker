import { useSyncExternalStore, type ComponentType } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type {} from '@deepseek-ai/dsh-api-session-controller/client';
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
import { WorkforceWorkspace, clearWorkforceDrafts } from '../ui/index.js';
import { ProjectExecutionReview } from '../ui/ProjectExecutionReview.js';
import { ConversationWorkflowPicker, ConversationWorkflowSteps } from '../ui/ConversationWorkflow.js';
import { ConversationEmployee } from '../ui/ConversationEmployee.js';
import { Icon } from '../ui/icons.js';
import type { WorkforceClient } from '../ui/client.js';
import type { WorkforceRun, WorkforceState } from '../domain/types.js';
import { createWorkforceClient, request, startEmployeeRun, issueEmployeeMentionTicket } from './api.js';
import { createEmployeeMentionSource, employeeMentionMarkerDisplayRule, type EmployeeMentionProject } from './mentions.js';
import { createConversationWorkflowController } from './conversation-workflow.js';
import { createConversationWorkflowTransport } from './conversation-workflow-transport.js';
import { createConversationWorkflowDetailsClient } from './conversation-workflow-details.js';
import { createConversationReopenNavigation } from './conversation-workflow-reopen.js';
import { createEmployeeConversationBlocks } from './employee-conversation-blocks.js';
import { createConversationEmployeeController } from './conversation-employee.js';
import { createConversationEmployeeTransport } from './conversation-employee-transport.js';
import { WorkforceI18nProvider, createWorkforceI18n, registerWorkforceLocales } from '../ui/i18n.js';
import './integration.css';
import '../ui/workforce.css';
import '../ui/capability-selector.css';
import '../ui/KnowledgeLibrary.css';
import '../ui/knowledge-graph.css';

export const GRAPH_HORSES_PANEL_ID = 'graph_horses' as MainPanelId;
const DELIVERY_PANEL_ID = 'graph_horses_delivery' as MainPanelId;
function GraphHorsesIcon({size}:PropsRuntime<'sidebar.panellist'>){ return <Icon name="network" size={size}/>; }
function GraphHorsesPage({client}:{client:WorkforceClient}){ return <WorkforceWorkspace client={client}/>; }
type ReviewNavigation={getSnapshot:()=>WorkforceRun|undefined;subscribe:(listener:()=>void)=>()=>void};
function DeliveryPage({client,navigation,onClose,onOpenSession}:{client:WorkforceClient;navigation:ReviewNavigation;onClose:()=>void;onOpenSession:(sessionId:string)=>void}){
  const run=useSyncExternalStore(navigation.subscribe,navigation.getSnapshot);
  return run ? <ProjectExecutionReview key={run.id} client={client} projectId={run.projectId} initialRunId={run.id} onClose={onClose} onOpenSession={onOpenSession}/> : null;
}
export const inject=['slots','sessions','workspaces','locale','layout','uiWorkspace','inputTriggers','conversation','uiConversation'];

/** Library and single-delivery review use distinct public panels. */
export async function apply(ctx:Context):Promise<void>{
  ctx.effect(()=>registerWorkforceLocales(ctx.locale),'workforce: locale dictionaries');
  const i18n=createWorkforceI18n(ctx.locale);
  const localized=<P extends object,>(Component:ComponentType<P>)=>(props:P)=><WorkforceI18nProvider runtime={ctx.locale}><Component {...props}/></WorkforceI18nProvider>;
  let reviewRun:WorkforceRun|undefined;
  const reviewListeners=new Set<()=>void>();
  const reviewNavigation:ReviewNavigation={getSnapshot:()=>reviewRun,subscribe:listener=>{reviewListeners.add(listener);return()=>reviewListeners.delete(listener)}};
  const showReview=(run:WorkforceRun)=>{
    if (ctx.fiber.uid === null) return;
    reviewRun=run;
    for(const listener of reviewListeners)listener();
    ctx.layout.selectPanel(DELIVERY_PANEL_ID);
  };
  const client=createWorkforceClient({
    onOpenNativePlugins:bundleName=>{
      if(bundleName){
        const navigation=ctx.get('pluginNavigation');
        if(!navigation)throw new Error(i18n.t('DSH 原生插件管理页面暂不可用，请稍后重试'));
        navigation.openBundle(bundleName);
      }else ctx.layout.selectPanel('plugins' as MainPanelId);
    },
  });
  const employeeBlocks=createEmployeeConversationBlocks({
    set:(sessionId,block)=>ctx.conversation.blocks.set(sessionId as SessionId,block),
    storeFor:sessionId=>ctx.conversation.blocks.storeFor(sessionId as SessionId),
  },()=>i18n.t('员工工作单执行或交接中，请稍候…'),()=>ctx.fiber.uid !== null);
  ctx.effect(()=>()=>employeeBlocks.dispose(),'workforce: employee composer handoff');
  // Seed existing deliveries before this plugin's UI can expose their composers.
  // A Host projection releases historical sessions that already have a native owner.
  const initialization=new AbortController();
  const initializationTimeout=setTimeout(()=>initialization.abort(new Error('员工会话状态读取超时')),10_000);
  try {
    const restored=await employeeBlocks.restore(async()=> (await request<WorkforceState>('/state',undefined,initialization.signal)).runs);
    if (!restored || ctx.fiber.uid === null) return;
  } finally { clearTimeout(initializationTimeout); }
  const projectForSession=async(sessionId:string):Promise<EmployeeMentionProject|undefined>=>{
    const response=await request<{projectId?:string; standaloneOnly?:boolean}>(`/session-project?sessionId=${encodeURIComponent(sessionId)}`);
    return response.projectId ? response.standaloneOnly ? {projectId:response.projectId,standaloneOnly:true} : response.projectId : undefined;
  };
  const reopenNavigation=createConversationReopenNavigation({
    isCurrentConversation:sessionId=>ctx.layout.panelInfo.getSnapshot().activePanelId===null
      && Boolean(ctx.sessions.list.getSnapshot().byId[sessionId as SessionId]?.retainedBy.mainView),
    isConversationVisible:()=>ctx.layout.panelInfo.getSnapshot().activePanelId===null,
    beginNavigation:()=>ctx.layout.beginNavigation(),
    reloadBlockReason:sessionId=>{
      const scope=ctx.sessions.scope(sessionId as SessionId);
      if(!scope)return '会话正在恢复，请稍后点击“刷新继续”';
      const input=ctx.conversation.input.for(scope).state.getSnapshot();
      if(input.attachmentIds.length)return '会话已恢复，请先移除未发送附件，再点击“刷新继续”';
      if(input.phase!=='plain')return '请等待当前输入处理完成，再点击“刷新继续”';
      return undefined;
    },
    reloadSession:sessionId=>{
      // The official Client keeps removed=true on a retained Session generation.
      // Its public navigation persists the identity; browser reload releases that
      // stale generation without disposing references owned by native UI.
      ctx.uiWorkspace.openSession(sessionId as SessionId);
      window.location.reload();
    },
  });
  const workflowTransport=createConversationWorkflowTransport(request,{
    ...reopenNavigation,onEmployeeSessionOwner:employeeBlocks.observe,
  });
  const workflowController=createConversationWorkflowController(workflowTransport.transport);
  const employeeController=createConversationEmployeeController(createConversationEmployeeTransport(request,reopenNavigation));
  const detailsClient=createConversationWorkflowDetailsClient(request,client);
  let disposed=false;
  const openRun=async(initial:WorkforceRun)=>{
    // Admission returns immediately. Open the native session only after the host
    // attaches it to the workspace, including when a queued task starts later.
    let run=initial;
    for(let attempt=0;attempt<40&&!disposed&&ctx.fiber.uid!==null;attempt++){
      if(run.sessionId && ctx.sessions.list.getSnapshot().byId[run.sessionId as SessionId]
        && ctx.workspaces.list.getSnapshot().items.some(project=>project.workspaceId===run.projectId && project.sessionIds.includes(run.sessionId as SessionId))){
        // Set the official block synchronously before navigation, including a
        // task that has already completed before its new session is opened.
        employeeBlocks.seed([run]);
        ctx.uiWorkspace.openSession(run.sessionId as SessionId);return;
      }
      if(run.status==='failed'||run.status==='cancelled'){showReview(run);return;}
      await new Promise(resolve=>setTimeout(resolve,250));
      const state=await client.snapshot();run=state.runs.find(r=>r.id===run.id)||run;
    }
    if(!disposed)showReview(run);
  };
  ctx.slots.inject('main',()=>ctx.slots.register({
    name:'main',key:GRAPH_HORSES_PANEL_ID,
    inject:()=>({client}),
  },localized(GraphHorsesPage)));
  ctx.slots.inject('main',()=>ctx.slots.register({
    name:'main',key:DELIVERY_PANEL_ID,
    inject:()=>({client,navigation:reviewNavigation,onClose:()=>reviewRun?.sessionId ? ctx.uiWorkspace.openSession(reviewRun.sessionId as SessionId) : ctx.layout.selectPanel(GRAPH_HORSES_PANEL_ID),onOpenSession:(sessionId:string)=>ctx.uiWorkspace.openSession(sessionId as SessionId)}),
  },localized(DeliveryPage)));
  ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({
    name:'sidebar.panellist',id:GRAPH_HORSES_PANEL_ID,order:10,label:'graph_horses',
  },GraphHorsesIcon));
  ctx.slots.inject('conversation.input.left',()=>ctx.slots.register({
    name:'conversation.input.left',id:'workforce-workflow',order:5,
    inject:()=>({controller:workflowController,recovery:reopenNavigation}),
  },localized(ConversationWorkflowPicker)));
  ctx.slots.inject('conversation.session.header.utilities',()=>ctx.slots.register({
    name:'conversation.session.header.utilities',id:'workforce-workflow-steps',order:-20,
    inject:()=>({controller:workflowController,detailsClient,onOpenSession:(sessionId:string)=>ctx.uiWorkspace.openSession(sessionId as SessionId)}),
  },localized(ConversationWorkflowSteps)));
  ctx.slots.inject('conversation.session.header.utilities',()=>ctx.slots.register({
    name:'conversation.session.header.utilities',id:'workforce-conversation-employee',order:-19,
    inject:()=>({controller:employeeController}),
  },localized(ConversationEmployee)));
  ctx.effect(()=>ctx.inputTriggers.registerSource(createEmployeeMentionSource({
    snapshot:client.snapshot,projectForSession,run:startEmployeeRun,issueMentionTicket:issueEmployeeMentionTicket,
    translate:i18n.t,translateError:i18n.errorMessage,
    onStarted:run=>{void openRun(run).catch(()=>{if(!disposed&&ctx.fiber.uid!==null)showReview(run);});},
  })),'workforce: employee mentions');
  ctx.effect(()=>ctx.uiConversation.userText.register(employeeMentionMarkerDisplayRule),'workforce: employee mention display');
  ctx.effect(()=>()=>{disposed=true;workflowController.dispose();workflowTransport.dispose();employeeController.dispose();reopenNavigation.dispose();reviewListeners.clear();clearWorkforceDrafts();document.querySelector('style[data-plugin="composable-workforce"]')?.remove();},'workforce: UI cleanup');
}
import '../ui/SharedWikiGraph.css';
