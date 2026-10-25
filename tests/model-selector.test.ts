import assert from 'node:assert/strict';
import test from 'node:test';
import { modelOptionValue, selectEmployeeModel } from '../src/ui/ModelSelector.js';
import { moduleReady } from '../src/ui/ModuleEditor.js';
import { createBlankModules } from '../src/domain/seed.js';
import { resolveEmployeeModelSelection } from '../src/domain/model-catalog.js';

test('model option values distinguish opaque provider and model IDs', () => {
  const values = [
    { provider: 'provider:model', model: 'variant' },
    { provider: 'provider', model: 'model:variant' },
    { provider: 'provider/"model', model: 'variant' },
  ].map(modelOptionValue);
  assert.equal(new Set(values).size, values.length);
});

test('choosing an individual model preserves supported reasoning effort', () => {
  const current = { mode: 'override' as const, provider: 'old', model: 'old', reasoningEffort: 'high' };
  const next = selectEmployeeModel(current, { provider: 'dsh-provider', providerName: 'DSH Provider', model: 'reasoning-model', modelName: 'Reasoning Model', reasoningEfforts: [{ id: 'high', name: '高' }] });
  assert.deepEqual(next, { mode: 'override', provider: 'dsh-provider', model: 'reasoning-model', reasoningEffort: 'high' });
  assert.deepEqual(current, { mode: 'override', provider: 'old', model: 'old', reasoningEffort: 'high' });
});

test('choosing a different model drops unsupported reasoning without inventing defaults', () => {
  const next = selectEmployeeModel({ mode: 'override', provider: 'old', model: 'old', reasoningEffort: 'high' }, { provider: 'dsh-provider', providerName: 'DSH Provider', model: 'plain-model', modelName: 'Plain Model', reasoningEfforts: [{ id: 'low', name: '低' }], defaultReasoningEffort: 'low' });
  assert.equal(next.reasoningEffort, undefined);
  assert.equal(next.provider, 'dsh-provider');
  assert.equal(next.model, 'plain-model');
});

test('default mode is ready while an explicit selection remains supported', () => {
  const modules = createBlankModules();
  assert.equal(moduleReady('model', modules), true);
  modules.model = { mode: 'inherit', provider: 'old-provider', model: 'old-model' };
  assert.equal(moduleReady('model', modules), true);
  modules.model = selectEmployeeModel(modules.model, { provider: 'dsh-provider', providerName: 'DSH Provider', model: 'explicit-model', modelName: 'Explicit Model' });
  assert.equal(moduleReady('model', modules), true);
});

test('default mode follows the current DSH selection and ignores legacy residual fields', () => {
  const legacy = { mode: 'inherit' as const, provider: 'old-provider', model: 'old-model', reasoningEffort: 'old-effort' };
  const first = resolveEmployeeModelSelection(legacy, { models: [], default: { provider: 'native', model: 'default-model', reasoningEffort: 'high' } });
  assert.deepEqual(first, { mode: 'override', provider: 'native', model: 'default-model', reasoningEffort: 'high' });
  assert.deepEqual(resolveEmployeeModelSelection(legacy, { models: [], default: { provider: 'native', model: 'new-default' } }), {
    mode: 'override', provider: 'native', model: 'new-default',
  });
  assert.deepEqual(legacy, { mode: 'inherit', provider: 'old-provider', model: 'old-model', reasoningEffort: 'old-effort' });
});

test('an explicit employee model is not replaced by a changed DSH default', () => {
  const selected = { mode: 'override' as const, provider: 'chosen', model: 'selected-model', reasoningEffort: 'low' };
  assert.deepEqual(resolveEmployeeModelSelection(selected, { models: [], default: { provider: 'native', model: 'default-model', reasoningEffort: 'high' } }), selected);
});

test('an absent DSH default does not select the first available model', () => {
  const inherited = { mode: 'inherit' as const };
  const result = resolveEmployeeModelSelection(inherited, { models: [{ provider: 'available', providerName: 'Available', model: 'first-model', modelName: 'First Model' }] });
  assert.deepEqual(result, inherited);
});
