import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyzeRecord} from '../lib/cloud/analysis';
import {CloudFailure} from '../lib/cloud/errors';
import type {Context} from '../lib/cloud/context';
import {prepareProviderWireRequest} from '../lib/openai-model';
import {journaledProviderRequest} from '../lib/provider-journal';
import {retainedConveniProposals} from '../lib/convenis/retained-receipt';
import type {ConveniAnalysis} from '../lib/convenis/contract';

function fixture(){
 const journal=new Map<string,unknown>();let binding:string|null=null;let responseBound=false;let calls=0;let commits=0;let persistedArgs:Record<string,unknown>|null=null;let fail=false;let rpcFault:string|null=null;let serverError=false;let lastBody:string|null=null;
 const text='La Fundació Sintètica rep una aportació pública per a un servei social a persones grans.';
 const doc={id:'doc',url:'https://fixture.invalid/doc',status:'fetched',document_type:'agreement',extracted_text:`## Pàgina 1\n${text}`,extraction_partial:false,extraction_method:'html-basic',extraction_coverage:{policy:'html-text-coverage-v1',complete:true},mime_type:'text/plain',quality_flags:[],storage_path:'cases/record/documents/doc/digest.txt',storage_sha256:'digest',active_extraction_id:'extraction'};
 const service={version_id:'v',service_code:'1',service_name:'Servei',parent_code:null,benefit_type:'service',description:'Descripció',target_population:'Persones',conditions:'Condicions',legal_reference:'Norma',normative_fields:{}};
 const answer={actors:[],instrument_grant:false,coverage_complete:true,unallocated_cents:0,summary:'Proposta sintètica',units:[{recipient:'Fundació Sintètica',recipient_nif:null,recipient_nature:'unknown',joint:false,period:'2025',year:2025,amount_cents:10000,amount_state:'planned',mixed:false,financiers:[],territory:null,classification:'discarded',service_ref:null,social_assessment:{status:'uncertain',explanation:'Pendent',evidence:['Q1']},population:'',description:'',explanation:'NIF pendent',reason:'missing_nif' as string|null,evidence:['Q1']}]};
 const db={rpc:async(name:string,args:Record<string,unknown>)=>{
  if(name==='cloud_screen_conveni_v2'||name==='cloud_persist_conveni'){
   assert.deepEqual([args.p_task,args.p_owner,args.p_generation,args.p_job],['task','owner',1,'job']);
   if(name==='cloud_screen_conveni_v2')return {data:false,error:null};
   assert.equal(responseBound,true,'receipt must be bound before persistence');persistedArgs=args;commits++;return {data:true,error:null};
  }
  if(name==='screen_conveni_v2'||name==='persist_conveni')throw Error('cloud path used unfenced Conveni RPC');
  if(name==='conveni_source_hash')return {data:'hash',error:null};
  if(name==='cloud_checkpoint')journal.set(String(args.p_key),args.p_value);
  if(name==='conveni_bind_begin'){
   if(rpcFault==='begin-before'){rpcFault=null;return {data:null,error:{message:'synthetic error'}};}
   if(binding)return {data:binding===args.p_wire?'existing':null,error:binding===args.p_wire?null:{message:'BIND_WIRE_CHANGED'}};
   if(journal.has('ai:job:conveni')||journal.has('conveni-input:job')||journal.has('provider-wire:ai:job:conveni'))return {data:'legacy',error:null};
   binding=String(args.p_wire);if(rpcFault==='begin-after'){rpcFault=null;return {data:null,error:{message:'synthetic error'}};}return {data:'created',error:null};
  }
  if(name==='conveni_bind_complete'){
   if(rpcFault==='complete-before'){rpcFault=null;return {data:null,error:{message:'synthetic error'}};}
   const received=journal.get('ai:job:conveni') as {state?:string}|undefined;
   if(binding!==args.p_wire||received?.state!=='received'||journal.get('conveni-input:job')!==binding||journal.get('provider-wire:ai:job:conveni')!==binding)return {data:null,error:{message:'BIND_RECEIPT_INVALID'}};
   responseBound=true;if(rpcFault==='complete-after'){rpcFault=null;return {data:null,error:{message:'synthetic error'}};}return {data:'synthetic-hash',error:null};
  }
  return {data:true,error:null};
 },from:(table:string)=>{let key='';const q={select:()=>q,eq:(name:string,v:string)=>{if(name==='item_key')key=v;return q;},in:()=>q,order:()=>q,
  single:async()=>({data:table==='source_records'?{id:'record',financing_type:'conveni',title:'Conveni sintètic',source_payload:{'Total aportacions previstes Generalitat':0,'Total aportacions previstes ens locals':1000}}:{id:'v',entry_count:1,general_context:''},error:null}),
  maybeSingle:async()=>({data:table==='app_settings'?{enabled:true,reason:null,updated_at:'2026-10-26T00:00:00Z'}:journal.has(key)?{value:journal.get(key)}:null,error:null}),
  range:async()=>({data:[doc],error:null}),limit:async()=>({data:[service],error:null})};return q;}};
 const c={db,task:'task',owner:'owner',generation:1} as unknown as Context;
 return {journal,run:()=>analyzeRecord(c,{id:'job',source_record_id:'record'},'matching'),get calls(){return calls;},get commits(){return commits;},get persistedArgs(){return persistedArgs;},get bound(){return responseBound;},get lastBody(){return lastBody;},clearBinding(){binding=null;responseBound=false;},setFail(){fail=true;},setServerError(){serverError=true;},setRpcFault(value:string){rpcFault=value;},setValid(){answer.units[0]={...answer.units[0],classification:'insufficient_evidence',reason:null};},setMixed(){answer.units[0]={...answer.units[0],recipient:'Ajuntament sintètic',recipient_nature:'public',reason:'Receptor públic fora de l’abast'};answer.units.push({...answer.units[0],recipient:'Fundació Sintètica',recipient_nature:'private',classification:'insufficient_evidence',reason:null});},fetch:async(_input:unknown,init?:RequestInit)=>{calls++;lastBody=typeof init?.body==='string'?init.body:null;if(fail)throw Error('synthetic timeout');if(serverError)return new Response('synthetic error',{status:503});return Response.json({status:'completed',output_text:JSON.stringify(answer),usage:{total_tokens:5}});}};
}
test('successful analyzeRecord persists the bound proposal through the lease-scoped cloud RPC',async()=>{
 const f=fixture(),original=globalThis.fetch,env={...process.env};process.env.OPENAI_MATCHING_MODEL='gpt-6-luna';process.env.OPENAI_API_KEY='fixture';delete process.env.WORKFLOW_TEST_PROJECT;delete process.env.PIPELINE_PROVIDER;
 f.setValid();globalThis.fetch=f.fetch as typeof fetch;
 try{
  await f.run();assert.equal(f.calls,1);assert.equal(f.commits,1);assert.equal(f.bound,true);
  assert.deepEqual(f.persistedArgs?.p_revisions,{doc:'digest:extraction'});
  assert.equal(f.persistedArgs?.p_source_hash,'hash');
  const payload=f.persistedArgs?.p_payload as {units:Array<{classification:string;blockers:string[]}>};
  assert.equal(payload.units[0].classification,'insufficient_evidence');assert.ok(payload.units[0].blockers.includes('missing_nif'));
 }finally{globalThis.fetch=original;process.env=env;}
});
test('adapted analyzeRecord binds a fresh receipt and reuses it without provider resend; legacy stays unbound',async()=>{
 const f=fixture(),original=globalThis.fetch,env={...process.env};process.env.OPENAI_MATCHING_MODEL='gpt-6-luna';process.env.OPENAI_API_KEY='fixture';delete process.env.WORKFLOW_TEST_PROJECT;delete process.env.PIPELINE_PROVIDER;
 globalThis.fetch=f.fetch as typeof fetch;
 try{
  // A missing-NIF discard is persisted as a pending proposal; the second run reuses the receipt.
  for(let i=0;i<2;i++)await f.run();
  assert.equal(f.calls,1);assert.equal(f.commits,2);assert.equal(f.bound,true);
  const payload=f.persistedArgs?.p_payload as ConveniAnalysis;
  assert.equal(payload.units[0].classification,'insufficient_evidence');assert.equal(payload.units[0].original_classification,'discarded');
  assert.ok(payload.diagnostics?.some(d=>d.code==='CONVENI_DISCARD_MISSING_NIF'));
  f.clearBinding();await assert.rejects(f.run(),(e:unknown)=>e instanceof CloudFailure&&e.kind==='provider_reconciliation');
  assert.equal(f.calls,1);assert.equal(f.bound,false);
 }finally{globalThis.fetch=original;process.env=env;}
});
test('adapted analyzeRecord never resends an uncertain provider outcome',async()=>{
 const f=fixture(),original=globalThis.fetch,env={...process.env};process.env.OPENAI_MATCHING_MODEL='gpt-6-luna';process.env.OPENAI_API_KEY='fixture';delete process.env.WORKFLOW_TEST_PROJECT;delete process.env.PIPELINE_PROVIDER;f.setFail();globalThis.fetch=f.fetch as typeof fetch;
 try {for(let i=0;i<2;i++)await assert.rejects(f.run(),(e:unknown)=>e instanceof CloudFailure&&e.kind==='provider_unknown');assert.equal(f.calls,1);assert.equal(f.bound,false);assert.equal(f.commits,0);}
 finally{globalThis.fetch=original;process.env=env;}
});

test('faults before and after binding or receipt completion retry without duplicate provider calls',async()=>{
 const original=globalThis.fetch,env={...process.env};process.env.OPENAI_MATCHING_MODEL='gpt-6-luna';process.env.OPENAI_API_KEY='fixture';delete process.env.WORKFLOW_TEST_PROJECT;delete process.env.PIPELINE_PROVIDER;
 try{for(const fault of ['begin-before','begin-after','complete-before','complete-after']){
  const f=fixture();f.setRpcFault(fault);globalThis.fetch=f.fetch as typeof fetch;
  await assert.rejects(f.run(),(e:unknown)=>e instanceof CloudFailure&&e.kind==='internal');
  assert.equal(f.calls,fault.startsWith('begin')?0:1);
  await f.run();
  assert.equal(f.calls,1);assert.equal(f.bound,true);assert.equal(f.commits,1);
 }}finally{globalThis.fetch=original;process.env=env;}
});

test('a provider 5xx retains the uncertain outcome and bound intent without resending',async()=>{
 const f=fixture(),original=globalThis.fetch,env={...process.env};process.env.OPENAI_MATCHING_MODEL='gpt-6-luna';process.env.OPENAI_API_KEY='fixture';delete process.env.WORKFLOW_TEST_PROJECT;delete process.env.PIPELINE_PROVIDER;f.setServerError();globalThis.fetch=f.fetch as typeof fetch;
 try{for(let i=0;i<2;i++)await assert.rejects(f.run(),(e:unknown)=>e instanceof CloudFailure&&e.kind==='provider_unknown');assert.equal(f.calls,1);assert.equal(f.bound,false);assert.equal(f.commits,0);}
 finally{globalThis.fetch=original;process.env=env;}
});

test('a changed request cannot replay or resend a bound historical receipt',async()=>{
 const f=fixture(),original=globalThis.fetch,env={...process.env};process.env.OPENAI_MATCHING_MODEL='gpt-6-luna';process.env.OPENAI_API_KEY='fixture';delete process.env.WORKFLOW_TEST_PROJECT;delete process.env.PIPELINE_PROVIDER;globalThis.fetch=f.fetch as typeof fetch;
 try{
  await f.run();
  const receipt=f.journal.get('ai:job:conveni');process.env.OPENAI_MATCHING_MODEL='fixture-new-model';
  await assert.rejects(f.run(),(e:unknown)=>e instanceof CloudFailure&&e.kind==='provider_reconciliation');
  assert.equal(f.calls,1);assert.deepEqual(f.journal.get('ai:job:conveni'),receipt);assert.equal(f.bound,true);
 }finally{globalThis.fetch=original;process.env=env;}
});

test('the actual Conveni wire body is bound in cloud and the same fingerprint is sent to the local journal',async()=>{
 const f=fixture(),original=globalThis.fetch,env={...process.env};process.env.OPENAI_MATCHING_MODEL='gpt-6-luna';process.env.OPENAI_API_KEY='fixture';delete process.env.WORKFLOW_TEST_PROJECT;delete process.env.PIPELINE_PROVIDER;globalThis.fetch=f.fetch as typeof fetch;
 try{
  await f.run();
  assert.ok(f.lastBody);const body=JSON.parse(f.lastBody) as Record<string,unknown>;
  assert.match(String(body.instructions),/interadministrative_agreement només si el caràcter interadministratiu/);
  const current=prepareProviderWireRequest(body).fingerprint;
  assert.equal(f.journal.get('conveni-input:job'),current);
  assert.equal(f.journal.get('provider-wire:ai:job:conveni'),current);
  let localHash:unknown;let providerCalls=0;
  globalThis.fetch=(async()=>{providerCalls++;throw Error('unexpected provider call');}) as typeof fetch;
  const localDb={from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{enabled:true,reason:null,updated_at:'2026-10-26T00:00:00Z'},error:null})}),rpc:async(name:string,args:Record<string,unknown>)=>{
   assert.equal(name,'claim_provider_call');localHash=args.p_hash;return {data:null,error:{message:'PROVIDER_REQUEST_CHANGED'}};
  }};
  await assert.rejects(journaledProviderRequest(localDb as never,'job','conveni',body),/NEW_ANALYSIS_REQUIRED/);
  assert.equal(localHash,current);assert.equal(providerCalls,0);
 }finally{globalThis.fetch=original;process.env=env;}
});

test('a mixed public-private response remains in the receipt without silently deciding either unit',async()=>{
 const f=fixture(),original=globalThis.fetch,env={...process.env};process.env.OPENAI_MATCHING_MODEL='gpt-6-luna';process.env.OPENAI_API_KEY='fixture';delete process.env.WORKFLOW_TEST_PROJECT;delete process.env.PIPELINE_PROVIDER;f.setMixed();globalThis.fetch=f.fetch as typeof fetch;
 try{
  for(let i=0;i<2;i++)await f.run();
  assert.equal(f.calls,1);assert.equal(f.commits,2);assert.equal(f.bound,true);
  const payload=f.persistedArgs?.p_payload as ConveniAnalysis;
  assert.ok(payload.diagnostics?.some(d=>d.code==='CONVENI_MODEL_DISCARD_REVIEW_REQUIRED'));
  const receipt=f.journal.get('ai:job:conveni') as {state:string;response:unknown};
  const visible=retainedConveniProposals({status:receipt.state,response:receipt.response});
  assert.deepEqual(visible?.map(unit=>[unit.recipient,unit.classification]),[['Ajuntament sintètic','Descart proposat'],['Fundació Sintètica','Evidència insuficient proposada']]);
 }finally{globalThis.fetch=original;process.env=env;}
});
