import {execFileSync,spawn} from 'node:child_process';
import {createClient} from '@supabase/supabase-js';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {assertTestEnvironment,TEST_PROJECT,TEST_API} from '../lib/test-environment';
import {runMockWorkflow} from '../lib/mock-workflow';
import {ACCESS_COOKIE_NAME,createAccessToken} from '../lib/access-auth';
async function main(){
 const status=JSON.parse(execFileSync('supabase',['status','--workdir','tests/runtime','-o','json'],{encoding:'utf8'}));
 Object.assign(process.env,{NEXT_PUBLIC_SUPABASE_URL:status.API_URL,WORKFLOW_TEST_PROJECT:TEST_PROJECT,PIPELINE_PROVIDER:'mock',OPENAI_API_KEY:'',VERCEL_TOKEN:'',SUPABASE_ACCESS_TOKEN:''});assertTestEnvironment(process.env);
 const db=createClient(TEST_API,status.SERVICE_ROLE_KEY,{auth:{persistSession:false}}),selection=[];
 const check=(r:{error:unknown})=>{if(r.error)throw r.error;};
 const paths:string[]=[];
 for(let n=0;n<2;n++){
  const id=randomUUID();check(await db.from('source_records').insert({id,source_dataset:'contractacions',source_record_id:`PURGE-FIXTURE-${id}`,mechanism:'Contractació',title:'Fitxer fictici eliminable',source_payload:{fixture:true,fixture_classification:'discarded'}}));
  const task=await db.rpc('begin_record_operation',{p_record:id,p_operation:'process'});check(task);await runMockWorkflow(db,task.data.taskId);
  const doc=await db.from('source_documents').select('id').eq('source_record_id',id).single();check(doc);
  const path=`${task.data.taskId}/${doc.data!.id}/fixture.txt`;paths.push(path);check(await db.storage.from('cloud-documents').upload(path,'Exclusivament contingut fictici de prova',{contentType:'text/plain'}));
  const current=await db.from('current_record_results').select('id,job_id,result_token').eq('id',id).single();check(current);selection.push(current.data!);
 }
 // A competing transaction must fail closed while a worker holds the source lock.
 const args=['exec','-i',`supabase_db_${TEST_PROJECT}`,'psql','-U','postgres','-X','-v','ON_ERROR_STOP=1','-At'];
 const locker=spawn('docker',args,{stdio:['pipe','pipe','pipe']});
 const locked=new Promise<void>((resolve,reject)=>{locker.stdout.on('data',chunk=>{if(String(chunk).includes('LOCK_READY'))resolve();});locker.on('error',reject);});
 const unlocked=new Promise<void>(resolve=>locker.on('exit',()=>resolve()));
 locker.stdin.end(`begin;select id from source_records where id='${selection[0].id}' for update;select 'LOCK_READY';select pg_sleep(2);rollback;`);
 await locked;
 const conflict=await db.rpc('delete_discarded_records',{p_selection:selection,p_confirmed_count:2});assert.ok(conflict.error,'Concurrent deletion must not succeed');
 const survivors=await db.from('source_records').select('id').in('id',selection.map(s=>s.id));check(survivors);assert.equal(survivors.data!.length,2);
 await unlocked;
 const token=await createAccessToken('local-workflow-fixture-only');
 const response=await fetch('http://localhost:3108/api/discarded/delete',{method:'POST',headers:{'Content-Type':'application/json',Cookie:`${ACCESS_COOKIE_NAME}=${token}`},body:JSON.stringify({selection,confirmedCount:2})});
 assert.equal(response.status,200);const result=await response.json();assert.equal(result.deleted,2);assert.equal(result.pending,0,'Storage purge must be verified, not assumed');
 for(const path of paths){const exists=await db.storage.from('cloud-documents').exists(path);assert.equal(exists.data,false);}
 const remaining=await db.from('source_records').select('id').in('id',selection.map(s=>s.id));check(remaining);assert.equal(remaining.data!.length,0);
 console.log(JSON.stringify({passed:true,deletedFictitiousRecords:2,verifiedStoragePurges:2,concurrentLock:'blocked with full rollback',purgeId:result.purgeId}));
}
main().catch(error=>{console.error(error.message??'Integration failed');process.exitCode=1;});
