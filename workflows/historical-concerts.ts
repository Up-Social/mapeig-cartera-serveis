import {getWorkflowMetadata,sleep} from 'workflow';

/** Started only by an explicit user action. This workflow never dispatches a
 * successor; uncertain outcomes stay available for reconciliation. */
export async function recoverHistoricalConcerts(attempt:string,task:string){
 'use workflow';
 const {workflowRunId}=getWorkflowMetadata();
 // start() can return after the workflow begins; wait without reading a source
 // until the dispatcher has committed the matching workflow receipt.
 for(let poll=0;poll<30;poll++){
  const state=await dispatchState(attempt,task,workflowRunId);
  if(state==='confirmed')break;
  if(state!=='waiting')return;
  if(poll===29)return;
  await sleep('2s');
 }
 const owner=await makeOwner();let generation:number|undefined;
 for(let i=0;i<6000;i++){
  const result=await runUnit(attempt,task,workflowRunId,owner,generation);
  if(result.leaseGeneration!==undefined)generation=result.leaseGeneration;
  if(result.status!=='advanced')return;
  await sleep('1s');
 }
 if(generation!==undefined)await recordLimit(attempt,task,workflowRunId,owner,generation);
}
async function dispatchState(attempt:string,task:string,workflowId:string){
 'use step';
 if(process.env.HISTORICAL_CONCERTS_ENABLED!=='true')return 'disabled';
 try {
  const {cloudDb}=await import('../lib/cloud/context');
  const response=await cloudDb().rpc('experimental_history_dispatch_state',{p_attempt:attempt,p_task:task,p_workflow:workflowId});
  return response.error?'unavailable':response.data;
 } catch{return 'unavailable';}
}
async function makeOwner(){
 'use step';
 const {randomUUID}=await import('node:crypto');return randomUUID();
}
async function runUnit(attempt:string,task:string,workflowId:string,owner:string,leaseGeneration?:number):Promise<{status:string;leaseGeneration?:number}>{
 'use step';
 if(process.env.HISTORICAL_CONCERTS_ENABLED!=='true')return {status:'disabled'};
 try {
  const [{cloudDb},{experimentalHistoricalWorkerStep},{createHistoricalEtaulerSource}]=await Promise.all([
   import('../lib/cloud/context'),import('../lib/concerts/historical-worker-step'),import('../lib/concerts/historical-etauler-source')]);
  return await experimentalHistoricalWorkerStep({client:cloudDb(),attemptId:attempt,taskId:task,workflowId,owner,leaseGeneration,source:createHistoricalEtaulerSource(fetch)});
 } catch {return {status:'reconcile'};}
}
dispatchState.maxRetries=0;
makeOwner.maxRetries=0;
runUnit.maxRetries=0;

async function recordLimit(attempt:string,task:string,workflowId:string,owner:string,generation:number){
 'use step';
 try {
  const {cloudDb}=await import('../lib/cloud/context');
  await cloudDb().rpc('experimental_history_limit_exceeded',{p_attempt:attempt,p_task:task,p_workflow:workflowId,p_owner:owner,p_generation:generation});
 } catch { /* Lease expiry makes the interrupted state visible for review. */ }
}
recordLimit.maxRetries=0;
