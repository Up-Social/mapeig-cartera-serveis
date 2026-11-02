/** One fenced unit of the dedicated historical workflow. The caller supplies the server client and source. */
import {advanceHistoricalRecovery,type HistoricalSource} from './historical-executor';
import {createExperimentalHistoricalStore} from './historical-experimental-store';

type Rpc={rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>};

/** The caller must have authenticated the dispatcher and the workflow identity.
 * A claim alone does not authenticate either. Run one unit only. */
export async function experimentalHistoricalWorkerStep(input:{client:Rpc;attemptId:string;taskId:string;workflowId:string;owner:string;source:HistoricalSource;leaseGeneration?:number}){
 const {client,attemptId,taskId,workflowId,owner,source}=input;
 let generation=input.leaseGeneration;
 if(generation===undefined){
  let claimed:{data:unknown;error:unknown};
  try {claimed=await client.rpc('experimental_history_worker_claim',{p_attempt:attemptId,p_task:taskId,p_workflow:workflowId,p_owner:owner});}
  catch {return {status:'reconcile' as const,reason:'CLAIM_UNCONFIRMED'};}
  if(claimed.error)return {status:'reconcile' as const,reason:'CLAIM_UNCONFIRMED'};
  if(claimed.data===null)return {status:'blocked' as const,reason:'NOT_CLAIMED'};
  if(!Number.isSafeInteger(claimed.data)||Number(claimed.data)<1)return {status:'reconcile' as const,reason:'CLAIM_INVALID'};
  generation=Number(claimed.data);
 }
 if(!Number.isSafeInteger(generation)||generation<1)return {status:'reconcile' as const,reason:'CLAIM_INVALID'};
 if(input.leaseGeneration!==undefined){
  try {
   const current=await client.rpc('experimental_history_worker_resume',{p_attempt:attemptId,p_task:taskId,p_workflow:workflowId,p_owner:owner,p_generation:generation});
   if(current.error)return {status:'reconcile' as const,reason:'LEASE_UNCONFIRMED'};
   if(current.data!==true){
    const terminal=await client.rpc('experimental_history_worker_terminal',{p_attempt:attemptId,p_task:taskId,p_workflow:workflowId,p_owner:owner,p_generation:generation});
    if(terminal.error)return {status:'reconcile' as const,reason:'TERMINAL_UNCONFIRMED'};
    if(terminal.data===true)return {status:'completed' as const,leaseGeneration:generation};
    return {status:'blocked' as const,reason:'LEASE_UNAVAILABLE'};
   }
  } catch {return {status:'reconcile' as const,reason:'LEASE_UNCONFIRMED'};}
 }
 const lease={owner,generation};
 const {store}=createExperimentalHistoricalStore(client);
 const guardedSource:HistoricalSource={async readPage(term,page,signal){
  const permitted=await client.rpc('experimental_history_page_permitted',{p_attempt:attemptId,p_owner:owner,p_generation:lease.generation});
  if(permitted.error||permitted.data!==true)throw Error('HISTORY_PAGE_NOT_PERMITTED');
  return source.readPage(term,page,signal);
 }};
 const result=await advanceHistoricalRecovery({attemptId,lease,store,source:guardedSource});
 // The adapter reports success only after the terminal transaction committed.
 if(result.status==='advanced'&&result.action==='verify_and_complete')return {status:'completed' as const,leaseGeneration:generation};
 return {...result,leaseGeneration:generation};
}
