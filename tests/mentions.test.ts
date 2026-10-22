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
  const result=await picked.claim.submit('处理附件',{} as never,[{} as never]);
  assert.equal(result.kind,'error');assert.match(result.text!,/暂不支持附件/);assert.equal(calls,0);
});
