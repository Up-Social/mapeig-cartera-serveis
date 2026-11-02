import {test} from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {executeJournaledCall,journaledProviderRequest,type ProviderJournal} from '../lib/provider-journal';
import {ProcessingDisabledError} from '../lib/processing-control';
import type {SupabaseClient} from '@supabase/supabase-js';
function fixture(){let state='new';let response:Record<string,unknown>|undefined;const journal:ProviderJournal={async claim(){if(state==='sending')throw Error('PROVIDER_UNKNOWN');if(state==='received')return {id:'1',send:false,response};state='sending';return {id:'1',send:true};},async save(_id,next,body){state=next;response=body;}};return journal;}
test('received response survives restart without a duplicate provider call',async()=>{const journal=fixture();let calls=0;const send=async()=>{calls++;return {status:200,body:{id:'response-1'}};};assert.deepEqual(await executeJournaledCall(journal,send),{id:'response-1'});assert.deepEqual(await executeJournaledCall(journal,send),{id:'response-1'});assert.equal(calls,1);});
test('unknown outcome stops resubmission',async()=>{const journal=fixture();let calls=0;const send=async()=>{calls++;throw Error('timeout');};await assert.rejects(executeJournaledCall(journal,send),/PROVIDER_UNKNOWN/);await assert.rejects(executeJournaledCall(journal,send),/PROVIDER_UNKNOWN/);assert.equal(calls,1);});
test('explicit rate limit permits a bounded journal retry',async()=>{const journal=fixture();await assert.rejects(executeJournaledCall(journal,async()=>({status:429,body:{error:'limited'}})),/429/);assert.deepEqual(await executeJournaledCall(journal,async()=>({status:200,body:{id:'ok'}})),{id:'ok'});});
test('a pause racing the provider claim remains an operational pause without sending',async()=>{
 const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:{enabled:true,updated_at:'v1'},error:null})};
 const db={from:()=>query,rpc:async()=>({data:null,error:{message:'PROCESSING_DISABLED'}})} as unknown as SupabaseClient;
 await assert.rejects(journaledProviderRequest(db,'job','matching',{model:'gpt-5-mini',input:'fixture'}),ProcessingDisabledError);
});

test('local Conveni journal conflicts pause for reconciliation without sending',async()=>{
 const original=global.fetch;let calls=0;
 global.fetch=async()=>{calls++;throw Error('must not send');};
 try{
  for(const message of ['CONVENI_JOURNAL_BUSY','CONVENI_JOURNAL_OTHER_RECEIPT','CONVENI_JOURNAL_ISOLATION_UNSUPPORTED']){
   const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:{enabled:true,updated_at:'v1'},error:null})};
   const db={from:()=>query,rpc:async()=>({data:null,error:{message}})} as unknown as SupabaseClient;
   await assert.rejects(journaledProviderRequest(db,'job','conveni',{model:'gpt-6-luna',input:'fixture'}),/PROVIDER_UNKNOWN.*pendent de conciliació/);
  }
  assert.equal(calls,0);
 }finally{global.fetch=original;}
});

test('a local job cannot bypass an uncertain receipt on a deterministic path',async()=>{
 const {assertNoUnsettledLocalCalls}=await import('../lib/provider-journal');
 const db=(rows:unknown[],error:Error|null=null)=>({from(){const q={select(){return q;},eq(){return q;},limit(){return Promise.resolve({data:rows,error});}};return q;}});
 await assert.rejects(assertNoUnsettledLocalCalls(db([{id:'uncertain'}]) as never,'job'),/PROVIDER_UNKNOWN/);
 await assert.rejects(assertNoUnsettledLocalCalls(db([],Error('offline')) as never,'job'),/PROVIDER_STATUS_UNAVAILABLE/);
 await assert.doesNotReject(assertNoUnsettledLocalCalls(db([]) as never,'job'));
});

test('local journal hashes the exact prepared request sent on the wire',async()=>{
 let claimed='';let sent='';const original=global.fetch;
 const query={select:()=>query,eq:()=>query,update:()=>query,maybeSingle:async()=>({data:{enabled:true,updated_at:'v1'},error:null}),single:async()=>({data:{id:'call'},error:null})};
 const db={from:()=>query,rpc:async(name:string,args:Record<string,unknown>)=>{if(name==='claim_provider_call'){claimed=String(args.p_hash);return {data:{send:true,id:'call'},error:null};}return {data:true,error:null};}} as unknown as SupabaseClient;
 global.fetch=async(_url,init)=>{sent=String(init?.body);return Response.json({id:'response'});};
 try {await journaledProviderRequest(db,'job','other-phase',{model:'gpt-6-luna',input:'fixture'});
  assert.equal(claimed,`prepared-json-v1:${createHash('sha256').update(sent).digest('hex')}`);
  assert.equal(JSON.parse(sent).service_tier,'default');
 }finally{global.fetch=original;}
});
