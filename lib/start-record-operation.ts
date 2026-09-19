import 'server-only';
import {spawn} from 'node:child_process';
import {createServerSupabase} from './records-page';
import {executionMode} from './pipeline/execution-mode';
import {requireUuid} from './uuid';
import type {RecordOperation} from './record-operation';
import {assertTestEnvironment} from './test-environment';
export async function startRecordOperation(recordId:string,operation:RecordOperation,expectedJobId?:string){
 const mode=executionMode();const mock=process.env.PIPELINE_PROVIDER==='mock';if(mock)assertTestEnvironment(process.env);else if(mode==='disabled')throw Error('Execució desactivada en aquest entorn.');
 const db=createServerSupabase();const r=await db.rpc(expectedJobId?'retry_job_operation':'begin_record_operation',{p_record:requireUuid(recordId),p_operation:operation,p_executor:mode==='vercel_workflow'?'vercel_workflow':'local',...(expectedJobId?{p_expected_job:requireUuid(expectedJobId)}:{})});
 if(r.error)throw Error(r.error.message.includes('PROVIDER_UNKNOWN')?'Cal resoldre la petició de proveïdor de resultat desconegut.':'No es pot iniciar: hi ha una tasca activa o falta preparar les dades.');
 const result=r.data as {runId:string;jobId:string;taskId:string;attemptId:string;newJob:boolean};
 if(mock){const {runMockWorkflow}=await import('./mock-workflow');await runMockWorkflow(db,result.taskId);return result;}
 if(mode==='vercel_workflow'){const {launchCloudTask}=await import('./cloud/launch');await launchCloudTask(result.taskId);}
 if(mode==='local'){const child=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/run-operation-task.ts','--task-id',result.taskId],{cwd:process.cwd(),env:process.env,detached:true,stdio:'ignore'});child.unref();}
 return result;
}
