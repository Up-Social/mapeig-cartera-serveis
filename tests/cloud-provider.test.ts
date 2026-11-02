import {test} from 'node:test';
import assert from 'node:assert/strict';
import {providerRequest} from '../lib/cloud/provider';
import {commit,rpc,type Context} from '../lib/cloud/context';
import {CloudFailure} from '../lib/cloud/errors';
import {openAIInputTokenCeiling,prepareProviderWireRequest} from '../lib/openai-model';
import {createHash} from 'node:crypto';
function fakeContext(allowBudget=true){
 const journal=new Map<string,unknown>();
 const db={rpc:async(name:string,args:Record<string,unknown>)=>{if(name==='cloud_budget_reserve')return {data:allowBudget,error:null};if(name==='cloud_checkpoint')journal.set(String(args.p_key),args.p_value);return {data:true,error:null};},from:(table:string)=>{let key='';const query={select:()=>query,eq:(name:string,value:string)=>{if(name==='item_key')key=value;return query;},maybeSingle:async()=>({data:table==='app_settings'?{enabled:true,reason:null,updated_at:'2026-10-26T00:00:00Z'}:journal.has(key)?{value:journal.get(key)}:null,error:null})};return query;}};
 return {journal,c:{db,task:'test',owner:'owner',generation:1} as unknown as Context};
}
test('Luna request reserves its bounded input before sending and reuses its receipt',async()=>{
 const {c,journal}=fakeContext();const original=global.fetch;const originalRpc=c.db.rpc.bind(c.db);let wire='';let reserved:Record<string,unknown>|undefined;let sent:Record<string,unknown>|undefined;let calls=0;
 c.db.rpc=(async(name:string,args:Record<string,unknown>)=>{if(name==='cloud_budget_reserve')reserved=args;return originalRpc(name,args);}) as unknown as typeof c.db.rpc;
 global.fetch=async(_url,init)=>{assert.ok(reserved);calls++;wire=String(init?.body);sent=JSON.parse(wire);return Response.json({model:'gpt-6-luna',usage:{input_tokens:10,output_tokens:2},output_text:'{}'});};
 try {
  await providerRequest(c,'luna',{model:'gpt-6-luna',input:'Fixture',max_output_tokens:1200});
  assert.deepEqual(sent?.reasoning,{effort:'none'});assert.equal(sent?.service_tier,'default');
  assert.equal(reserved?.p_input_tokens,openAIInputTokenCeiling(sent!));assert.equal(reserved?.p_output,1200);
  assert.equal(journal.get('provider-wire:luna'),`prepared-json-v1:${createHash('sha256').update(wire).digest('hex')}`);
  const reused=await providerRequest(c,'luna',{model:'gpt-6-luna',input:'Fixture',max_output_tokens:1200});assert.equal(reused.model,'gpt-6-luna');assert.equal(calls,1);
  await assert.rejects(providerRequest(c,'luna',{model:'another-model'}),/validation/);assert.equal(calls,1);
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

test('overlapping requests sharing a live task wait and reuse the received journal',async()=>{
 const {c}=fakeContext();const original=global.fetch;let calls=0;let started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 global.fetch=async()=>{calls++;started();await gate;return Response.json({id:'only-once'});};
 try{
  const body={model:'gpt-6-luna',input:'fixture'};const first=providerRequest(c,'ai:job:conveni',body),second=providerRequest(c,'ai:job:conveni',body);
  await ready;assert.equal(calls,1);release();
  assert.deepEqual(await first,{id:'only-once'});assert.deepEqual(await second,{id:'only-once'});assert.equal(calls,1);
 }finally{release();global.fetch=original;}
});

test('overlapping calls do not turn an uncertain provider outcome into a retry',async()=>{
 const {c,journal}=fakeContext();const original=global.fetch;let calls=0;let started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 global.fetch=async()=>{calls++;started();await gate;throw Error('fixture timeout');};
 try{
  const body={model:'gpt-6-luna',input:'fixture'};const first=providerRequest(c,'ai:job:conveni',body),second=providerRequest(c,'ai:job:conveni',body);
  await ready;release();const outcomes=await Promise.allSettled([first,second]);
  assert.ok(outcomes.every(value=>value.status==='rejected'&&value.reason instanceof CloudFailure&&value.reason.kind==='provider_unknown'));
  assert.equal(calls,1);assert.equal((journal.get('ai:job:conveni') as {state:string}).state,'sending');
 }finally{release();global.fetch=original;}
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

test('legacy receipts without wire hash and changed transformations fail closed',async()=>{
 const {c,journal}=fakeContext();const original=global.fetch;let calls=0;
 global.fetch=async()=>{calls++;return Response.json({id:'unexpected'});};
 try {
  const body={model:'gpt-6-luna',input:'fixture'};
  journal.set('legacy',{state:'received',attempt:1,response:{id:'old'}});
  await assert.rejects(providerRequest(c,'legacy',body),/validation/);
  journal.set('retry',{state:'retry',attempt:1});
  journal.set('provider-wire:retry',`prepared-json-v1:${createHash('sha256').update(JSON.stringify(body)).digest('hex')}`);
  assert.notEqual(journal.get('provider-wire:retry'),prepareProviderWireRequest(body).fingerprint);
  await assert.rejects(providerRequest(c,'retry',body),/validation/);
  for(const state of ['sending','unknown']){
   journal.set('unknown',{state,attempt:1});
   await assert.rejects(providerRequest(c,'unknown',body),/provider_unknown/);
  }
  assert.equal(calls,0);
 }finally{global.fetch=original;}
});


test('rolled-back cloud commit can resume from the same received provider receipt',async()=>{
 const {c,journal}=fakeContext();const original=global.fetch;const originalRpc=c.db.rpc.bind(c.db);let calls=0,commits=0;
 global.fetch=async()=>{calls++;return Response.json({id:'synthetic',output_text:'{}'});};
 c.db.rpc=(async(name:string,args:Record<string,unknown>)=>{if(name==='cloud_commit'&&++commits===1)return {data:null,error:{code:'40001',message:'T19_DEDUP_BUSY'}};return originalRpc(name,args);}) as unknown as typeof c.db.rpc;
 try{
  const received=await providerRequest(c,'ai:job:matching',{model:'mock',input:'fixture'});
  await assert.rejects(commit(c,'job','analysis',{}),e=>e instanceof CloudFailure&&e.kind==='transient'&&e.diagnostic?.code==='T19_DEDUP_BUSY');
  assert.equal((journal.get('ai:job:matching') as {state:string}).state,'received');
  assert.deepEqual(await providerRequest(c,'ai:job:matching',{model:'mock',input:'fixture'}),received);
  await commit(c,'job','analysis',{});assert.equal(calls,1);assert.equal(commits,2);
 }finally{global.fetch=original;}
});

test('deduplication conflict cannot cause an uncertain provider call to be repeated',async()=>{
 const {c,journal}=fakeContext();const original=global.fetch;const originalRpc=c.db.rpc.bind(c.db);let calls=0;
 global.fetch=async()=>{calls++;throw Error('Unexpected provider call');};
 c.db.rpc=(async(name:string,args:Record<string,unknown>)=>name==='cloud_commit'?{data:null,error:{code:'40001',message:'T19_DEDUP_BUSY'}}:originalRpc(name,args)) as unknown as typeof c.db.rpc;
 try{
  journal.set('ai:job:matching',{state:'sending',attempt:1});
  await assert.rejects(commit(c,'job','analysis',{}),e=>e instanceof CloudFailure&&e.kind==='transient');
  await assert.rejects(providerRequest(c,'ai:job:matching',{}),e=>e instanceof CloudFailure&&e.kind==='provider_unknown');
  assert.equal(calls,0);assert.equal((journal.get('ai:job:matching') as {state:string}).state,'sending');
 }finally{global.fetch=original;}
});

test('only the exact conflict in cloud_commit is classified as transient',async()=>{
 const {c}=fakeContext();
 for(const [name,code,message] of [['cloud_commit','40001','different stale revision'],['cloud_commit','P0001','T19_DEDUP_BUSY'],['cloud_resource','40001','T19_DEDUP_BUSY'],['cloud_commit','40001','T19_DEDUP_BUSY extra']]){
  c.db.rpc=(async()=>({data:null,error:{code,message}})) as unknown as typeof c.db.rpc;
  await assert.rejects(rpc(c.db,name,{}),e=>e instanceof CloudFailure&&e.kind==='internal');
 }
});

test('a competing Conveni journal or reserve requires reconciliation rather than automatic retry',async()=>{
 const {c}=fakeContext();
 for(const name of ['cloud_checkpoint','cloud_budget_reserve'])for(const message of ['CONVENI_JOURNAL_BUSY','CONVENI_JOURNAL_OTHER_RECEIPT','CONVENI_JOURNAL_ISOLATION_UNSUPPORTED']){
  c.db.rpc=(async()=>({data:null,error:{code:message==='CONVENI_JOURNAL_BUSY'?'55P03':'P0001',message}})) as unknown as typeof c.db.rpc;
  await assert.rejects(rpc(c.db,name,{}),e=>e instanceof CloudFailure&&e.kind==='provider_reconciliation'&&e.diagnostic?.code==='EXISTING_PROVIDER_RECEIPT_REVIEW_REQUIRED');
 }
 c.db.rpc=(async()=>({data:null,error:{code:'55P03',message:'CONVENI_JOURNAL_BUSY'}})) as unknown as typeof c.db.rpc;
 await assert.rejects(rpc(c.db,'unrelated_operation',{}),e=>e instanceof CloudFailure&&e.kind==='internal');
 c.db.rpc=(async()=>({data:null,error:{code:'P0001',message:'CONVENI_JOURNAL_RESPONSE_CONFLICT'}})) as unknown as typeof c.db.rpc;
 await assert.rejects(rpc(c.db,'cloud_checkpoint',{}),e=>e instanceof CloudFailure&&e.kind==='provider_unknown');
});

test('unknown provider outcome survives an unconfirmed resource release without repeating the call',async()=>{
 const {c,journal}=fakeContext();const original=global.fetch;const originalRpc=c.db.rpc.bind(c.db);let calls=0;
 global.fetch=async()=>{calls++;throw Error('PRIVATE PROVIDER ERROR');};
 c.db.rpc=(async(name:string,args:Record<string,unknown>)=>name==='cloud_resource'&&args.p_release?{data:null,error:{code:'08006',message:'PRIVATE RELEASE ERROR'}}:originalRpc(name,args)) as unknown as typeof c.db.rpc;
 try{
  await assert.rejects(providerRequest(c,'ai:job:matching',{}),e=>e instanceof CloudFailure&&e.kind==='provider_unknown'&&e.diagnostic?.code==='PROVIDER_UNKNOWN_RESOURCE_RELEASE_UNCONFIRMED'&&JSON.stringify(e).includes('PRIVATE')===false);
  assert.equal((journal.get('ai:job:matching') as {state:string}).state,'sending');
  await assert.rejects(providerRequest(c,'ai:job:matching',{}),e=>e instanceof CloudFailure&&e.kind==='provider_unknown');
  assert.equal(calls,1);
 }finally{global.fetch=original;}
});

test('failed resource release pauses after 429, credentials or a received response without leaking details',async()=>{
 for(const [status,kind] of [[429,'transient'],[401,'credentials'],[200,null]] as const){
  const {c,journal}=fakeContext();const original=global.fetch;const originalRpc=c.db.rpc.bind(c.db);let calls=0;
  c.db.rpc=(async(name:string,args:Record<string,unknown>)=>name==='cloud_resource'&&args.p_release?{data:null,error:{code:'08006',message:'PRIVATE RELEASE ERROR'}}:originalRpc(name,args)) as unknown as typeof c.db.rpc;
  global.fetch=async()=>{calls++;return Response.json(status===200?{id:'response',usage:{input_tokens:1,output_tokens:1}}:{error:{code:'fixture',message:'PRIVATE PROVIDER ERROR'}},{status});};
  try{
   await assert.rejects(providerRequest(c,'ai:job:matching',{}),e=>e instanceof CloudFailure&&e.kind==='provider_reconciliation'&&e.diagnostic?.code==='PROVIDER_RESOURCE_RELEASE_UNCONFIRMED'&&JSON.stringify(e.diagnostic?.details)==JSON.stringify({provider_failure_kind:kind,resource_release:'unconfirmed'})&&!JSON.stringify(e).includes('PRIVATE'));
   assert.equal(calls,1);assert.equal((journal.get('ai:job:matching') as {state:string}).state,status===200?'received':'retry');
  }finally{global.fetch=original;}
 }
});
