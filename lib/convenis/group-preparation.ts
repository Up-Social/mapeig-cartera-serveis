import {isUuid} from '../uuid';
import type {Citation} from './contract';
const uuid=(value:unknown):value is string=>typeof value==='string'&&isUuid(value);
export const GROUP_CONFIRMATIONS=['public_total','recipient_period','covers_concepts','same_social_service','recipient_role','conditions_preserved','not_a_sum_or_shared'] as const;
export type GroupPreparationRequest={action:'prepare-group';jobId:string;unitId:string;eventId:string;previousPreparationId:string|null;parentReviewId:string|null;groupHash:string;analysisHash:string;sourceHash:string;documentRevisions:Record<string,string>;heads:Record<string,string>;serviceCode:string;amountLiteral:string;amountCents:number;totalCitation:Citation;identityCitation:Citation;confirmations:Record<string,true>;note:string};
/** Mirrors the SQL parser's deliberately unambiguous monetary formats. */
export function groupLiteralCents(value:string):number|null {
 if(typeof value!=='string'||value.trim().length>32)return null;
 const text=value.trim().replace(/\s*€$/u,'').trim();let normalized:string;
 if(/^[0-9]+$/.test(text))normalized=`${text}.00`;
 else if(/^(?:[0-9]+|[0-9]{1,3}(?:\.[0-9]{3})+),[0-9]{2}$/.test(text))normalized=text.replaceAll('.','').replace(',','.');
 else if(/^[0-9]+\.[0-9]{2}$/.test(text))normalized=text;
 else return null;
 const [whole,fraction]=normalized.split('.');const n=BigInt(whole)*BigInt(100)+BigInt(fraction);
 return n<=BigInt(Number.MAX_SAFE_INTEGER)?Number(n):null;
}
function citation(value:unknown):value is Citation {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;const c=value as Record<string,unknown>;
 return uuid(c.document_id)&&Number.isSafeInteger(c.page)&&Number(c.page)>0&&Number(c.page)<=999999&&typeof c.quote==='string'&&c.quote.trim().length>=12;
}
export function parseGroupPreparation(value:unknown):GroupPreparationRequest {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Preparació de grup invàlida');const b=value as Record<string,unknown>;
 const previous=b.previousPreparationId??null,parent=b.parentReviewId??null;
 if(b.action!=='prepare-group'||!uuid(b.jobId)||!uuid(b.unitId)||!uuid(b.eventId)||(previous!==null&&!uuid(previous))||(parent!==null&&!uuid(parent))
  ||typeof b.groupHash!=='string'||!/^[a-f0-9]{64}$/.test(b.groupHash)||typeof b.analysisHash!=='string'||!/^[a-f0-9]{64}$/.test(b.analysisHash)||typeof b.sourceHash!=='string'||!/^[a-f0-9]{32}$/.test(b.sourceHash)
  ||!b.documentRevisions||typeof b.documentRevisions!=='object'||Array.isArray(b.documentRevisions)||Object.entries(b.documentRevisions).some(([id,v])=>!uuid(id)||typeof v!=='string'||!v)
  ||!b.heads||typeof b.heads!=='object'||Array.isArray(b.heads)||Object.keys(b.heads).length<2||Object.keys(b.heads).length>500||Object.entries(b.heads).some(([i,v])=>!/^\d+$/.test(i)||!uuid(v))
  ||typeof b.serviceCode!=='string'||!b.serviceCode.trim()||typeof b.amountLiteral!=='string'||groupLiteralCents(b.amountLiteral)===null
  ||!citation(b.totalCitation)||!citation(b.identityCitation)||!b.confirmations||typeof b.confirmations!=='object'||Array.isArray(b.confirmations)
  ||GROUP_CONFIRMATIONS.some(key=>(b.confirmations as Record<string,unknown>)[key]!==true)||typeof b.note!=='string'||b.note.trim().length<10)throw Error('Cal documentar totes les dades i confirmacions de la preparació');
 return {...b,previousPreparationId:previous,parentReviewId:parent,amountCents:groupLiteralCents(b.amountLiteral)!} as GroupPreparationRequest;
}
export function groupPreparationRpcArgs(record:string,b:GroupPreparationRequest,archive:unknown){
 if(!uuid(record))throw Error('Registre invàlid');
 return {p_record:record,p_job:b.jobId,p_unit:b.unitId,p_event:b.eventId,p_previous:b.previousPreparationId,p_parent_review:b.parentReviewId,p_group_hash:b.groupHash,p_analysis_hash:b.analysisHash,p_source_hash:b.sourceHash,p_revisions:b.documentRevisions,p_heads:b.heads,p_code:b.serviceCode,p_amount_cents:b.amountCents,p_amount_literal:b.amountLiteral,p_total_citation:b.totalCitation,p_identity_citation:b.identityCitation,p_confirmations:b.confirmations,p_note:b.note,p_archive_snapshot:archive};
}
export type CurrentConceptHead={concept_index:number;review_id:string|null;review_is_current:boolean;outcome:string|null;reviewed_code:string|null;selected_citation:{document_id:string}|null};
/** Verify the complete set before reading bytes. SQL repeats this check under lock. */
export function selectedGroupDocuments(b:GroupPreparationRequest,concepts:CurrentConceptHead[]):string[] {
 const seen=new Set<number>();
 if(concepts.length!==Object.keys(b.heads).length||concepts.some(item=>{
  if(!Number.isSafeInteger(item.concept_index)||seen.has(item.concept_index))return true;seen.add(item.concept_index);
  return !item.review_is_current||item.outcome!=='select'||item.reviewed_code!==b.serviceCode||item.review_id!==b.heads[String(item.concept_index)]||!item.selected_citation||!uuid(item.selected_citation.document_id);
 }))throw Error('Cal revisar tots els conceptes amb el mateix servei abans de preparar el total');
 return [...new Set([b.totalCitation.document_id,b.identityCitation.document_id,...concepts.map(item=>item.selected_citation!.document_id)])];
}
