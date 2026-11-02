import type {HistoricalStore} from './historical-executor';
import type {HistoricalSnapshot} from './historical-runner';

type RpcClient={rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>};
type Lease={owner:string;generation:number};
const isObject=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);

/** Adapter for the private experimental SQL only. It cannot connect by itself:
 * the caller must inject a client, and those RPCs have no application grants. */
export function createExperimentalHistoricalStore(client:RpcClient):{store:HistoricalStore;reconcileDatabaseOperation:(attemptId:string,lease:Lease,operationId:string)=>Promise<'no_pending_intent'|'no_commit_confirmed'|'external_reconciliation_required'>}{
 async function call(name:string,args:Record<string,unknown>):Promise<unknown>{
  const response=await client.rpc(name,args);
  if(!response||response.error)throw new Error('HISTORY_STORE_UNAVAILABLE');
  return response.data;
 }
 const base=(attemptId:string,lease:Lease)=>({p_attempt:attemptId,p_owner:lease.owner,p_generation:lease.generation});
 const store:HistoricalStore={
  async read(attemptId,lease){
   const data=await call('experimental_history_read',base(attemptId,lease));
   if(!isObject(data)||typeof data.revision!=='string'||!/^\d+$/.test(data.revision)||!isObject(data.snapshot))throw new Error('HISTORY_STORE_INVALID');
   const s=data.snapshot;
   if(!['running','uncertain','completed'].includes(String(s.state))||!['confirmed','unknown'].includes(String(s.dispatch))||
    !['verified','user_requested','unverified'].includes(String(s.historicalSourceContract))||!Array.isArray(s.queries)||!Array.isArray(s.receipts)||
    typeof s.retrievedAt!=='string'||!(s.manifestHash===null||typeof s.manifestHash==='string')||
    !(s.inFlight===null||(isObject(s.inFlight)&&typeof s.inFlight.id==='string'&&['page','manifest','import','completion'].includes(String(s.inFlight.kind)))))throw new Error('HISTORY_STORE_INVALID');
   return {revision:data.revision,snapshot:s as HistoricalSnapshot};
  },
  async begin(attemptId,lease,revision,reservation){
   const data=await call('experimental_history_begin',{...base(attemptId,lease),p_revision:revision,p_reservation:reservation});
   if(typeof data!=='boolean')throw new Error('HISTORY_STORE_INVALID');return data;
  },
  async apply(attemptId,lease,reservation,result){
   const data=await call('experimental_history_apply',{...base(attemptId,lease),p_reservation:reservation,p_result:result});
   if(data!==true)throw new Error('HISTORY_STORE_INVALID');
  },
 };
 async function reconcileDatabaseOperation(attemptId:string,lease:Lease,operationId:string){
  const result=await call('experimental_history_reconcile_db',{...base(attemptId,lease),p_operation:operationId});
  if(result!=='no_pending_intent'&&result!=='no_commit_confirmed'&&result!=='external_reconciliation_required')throw new Error('HISTORY_STORE_INVALID');
  return result;
 }
 return {store,reconcileDatabaseOperation};
}
