import {checkpoint,commit,lease,readCheckpoint,rpc,type Context} from './context';
import {CloudFailure,CloudYield,publicFailure,failureMessage} from './errors';

/** Handle a task failure while retaining the lease and provider journal. */
export async function handleCloudFailure(c:Context,error:unknown,job:string|undefined,stage:string):Promise<{done:boolean;wait:number}>{
 if(error instanceof CloudYield){await rpc(c.db,'cloud_finish',{...lease(c),p_state:'pending'});return {done:false,wait:error.wait};}
 let failure=publicFailure(error);
 const recordFailure=async()=>{try {await checkpoint(c,'last_failure',{kind:failure.kind,job:job??null,stage,diagnostic:failure.diagnostic??null,at:new Date().toISOString()});} catch { /* Do not mask the original failure if the lease has expired. */ }};
 await recordFailure();
 if(job&&['document','validation'].includes(failure.kind)){
  try {
   await commit(c,job,'error',{kind:failure.kind,message:failureMessage(failure)});
   await rpc(c.db,'cloud_finish',{...lease(c),p_state:'pending'});return {done:false,wait:1};
  } catch(commitError) {
   const conflict=publicFailure(commitError);
   // Only the known rolled-back commit is safe to retry. Other failures retain
   // their previous propagation; never reinterpret provider uncertainty.
   if(conflict.kind!=='transient'||conflict.diagnostic?.code!=='T19_DEDUP_BUSY')throw commitError;
   const originalCode=failure.diagnostic?.code;
   failure=new CloudFailure('transient',conflict.retryAfter,{operation:'cloud_commit',code:'T19_DEDUP_BUSY',details:{
    original_failure_kind:failure.kind,
    original_failure_code:originalCode&&/^[A-Z][A-Z0-9_]{0,79}$/.test(originalCode)?originalCode:null,
   }});
   await recordFailure();
  }
 }
 if(failure.kind==='transient'){
  const key=`retry:${job??'task'}`;const attempts=(await readCheckpoint<number>(c,key)??0)+1;
  await checkpoint(c,key,attempts);
  if(attempts<3){await rpc(c.db,'cloud_finish',{...lease(c),p_state:'pending'});return {done:false,wait:failure.retryAfter};}
 }
 await rpc(c.db,'cloud_finish',{...lease(c),p_state:'paused',p_kind:failure.kind});return {done:true,wait:0};
}
