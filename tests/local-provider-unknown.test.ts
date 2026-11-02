import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {isProviderOutcomeUnknown} from '../lib/provider-failure';
import {captureLocalProviderScope,failLocalUnknownTask,stopLocalRunForUnknown} from '../lib/pipeline/local-provider-unknown';

type Row=Record<string,unknown>;
function fixture(options:{failRpc?:boolean}={}){
 const tables:Record<string,Row[]>={worker_tasks:[{id:'task',status:'running',claimed_by:'worker'}],pipeline_jobs:[{id:'job',run_id:'run',status:'ready',xmin:'1'}],pipeline_runs:[{id:'run',status:'matching',xmin:'2'}],source_records:[{id:'source',processing_status:'preparat'}],provider_calls:[{id:'receipt',state:'sending'}]};
 const writes:string[]=[];
 const db={from(table:string){let changes:Row={};const eq:Array<[string,unknown]>=[];const neq:Array<[string,unknown]>=[];
  const run=()=>{writes.push(table);const rows=tables[table].filter(row=>eq.every(([k,v])=>row[k]===v)&&neq.every(([k,v])=>row[k]!==v));for(const row of rows)Object.assign(row,changes);return {data:rows[0]??null,error:null};};
  const query={update(value:Row){changes=value;return query;},eq(key:string,value:unknown){eq.push([key,value]);return query;},neq(key:string,value:unknown){neq.push([key,value]);return query;},select(){return query;},async maybeSingle(){return run();},then(resolve:(v:unknown)=>void){resolve(run());}};
  return query;
 },async rpc(name:string,args:Record<string,unknown>){
  const job=tables.pipeline_jobs[0],run=tables.pipeline_runs[0];
  if(name==='local_provider_scope')return {data:{job_status:job.status,job_xmin:job.xmin,run_status:run.status,run_xmin:run.xmin},error:null};
  writes.push(name);if(options.failRpc)return {data:null,error:{message:'synthetic error'}};
  const scope=args.p_scope as Row;
  if(job.id!==args.p_job||job.run_id!==args.p_run||job.status!==scope.job_status||job.xmin!==scope.job_xmin||run.status!==scope.run_status||run.xmin!==scope.run_xmin||!tables.provider_calls.some(c=>c.state==='sending'))return {data:false,error:null};
  Object.assign(job,{status:'error',error_kind:'provider_unknown'});Object.assign(run,{status:'paused',pause_kind:'provider_unknown'});return {data:true,error:null};
 }} as unknown as SupabaseClient;
 return {db,tables,writes};
}

test('run uncertainty pauses and fails the task without changing sources or its sending receipt',async()=>{
 const f=fixture();let attempts=0;
 const scope=await captureLocalProviderScope(f.db,'run','job');
 try{attempts++;await stopLocalRunForUnknown(f.db,'run','job',scope);assert.fail('must not complete');}
 catch(error){assert.equal(isProviderOutcomeUnknown(error),true);await failLocalUnknownTask(f.db,'task','worker');}
 assert.equal(attempts,1);assert.equal(f.tables.pipeline_jobs[0].error_kind,'provider_unknown');
 assert.equal(f.tables.pipeline_runs[0].status,'paused');assert.equal(f.tables.pipeline_runs[0].pause_kind,'provider_unknown');
 assert.equal(f.tables.worker_tasks[0].status,'failed');assert.equal(f.tables.worker_tasks[0].failure_kind,'provider_unknown');
 assert.equal(f.tables.source_records[0].processing_status,'preparat');assert.equal(f.tables.provider_calls[0].state,'sending');
 assert.deepEqual(f.writes,['local_pause_provider_unknown','worker_tasks']);
});

test('direct operation records uncertainty without writing the run, source, or receipt',async()=>{
 const f=fixture();await failLocalUnknownTask(f.db,'task');
 assert.equal(f.tables.worker_tasks[0].failure_kind,'provider_unknown');assert.equal(f.tables.worker_tasks[0].status,'failed');
 assert.equal(f.tables.provider_calls[0].state,'sending');assert.deepEqual(f.writes,['worker_tasks']);
});

test('pause errors still propagate uncertainty and an already-paused reason is preserved',async()=>{
 const f=fixture({failRpc:true});const scope=await captureLocalProviderScope(f.db,'run','job');f.tables.pipeline_runs[0]={id:'run',status:'paused',pause_reason:'existing'};
 await assert.rejects(stopLocalRunForUnknown(f.db,'run','job',scope),/PROVIDER_UNKNOWN.*registrar/);
 assert.equal(f.tables.pipeline_runs[0].pause_reason,'existing');assert.equal(f.tables.provider_calls[0].state,'sending');
});
test('matching also propagates uncertainty while preserving a job or run changed during the call',async()=>{
 for(const [jobStatus,runStatus] of [['approved','matching'],['matching','completed'],['needs_review','needs_review']] as const){
  const f=fixture();f.tables.pipeline_jobs[0].status='matching';const scope=await captureLocalProviderScope(f.db,'run','job');f.tables.pipeline_jobs[0].status=jobStatus;f.tables.pipeline_runs[0].status=runStatus;
  await assert.rejects(stopLocalRunForUnknown(f.db,'run','job',scope),/PROVIDER_UNKNOWN/);
  assert.equal(f.tables.pipeline_jobs[0].status,jobStatus);assert.equal(f.tables.pipeline_runs[0].status,runStatus);assert.equal(f.tables.provider_calls[0].state,'sending');
 }
 const f=fixture();f.tables.pipeline_jobs[0].status='matching';const scope=await captureLocalProviderScope(f.db,'run','job');
 await assert.rejects(stopLocalRunForUnknown(f.db,'run','job',scope),/PROVIDER_UNKNOWN/);
 assert.equal(f.tables.pipeline_jobs[0].error_kind,'provider_unknown');assert.equal(f.tables.pipeline_runs[0].status,'paused');
});

test('a task that has changed owner or state is not silently marked as updated',async()=>{
 const f=fixture();await assert.rejects(failLocalUnknownTask(f.db,'task','other'),/PROVIDER_UNKNOWN/);
 assert.equal(f.tables.worker_tasks[0].status,'running');assert.equal(f.tables.provider_calls[0].state,'sending');
});
test('a row changed and restored to its former status still invalidates its captured revision',async()=>{
 const f=fixture();const scope=await captureLocalProviderScope(f.db,'run','job');f.tables.pipeline_jobs[0].xmin='3';
 await assert.rejects(stopLocalRunForUnknown(f.db,'run','job',scope),/PROVIDER_UNKNOWN.*registrar/);
 assert.equal(f.tables.pipeline_jobs[0].status,'ready');assert.equal(f.tables.pipeline_runs[0].status,'matching');
});
test('scope read failure blocks before any child or provider call',async()=>{
 const db={rpc:async()=>{throw Error('connection lost');}} as unknown as SupabaseClient;let calls=0;
 await assert.rejects(async()=>{await captureLocalProviderScope(db,'run','job');calls++;},/LOCAL_TYPE_BLOCKED/);
 assert.equal(calls,0);
});
