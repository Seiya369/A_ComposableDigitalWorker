import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session';
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy';
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox';
import { setApprovalPolicy, type ApprovalPolicy } from '@deepseek-ai/dsh-user-approval';
import type {} from '@deepseek-ai/dsh-permission-presets';
import type {} from '@deepseek-ai/dsh-session-persistence';
import type {} from '@deepseek-ai/dsh-agent-preset-registry';

export interface NativeEmployeeContext {
  sourceAgent?: Agent;
  presetId?: string;
  permission?: string;
  sandbox?: SandboxMode;
  approval?: ApprovalPolicy;
}

/** Read policy facts only; never restore, own, delete or replay a source conversation. */
export async function readNativeEmployeeContext(ctx: Context, sourceSessionId: string | undefined, signal: AbortSignal): Promise<NativeEmployeeContext> {
  const presets = ctx.get('agentPresets');
  if (!sourceSessionId) return { presetId: presets?.defaultId };
  const id = SessionId(sourceSessionId);
  const sourceAgent = ctx.agents.get(id);
  const session = sourceAgent?.session;
  const state: NativeEmployeeContext = { sourceAgent, presetId: sourceAgent ? presets?.composedPreset(sourceAgent.ctx) : undefined };
  const fold = (events: readonly SessionEvent[]) => {
    for (const event of events) {
      if (event.type === 'agent-preset/selected') state.presetId = event.data.agentPreset;
      else if (event.type === 'permission/preset') state.permission = event.data.preset;
      else if (event.type === 'sandbox/mode') state.sandbox = event.data.mode;
      else if (event.type === 'approval/policy') state.approval = event.data.policy;
    }
  };
  if (session) {
    state.presetId ??= session.header.agentPreset;
    fold(session.snapshotEvents());
    if (sourceAgent) state.presetId = presets?.composedPreset(sourceAgent.ctx) ?? state.presetId;
    state.permission = ctx.get('permissionPresets')?.current(session) ?? state.permission;
    state.sandbox ??= ctx.get('sandboxPolicy')?.resolve({ session }).mode;
  } else {
    const persistence = ctx.get('sessionPersistence');
    if (persistence) {
      const handle = await persistence.open(id, 'read', { signal });
      try {
        state.presetId ??= handle.header.agentPreset;
        for (let offset = 0; ; offset += 500) {
          signal.throwIfAborted();
          const { events } = await handle.read(offset, 500, { signal });
          fold(events);
          if (events.length < 500) break;
        }
      } finally { await handle.close(); }
    } else if (ctx.get('sandboxPolicy') || ctx.get('permissionPresets')) {
      throw new Error('无法读取来源会话的原生权限，请打开来源会话后重试');
    }
  }
  state.presetId ??= presets?.defaultId;
  state.sandbox ??= ctx.get('sandboxPolicy')?.resolve().mode;
  state.approval ??= ctx.get('approval')?.config.policy ?? undefined;
  return state;
}

/** Native owners write the new session's facts; Auto identity and admission are preserved. */
export async function applyNativeEmployeeContext(ctx: Context, agentCtx: Context, agent: Agent, state: NativeEmployeeContext): Promise<void> {
  const presets = ctx.get('agentPresets');
  if (presets) {
    const inherited = state.sourceAgent && presets.composeFrom(agentCtx, state.sourceAgent.ctx);
    if (!inherited) await presets.mount(agentCtx, state.presetId);
  }
  if (state.permission && state.permission !== 'custom') {
    const permissions = ctx.get('permissionPresets');
    if (!permissions) throw new Error('来源会话的原生权限预设服务不可用');
    permissions.set(agent.session, state.permission);
  }
  if (state.sandbox) setSandboxMode(agent.session, state.sandbox);
  if (state.approval) setApprovalPolicy(agent.session, state.approval);
}
