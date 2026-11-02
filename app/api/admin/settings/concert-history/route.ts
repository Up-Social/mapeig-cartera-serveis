import {hasTrustedOrigin} from '@/lib/access-auth';
import {cloudDb} from '@/lib/cloud/context';
import {getProcessingSetting} from '@/lib/processing-control';
import {historicalCanStart} from '@/lib/concerts/historical-status-ui';
import {dispatchHistoricalOnce,type HistoricalDispatcher} from '@/lib/concerts/historical-dispatch';
import {start} from 'workflow/api';
import {recoverHistoricalConcerts} from '@/workflows/historical-concerts';

export const dynamic='force-dynamic';
const enabled=()=>process.env.HISTORICAL_CONCERTS_ENABLED==='true';
export async function GET(){
 if(!enabled())return Response.json({state:'disabled',reason:'FEATURE_DISABLED',can_start:false,feature_enabled:false,source_exhaustive:false},{status:404,headers:{'Cache-Control':'no-store'}});
 try {
  const db=cloudDb();
  const [result,processing]=await Promise.all([db.rpc('experimental_history_status'),getProcessingSetting(db)]);
  if(result.error||!result.data||typeof result.data!=='object')throw Error('HISTORY_STATUS_UNAVAILABLE');
  const status=result.data as Record<string,unknown>;
  const featureEnabled=enabled();
  return Response.json({...status,can_start:historicalCanStart({state:status.state,featureEnabled,processingEnabled:processing.enabled}),feature_enabled:featureEnabled,processing_enabled:processing.enabled,source_exhaustive:false},{headers:{'Cache-Control':'no-store'}});
 } catch {return Response.json({state:'unavailable',can_start:false,source_exhaustive:false},{status:503,headers:{'Cache-Control':'no-store'}});}
}
export async function POST(request:Request){
 if(!hasTrustedOrigin(request))return Response.json({error:'Origen de la petició no vàlid.'},{status:403});
 if(!enabled())return Response.json({error:'La recuperació històrica no està disponible en aquest entorn.'},{status:503});
 let data:unknown;try{data=await request.json();}catch{return Response.json({error:'Confirmació no vàlida.'},{status:400});}
 if(!data||typeof data!=='object'||!('confirm' in data)||data.confirm!==true)return Response.json({error:'Cal confirmar la cerca històrica.'},{status:400});
 try {
  const db=cloudDb();
  async function rpc(name:string,args:Record<string,unknown>){const response=await db.rpc(name,args);if(response.error)throw Error('HISTORY_DATABASE_UNAVAILABLE');return response.data;}
  const dispatcher:HistoricalDispatcher={
   async reserve(attempt,token,task){const result=await rpc('experimental_history_park_task',{p_attempt:attempt,p_token:token,p_task:task});if(typeof result!=='boolean')throw Error('HISTORY_RESERVATION_INVALID');return result;},
   async start(attempt,task){const run=await start(recoverHistoricalConcerts,[attempt,task]);return run.runId;},
   async confirm(attempt,token,workflow){await rpc('experimental_history_confirm_dispatch',{p_attempt:attempt,p_token:token,p_workflow:workflow});},
   async markUnknown(attempt,token){await rpc('experimental_history_dispatch_unknown',{p_attempt:attempt,p_token:token});},
  };
  const result=await dispatchHistoricalOnce({enabled:true,dispatcher});
  return Response.json(result,{status:result.status==='started'?202:409,headers:{'Cache-Control':'no-store'}});
 } catch {return Response.json({status:'review_required',reason:'DISPATCH_UNCONFIRMED'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
