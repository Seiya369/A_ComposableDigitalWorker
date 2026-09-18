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
  const result=await source.matchEnter!({sessionId:'s' as never},'@架构师 设计模块',new AbortController().signal,{images:0});
  assert.ok(result&&typeof result==='object'&&'claim' in result);
  const outcome=await result.claim.submit('设计模块',{} as never,[]);
  assert.equal(outcome.kind,'error');assert.match(outcome.text!,/模型未配置/);
  assert.deepEqual(submitted,{projectId:'project-a',employeeId:'employee-1',request:'设计模块',sourceSessionId:'s'});
});

test('duplicate employee names get independent aliases and image payloads are not dropped',async()=>{
  const duplicate={...alice,id:'another-2'};
  assert.equal(employeeAliases([alice,duplicate]).size,2);
  const source=createEmployeeMentionSource({snapshot:async()=>state,projectForSession:async()=> 'project-a',run:async()=>{throw new Error('unused')},onStarted:()=>{}});
  await assert.rejects(source.matchEnter!({sessionId:'s' as never},'@架构师 看图',new AbortController().signal,{images:1}),/暂不支持图片/);
});
