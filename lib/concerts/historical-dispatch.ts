import {randomUUID} from 'node:crypto';

/** A single explicit action may reserve and dispatch one historical run.
 * The backend must authenticate the request before calling this function.
 * RPC implementations must commit reservation and task atomically. */
export interface HistoricalDispatcher {
 reserve(attempt:string,token:string,task:string):Promise<boolean>;
 start(attempt:string,task:string):Promise<string>;
 confirm(attempt:string,token:string,workflow:string):Promise<void>;
 markUnknown(attempt:string,token:string):Promise<void>;
}
export async function dispatchHistoricalOnce(input:{enabled:boolean;dispatcher:HistoricalDispatcher;timeoutMs?:number}){
 if(input.enabled!==true)return {status:'disabled' as const};
 const timeout=input.timeoutMs??15_000;
 if(!Number.isSafeInteger(timeout)||timeout<1||timeout>60_000)throw Error('HISTORY_DISPATCH_TIMEOUT_INVALID');
 const attempt=randomUUID(),token=randomUUID(),task=randomUUID();
 let reserveTimer:ReturnType<typeof setTimeout>|undefined;
 try {
  const reservation=await Promise.race([input.dispatcher.reserve(attempt,token,task),new Promise<never>((_,reject)=>{reserveTimer=setTimeout(()=>reject(Error('timeout')),timeout);})]);
  if(reservation===false)return {status:'already_reserved' as const};
  if(reservation!==true)throw Error('INVALID_RESERVATION_RECEIPT');
 } catch {return {status:'review_required' as const,reason:'RESERVATION_UNCONFIRMED' as const};}
 finally {if(reserveTimer)clearTimeout(reserveTimer);} 
 let timer:ReturnType<typeof setTimeout>|undefined;
 try {
  // A timeout is never evidence that the remote start did not happen.
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),timeout);});
  const result=await Promise.race([input.dispatcher.start(attempt,task),deadline]);
  if(typeof result!=='string'||!result.trim()||result.length>256)throw Error('INVALID_WORKFLOW_RECEIPT');
  await Promise.race([input.dispatcher.confirm(attempt,token,result),deadline]);
  return {status:'started' as const};
 } catch {
  let markerTimer:ReturnType<typeof setTimeout>|undefined;
  try {
   await Promise.race([input.dispatcher.markUnknown(attempt,token),new Promise<never>((_,reject)=>{markerTimer=setTimeout(()=>reject(Error('timeout')),timeout);})]);
  } catch { /* Treat a lost unknown marker as uncertain too. */ }
  finally {if(markerTimer)clearTimeout(markerTimer);}
  return {status:'review_required' as const,reason:'DISPATCH_UNCONFIRMED' as const};
 } finally {if(timer)clearTimeout(timer);}
}
