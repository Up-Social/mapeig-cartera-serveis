import {assertProcessingEnabled,isProcessingPaused,pauseLocalProcessing,PROCESSING_PAUSE_EXIT_CODE} from '../lib/processing-control';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createClient} from '@supabase/supabase-js';
import {requireUuid} from '../lib/uuid';
async function main(){
 const id=requireUuid(process.argv[process.argv.indexOf('--task-id')+1]);
 if(process.env.WORKFLOW_TEST_PROJECT||process.env.PIPELINE_PROVIDER==='mock')throw Error('Use the fixture runner in isolated tests');
 const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY!);
 await assertProcessingEnabled(db);
 const task=await db.from('worker_tasks').update({status:'running',claimed_at:new Date().toISOString()}).eq('id',id).eq('status','queued').eq('executor','local').select('*').maybeSingle();if(task.error)throw task.error;if(!task.data)return;
 const t=task.data;const script=t.task_type==='enrich_record'?'enrichment:run':t.task_type==='prepare_run'?'pipeline:prepare':t.task_type==='match_run'?'matching:run':'pipeline:process';
 const args=t.task_type==='enrich_record'?['--source-record-id',t.source_record_id]:['--run-id',t.run_id];
 try{await promisify(execFile)('npm',['run',script,'--',...args],{env:{...process.env,WORKFLOW_JOB_ID:t.pipeline_job_id},maxBuffer:10*1024*1024});await db.from('worker_tasks').update({status:'completed',completed_at:new Date().toISOString()}).eq('id',id);}
 catch(error){if(isProcessingPaused(error)){await pauseLocalProcessing(db,{runId:t.run_id,taskId:id,jobId:t.pipeline_job_id});console.error('PROCESSING_DISABLED');process.exitCode=PROCESSING_PAUSE_EXIT_CODE;return;}await db.from('worker_tasks').update({status:'failed',error_message:'Execució interrompuda. Consulta els intents del treball.',completed_at:new Date().toISOString()}).eq('id',id);process.exitCode=1;}
}
main().catch(error=>{console.error(isProcessingPaused(error)?'PROCESSING_DISABLED':'No s’ha pogut executar la tasca local.');process.exitCode=isProcessingPaused(error)?PROCESSING_PAUSE_EXIT_CODE:1;});
