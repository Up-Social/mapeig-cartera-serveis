import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {assertProcessingEnabled,getProcessingSetting,setProcessingEnabled,disableProcessing,ProcessingDisabledError,isProcessingPaused,pauseLocalProcessing} from '../lib/processing-control';

function fakeDb(initial: {enabled:boolean;reason:string|null;updated_at:string}|null, unavailable=false) {
 let row=initial;
 const db={from:()=>{
  let expected:string|undefined;let update:typeof row|undefined;let insert=false;
  const query={select:()=>query,eq:(key:string,value:string)=>{if(key==='updated_at')expected=value;return query;},
   update:(value:NonNullable<typeof row>)=>{update=value;return query;},
   upsert:(value:NonNullable<typeof row>)=>{update=value;insert=true;return query;},
   maybeSingle:async()=>({data:unavailable?null:row,error:unavailable?{message:'PRIVATE_DATABASE_ERROR'}:null}),
   single:async()=>{if(unavailable||(!insert&&expected!==row?.updated_at))return {data:null,error:{message:'PRIVATE_DATABASE_ERROR'}};row=update!;return {data:row,error:null};}};
  return query;
 }} as unknown as SupabaseClient;
 return {db,replace:(value:typeof row)=>{row=value;},read:()=>row};
}

test('missing or unavailable operational state fails closed without leaking DB diagnostics',async()=>{
 for(const input of [fakeDb(null),fakeDb(null,true)]){
  assert.equal((await getProcessingSetting(input.db)).enabled,false);
  await assert.rejects(assertProcessingEnabled(input.db),ProcessingDisabledError);
 }
});

test('processing guard sees changes between units and disabled environment wins',async()=>{
 const f=fakeDb({enabled:true,reason:null,updated_at:'v1'});
 await assertProcessingEnabled(f.db);
 f.replace({enabled:false,reason:'incident',updated_at:'v2'});
 await assert.rejects(assertProcessingEnabled(f.db),ProcessingDisabledError);
 f.replace({enabled:true,reason:null,updated_at:'v3'});
 const original=process.env.WORKER_EXECUTION_MODE;process.env.WORKER_EXECUTION_MODE='disabled';
 try{await assert.rejects(assertProcessingEnabled(f.db),ProcessingDisabledError);}
 finally{if(original===undefined)delete process.env.WORKER_EXECUTION_MODE;else process.env.WORKER_EXECUTION_MODE=original;}
});

test('enabling cannot overwrite a concurrent safety shutdown after successful probe',async()=>{
 const f=fakeDb({enabled:false,reason:'incident',updated_at:'v1'});
 await assert.rejects(setProcessingEnabled(f.db,true,null),/PROCESSING_STATE_CHANGED/);
 const observed=await getProcessingSetting(f.db);
 f.replace({enabled:false,reason:'new_incident',updated_at:'v2'});
 await assert.rejects(setProcessingEnabled(f.db,true,null,observed.updatedAt),/PROCESSING_STATE_CHANGED/);
 assert.equal(f.read()?.enabled,false);
 assert.equal((await setProcessingEnabled(f.db,true,null,'v2')).enabled,true);
});

test('emergency shutdown does not depend on a stale version and errors stay visible',async()=>{
 const f=fakeDb({enabled:true,reason:null,updated_at:'v1'});
 assert.equal((await disableProcessing(f.db,'cleanup_failed')).enabled,false);
 assert.equal(f.read()?.reason,'cleanup_failed');
 await assert.rejects(disableProcessing(fakeDb(null,true).db,'cleanup_failed'),/PROCESSING_CONTROL_UNAVAILABLE/);
});

test('controlled pause survives a child process boundary without being confused with document errors',()=>{
 assert.equal(isProcessingPaused(new ProcessingDisabledError()),true);
 assert.equal(isProcessingPaused({code:75,stderr:'PROCESSING_DISABLED\n'}),true);
 assert.equal(isProcessingPaused({message:'PROCESSING_DISABLED',code:'55000'}),true);
 assert.equal(isProcessingPaused({stderr:'PROCESSING_PAUSE_UNAVAILABLE'}),true);
 assert.equal(isProcessingPaused(new Error('Invalid PDF')),false);
 assert.equal(isProcessingPaused(new Error('PROVIDER_UNKNOWN')),false);
});

test('local pause changes only operational state and preserves domain evidence and journals',async()=>{
 const writes:Array<{table:string;value:Record<string,unknown>}>=[];
 const db={from:(table:string)=>{
  const q={update:(value:Record<string,unknown>)=>{writes.push({table,value});return q;},eq:()=>q,in:()=>q,
   then:(resolve:(value:unknown)=>void)=>resolve({error:null})};return q;
 }} as unknown as SupabaseClient;
 await pauseLocalProcessing(db,{runId:'run',taskId:'task'});
 assert.deepEqual(writes.map(w=>w.table),['pipeline_runs','worker_tasks']);
 assert.equal(writes[0].value.status,'paused');assert.equal(writes[1].value.execution_state,'paused');
 assert.equal(writes[1].value.failure_kind,'processing_disabled');assert.equal(writes[1].value.completed_at,null);
});

test('mock opt-in cannot bypass the shared pause or target a remote database',async()=>{
 const fixture=fakeDb({enabled:true,reason:null,updated_at:'v1'});
 const values={WORKER_EXECUTION_MODE:'disabled',PIPELINE_PROVIDER:'mock',WORKFLOW_TEST_PROJECT:'cartera-workflow-test',
  NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:55421',OPENAI_API_KEY:'',VERCEL_TOKEN:'',SUPABASE_ACCESS_TOKEN:''};
 const original=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));
 Object.assign(process.env,values);
 try{
  await assertProcessingEnabled(fixture.db);
  fixture.replace({enabled:false,reason:'incident',updated_at:'v2'});
  await assert.rejects(assertProcessingEnabled(fixture.db),ProcessingDisabledError);
  process.env.NEXT_PUBLIC_SUPABASE_URL='https://example.supabase.co';
  await assert.rejects(assertProcessingEnabled(fixture.db),/Isolated workflow test environment required/);
 }finally{for(const[key,value]of Object.entries(original)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
