import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-session-controller';
import type { EmployeeModelCatalog } from '../domain/model-catalog.js';

/** Same provider ordering as the native conversation model selector. */
function providerPriority(id: string): number {
  return id === 'deepseek-account' ? 0 : id === 'deepseek-official' ? 1 : 2;
}

/**
 * Read the public Session Controller catalog without opening a Session or invoking
 * a model. The service resolves the current LLM registry on every read, so model
 * settings and account changes are reflected on the next selector refresh.
 *
 * Deliberately whitelist presentation fields. Provider failures can include
 * sensitive transport details and are never copied into this browser DTO.
 */
export async function listEmployeeModels(ctx: Context): Promise<EmployeeModelCatalog> {
  try {
    const catalog = await ctx.sessionController.modelCatalog();
    const groups = catalog.groups.toSorted((left, right) => providerPriority(left.id) - providerPriority(right.id));
    const selection = catalog.default;
    const defaultSelection = selection && typeof selection.provider === 'string' && selection.provider.trim() && typeof selection.model === 'string' && selection.model.trim() ? {
      provider: selection.provider,
      model: selection.model,
      ...(typeof selection.reasoningEffort === 'string' && selection.reasoningEffort.trim() ? { reasoningEffort: selection.reasoningEffort } : {}),
    } : undefined;
    return {
      ...(defaultSelection ? { default: defaultSelection } : {}),
      models: groups.flatMap(group => group.models.map(model => ({
        provider: group.id,
        providerName: group.name,
        model: model.id,
        modelName: model.name,
        ...(model.reasoning === undefined ? {} : {
          reasoningEfforts: model.reasoning.efforts.map(effort => ({ id: effort.id, name: effort.name })),
          ...(model.reasoning.defaultEffort === undefined ? {} : { defaultReasoningEffort: model.reasoning.defaultEffort }),
        }),
      }))),
    };
  } catch {
    throw new Error('无法读取 DSH 模型目录，请重试或检查 DSH 模型设置');
  }
}
