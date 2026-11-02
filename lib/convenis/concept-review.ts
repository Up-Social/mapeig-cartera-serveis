import {isUuid} from '../uuid';
import type {Citation} from './contract';
const uuid=(value:unknown):value is string=>typeof value==='string'&&isUuid(value);
export type ConceptReviewRequest={
 action:'review-concept';jobId:string;unitId:string;eventId:string;conceptIndex:number;
 previousConceptReviewId:string|null;parentReviewId:string|null;conceptHash:string;sourceHash:string;
 documentRevisions:Record<string,string>;outcome:'select'|'outside'|'reject'|'insufficient';
 serviceCode:string|null;note:string;citation:Citation;socialConfirmed:boolean;
};
/** API validation is defensive; all documentary and concurrency checks are
 * repeated atomically by review_conveni_concept in PostgreSQL. */
export function parseConceptReview(value:unknown):ConceptReviewRequest {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Revisió de concepte invàlida');
 const b=value as Record<string,unknown>;
 const previous=b.previousConceptReviewId??null,parent=b.parentReviewId??null;
 if(b.action!=='review-concept'||!uuid(b.jobId)||!uuid(b.unitId)||!uuid(b.eventId)
  ||!Number.isSafeInteger(b.conceptIndex)||Number(b.conceptIndex)<0||Number(b.conceptIndex)>499
  ||(previous!==null&&!uuid(previous))||(parent!==null&&!uuid(parent))
  ||typeof b.conceptHash!=='string'||!/^[a-f0-9]{64}$/.test(b.conceptHash)
  ||typeof b.sourceHash!=='string'||!/^[a-f0-9]{32}$/.test(b.sourceHash)
  ||!b.documentRevisions||typeof b.documentRevisions!=='object'||Array.isArray(b.documentRevisions)
  ||Object.entries(b.documentRevisions).some(([id,revision])=>!uuid(id)||typeof revision!=='string'||!revision)
  ||typeof b.note!=='string'||b.note.trim().length<10
  ||!['select','outside','reject','insufficient'].includes(String(b.outcome))
  ||typeof b.socialConfirmed!=='boolean')throw Error('Revisió de concepte invàlida o obsoleta');
 const positive=b.outcome==='select'||b.outcome==='outside';
 if((positive&&!b.socialConfirmed)||(!positive&&b.socialConfirmed))throw Error('Confirmació social incompatible');
 if(b.outcome==='select'&&(typeof b.serviceCode!=='string'||!b.serviceCode.trim()))throw Error('Cal seleccionar un servei');
 const citation=b.citation as Record<string,unknown>|null;
 if(!citation||typeof citation!=='object'||Array.isArray(citation)||!uuid(citation.document_id)||!Number.isSafeInteger(citation.page)||Number(citation.page)<1||Number(citation.page)>999999||typeof citation.quote!=='string'||citation.quote.trim().length<12)throw Error('Cal seleccionar una cita documental del concepte');
 return {...b,previousConceptReviewId:previous,parentReviewId:parent,serviceCode:b.outcome==='select'?b.serviceCode:null} as ConceptReviewRequest;
}
/** Construct the exact database contract without deriving any economic value. */
export function conceptReviewRpcArgs(recordId:string,request:ConceptReviewRequest) {
 if(!uuid(recordId))throw Error('Registre invàlid');
 return {p_record:recordId,p_job:request.jobId,p_unit:request.unitId,p_index:request.conceptIndex,p_event:request.eventId,
  p_previous:request.previousConceptReviewId,p_parent_review:request.parentReviewId,p_expected_hash:request.conceptHash,
  p_source_hash:request.sourceHash,p_revisions:request.documentRevisions,p_outcome:request.outcome,p_code:request.serviceCode,
  p_note:request.note,p_citation:request.citation,p_social_confirmed:request.socialConfirmed};
}

/** Historical events never become current merely because an ID is present. */
export function conceptReviewState(reviewId:unknown,isCurrent:unknown,outcome:unknown,hasHistory=false):'pending'|'historical'|'current'|'incomplete'|'stale' {
 if(!reviewId)return hasHistory?'historical':'pending';
 if(isCurrent!==true)return 'stale';
 if(outcome==='insufficient')return 'incomplete';
 return ['select','outside','reject'].includes(String(outcome))?'current':'stale';
}
