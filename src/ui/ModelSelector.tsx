import { useEffect, useId, useState } from 'react';
import type { EmployeeModelCatalog, EmployeeModelOption } from '../domain/model-catalog.js';
import { resolveEmployeeModelSelection } from '../domain/model-catalog.js';
import type { ModelModule } from '../domain/types.js';
import type { WorkforceClient } from './client.js';
import { Field } from './fields.js';

interface ModelSelectorProps {
  client: Pick<WorkforceClient, 'listModels'>;
  value: ModelModule;
  onChange: (value: ModelModule) => void;
}

/** Provider and model IDs are opaque strings, so separator-based keys are unsafe. */
export function modelOptionValue(model: Pick<EmployeeModelOption, 'provider' | 'model'>): string {
  return JSON.stringify([model.provider, model.model]);
}

/** A deliberate model change keeps only reasoning settings supported by the new model. */
export function selectEmployeeModel(current: ModelModule, selected: EmployeeModelOption): ModelModule {
  const reasoningEffort = selected.reasoningEfforts?.some(effort => effort.id === current.reasoningEffort) ? current.reasoningEffort : undefined;
  return { ...current, mode: 'override', provider: selected.provider, model: selected.model, reasoningEffort };
}

export function ModelSelector({ client, value, onChange }: ModelSelectorProps) {
  const radioName = useId();
  const [catalog, setCatalog] = useState<EmployeeModelCatalog>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void client.listModels().then(next => { if (active) setCatalog(next); }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, attempt]);

  const models = catalog?.models ?? [];
  const effective = resolveEmployeeModelSelection(value, catalog ?? { models: [] });
  const currentValue = effective.mode === 'override' && effective.provider && effective.model ? modelOptionValue({ provider: effective.provider, model: effective.model }) : '';
  const selected = models.find(model => modelOptionValue(model) === currentValue);
  const missing = !!currentValue && !!catalog && !selected;
  const efforts = selected?.reasoningEfforts ?? [];
  const missingEffort = !!effective.reasoningEffort && !!selected && !efforts.some(effort => effort.id === effective.reasoningEffort);
  const groups = new Map<string, { name: string; models: EmployeeModelOption[] }>();
  for (const model of models) {
    const group = groups.get(model.provider) ?? { name: model.providerName || model.provider, models: [] };
    group.models.push(model); groups.set(model.provider, group);
  }
  const defaultEffort = efforts.find(effort => effort.id === selected?.defaultReasoningEffort)?.name;

  return <div className="wf-model-selector">
    <div className="wf-model-catalog-status">
      <h3 className="wf-field-label" id={`${radioName}-label`}>岗位模型</h3>
      {loading ? <span className="wf-hint" role="status"><span className="wf-spinner" />读取 DSH 已配置模型…</span> : null}
      {!loading && !error && models.length > 0 && !currentValue && <span className="wf-model-warning" role="status">未读取到 DSH 默认模型</span>}
      <button type="button" className="wf-button" disabled={loading} onClick={() => setAttempt(current => current + 1)} aria-label={error ? '重试读取模型列表' : '刷新模型列表'}>{error ? '重试' : '刷新模型'}</button>
    </div>
    {error && <div className="wf-banner wf-banner-error" role="alert">读取 DSH 模型列表失败：{error}。现有配置已保留，可以重试。</div>}
    {!loading && !error && models.length === 0 && <p className="wf-hint" role="status">当前未读取到可选模型。请检查 DSH 模型设置，或稍后刷新列表。</p>}
    <fieldset className="wf-model-options" disabled={loading} aria-labelledby={`${radioName}-label`}>
      {currentValue && !selected && <label className="wf-model-option is-selected is-unavailable"><input type="radio" name={radioName} value={currentValue} checked disabled /><span><strong>{effective.model}</strong><small>{effective.provider}{missing ? ' · 当前 DSH 中已缺失' : ' · 原配置，待确认'}</small></span></label>}
      {[...groups.entries()].map(([provider, group], index) => <div className="wf-model-provider" key={provider} role="group" aria-labelledby={`${radioName}-provider-${index}`}>
        <h3 id={`${radioName}-provider-${index}`}>{group.name}</h3>
        <div className="wf-model-provider-options">{group.models.map(model => {
          const optionValue = modelOptionValue(model);
          const checked = optionValue === currentValue;
          return <label className={`wf-model-option${checked ? ' is-selected' : ''}`} key={optionValue}><input type="radio" name={radioName} value={optionValue} checked={checked} onChange={() => onChange(selectEmployeeModel(effective, model))} /><span><strong>{model.modelName || model.model}</strong>{model.modelName && model.modelName !== model.model && <small>{model.model}</small>}</span></label>;
        })}</div>
      </div>)}
    </fieldset>
    {missing && <p className="wf-model-warning" role="status">已保存的模型不在当前 DSH 模型列表中。配置将保留；需要执行任务时，请重新选择可用模型。</p>}
    {selected && (efforts.length > 0 || effective.reasoningEffort) && <Field label="推理强度" hint={missingEffort ? '原推理强度不受当前模型支持，已保留原值。可选择支持的值或使用模型默认设置。' : undefined}>
      <select value={effective.reasoningEffort ?? ''} onChange={event => onChange({ ...effective, reasoningEffort: event.target.value || undefined })}>
        <option value="">使用模型默认设置{defaultEffort ? `（${defaultEffort}）` : ''}</option>
        {missingEffort && <option value={effective.reasoningEffort} disabled>{effective.reasoningEffort}（当前模型不支持）</option>}
        {efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name || effort.id}</option>)}
      </select>
    </Field>}
    {selected && efforts.length === 0 && !effective.reasoningEffort && <p className="wf-hint">该模型没有可单独选择的推理强度，将使用 DSH 默认设置。</p>}
  </div>;
}
