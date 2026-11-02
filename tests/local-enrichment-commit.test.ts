import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {beginLocalEnrichment,commitLocalEnrichment,validateLocalEvidenceOrdinals,localEnrichmentSnapshot} from '../lib/pipeline/local-enrichment-commit';
import {isLocalTypeBlocked} from '../lib/pipeline/local-matching-guard';
import {executeJournaledCall,type ProviderJournal} from '../lib/provider-journal';
import {isProviderOutcomeUnknown} from '../lib/provider-failure';

test('an obsolete failure or result does not overwrite the current record',async()=>{
 let latest='new';const state={status:'processing',summary:'new result'};
 const db={rpc:async(name:string,args:Record<string,unknown>)=>{
  assert.equal(name,'local_commit_enrichment');
  if(args.p_job!==latest)return {data:false,error:null};
  if(args.p_action==='error')state.status='error';
  else state.summary=(args.p_data as {summary:string}).summary;
  return {data:true,error:null};
 }} as unknown as SupabaseClient;
 await assert.rejects(commitLocalEnrichment(db,'old','record','error',null,[],'stale'),isLocalTypeBlocked);
 await assert.rejects(commitLocalEnrichment(db,'old','record','complete',{summary:'old result'},[]),isLocalTypeBlocked);
 assert.deepEqual(state,{status:'processing',summary:'new result'});
 await commitLocalEnrichment(db,'new','record','complete',{summary:'current'},[]);
 assert.equal(state.summary,'current');latest='later';
 await assert.rejects(commitLocalEnrichment(db,'new','record','error',null,[],'stale'),isLocalTypeBlocked);
 assert.equal(state.status,'processing');
});
test('local enrichment rejects absent or invalid evidence ordinals instead of silently dropping them',()=>{
 for(const invalid of [[],[0],[2],[1,999],[1.5],null])assert.throws(()=>validateLocalEvidenceOrdinals(invalid,1),/cites vàlides/);
 assert.deepEqual(validateLocalEvidenceOrdinals([1,1],1),[1]);
});
test('source and document snapshots preserve revisions and use deterministic document ordering',()=>{
 const snapshot=localEnrichmentSnapshot({id:'r',financing_type:'conveni',source_payload:{a:1}},[{id:'b',active_extraction_id:'old'},{id:'a',active_extraction_id:'current'}],[{id:'chunk',source_document_id:'a',ordinal:0,content:'text'}]);
 assert.deepEqual(snapshot.documents.map(d=>d.id),['a','b']);
 assert.equal(snapshot.source.financing_type,'conveni');assert.deepEqual(snapshot.source.source_payload,{a:1});
 assert.equal(snapshot.documents[1].active_extraction_id,'old');
 assert.equal(snapshot.chunks[0].content_sha256,'982d9e3eb996f559e633f4d194def3761d909f5a3b647d1a851fead67c32c9d1');
});
test('an unavailable or malformed guard result fails closed',async()=>{
 for(const result of [{data:null,error:{message:'unavailable'}},{data:null,error:null}]){
  const db={rpc:async()=>result} as unknown as SupabaseClient;
  await assert.rejects(commitLocalEnrichment(db,'job','record','error'));
 }
});
test('a lost commit response blocks a new provider call after the durable commit',async()=>{
 let saved:Record<string,unknown>|undefined;let calls=0;let writes=0;let stored='';
 const journal:ProviderJournal={async claim(){return saved?{send:false,id:'call',response:saved}:{send:true,id:'call'};},async save(_id,_state,body){saved=body;}};
 const send=async()=>{calls++;return {status:200,body:{summary:'result'}};};
 const db={rpc:async(name:string,args:Record<string,unknown>)=>{if(name==='local_begin_enrichment')return {data:false,error:null};stored=String((args.p_data as {summary:string}).summary);writes++;if(writes===1)throw Error('response lost after commit');return {data:true,error:null};}} as unknown as SupabaseClient;
 const first=await executeJournaledCall(journal,send);
 await assert.rejects(commitLocalEnrichment(db,'job','record','complete',first,[],null,{}),/response lost/);
 await assert.rejects(async()=>{await beginLocalEnrichment(db,'job','record',{});await executeJournaledCall(journal,send);},isLocalTypeBlocked);
 assert.equal(calls,1);assert.equal(stored,'result');assert.equal(writes,1);
});
test('an ambiguous historical receipt or completed attempt blocks before the provider',async()=>{
 for(const result of [{data:false,error:null},{data:null,error:{message:'unavailable'}}]){
  let sends=0;const db={rpc:async()=>result} as unknown as SupabaseClient;
  await assert.rejects(async()=>{await beginLocalEnrichment(db,'job','record',{});sends++;},isLocalTypeBlocked);
  assert.equal(sends,0);
 }
});
test('an uncertain timeout survives child stderr and is not confused with a retryable timeout',()=>{
 assert.equal(isProviderOutcomeUnknown(new Error('PROVIDER_UNKNOWN')),true);
 assert.equal(isProviderOutcomeUnknown({message:'child failed',stderr:'x'.repeat(2000)+' PROVIDER_UNKNOWN'}),true);
 assert.equal(isProviderOutcomeUnknown(new Error('ordinary timeout')),false);
});
