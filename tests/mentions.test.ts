import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmployeeMentionSource, employeeAliases } from '../src/client/mentions.js';
import type { ProjectEmployee, WorkforceState } from '../src/domain/types.js';

const alice={id:'employee-1',version:1,name:'架构师',projectId:'project-a',templateName:'技术负责人',status:'active',modules:{responsibilities:{mission:'设计架构',duties:[],boundaries:[]},capabilities:{skills:[],tools:[]}}} as ProjectEmployee;
const bob={...alice,id:'employee-2',projectId:'project-b'};
const state={employees:[alice,bob]} as WorkforceState;

test('@ roster only exposes active employees in the selected project',async()=>{
  const source=createEmployeeMentionSource({snapshot:async()=>state,projectForSession:async()=> 'project-a',run:async()=>{throw new Error('must not run while listing')},onStarted:()=>{}});
  const candidates=await source.candidates({sessionId:'s' as never},{query:'',position:'leading',signal:new AbortController().signal});
  assert.equal(candidates.length,1);assert.equal(candidates[0]?.value,alice.id);
  assert.equal(candidates[0]?.section, '项目数字员工');
  assert.equal(candidates[0]?.hint, '主办');
  assert.deepEqual(await source.candidates({sessionId:'s' as never},{query:'',position:'inline',signal:new AbortController().signal}),[]);
});

test('@ pick captures instance identity and preserves failed submissions',async()=>{
  let submitted:unknown;
  const source=createEmployeeMentionSource({snapshot:async()=>state,projectForSession:async()=> 'project-a',run:async(input)=>{submitted=input;throw new Error('模型未配置')},onStarted:()=>{assert.fail('failed runs must not navigate')}});
  const result=await source.matchEnter!({sessionId:'s' as never},'@架构师 设计模块',new AbortController().signal,{attachments:0});
  assert.ok(result&&typeof result==='object'&&'claim' in result);
  const outcome=await result.claim.submit('设计模块',{} as never,[]);
  assert.equal(outcome.kind,'error');assert.match(outcome.text!,/模型未配置/);
  assert.deepEqual(submitted,{projectId:'project-a',employeeId:'employee-1',request:'设计模块',sourceSessionId:'s'});
});

test('duplicate employee names get independent aliases and attachment payloads are not dropped',async()=>{
  const duplicate={...alice,id:'another-2'};
  assert.equal(employeeAliases([alice,duplicate]).size,2);
  const source=createEmployeeMentionSource({snapshot:async()=>state,projectForSession:async()=> 'project-a',run:async()=>{throw new Error('unused')},onStarted:()=>{}});
  await assert.rejects(source.matchEnter!({sessionId:'s' as never},'@架构师 看图',new AbortController().signal,{attachments:1}),/暂不支持附件/);
});


test('a picked employee command rejects attachments before dispatch',async()=>{
  let calls=0;
  const source=createEmployeeMentionSource({snapshot:async()=>state,projectForSession:async()=> 'project-a',run:async()=>{calls++;throw new Error('must not dispatch')},onStarted:()=>{}});
  const candidates=await source.candidates({sessionId:'s' as never},{query:'',position:'leading',signal:new AbortController().signal});
  const picked=source.onPick!({session:{sessionId:'s' as never},position:'leading',candidate:candidates[0]} as never);
  assert.ok(picked&&typeof picked==='object'&&'claim' in picked);
  assert.equal(picked.claim.name,alice.name);
  assert.equal(picked.claim.attachments,false);
  assert.equal(picked.claim.hint, '交给架构师的任务…');
  const result=await picked.claim.submit('处理附件',{} as never,[{} as never]);
  assert.equal(result.kind,'error');assert.match(result.text!,/暂不支持附件/);assert.equal(calls,0);
});

const template = (id: string, name: string, status = 'ready') => ({
  id, name, version: 1, status, description: `${name}岗位`, modules: { responsibilities: { mission: `${name}专业职责`, duties: [], boundaries: [] }, capabilities: { skills: [], tools: [] } },
});

const ticketMarker = '<graph-horses-employee:0123456789abcdef0123456789abcdef>';

test('Chat names use the shared roster and selecting a reference creates no resident binding or work', async () => {
  const employee = { ...alice, id: 'chat-product', projectId: 'chat', templateId: 'role-product', name: '产品负责人' };
  const snapshot = { employees: [employee], templates: [template('role-product', '产品负责人'), template('role-new', '测试负责人')] } as unknown as WorkforceState;
  const original = structuredClone(snapshot), issued: unknown[] = [];
  const source = createEmployeeMentionSource({ snapshot: async () => snapshot, projectForSession: async () => ({ projectId: 'chat', standaloneOnly: true }),
    run: async () => { assert.fail('Chat must use native send'); }, onStarted: () => assert.fail('Chat must not navigate'),
    issueMentionTicket: async input => { issued.push(input); return { marker: ticketMarker }; },
  });
  for (const sessionId of ['chat-a', 'chat-b']) {
    const candidates = await source.candidates({ sessionId: sessionId as never }, { query: '', position: 'leading', signal: new AbortController().signal });
    assert.deepEqual(candidates.map(item => [item.value, item.section, item.hint]), [
      ['employee:chat-product', '本工作区已启用员工', '仅本轮'], ['template:role-new', '自由职业人模板', '仅本轮'],
    ]);
    const picked = source.onPick({ session: { sessionId: sessionId as never }, position: 'leading', candidate: candidates[0] } as never);
    assert.ok(picked && typeof picked === 'object' && 'insert' in picked);
    assert.equal(picked.insert.clipboardText, '@产品负责人');
    assert.deepEqual(snapshot, original, 'listing and picking never install employees or bind sessions');
    assert.equal(await source.codec!.serialize(picked.insert.ref, new AbortController().signal), ticketMarker + ' @产品负责人');
  }
  assert.deepEqual(issued, ['chat-a', 'chat-b'].map(sessionId => ({ sessionId, employeeId: 'chat-product' })));
});

test('fresh Chat lists ready templates and defers temporary admission to the native user turn', async () => {
  const snapshot = { employees: [], templates: [template('role-a', '产品负责人'), template('draft', '草稿', 'draft'), template('old', '归档', 'archived')] } as unknown as WorkforceState;
  const issued: unknown[] = [];
  const source = createEmployeeMentionSource({ snapshot: async () => snapshot, projectForSession: async () => ({ projectId: 'chat', standaloneOnly: true }),
    run: async () => assert.fail('no separate work order'), onStarted: () => assert.fail('no navigation'), issueMentionTicket: async input => { issued.push(input); return { marker: ticketMarker }; },
  });
  const candidates = await source.candidates({ sessionId: 'chat' as never }, { query: '', position: 'leading', signal: new AbortController().signal });
  assert.deepEqual(candidates.map(item => [item.name, item.value]), [['产品负责人', 'template:role-a']]);
  const picked = source.onPick({ session: { sessionId: 'chat' as never }, position: 'leading', candidate: candidates[0] } as never);
  assert.ok(picked && typeof picked === 'object' && 'insert' in picked); assert.equal(issued.length, 0);
  await source.codec!.serialize(picked.insert.ref, new AbortController().signal);
  assert.deepEqual(issued, [{ sessionId: 'chat', templateId: 'role-a' }]); assert.equal(snapshot.employees.length, 0);
});

test('Chat roster excludes team members and paused instances without silently creating copies', async () => {
  const standalone = { ...alice, id: 'chat-product', projectId: 'chat', templateId: 'role-product', name: '我的产品顾问' };
  const snapshot = { employees: [standalone, { ...standalone, id: 'chat-team', templateId: 'role-team', teamInstanceId: 'legacy-team' },
    { ...standalone, id: 'chat-managed', templateId: 'role-managed', managerId: 'chat-product' },
    { ...standalone, id: 'chat-paused', templateId: 'role-paused', status: 'paused' }, bob], templates: [template('role-product', '产品负责人'), template('role-team', '开发人员'), template('role-paused', '暂停岗位'), template('role-new', '测试负责人')] } as unknown as WorkforceState;
  const source = createEmployeeMentionSource({ snapshot: async () => snapshot, projectForSession: async () => ({ projectId: 'chat', standaloneOnly: true }), run: async () => assert.fail('not submitted'), onStarted() {} });
  const candidates = await source.candidates({ sessionId: 's' as never }, { query: '', position: 'leading', signal: new AbortController().signal });
  assert.deepEqual(candidates.map(item => item.value), ['employee:chat-product', 'template:role-team', 'template:role-new']);
});

test('same-name Chat instances and templates retain separate reference identities', async () => {
  const employee = { ...alice, id: 'shared-id', projectId: 'chat', name: '顾问', templateId: 'old-template' };
  const snapshot = { employees: [employee], templates: [template('shared-id', '顾问')] } as unknown as WorkforceState;
  const issued: unknown[] = [];
  const source = createEmployeeMentionSource({ snapshot: async () => snapshot, projectForSession: async () => ({ projectId: 'chat', standaloneOnly: true }), run: async () => assert.fail('not a work order'), onStarted() {}, issueMentionTicket: async input => { issued.push(input); return { marker: ticketMarker }; } });
  const candidates = await source.candidates({ sessionId: 's' as never }, { query: '顾问', position: 'leading', signal: new AbortController().signal });
  assert.equal(new Set(candidates.map(item => item.name)).size, 2);
  for (const candidate of candidates) {
    const picked = source.onPick({ session: { sessionId: 's' as never }, position: 'leading', candidate } as never);
    assert.ok(picked && typeof picked === 'object' && 'insert' in picked); await source.codec!.serialize(picked.insert.ref, new AbortController().signal);
  }
  assert.deepEqual(issued, [{ sessionId: 's', employeeId: 'shared-id' }, { sessionId: 's', templateId: 'shared-id' }]);
});

test('Chat plain typed mentions never claim or reject the native attachment envelope', async () => {
  const source = createEmployeeMentionSource({ snapshot: async () => ({ employees: [], templates: [template('role-a', '产品负责人')] } as unknown as WorkforceState), projectForSession: async () => ({ projectId: 'chat', standaloneOnly: true }), run: async () => assert.fail('must not run'), onStarted() {} });
  for (const [line, attachments] of [['@产品负责人 看图', 1], ['@产品负责人', 0]] as const)
    assert.equal(await source.matchEnter!({ sessionId: 's' as never }, line, new AbortController().signal, { attachments }), undefined);
});
