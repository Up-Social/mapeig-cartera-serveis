import 'server-only';
import {cloudDb,rpc} from './context';
import {launchCloudTask} from './launch';
export async function launchRun(runId:string){
 const db=cloudDb();const t=await db.from('worker_tasks').select('id').eq('run_id',runId).eq('executor','vercel_workflow').order('created_at',{ascending:false}).limit(1).single();
 if(t.error)throw new Error('No s’ha pogut registrar l’execució.');await launchCloudTask(t.data.id);
}
export async function createCloudRun(records:string[],ocr=false){
 const id=await rpc<string>(cloudDb(),'cloud_create_run',{p_records:records,p_ocr:ocr});await launchRun(id);return id;
}

export async function startCloudPhase(run:string,type:'prepare_run'|'match_run'){
 const task=await rpc<string>(cloudDb(),'cloud_start_phase',{p_run:run,p_type:type});await launchCloudTask(task);
}
export async function startCloudRecord(record:string,type:'prepare_run'|'enrich_record'|'match_run'){
 const task=await rpc<string>(cloudDb(),'cloud_record_phase',{p_record:record,p_type:type});await launchCloudTask(task);
}
