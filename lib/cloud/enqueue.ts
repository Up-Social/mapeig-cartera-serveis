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
