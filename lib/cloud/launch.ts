import 'server-only';
import {start} from 'workflow/api';
import {processCloudTask} from '../../workflows/process-task';
import {cloudDb} from './context';
export async function launchCloudTask(task:string){
 const db=cloudDb();
 try{
  const run=await start(processCloudTask,[task]);
  const r=await db.from('worker_tasks').update({workflow_id:run.runId,dispatch_at:new Date().toISOString()}).eq('id',task);
  if(r.error)return false;return true;
 }catch {return false;}
}
