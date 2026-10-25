import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '@deepseek-ai/cordis';
import { listEmployeeModels } from '../src/harness/model-catalog.js';

function context(modelCatalog: () => Promise<unknown>): Context {
  return { sessionController: { modelCatalog } } as unknown as Context;
}

test('employee model options project only safe native catalog fields and match the native provider order', async () => {
  const catalog = {
    default: { provider: 'custom', model: 'reasoner', reasoningEffort: 'high', apiKey: 'secret-default-key', endpoint: 'https://private.invalid' },
    groups: [
      { id: 'custom', name: '自定义供应商', apiKey: 'secret-key', endpoint: 'https://private.invalid', models: [
        { id: 'reasoner', name: '推理模型', token: 'secret-token', reasoning: {
          efforts: [{ id: 'high', name: '高', description: 'not exported', account: 'secret-account' }],
          defaultEffort: 'high',
        } },
      ] },
      { id: 'deepseek-official', name: 'DeepSeek API', models: [{ id: 'chat', name: 'Chat' }] },
      { id: 'deepseek-account', name: 'DeepSeek 账号', models: [{ id: 'account-chat', name: 'Account Chat' }] },
      { id: 'empty', name: '未配置', models: [] },
    ],
    failures: [{ id: 'broken', name: 'Broken', message: 'credential=secret-password' }],
    credentials: { key: 'secret' },
  };
  const result = await listEmployeeModels(context(async () => catalog));
  assert.deepEqual(result, { default: { provider: 'custom', model: 'reasoner', reasoningEffort: 'high' }, models: [
    { provider: 'deepseek-account', providerName: 'DeepSeek 账号', model: 'account-chat', modelName: 'Account Chat' },
    { provider: 'deepseek-official', providerName: 'DeepSeek API', model: 'chat', modelName: 'Chat' },
    { provider: 'custom', providerName: '自定义供应商', model: 'reasoner', modelName: '推理模型',
      reasoningEfforts: [{ id: 'high', name: '高' }], defaultReasoningEffort: 'high' },
  ] });
  assert.doesNotMatch(JSON.stringify(result), /secret|endpoint|account-chat.*credentials/);
  result.models[2]!.reasoningEfforts![0]!.name = 'changed';
  assert.equal(catalog.groups[0]!.models[0]!.reasoning!.efforts[0]!.name, '高');
});

test('employee model reads use the live native directory every time and keep custom provider order', async () => {
  let calls = 0;
  const ctx = context(async () => {
    calls++;
    return {
      default: calls === 1 ? { provider: 'z-provider', model: 'second' } : { provider: 'new-provider', model: 'new-model' },
      groups: calls === 1 ? [
        { id: 'z-provider', name: 'Z', models: [{ id: 'first', name: 'First' }, { id: 'second', name: 'Second' }] },
        { id: 'a-provider', name: 'A', models: [{ id: 'last', name: 'Last' }] },
      ] : [
        { id: 'new-provider', name: 'New', models: [{ id: 'new-model', name: 'New Model' }] },
      ],
      failures: [],
    };
  });
  const first = await listEmployeeModels(ctx);
  assert.deepEqual(first.models.map(option => option.model), ['first', 'second', 'last']);
  assert.deepEqual(first.default, { provider: 'z-provider', model: 'second' });
  const next = await listEmployeeModels(ctx);
  assert.deepEqual(next.models.map(option => option.model), ['new-model']);
  assert.deepEqual(next.default, { provider: 'new-provider', model: 'new-model' });
  assert.equal(calls, 2);
});

test('an empty or partially failed native catalog returns available models without raw provider errors', async () => {
  assert.deepEqual(await listEmployeeModels(context(async () => ({
    groups: [], failures: [{ id: 'failed', message: 'https://private.invalid?token=secret' }],
  }))), { models: [] });
});

test('whole-directory failures expose a safe retry message without provider credentials', async () => {
  await assert.rejects(listEmployeeModels(context(async () => {
    throw new Error('https://private.invalid Authorization: Bearer secret-token');
  })), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /DSH.*模型目录/);
    assert.doesNotMatch(error.message, /private|Authorization|Bearer|secret-token/);
    return true;
  });
});

test('an unavailable native default is not invented from model list order', async () => {
  const result = await listEmployeeModels(context(async () => ({
    groups: [{ id: 'available', name: 'Available', models: [{ id: 'first', name: 'First' }] }], failures: [],
  })));
  assert.equal(result.models[0]!.model, 'first');
  assert.equal(result.default, undefined);
});
