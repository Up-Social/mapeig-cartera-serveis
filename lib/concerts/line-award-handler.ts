import {randomUUID} from 'node:crypto';
export type AwardSnapshot={document_id:string;document_path:string;document_sha256:string;unit_path:string;unit_sha256:string;source_object:string;source_version:string;item_object:string;item_version:string;population_event:string;previous_decision?:string|null;previous_decision_parent?:string|null};
type Deps={snapshot:(record:string,job:string,unit:string)=>Promise<AwardSnapshot|null>;capture:(snapshot:AwardSnapshot,signal:AbortSignal)=>Promise<Uint8Array>;retain:(record:string,job:string,unit:string,snapshot:AwardSnapshot,bytes:Uint8Array,signal:AbortSignal)=>Promise<void>;decide:(input:Record<string,unknown>)=>Promise<string>};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const knownDecisionErrors:Record<string,string>={
 LINE_STORAGE_STALE:'La font o la còpia de la línia ha canviat. Torna a carregar-la i comprova la documentació.',
 LINE_RETAINED_BYTES_REQUIRED:'No consta una còpia documental verificada per a aquesta revisió. Torna a carregar la línia.',
 LINE_POPULATION_STALE:'L’observació de població ha canviat. Actualitza-la abans de tornar a revisar la línia.',
 LINE_JOB:'Hi ha un processament més recent o el treball ja no es pot revisar. Torna a carregar el cas.',
 LINE_EVIDENCE:'La cita, l’import, el servei o la identitat no coincideixen amb la font de la línia. Contrasta les dades indicades.',
 LINE_SERVICE_CORRECTION_STALE:'La correcció del codi de servei ja no és vigent. Revisa-la abans de continuar.',
 LINE_DIAGNOSTIC_UNRECONCILED:'L’annex encara no té una conciliació documental vigent. Torna a revisar les línies i els imports.',
 LINE_WRITES_PAUSED:'Les revisions econòmiques de Concerts estan temporalment aturades. No s’ha desat cap decisió; les dades continuen disponibles per consultar-les.',
};
const knownRetentionErrors:Record<string,string>={
 CONCERT_BYTES_STALE:'La font, la còpia o el treball han canviat. Torna a carregar la línia abans de revisar-la.',
 CONCERT_BYTES_HASH:'La còpia documental no coincideix amb l’empremta registrada. Cal recuperar i comprovar la font.',
 CONCERT_BYTES_EXTRACTION:'El text extret no coincideix amb l’empremta registrada. Cal comprovar la documentació.',
 DIAGNOSTIC_UNIT:'Una línia no coincideix amb les dades de l’annex. Contrasta les línies abans de revisar-les.',
 DIAGNOSTIC_RECONCILIATION:'Els imports de l’annex no estan conciliats. Contrasta el màxim i els imports de cada línia.',
 DIAGNOSTIC_TOTAL_COUNT:'No es poden identificar tots els subtotals de l’annex. Cal revisar el document complet.',
 DIAGNOSTIC_UNPARSED_ROW:'Hi ha una fila de l’annex que no es pot associar amb seguretat a una línia. Cal revisar-la.',
 DIAGNOSTIC_COMPONENTS:'No es pot confirmar com s’agrupen els components d’una línia. Cal revisar la taula.',
 DIAGNOSTIC_PAGE_TOTAL:'El subtotal d’una pàgina no es pot contrastar amb la seva línia. Cal revisar l’annex.',
 DIAGNOSTIC_ACT:'El document no acredita una adjudicació definitiva amb aquest format. Cal revisar l’acte.',
};
// The application must authenticate the request before invoking this handler.
export async function handleAward(request:Request,record:string,unit:string,deps:Deps):Promise<Response>{
 const raw=await request.json().catch(()=>null) as Record<string,unknown>|null;
 if(!uuid.test(record)||!uuid.test(unit)||!raw||typeof raw.jobId!=='string'||!uuid.test(raw.jobId)||typeof raw.eventId!=='string'||!uuid.test(raw.eventId)||typeof raw.code!=='string'||raw.code.length<1||raw.code.length>100||typeof raw.amountLiteral!=='string'||raw.amountLiteral.length<1||raw.amountLiteral.length>64||typeof raw.quote!=='string'||raw.quote.length<1||raw.quote.length>5000||typeof raw.reason!=='string'||raw.reason.trim().length<10||raw.reason.length>2000||typeof raw.reviewer!=='string'||raw.reviewer.trim().length<3||raw.reviewer.length>200||(raw.decisionId!=null&&(typeof raw.decisionId!=='string'||!uuid.test(raw.decisionId)))||(raw.previousId!=null&&(typeof raw.previousId!=='string'||!uuid.test(raw.previousId)))||raw.award!==true||raw.recipient!==true||raw.allocation!==true)return Response.json({error:'Completa la revisió i les confirmacions.'},{status:400});
 let s:AwardSnapshot|null;let bytes:Uint8Array;
 try{s=await deps.snapshot(record,raw.jobId,unit);}catch{return Response.json({error:'No s’ha pogut consultar l’estat de la línia. No s’ha enviat cap decisió; torna a carregar-la.',outcome:'not_sent'},{status:503});}
 try{
  if(!s||s.population_event!==raw.eventId||((raw.decisionId===s.previous_decision ? s.previous_decision_parent : s.previous_decision)??null)!==(raw.previousId??null)||!uuid.test(s.document_id)||!uuid.test(s.source_object)||!uuid.test(s.item_object)||s.source_object===s.item_object||typeof s.source_version!=='string'||!s.source_version||typeof s.item_version!=='string'||!s.item_version||! /^[a-f0-9]{64}$/.test(s.document_sha256)||s.unit_sha256!==s.document_sha256)throw Error('STALE');
  const prefix=`cases/${record}/documents/${s.document_id}/`;const item=`cases/${record}/items/${unit}/documents/${s.document_id}/`;
  if(!s.document_path.startsWith(prefix)||!new RegExp(`^${s.document_sha256}\\.[a-z0-9]+$`).test(s.document_path.slice(prefix.length))||s.unit_path!==item+s.document_path.slice(prefix.length))throw Error('STALE');
  bytes=await deps.capture(s,request.signal);
 }catch{return Response.json({error:'No s’ha pogut verificar la font, la còpia o l’estat de la línia. No s’ha enviat cap decisió; revisa la documentació i torna-ho a provar.'},{status:409});}
 try{await deps.retain(record,raw.jobId,unit,s,bytes,request.signal);if(request.signal.aborted)throw Error('ABORTED');}
 catch(cause){
  const reason=cause&&typeof cause==='object'&&'code' in cause&&cause.code==='55P03'?'Una altra operació està modificant aquest expedient. Torna-ho a provar.':cause&&typeof cause==='object'&&'code' in cause&&cause.code==='P0001'&&'message' in cause&&typeof cause.message==='string'&&Object.hasOwn(knownRetentionErrors,cause.message)?knownRetentionErrors[cause.message]:null;
  return Response.json({error:reason?`${reason} No s’ha enviat cap decisió.`:'No s’ha pogut confirmar la conservació de l’evidència. No s’ha enviat cap decisió; torna a carregar la línia abans de provar-ho de nou.',outcome:'not_sent'},{status:reason?409:503});
 }
 const decision=typeof raw.decisionId==='string'&&uuid.test(raw.decisionId)?raw.decisionId:randomUUID();
 try{
  const result=await deps.decide({p_record:record,p_job:raw.jobId,p_unit:unit,p_decision:decision,p_population:raw.eventId,p_code:raw.code,p_amount_literal:raw.amountLiteral,p_quote:raw.quote,p_note:raw.reason,p_reviewer:raw.reviewer,p_confirmations:{award:true,recipient:true,allocation:true},p_source_object:s.source_object,p_source_version:s.source_version,p_item_object:s.item_object,p_item_version:s.item_version,p_previous:raw.previousId??null});
  if(result!==decision)throw Error('STALE');return Response.json({decisionId:decision});
 }catch(cause){
  // A whitelisted PostgreSQL exception is a confirmed transaction rollback.
  // Transport errors and unexpected responses can have committed and stay uncertain.
  if(cause&&typeof cause==='object'&&'code' in cause&&cause.code==='55P03')return Response.json({error:'Una altra operació està modificant aquest expedient. No s’ha desat la revisió; torna-ho a provar.',outcome:'rolled_back'},{status:409});
  if(cause&&typeof cause==='object'&&'code' in cause&&cause.code==='P0001'&&'message' in cause&&typeof cause.message==='string'&&Object.hasOwn(knownDecisionErrors,cause.message))return Response.json({error:knownDecisionErrors[cause.message],outcome:'rolled_back'},{status:409});
  return Response.json({error:'No s’ha pogut confirmar el resultat de la revisió. Pot haver-se desat: torna a carregar la línia i comprova’n l’estat abans de repetir-la.',outcome:'unknown'},{status:503});
 }
}
