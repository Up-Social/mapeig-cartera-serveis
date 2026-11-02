import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {assertLocalMatchingType,assertLocalRunTypes,assertLocalEnrichmentScope,assertLocalSelectedRunTypes,isLocalTypeBlocked,withLocalMatchingGuard} from '../lib/pipeline/local-matching-guard';

function database(type:unknown,error:{message:string}|null=null){
 const reads:string[]=[];
 const db={from(table:string){reads.push(table);return {select(columns:string){assert.equal(columns,'financing_type');return {eq(field:string,id:string){assert.equal(field,'id');assert.equal(id,'source');return {async single(){return {data:type===undefined?null:{financing_type:type},error};}};}};}};}};
 return {db:db as unknown as SupabaseClient,reads};
}
test('Concerts and unknown or unreadable source records never claim or process a local job',async()=>{
 for(const [type,error] of [['concert',null],[null,null],[undefined,null],['future_type',null],['conveni',{message:'query failed'}]] as const){
  const {db,reads}=database(type,error);let claimed=false;
  await assert.rejects(withLocalMatchingGuard(db,'source',async()=>{claimed=true;}));
  assert.equal(claimed,false);assert.deepEqual(reads,['source_records']);
 }
});

function runDatabase(types:unknown[],failPage=-1,status:string|null='ready'){
 const db={from(table:string){
  if(table==='pipeline_runs')return {select:()=>({eq:()=>({single:async()=>({data:status===null?null:{status},error:null})})})};
  assert.equal(table,'pipeline_jobs');
  return {select:()=>({eq:()=>({order:()=>({range:(from:number,to:number)=>({eq(){return this;},then(resolve:(v:unknown)=>void){resolve({data:from===failPage?null:types.slice(from,to+1).map(type=>({source_records:type===undefined?null:{financing_type:type}})),error:from===failPage?{message:'failed'}:null});}})})})})};
 }};
 return db as unknown as SupabaseClient;
}
test('whole run preflight rejects a mixed batch, even beyond the first page, before wrapper side effects',async()=>{
 const types=[...Array(1000).fill('conveni'),'concert'];let claims=0,calls=0,writes=0;
 const run=async()=>{await assertLocalRunTypes(runDatabase(types),'run');claims++;writes++;calls++;};
 await assert.rejects(run,isLocalTypeBlocked);assert.deepEqual([claims,writes,calls],[0,0,0]);
});
test('missing types, absent jobs and page errors fail closed; a supported batch proceeds',async()=>{
 for(const [types,failPage] of [[[null],-1],[[undefined],-1],[[], -1],[Array(500).fill('conveni'),500]] as [unknown[],number][]){
  let claims=0;await assert.rejects(async()=>{await assertLocalRunTypes(runDatabase(types,failPage),'run');claims++;},isLocalTypeBlocked);assert.equal(claims,0);
 }
 await assertLocalRunTypes(runDatabase(['conveni','contractacio','subvencio']),'run');
 await assert.rejects(assertLocalRunTypes(runDatabase(['conveni'],-1,'paused'),'run'),/pausat/);
 await assert.rejects(assertLocalRunTypes(runDatabase(['conveni'],-1,null),'run'),isLocalTypeBlocked);
});
test('child process guard error is recognized without relying on an Error subclass',()=>{
 assert.equal(isLocalTypeBlocked({stderr:'LOCAL_TYPE_BLOCKED: bloquejat'}),true);
 assert.equal(isLocalTypeBlocked(new Error('other failure')),false);
});
function enrichmentDb(types:unknown[],status='ready',job:{id:string;run_id:string|null;source_record_id:string}|null={id:'job',run_id:'run',source_record_id:'source'}){
 return {from(table:string){
  if(table==='source_records')return {select:()=>({eq:()=>({single:async()=>({data:{financing_type:'conveni'},error:null})})})};
  if(table==='pipeline_runs')return {select:()=>({eq:()=>({single:async()=>({data:{status},error:null})})})};
  assert.equal(table,'pipeline_jobs');
  let requested:string|undefined;
  const q={select(){return q;},eq(k:string,v:string){if(k==='id')requested=v;return q;},order(){return q;},limit(){return q;},range(from:number,to:number){return Promise.resolve({data:types.slice(from,to+1).map(type=>({source_records:{financing_type:type}})),error:null});},async single(){return {data:requested&&requested!==job?.id?null:job,error:null};}};
  return q;
 }} as unknown as SupabaseClient;
}
test('enrichment resolves its actual job, checks the whole run and respects a pause before work',async()=>{
 for(const db of [enrichmentDb(['conveni','concert']),enrichmentDb(['conveni'],'paused'),enrichmentDb(['conveni'],'ready',null),enrichmentDb(['conveni'],'ready',{id:'job',run_id:null,source_record_id:'source'})]){
  let calls=0;await assert.rejects(async()=>{await assertLocalEnrichmentScope(db,'source');calls++;},isLocalTypeBlocked);assert.equal(calls,0);
 }
 await assert.rejects(assertLocalEnrichmentScope(enrichmentDb(['conveni']),'source','wrong-job'),isLocalTypeBlocked);
 assert.equal((await assertLocalEnrichmentScope(enrichmentDb(['conveni']),'source','job')).id,'job');
});
test('enrichment stops before provider if the job bound by claim is no longer current',async()=>{
 const base=enrichmentDb(['conveni']);
 const db={from(table:string){
  if(table!=='pipeline_jobs')return base.from(table);
  let requested:string|undefined;
  const q={select(){return q;},eq(k:string,v:string){if(k==='id')requested=v;return q;},order(){return q;},limit(){return q;},
   range:async()=>({data:[{source_records:{financing_type:'conveni'}}],error:null}),
   single:async()=>({data:{id:requested==='bound'?'bound':'newer',run_id:'run',source_record_id:'source'},error:null})};
  return q;
 }} as unknown as SupabaseClient;
 let providerJob:string|undefined;
 const mockProvider=async(jobId:string)=>{providerJob=jobId;};
 await assert.rejects(async()=>{const selected=await assertLocalEnrichmentScope(db,'source','bound');await mockProvider(selected.id);},isLocalTypeBlocked);
 assert.equal(providerJob,undefined);
});
test('standalone matching checks every selected run before any claim, including paused and mixed runs',async()=>{
 for(const failure of ['mixed','paused']){
  let current='';
  const db={from(table:string){
   if(table==='pipeline_runs')return {select:()=>({eq:(_field:string,id:string)=>{current=id;return {single:async()=>({data:{status:id==='run-2'&&failure==='paused'?'paused':'ready'},error:null})};}})};
   return runDatabase(current==='run-2'&&failure==='mixed'?['conveni','concert']:['conveni']).from(table);
  }} as unknown as SupabaseClient;
  let claims=0;await assert.rejects(async()=>{await assertLocalSelectedRunTypes(db,[{run_id:'run-1'},{run_id:'run-2'}]);claims++;},isLocalTypeBlocked);assert.equal(claims,0);
 }
 await assert.rejects(assertLocalSelectedRunTypes(runDatabase(['conveni']),[{run_id:null}]),isLocalTypeBlocked);
 await assertLocalSelectedRunTypes(runDatabase(['conveni']),[{run_id:'run-1'},{run_id:'run-2'}]);
});
test('the existing supported financing types reach the local processor',async()=>{
 for(const type of ['conveni','contractacio','subvencio']){
  const {db}=database(type);let claims=0;
  assert.equal(await withLocalMatchingGuard(db,'source',async()=>{claims++;return 'result';}),'result');assert.equal(claims,1);
 }
});
test('a changed source type is rejected again before the generic provider path',()=>{
 assert.doesNotThrow(()=>assertLocalMatchingType('contractacio'));assert.throws(()=>assertLocalMatchingType('concert'),/flux cloud/);
});
