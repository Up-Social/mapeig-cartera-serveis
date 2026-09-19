import {execFileSync} from 'node:child_process';
import {createClient} from '@supabase/supabase-js';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {assertTestEnvironment,TEST_PROJECT,TEST_API} from '../lib/test-environment';
import {runMockWorkflow} from '../lib/mock-workflow';
async function main(){
 const status=JSON.parse(execFileSync('supabase',['status','--workdir','tests/runtime','-o','json'],{encoding:'utf8'}));
 Object.assign(process.env,{NEXT_PUBLIC_SUPABASE_URL:status.API_URL,WORKFLOW_TEST_PROJECT:TEST_PROJECT,PIPELINE_PROVIDER:'mock',OPENAI_API_KEY:'',VERCEL_TOKEN:'',SUPABASE_ACCESS_TOKEN:''});assertTestEnvironment(process.env);
 const db=createClient(TEST_API,status.SERVICE_ROLE_KEY,{auth:{persistSession:false}});
 const recordId=randomUUID();const record=await db.from('source_records').insert({id:recordId,source_dataset:'contractacions',source_record_id:`FIXTURE-${recordId}`,mechanism:'Contractació pública',title:'Prova fictícia de rerun',source_payload:{fixture:true,fixture_classification:'discarded'}});if(record.error)throw record.error;
 const operation=await db.rpc('begin_record_operation',{p_record:recordId,p_operation:'process'});if(operation.error)throw operation.error;
 await runMockWorkflow(db,operation.data.taskId);
 const snapshots=await db.from('job_snapshots').select('id,content_hash').eq('pipeline_job_id',operation.data.jobId);if(snapshots.error)throw snapshots.error;
 const pre=await db.rpc('preflight_batch_rerun',{p_origin:operation.data.runId,p_provider:'mock',p_model:'fixture-v1'});if(pre.error)throw pre.error;
 const args={p_origin:operation.data.runId,p_token:pre.data.token,p_idempotency:randomUUID(),p_provider:'mock',p_model:'fixture-v1'};
 const create=await db.rpc('create_batch_rerun',args);if(create.error)throw create.error;
 const duplicate=await db.rpc('create_batch_rerun',args);if(duplicate.error)throw duplicate.error;assert.equal(duplicate.data.runId,create.data.runId);
 await runMockWorkflow(db,create.data.taskId);
 const preserved=await db.from('job_snapshots').select('id,content_hash').eq('pipeline_job_id',operation.data.jobId);if(preserved.error)throw preserved.error;
 for(const s of snapshots.data)assert.ok(preserved.data.some(p=>p.id===s.id&&p.content_hash===s.content_hash));
 const jobs=await db.from('pipeline_jobs').select('source_record_id,status,analysis_results(classification)').eq('run_id',create.data.runId);if(jobs.error)throw jobs.error;
 assert.equal(jobs.data.length,1);assert.equal(jobs.data[0].source_record_id,recordId);assert.equal(jobs.data[0].status,'needs_review');
 console.log(JSON.stringify({passed:true,provider:'mock',recordId,originRunId:operation.data.runId,comparisonRunId:create.data.runId}));
}
main().catch(error=>{console.error(error.message??'Local rerun test failed');process.exitCode=1;});
