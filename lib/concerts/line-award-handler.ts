import {randomUUID} from 'node:crypto';
type Snapshot={document_id:string;document_path:string;document_sha256:string;unit_path:string;unit_sha256:string;source_object:string;source_version:string;item_object:string;item_version:string;population_event:string;previous_decision?:string|null;previous_decision_parent?:string|null};
type Deps={snapshot:(record:string,job:string,unit:string)=>Promise<Snapshot|null>;verify:(path:string,sha:string,signal:AbortSignal)=>Promise<void>;decide:(input:Record<string,unknown>)=>Promise<string>};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The application must authenticate the request before invoking this handler.
export async function handleAward(request:Request,record:string,unit:string,deps:Deps):Promise<Response>{
 const raw=await request.json().catch(()=>null) as Record<string,unknown>|null;
 if(!uuid.test(record)||!uuid.test(unit)||!raw||typeof raw.jobId!=='string'||!uuid.test(raw.jobId)||typeof raw.eventId!=='string'||!uuid.test(raw.eventId)||typeof raw.code!=='string'||raw.code.length<1||raw.code.length>100||typeof raw.amountLiteral!=='string'||raw.amountLiteral.length<1||raw.amountLiteral.length>64||typeof raw.quote!=='string'||raw.quote.length<1||raw.quote.length>5000||typeof raw.reason!=='string'||raw.reason.trim().length<10||raw.reason.length>2000||typeof raw.reviewer!=='string'||raw.reviewer.trim().length<3||raw.reviewer.length>200||(raw.decisionId!=null&&(typeof raw.decisionId!=='string'||!uuid.test(raw.decisionId)))||(raw.previousId!=null&&(typeof raw.previousId!=='string'||!uuid.test(raw.previousId)))||raw.award!==true||raw.recipient!==true||raw.allocation!==true)return Response.json({error:'Completa la revisió i les confirmacions.'},{status:400});
 let s:Snapshot|null;
 try{s=await deps.snapshot(record,raw.jobId,unit);}catch{return Response.json({error:'No s’ha pogut consultar l’estat de la línia. No s’ha enviat cap decisió; torna a carregar-la.',outcome:'not_sent'},{status:503});}
 try{
  if(!s||s.population_event!==raw.eventId||((raw.decisionId===s.previous_decision ? s.previous_decision_parent : s.previous_decision)??null)!==(raw.previousId??null)||!uuid.test(s.document_id)||!uuid.test(s.source_object)||!uuid.test(s.item_object)||s.source_object===s.item_object||typeof s.source_version!=='string'||!s.source_version||typeof s.item_version!=='string'||!s.item_version||! /^[a-f0-9]{64}$/.test(s.document_sha256)||s.unit_sha256!==s.document_sha256)throw Error('STALE');
  const prefix=`cases/${record}/documents/${s.document_id}/`;const item=`cases/${record}/items/${unit}/documents/${s.document_id}/`;
  if(!s.document_path.startsWith(prefix)||!new RegExp(`^${s.document_sha256}\\.[a-z0-9]+$`).test(s.document_path.slice(prefix.length))||s.unit_path!==item+s.document_path.slice(prefix.length))throw Error('STALE');
  await deps.verify(s.document_path,s.document_sha256,request.signal);await deps.verify(s.unit_path,s.unit_sha256,request.signal);
 }catch{return Response.json({error:'No s’ha pogut verificar la font, la còpia o l’estat de la línia. No s’ha enviat cap decisió; revisa la documentació i torna-ho a provar.'},{status:409});}
 const decision=typeof raw.decisionId==='string'&&uuid.test(raw.decisionId)?raw.decisionId:randomUUID();
 try{
  const result=await deps.decide({p_record:record,p_job:raw.jobId,p_unit:unit,p_decision:decision,p_population:raw.eventId,p_code:raw.code,p_amount_literal:raw.amountLiteral,p_quote:raw.quote,p_note:raw.reason,p_reviewer:raw.reviewer,p_confirmations:{award:true,recipient:true,allocation:true},p_source_object:s.source_object,p_source_version:s.source_version,p_item_object:s.item_object,p_item_version:s.item_version,p_previous:raw.previousId??null});
  if(result!==decision)throw Error('STALE');return Response.json({decisionId:decision});
 }catch{return Response.json({error:'No s’ha pogut confirmar el resultat de la revisió. Pot haver-se desat: torna a carregar la línia i comprova’n l’estat abans de repetir-la.',outcome:'unknown'},{status:503});}
}
