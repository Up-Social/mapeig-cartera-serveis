import {randomUUID} from 'node:crypto';
import {independentEconomicConfigurationError} from '@/lib/convenis/independent-economic-config';
import {ConveniIndependentReadUnavailable,independentConveniReadersEnabled,requireConsistentConveniReads} from '@/lib/convenis/independent-read-guard';
import {independentPendingMessage} from '@/lib/convenis/independent-pending-message';
import {createServerSupabase} from '@/lib/records-page';
import {boundedPreparationRpc,createFirstCopyPreparer,type CopyPlan} from '@/lib/convenis/first-copy-preparer';
import {ARCHIVE_REQUEST_TIMEOUT_MS} from '@/lib/convenis/archive-verification';
import {preparationErrorMessage} from '@/lib/convenis/preparation-error-message';
import {isUuid} from '@/lib/uuid';
const firstGuardEnabled=()=>process.env.CONVENI_FIRST_PREPARATION_GUARD_ENABLED==='true';
const firstGuardMisconfigured=()=>firstGuardEnabled()&&(process.env.CONVENI_ECONOMIC_COVERAGE_ENABLED!=='true'||process.env.CONVENI_ECONOMIC_RECONCILIATION_ENABLED!=='true');
export const dynamic='force-dynamic';
type Snapshot=Awaited<ReturnType<ReturnType<typeof createFirstCopyPreparer>>>['snapshot'];
type Receipt=Awaited<ReturnType<ReturnType<typeof createFirstCopyPreparer>>>;
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const configError=independentEconomicConfigurationError();if(configError)return Response.json({error:configError},{status:503,headers:{'Cache-Control':'private, no-store'}});
 if(firstGuardMisconfigured())return Response.json({error:'La protecció de la preparació no està configurada de manera coherent.'},{status:503,headers:{'Cache-Control':'private, no-store'}});
 if(process.env.CONVENI_ECONOMIC_REVIEW_ENABLED!=='true')return Response.json({error:'Preparació econòmica no disponible.'},{status:404});
 const {id}=await params,url=new URL(request.url),jobId=url.searchParams.get('jobId'),unitId=url.searchParams.get('unitId');
 const coverageEnabled=process.env.CONVENI_ECONOMIC_COVERAGE_ENABLED==='true',before=url.searchParams.get('before'),beforeId=url.searchParams.get('beforeId');
 if((before!==null||beforeId!==null)&&(!coverageEnabled||!before||!Number.isFinite(Date.parse(before))||!isUuid(beforeId??'')))return Response.json({error:'Cursor invàlid.'},{status:400});
 if(!isUuid(id)||!isUuid(jobId??'')||!isUuid(unitId??''))return Response.json({error:'Dades invàlides.'},{status:400});
 try{const db=createServerSupabase();await requireConsistentConveniReads(db);const [history,observations,operation]=await Promise.all([db.rpc('conveni_first_history_candidate',{p_record:id,p_job:jobId,p_unit:unitId}),db.rpc(coverageEnabled?'conveni_visual_history_page':'conveni_visual_history',coverageEnabled?{p_record:id,p_before:before,p_before_id:beforeId}:{p_record:id}),db.rpc('conveni_first_operation_get',{p_record:id,p_job:jobId,p_unit:unitId})]);
  if(operation.error)throw Error('preparation unavailable');if((history.error||observations.error)&&!operation.data)throw Error('preparation unavailable');
  const guard=firstGuardEnabled()?await db.rpc('conveni_first_guard_status',{p_record:id,p_job:jobId,p_unit:unitId}):null;
  if(guard?.error||(guard&&(!guard.data||typeof guard.data.blocked!=='boolean')))throw Error('preparation guard unavailable');
  const independent=independentConveniReadersEnabled();const versioned=independent?await db.rpc('conveni_independent_versioned_history',{p_record:id,p_unit:unitId}):null;if(versioned?.error)throw versioned.error;
  const hasVersioned=Boolean(versioned?.data?.previous_id);const versionedOp=hasVersioned?await db.rpc('conveni_independent_preparation_get',{p_record:id,p_job:jobId,p_unit:unitId}):null;if(versionedOp?.error)throw versionedOp.error;
  const reconciliationAvailable=!firstGuardEnabled()&&coverageEnabled&&process.env.CONVENI_ECONOMIC_RECONCILIATION_ENABLED==='true';const audit=reconciliationAvailable?await db.rpc(hasVersioned?'conveni_independent_preparation_history':'conveni_first_operation_history',{p_record:id,p_job:jobId,p_unit:unitId}):null;if(audit?.error)throw audit.error;
  return Response.json({independent,versionedHistory:versioned?.data??null,history:history.data??{hasHistory:false},observations:observations.data??[],operation:hasVersioned?versionedOp?.data??null:operation.data??null,historyUnavailable:Boolean(history.error||observations.error),reconciliationAvailable,operationHistory:audit?.data??[],...(guard?{preparationGuard:guard.data}:{})},{headers:{'Cache-Control':'private, no-store'}});
 }catch{return Response.json({error:'No s’ha pogut carregar la preparació.'},{status:503});}
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const configError=independentEconomicConfigurationError();if(configError)return Response.json({error:configError},{status:503,headers:{'Cache-Control':'private, no-store'}});
 if(firstGuardMisconfigured())return Response.json({error:'La protecció de la preparació no està configurada de manera coherent.'},{status:503,headers:{'Cache-Control':'private, no-store'}});
 if(process.env.CONVENI_ECONOMIC_REVIEW_ENABLED!=='true')return Response.json({error:'Preparació econòmica no disponible.'},{status:404});
 const {id}=await params,b=await request.json().catch(()=>null);
 const coverageEnabled=process.env.CONVENI_ECONOMIC_COVERAGE_ENABLED==='true';
 const independent=independentConveniReadersEnabled();
 const baseKeys=(coverageEnabled?'ackId,coverageIds,draftId,economic,historyConfirmed,historySnapshot,identityId,jobId,linkId,literal,manifest,monetaryId,note,operationId,receiptId,reviewer,rolePeriodId,social,unitId':'ackId,draftId,economic,historyConfirmed,historySnapshot,identityId,jobId,linkId,literal,manifest,monetaryId,note,operationId,receiptId,reviewer,rolePeriodId,social,unitId');
 const keys=[...baseKeys.split(','),...(independent?['versionedHistoryConfirmed','versionedHistorySnapshot']:[])].sort().join(',');
 if(!isUuid(id)||!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).sort().join(',')!==keys
  ||(coverageEnabled&&(!Array.isArray(b.coverageIds)||!b.coverageIds.every(isUuid)||new Set(b.coverageIds).size!==b.coverageIds.length))
  ||![b.operationId,b.ackId,b.draftId,b.identityId,b.jobId,b.linkId,b.monetaryId,b.receiptId,b.rolePeriodId,b.unitId].every(isUuid)
  ||typeof b.literal!=='string'||b.literal.length>60||typeof b.reviewer!=='string'||b.reviewer.trim().length<3||b.reviewer.length>120
  ||typeof b.note!=='string'||b.note.trim().length<10||b.note.length>2000||b.social!==true||b.economic!==true||b.manifest!==true
  ||typeof b.historyConfirmed!=='boolean'||(b.historySnapshot!==null&&(typeof b.historySnapshot!=='object'||Array.isArray(b.historySnapshot)||b.historyConfirmed!==true||!isUuid(b.historySnapshot.previous_id??'')))
  ||(independent&&(typeof b.versionedHistoryConfirmed!=='boolean'||(b.versionedHistorySnapshot!==null&&(typeof b.versionedHistorySnapshot!=='object'||Array.isArray(b.versionedHistorySnapshot)||b.versionedHistoryConfirmed!==true||!isUuid(b.versionedHistorySnapshot.previous_id??''))))))return Response.json({error:'Cal completar les comprovacions de la preparació.'},{status:400});
 const storageUrl=process.env.NEXT_PUBLIC_SUPABASE_URL,serviceKey=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!storageUrl||!serviceKey)return Response.json({error:'No es pot verificar la font.'},{status:503});
 const db=createServerSupabase();
 // One deadline covers preflight, every RPC and physical verification. An
 // aborted wait cannot cancel an SQL transaction already running remotely.
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),ARCHIVE_REQUEST_TIMEOUT_MS);
 const abort=()=>controller.abort();request.signal.addEventListener('abort',abort,{once:true});if(request.signal.aborted)controller.abort();
 try{
  await boundedPreparationRpc(()=>requireConsistentConveniReads(db),controller.signal);
  if(independentConveniReadersEnabled()){
   const preview=await boundedPreparationRpc(async()=>await db.rpc('conveni_independent_decision_candidate',{p_record:id,p_job:b.jobId,p_unit:b.unitId}),controller.signal);
   if(preview.error)return Response.json({error:'No es pot comprovar la revisió anterior.'},{status:503});
   if(preview.data?.pendingReason&&preview.data.pendingReason!=='HISTORY_VERSIONED_UNCONFIRMED')return Response.json({error:independentPendingMessage(preview.data.pendingReason)},{status:409});
   if((preview.data?.previousId??null)!==(b.versionedHistorySnapshot?.previous_id??null))return Response.json({error:'L’historial versionat ha canviat; torna’l a carregar i contrastar.'},{status:409});
  }
  const rpc=async<T>(name:string,args:Record<string,unknown>)=>boundedPreparationRpc(async()=>{const r=await db.rpc(name,args);if(r.error)throw r.error;return r.data as T;},controller.signal);
  if(firstGuardEnabled()){
   const {operationId,ackId,draftId,receiptId,linkId,...payload}=b,attempt=randomUUID(),versioned=independent&&b.versionedHistorySnapshot!==null;
   const operation=await rpc<{id:string;ids:{ackId:string;draftId:string;receiptId:string;linkId:string};state:string}>('conveni_first_guard_begin',{p_attempt:attempt,p_record:id,p_job:b.jobId,p_unit:b.unitId,p_operation:operationId,p_mode:versioned?'versioned':'first',p_previous:versioned?b.versionedHistorySnapshot.previous_id:null,p_payload:payload,p_ids:{ackId,draftId,receiptId,linkId}});
   if(!operation||!isUuid(operation.id)||!operation.ids||![operation.ids.ackId,operation.ids.draftId,operation.ids.receiptId,operation.ids.linkId].every(isUuid))throw Error('operation invalid');
   if(operation.state==='ready')return Response.json({prepared:true});
   if(operation.state!=='pending')throw Error('operation state invalid');
   const step=<T>(action:string,value:unknown=null)=>rpc<T>('conveni_first_guard_step',{p_attempt:attempt,p_action:action,p_value:value});
   if(versioned)await step('ack');
   if(b.historySnapshot!==null)await step(versioned?'native_ack':'ack');
   await step('prepare');
   if(versioned)await step('bind');
   const copy=createFirstCopyPreparer({storage:{storageUrl,serviceKey},
    plan:()=>step<CopyPlan>('copy_plan'),finishPlan:(_draft,plan)=>step<Snapshot>('copy_finish',plan),
    find:()=>step<Receipt|null>('find_receipt'),save:(_event,_draft,snapshot)=>step<Receipt>('save_receipt',snapshot)});
   await copy({draftId:operation.ids.draftId,eventId:operation.ids.receiptId},controller.signal);
   await step('link');await step('ready');
   return Response.json({prepared:true});
  }
  const {operationId,ackId,draftId,receiptId,linkId,...payload}=b;
  const versioned=independent&&b.versionedHistorySnapshot!==null;
  const operation=await rpc<{id:string;ids:{ackId:string;draftId:string;receiptId:string;linkId:string};state:string}>(versioned?'conveni_independent_preparation_begin':'conveni_first_operation_begin',{p_record:id,p_job:b.jobId,p_unit:b.unitId,p_operation:operationId,p_payload:payload,p_ids:{ackId,draftId,receiptId,linkId},...(versioned?{p_previous:b.versionedHistorySnapshot.previous_id}:{})});
  if(!operation||!isUuid(operation.id)||!operation.ids||![operation.ids.ackId,operation.ids.draftId,operation.ids.receiptId,operation.ids.linkId].every(isUuid))throw Error('operation invalid');
  if(operation.state==='ready')return Response.json({prepared:true});
  if(operation.state!=='pending')throw Error('operation state invalid');
  const ids=operation.ids;const guarded=!versioned&&coverageEnabled&&process.env.CONVENI_ECONOMIC_RECONCILIATION_ENABLED==='true';
  if(versioned)await rpc('conveni_independent_guarded_ack',{p_record:id,p_job:b.jobId,p_unit:b.unitId,p_operation:operation.id});
  if(b.historySnapshot!==null){
   if(versioned)await rpc('conveni_independent_guarded_native_ack',{p_record:id,p_job:b.jobId,p_unit:b.unitId,p_operation:operation.id});
   else if(guarded)await rpc('conveni_first_guarded_ack',{p_record:id,p_job:b.jobId,p_unit:b.unitId,p_operation:operation.id});
   else await rpc('conveni_first_ack_history',{p_event:ids.ackId,p_record:id,p_job:b.jobId,p_unit:b.unitId,p_snapshot:b.historySnapshot,p_previous:b.historySnapshot.previous_id,p_reviewer:b.reviewer,p_note:b.note,p_confirmed:true});
  }
  if(versioned)await rpc('conveni_independent_guarded_prepare',{p_record:id,p_job:b.jobId,p_unit:b.unitId,p_operation:operation.id});
  else if(guarded)await rpc('conveni_first_guarded_prepare',{p_record:id,p_job:b.jobId,p_unit:b.unitId,p_operation:operation.id});
  else await rpc(coverageEnabled?'conveni_first_prepare_draft_coverage':'conveni_first_prepare_draft',{p_record:id,p_job:b.jobId,p_unit:b.unitId,p_event:ids.draftId,p_ack:b.historySnapshot?ids.ackId:null,p_monetary:b.monetaryId,p_identity:b.identityId,p_role_period:b.rolePeriodId,p_literal:b.literal,p_reviewer:b.reviewer,p_note:b.note,p_social:true,p_economic:true,p_manifest:true,...(coverageEnabled?{p_coverage:b.coverageIds}:{})});
  if(versioned)await rpc('conveni_independent_guarded_bind_ack',{p_record:id,p_job:b.jobId,p_unit:b.unitId,p_operation:operation.id});
  const copy=createFirstCopyPreparer({storage:{storageUrl,serviceKey},
   plan:draft=>rpc<CopyPlan>('conveni_first_copy_plan',{p_record:id,p_draft:draft}),
   finishPlan:(draft,plan)=>rpc<Snapshot>('conveni_first_copy_finish',{p_record:id,p_draft:draft,p_plan:plan}),
   find:(event,draft)=>rpc<Receipt|null>('conveni_first_receipt_find',{p_record:id,p_event:event,p_draft:draft}),
   save:(event,draft,snapshot)=>rpc<Receipt>('conveni_first_receipt_save',{p_record:id,p_event:event,p_draft:draft,p_snapshot:snapshot})});
  await copy({draftId:ids.draftId,eventId:ids.receiptId},controller.signal);
  await rpc('conveni_first_link_draft',{p_record:id,p_event:ids.linkId,p_draft:ids.draftId,p_receipt:ids.receiptId,p_monetary:b.monetaryId,p_identity:b.identityId,p_role_period:b.rolePeriodId,p_reviewer:b.reviewer,p_note:b.note,p_social:true,p_economic:true,p_manifest:true});
  await rpc(versioned?'conveni_independent_preparation_ready':'conveni_first_operation_ready',{p_record:id,p_job:b.jobId,p_unit:b.unitId,p_operation:operation.id});
  return Response.json({prepared:true});
 }catch(e){
  if(e instanceof ConveniIndependentReadUnavailable)return Response.json({error:e.message},{status:503});
  const m=typeof e==='object'&&e!==null&&'message' in e?String(e.message):'';
  if(firstGuardEnabled()&&m.includes('VERSIONED_OPERATION_SUPERSEDED'))return Response.json({error:'L’historial de la unitat ha canviat. La preparació està pendent de revisió.'},{status:409});
  if(firstGuardEnabled()&&m.includes('FIRST_ATTEMPT_RECEIPT_RECONCILIATION_REQUIRED'))return Response.json({error:'Ja existeix un comprovant que no s’ha pogut verificar en aquesta preparació. Cal revisar-lo abans de continuar.'},{status:409});
  if(firstGuardEnabled()&&m.includes('FIRST_ATTEMPT_OUTCOME_UNCERTAIN'))return Response.json({error:'Una preparació anterior pot continuar en curs. El resultat està pendent de revisió i no es pot tornar a iniciar.'},{status:409});
  if(firstGuardEnabled()&&(m.includes('FIRST_ATTEMPT_CONFIGURATION_MISMATCH')||m.includes('FIRST_ATTEMPT_ISOLATION')))return Response.json({error:'No es pot verificar la configuració de la preparació.'},{status:503});
  return Response.json({error:preparationErrorMessage(e)},{status:409});
 }
 finally{clearTimeout(timer);request.signal.removeEventListener('abort',abort);}
}

/** Reconciliation is intentionally separate from retry. SQL permits it only
 * for a freshly revalidated missing-document error with no persisted effects. */
export async function DELETE(request:Request,{params}:{params:Promise<{id:string}>}){
 if(firstGuardEnabled())return Response.json({error:'La preparació està pendent de revisió; no es pot substituir automàticament.'},{status:409,headers:{'Cache-Control':'private, no-store'}});
 const configError=independentEconomicConfigurationError();if(configError)return Response.json({error:configError},{status:503,headers:{'Cache-Control':'private, no-store'}});
 if(firstGuardMisconfigured())return Response.json({error:'La protecció de la preparació no està configurada de manera coherent.'},{status:503,headers:{'Cache-Control':'private, no-store'}});
 if(process.env.CONVENI_ECONOMIC_REVIEW_ENABLED!=='true'||process.env.CONVENI_ECONOMIC_COVERAGE_ENABLED!=='true'||process.env.CONVENI_ECONOMIC_RECONCILIATION_ENABLED!=='true')return Response.json({error:'Conciliació no disponible.'},{status:404});
 const {id}=await params,b=await request.json().catch(()=>null);
 if(!isUuid(id)||!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).sort().join(',')!=='jobId,operationId,reason,unitId'||![b.jobId,b.operationId,b.unitId].every(isUuid)||typeof b.reason!=='string'||b.reason.trim().length<10||b.reason.length>2000)return Response.json({error:'Cal identificar i justificar la conciliació.'},{status:400});
 try{const db=createServerSupabase();await requireConsistentConveniReads(db);let versioned=false;
  if(independentConveniReadersEnabled()){const current=await db.rpc('conveni_independent_preparation_get',{p_record:id,p_job:b.jobId,p_unit:b.unitId});if(current.error)throw current.error;versioned=current.data?.id===b.operationId;}
  const r=await db.rpc(versioned?'conveni_independent_supersede_prewrite':'conveni_first_supersede_prewrite',{p_record:id,p_job:b.jobId,p_unit:b.unitId,p_operation:b.operationId,p_reason:b.reason});if(r.error)throw r.error;return Response.json({superseded:true},{headers:{'Cache-Control':'private, no-store'}});}catch{return Response.json({error:'No s’ha pogut confirmar que l’intent sigui substituïble. Conserva’l pendent de revisió.'},{status:409});}
}
