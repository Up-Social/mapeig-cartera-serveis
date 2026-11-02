import {independentEconomicConfigurationError} from '@/lib/convenis/independent-economic-config';
import {ConveniIndependentReadUnavailable,independentConveniReadersEnabled,requireConsistentConveniReads} from '@/lib/convenis/independent-read-guard';
import {createServerSupabase} from '@/lib/records-page';
import {isUuid} from '@/lib/uuid';
import {verifyDecisionReceipt} from '@/lib/convenis/decision-receipt-verification';
import {ARCHIVE_REQUEST_TIMEOUT_MS} from '@/lib/convenis/archive-verification';
import {boundedPreparationRpc,CopyPreparationUncertain} from '@/lib/convenis/first-copy-preparer';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const configError=independentEconomicConfigurationError();if(configError)return Response.json({error:configError},{status:503,headers:{'Cache-Control':'private, no-store'}});
 if(process.env.CONVENI_ECONOMIC_REVIEW_ENABLED!=='true')return Response.json({error:'Aprovació econòmica no disponible.'},{status:404});
 const {id}=await params;const url=new URL(request.url),jobId=url.searchParams.get('jobId'),unitId=url.searchParams.get('unitId');
 if(!isUuid(id)||!isUuid(jobId??'')||!isUuid(unitId??''))return Response.json({error:'Dades invàlides.'},{status:400});
 try{const db=createServerSupabase();await requireConsistentConveniReads(db);
  if(independentConveniReadersEnabled()){
   const [result,recovery]=await Promise.all([db.rpc('conveni_independent_decision_candidate',{p_record:id,p_job:jobId,p_unit:unitId}),db.rpc('conveni_independent_decision_recovery',{p_record:id,p_job:jobId,p_unit:unitId})]);
   if(result.error||recovery.error)throw result.error??recovery.error;
   return Response.json({candidate:result.data?.candidate??null,pendingReason:result.data?.pendingReason??null,recovery:recovery.data??null,independent:true},{headers:{'Cache-Control':'private, no-store'}});
  }
  const [result,recovery]=await Promise.all([db.rpc('conveni_first_candidate_ready',{p_record:id,p_job:jobId,p_unit:unitId}),db.rpc('conveni_first_recovery_status',{p_record:id,p_job:jobId,p_unit:unitId})]);
  if(result.error||recovery.error)throw result.error??recovery.error;return Response.json({candidate:recovery.data?.provisionId?null:result.data??null,recovery:recovery.data??null},{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){return Response.json({error:error instanceof ConveniIndependentReadUnavailable?error.message:'No es pot verificar la preparació econòmica.'},{status:503});}
}
/** Closed candidate. The database wrapper also has no application grants. */
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const configError=independentEconomicConfigurationError();if(configError)return Response.json({error:configError},{status:503,headers:{'Cache-Control':'private, no-store'}});
 if(process.env.CONVENI_ECONOMIC_REVIEW_ENABLED!=='true')return Response.json({error:'Aprovació econòmica no disponible.'},{status:404});
 const {id}=await params;const b=await request.json().catch(()=>null);
 const independent=independentConveniReadersEnabled();
 const expectedKeys=independent?'economic,eventId,jobId,linkId,manifest,note,previousId,receiptId,reviewId,reviewer,social,unitId':'economic,eventId,jobId,linkId,manifest,note,receiptId,reviewId,reviewer,social,unitId';
 if(!isUuid(id)||!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).sort().join(',')!==expectedKeys||(independent&&b.previousId!==null&&!isUuid(b.previousId))
  ||![b.eventId,b.jobId,b.linkId,b.receiptId,b.reviewId,b.unitId].every(isUuid)||typeof b.reviewer!=='string'||b.reviewer.trim().length<3||b.reviewer.length>120
  ||typeof b.note!=='string'||b.note.trim().length<10||b.note.length>2000||b.social!==true||b.economic!==true||b.manifest!==true)return Response.json({error:'Cal revisar i confirmar totes les dades de la decisió.'},{status:400});
 if(process.env.CONVENI_DECISION_PHYSICAL_VERIFICATION_ENABLED!=='true')return Response.json({error:'La verificació documental de la decisió no està disponible. La decisió queda pendent.'},{status:503});
 const storageUrl=process.env.NEXT_PUBLIC_SUPABASE_URL,serviceKey=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!storageUrl||!serviceKey)return Response.json({error:'No es poden verificar les fonts. La decisió queda pendent.'},{status:503});
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),ARCHIVE_REQUEST_TIMEOUT_MS);
 const abort=()=>controller.abort();request.signal.addEventListener('abort',abort,{once:true});if(request.signal.aborted)controller.abort();
 let committing=false;
 try{
  const db=createServerSupabase();await boundedPreparationRpc(()=>requireConsistentConveniReads(db),controller.signal);
  const args={p_record:id,p_job:b.jobId,p_unit:b.unitId,p_event:b.eventId,p_review:b.reviewId,p_previous:independent?b.previousId:null,p_link:b.linkId,p_receipt:b.receiptId,p_actor:b.reviewer,p_note:b.note,p_independent:independent};
  await verifyDecisionReceipt({scope:{recordId:id,jobId:b.jobId,unitId:b.unitId,linkId:b.linkId,receiptId:b.receiptId},storageUrl,serviceKey,signal:controller.signal,
   read:async()=>{const r=await db.rpc('conveni_decision_receipt_candidate',args);if(r.error)throw r.error;return r.data;}});
  if(controller.signal.aborted)throw Error('Verification interrupted');
  committing=true;
  const result=await boundedPreparationRpc(async()=>await db.rpc('conveni_decision_commit_candidate',args),controller.signal);
  if(result.error)throw result.error;
  return Response.json({saved:true,eventId:b.eventId,provisionId:result.data?.provision_id??null});
 }catch(error){if(error instanceof ConveniIndependentReadUnavailable)return Response.json({error:error.message},{status:503});if(committing&&error instanceof CopyPreparationUncertain)return Response.json({error:'No s’ha pogut confirmar si la decisió s’ha desat. Consulta l’historial i reconcilia l’operació abans de tornar-la a enviar.'},{status:409});if(typeof error==='object'&&error!==null&&'message' in error&&String(error.message).includes('ECONOMIC_HISTORICAL_REQUEST_UNVERIFIABLE'))return Response.json({error:'La decisió anterior es conserva, però no es pot verificar tota la petició original. Consulta l’historial abans de continuar.'},{status:409});return Response.json({error:'No s’ha pogut confirmar la decisió. Comprova les fonts i reconcilia l’operació abans de repetir-la.'},{status:409});}
 finally{clearTimeout(timer);request.signal.removeEventListener('abort',abort);}
}
