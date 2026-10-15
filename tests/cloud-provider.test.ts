import {test} from 'node:test';
import assert from 'node:assert/strict';
import {providerRequest} from '../lib/cloud/provider';
import type {Context} from '../lib/cloud/context';
import {openAIInputTokenCeiling} from '../lib/openai-model';
function fakeContext(allowBudget=true){
 const journal=new Map<string,unknown>();
 const db={rpc:async(name:string,args:Record<string,unknown>)=>{if(name==='cloud_budget_reserve')return {data:allowBudget,error:null};if(name==='cloud_checkpoint')journal.set(String(args.p_key),args.p_value);return {data:true,error:null};},from:()=>{let key='';const query={select:()=>query,eq:(name:string,value:string)=>{if(name==='item_key')key=value;return query;},maybeSingle:async()=>({data:journal.has(key)?{value:journal.get(key)}:null,error:null})};return query;}};
 return {journal,c:{db,task:'test',owner:'owner',generation:1} as unknown as Context};
}
test('Luna request reserves its bounded input before sending and reuses its receipt',async()=>{
 const {c}=fakeContext();const original=global.fetch;const originalRpc=c.db.rpc.bind(c.db);let reserved:Record<string,unknown>|undefined;let sent:Record<string,unknown>|undefined;let calls=0;
 c.db.rpc=(async(name:string,args:Record<string,unknown>)=>{if(name==='cloud_budget_reserve')reserved=args;return originalRpc(name,args);}) as unknown as typeof c.db.rpc;
 global.fetch=async(_url,init)=>{assert.ok(reserved);calls++;sent=JSON.parse(String(init?.body));return Response.json({model:'gpt-6-luna',usage:{input_tokens:10,output_tokens:2},output_text:'{}'});};
 try {
  await providerRequest(c,'luna',{model:'gpt-6-luna',input:'Fixture',max_output_tokens:1200});
  assert.deepEqual(sent?.reasoning,{effort:'none'});assert.equal(sent?.service_tier,'default');
  assert.equal(reserved?.p_input_tokens,openAIInputTokenCeiling(sent!));assert.equal(reserved?.p_output,1200);
  const reused=await providerRequest(c,'luna',{model:'another-model'});assert.equal(reused.model,'gpt-6-luna');assert.equal(calls,1);
 } finally {global.fetch=original;}
});
test('persisted response reused without another provider call',async()=>{
 const {c,journal}=fakeContext();const original=global.fetch;let calls=0;
 global.fetch=async()=>{calls++;return Response.json({id:'mock',output_text:'SENSITIVE_SENTINEL'});};
 try {await providerRequest(c,'key',{});await providerRequest(c,'key',{});assert.equal(calls,1);assert.ok(journal.has('key'));}finally{global.fetch=original;}
});
test('uncertain response pauses and cannot be silently repeated',async()=>{
 const {c}=fakeContext();const original=global.fetch;let calls=0;
 global.fetch=async()=>{calls++;throw Error('SENSITIVE_SENTINEL');};
 try {await assert.rejects(providerRequest(c,'key',{}),/provider_unknown/);await assert.rejects(providerRequest(c,'key',{}),/provider_unknown/);assert.equal(calls,1);}finally{global.fetch=original;}
});
test('rate limiting permits at most three confirmed attempts',async()=>{
 const {c}=fakeContext();const original=global.fetch;let calls=0;
 global.fetch=async()=>{calls++;return Response.json({error:{code:'rate_limit_exceeded'}},{status:429,headers:{'retry-after':'10'}});};
 try {for(let i=0;i<3;i++)await assert.rejects(providerRequest(c,'key',{}),/transient/);await assert.rejects(providerRequest(c,'key',{}),/validation/);assert.equal(calls,3);}finally{global.fetch=original;}
});

test('budget pause happens before any billable call or sending checkpoint',async()=>{
 const {c,journal}=fakeContext(false);const original=global.fetch;let calls=0;
 global.fetch=async()=>{calls++;return Response.json({});};
 try {await assert.rejects(providerRequest(c,'key',{}),/budget/);assert.equal(calls,0);assert.equal(journal.has('key'),false);}finally{global.fetch=original;}
});

test('confirmed rejection is journaled separately from unknown external outcome',async()=>{
 const {c,journal}=fakeContext();const original=global.fetch;let calls=0;
 global.fetch=async()=>{calls++;return Response.json({error:{code:'invalid_json_schema',message:'PRIVATE_ERROR'}},{status:400});};
 try {await assert.rejects(providerRequest(c,'key',{}),/validation/);assert.equal((journal.get('key') as {state:string}).state,'rejected');await assert.rejects(providerRequest(c,'key',{}),/validation/);assert.equal(calls,1);}finally{global.fetch=original;}
});
