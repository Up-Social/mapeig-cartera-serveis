import {isLocalTypeBlocked} from './local-matching-guard';

/** Queue polling is injected so the real loop can be verified without running jobs. */
export async function runLocalWorkerLoop<T>(options:{
 once:boolean;
 isStopping:()=>boolean;
 claim:()=>Promise<T|null>;
 execute:(task:T)=>Promise<void>;
 wait:()=>Promise<void>;
 onBlocked:(error:unknown)=>void;
 onError:(error:unknown)=>void;
}):Promise<void> {
 let blockedReported=false;
 do {
  let task:T|null;
  try {
   task=await options.claim();
   blockedReported=false;
  } catch(error) {
   if(isLocalTypeBlocked(error)) {
    if(!blockedReported){options.onBlocked(error);blockedReported=true;}
    if(options.once)throw error;
    await options.wait();
    continue;
   }
   if(options.once)throw error;
   options.onError(error);
   await options.wait();
   continue;
  }
  if(!task){if(options.once)break;await options.wait();continue;}
  await options.execute(task);
 } while(!options.isStopping());
}
