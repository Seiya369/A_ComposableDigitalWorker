import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmployeeMentionSource, employeeAliases } from '../src/client/mentions.js';
import type { ProjectEmployee, WorkforceState } from '../src/domain/types.js';

const alice={id:'employee-1',name:'架构师',projectId:'project-a',templateName:'技术负责人',status:'active',modules:{responsibilities:{mission:'设计架构'}}} as ProjectEmployee;
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
  id, name, version: 1, status, description: `${name}岗位`, modules: { responsibilities: { mission: `${name}专业职责` } },
});

test('Chat copy identifies workspace employees and single delegation without adding a session binding', async () => {
  const employee = { ...alice, id: 'chat-product', projectId: 'chat', templateId: 'role-product', name: '产品负责人' };
  const snapshot = { employees: [employee], templates: [template('role-product', '产品负责人'), template('role-new', '测试负责人')] } as unknown as WorkforceState;
  const original = structuredClone(snapshot), submitted: unknown[] = [];
  const source = createEmployeeMentionSource({ snapshot: async () => snapshot,
    projectForSession: async () => ({ projectId: 'chat', standaloneOnly: true }),
    run: async input => { submitted.push(input); return { id: 'run' } as never; }, onStarted: () => {},
  });
  for (const sessionId of ['chat-a', 'chat-b']) {
    const candidates = await source.candidates({ sessionId: sessionId as never }, { query: '', position: 'leading', signal: new AbortController().signal });
    assert.deepEqual(candidates.map(item => [item.value, item.section, item.hint]), [
      ['employee:chat-product', '本工作区已启用员工', '单次委派'],
      ['template:role-new', '自由职业人模板', '单次委派'],
    ]);
    for (const candidate of candidates) {
      const picked = source.onPick!({ session: { sessionId: sessionId as never }, position: 'leading', candidate } as never);
      assert.ok(picked && typeof picked === 'object' && 'claim' in picked);
      assert.equal(picked.claim.hint, `交给${candidate.name}的任务（将打开独立工作单）…`);
    }
    assert.deepEqual(snapshot, original, 'browsing and picking do not install or bind an employee');
    assert.equal(submitted.length, sessionId === 'chat-a' ? 0 : 1);
    const picked = source.onPick!({ session: { sessionId: sessionId as never }, position: 'leading', candidate: candidates[0] } as never);
    assert.ok(picked && typeof picked === 'object' && 'claim' in picked);
    assert.equal((await picked.claim.submit('澄清这个需求', {} as never, [])).kind, 'success');
  }
  assert.deepEqual(submitted, ['chat-a', 'chat-b'].map(sourceSessionId => ({ projectId: 'chat', employeeId: 'chat-product', request: '澄清这个需求', sourceSessionId })));
  assert.deepEqual(snapshot, original, 'copy changes preserve employee dispatch and existing state');
});

test('fresh Chat lists ready library roles without installing a team and starts only after explicit submit', async () => {
  const snapshot = { employees: [], templates: [template('role-a', '产品负责人'), template('role-draft', '草稿', 'draft'), template('role-old', '归档', 'archived')] } as unknown as WorkforceState;
  const original = structuredClone(snapshot);
  const submitted: unknown[] = [];
  const source = createEmployeeMentionSource({ snapshot: async () => snapshot,
    projectForSession: async () => ({ projectId: 'chat', standaloneOnly: true }),
    run: async input => { submitted.push(input); return { id: 'run-a' } as never; }, onStarted: () => {},
  });
  const candidates = await source.candidates({ sessionId: 'chat-session' as never }, { query: '', position: 'leading', signal: new AbortController().signal });
  assert.deepEqual(candidates.map(item => [item.name, item.value]), [['产品负责人', 'template:role-a']]);
  const picked = source.onPick!({ session: { sessionId: 'chat-session' as never }, position: 'leading', candidate: candidates[0] } as never);
  assert.ok(picked && typeof picked === 'object' && 'claim' in picked);
  assert.deepEqual(submitted, [], 'listing and selecting are read-only');
  assert.deepEqual(snapshot, original, 'mention browsing never installs employees, teams or workflows');
  assert.equal((await picked.claim.submit('澄清这个需求', {} as never, [])).kind, 'success');
  assert.deepEqual(submitted, [{ projectId: 'chat', templateId: 'role-a', request: '澄清这个需求', sourceSessionId: 'chat-session' }]);
});

test('Chat exposes only standalone active employees and uninstantiated library roles without bypassing paused instances', async () => {
  const standalone = { ...alice, id: 'chat-product', projectId: 'chat', templateId: 'role-product', name: '我的产品顾问' };
  const teamEmployee = { ...standalone, id: 'chat-team', templateId: 'role-team', teamInstanceId: 'legacy-flow-team' };
  const managed = { ...standalone, id: 'chat-managed', templateId: 'role-managed', managerId: 'chat-product' };
  const paused = { ...standalone, id: 'chat-paused', templateId: 'role-paused', status: 'paused' };
  const snapshot = { employees: [standalone, teamEmployee, managed, paused, bob], templates: [
    template('role-product', '产品负责人'), template('role-team', '开发人员'), template('role-paused', '暂停岗位'), template('role-new', '测试负责人'),
  ] } as unknown as WorkforceState;
  const source = createEmployeeMentionSource({ snapshot: async () => snapshot,
    projectForSession: async () => ({ projectId: 'chat', standaloneOnly: true }), run: async () => { throw Error('not submitted'); }, onStarted: () => {},
  });
  const candidates = await source.candidates({ sessionId: 's' as never }, { query: '', position: 'leading', signal: new AbortController().signal });
  assert.deepEqual(candidates.map(item => item.value), ['employee:chat-product', 'template:role-team', 'template:role-new']);
  assert.equal(candidates.find(item => item.value === 'employee:chat-product')?.name, '我的产品顾问');
  assert.ok(!candidates.some(item => item.value === 'employee:chat-team' || item.value === 'employee:chat-managed'));
});

test('Chat employee and library IDs remain distinct even when display names and IDs coincide', async () => {
  const employee = { ...alice, id: 'shared-id', projectId: 'chat', name: '顾问', templateId: 'old-template' };
  const snapshot = { employees: [employee], templates: [template('shared-id', '顾问')] } as unknown as WorkforceState;
  const submissions: unknown[] = [];
  const source = createEmployeeMentionSource({ snapshot: async () => snapshot,
    projectForSession: async () => ({ projectId: 'chat', standaloneOnly: true }),
    run: async input => { submissions.push(input); return { id: 'run' } as never; }, onStarted: () => {},
  });
  const candidates = await source.candidates({ sessionId: 's' as never }, { query: '顾问', position: 'leading', signal: new AbortController().signal });
  assert.equal(new Set(candidates.map(item => item.name)).size, 2);
  assert.deepEqual(candidates.map(item => item.value), ['employee:shared-id', 'template:shared-id']);
  for (const candidate of candidates) {
    const picked = source.onPick!({ session: { sessionId: 's' as never }, position: 'leading', candidate } as never);
    assert.ok(picked && typeof picked === 'object' && 'claim' in picked);
    assert.equal((await picked.claim.submit('给出建议', {} as never, [])).kind, 'success');
  }
  assert.deepEqual(submissions, [
    { projectId: 'chat', employeeId: 'shared-id', request: '给出建议', sourceSessionId: 's' },
    { projectId: 'chat', templateId: 'shared-id', request: '给出建议', sourceSessionId: 's' },
  ]);
});

test('Chat typed mentions reject attachments and empty input before creating any employee work', async () => {
  let calls = 0;
  const source = createEmployeeMentionSource({ snapshot: async () => ({ employees: [], templates: [template('role-a', '产品负责人')] } as unknown as WorkforceState),
    projectForSession: async () => ({ projectId: 'chat', standaloneOnly: true }),
    run: async () => { calls++; throw Error('must not run'); }, onStarted: () => {},
  });
  await assert.rejects(source.matchEnter!({ sessionId: 's' as never }, '@产品负责人 看图', new AbortController().signal, { attachments: 1 }), /暂不支持附件/);
  const picked = await source.matchEnter!({ sessionId: 's' as never }, '@产品负责人', new AbortController().signal, { attachments: 0 });
  assert.ok(picked && typeof picked === 'object' && 'claim' in picked);
  assert.equal((await picked.claim.submit('  ', {} as never, [])).kind, 'error');
  assert.equal((await picked.claim.submit('看图', {} as never, [{} as never])).kind, 'error');
  assert.equal(calls, 0);
});
