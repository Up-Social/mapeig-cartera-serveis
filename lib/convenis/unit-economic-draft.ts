import {isUuid} from '../uuid';
import type {Citation} from './contract';
import {groupLiteralCents} from './group-preparation';
import {quoteHasAmountLiteral} from './economic-citation';

// These are reviewer assertions, not facts established by this parser.
export const UNIT_ECONOMIC_CONFIRMATIONS = [
 'public_contribution', 'recipient_role', 'period', 'not_shared_or_maximum',
 'conditions_preserved', 'not_payment',
] as const;
type Confirmation = typeof UNIT_ECONOMIC_CONFIRMATIONS[number];
export type UnitEconomicDraftRequest = {
 action:'prepare-unit-economic-draft'; jobId:string; unitId:string; eventId:string;
 previousDraftId:string|null; parentReviewId:string|null; sourceHash:string;
 proposalHash:string; analysisHash:string; documentRevisions:Record<string,string>;
 serviceCode:string; amountLiteral:string; amountCents:number;
 monetaryCitation:Citation; identityCitation:Citation; rolePeriodCitation:Citation;
 confirmations:Record<Confirmation,true>; note:string;
};

const uuid = (value:unknown):value is string => typeof value==='string' && isUuid(value);
const object = (value:unknown):value is Record<string,unknown> => !!value && typeof value==='object' && !Array.isArray(value);
const hash = (value:unknown, size:number):value is string => typeof value==='string' && (size===32 ? /^[a-f0-9]{32}$/ : /^[a-f0-9]{64}$/).test(value);
function parseCitation(value:unknown):Citation|null {
 if(!object(value) || !uuid(value.document_id) || !Number.isSafeInteger(value.page)
  || Number(value.page)<1 || Number(value.page)>999999 || typeof value.quote!=='string'
  || value.quote.trim().length<12 || value.quote.length>4000) return null;
 return {document_id:value.document_id,page:Number(value.page),quote:value.quote};
}

/** Input validation only. Neither documentary attribution nor Storage identity
 * is established here; this private draft must not be used as approval. */
export function parseUnitEconomicDraft(value:unknown):UnitEconomicDraftRequest {
 if(!object(value)) throw Error('Preparació econòmica invàlida');
 const b=value, previous=b.previousDraftId??null, parent=b.parentReviewId??null;
 const amount=typeof b.amountLiteral==='string'?groupLiteralCents(b.amountLiteral):null;
 const monetary=parseCitation(b.monetaryCitation), identity=parseCitation(b.identityCitation), rolePeriod=parseCitation(b.rolePeriodCitation);
 if(b.action!=='prepare-unit-economic-draft' || !uuid(b.jobId) || !uuid(b.unitId) || !uuid(b.eventId)
  || (previous!==null && (!uuid(previous) || previous===b.eventId)) || (parent!==null && !uuid(parent))
  || !hash(b.sourceHash,32) || !hash(b.proposalHash,64) || !hash(b.analysisHash,64)
  || !object(b.documentRevisions) || Object.keys(b.documentRevisions).length<1 || Object.keys(b.documentRevisions).length>502
  || Object.entries(b.documentRevisions).some(([id,revision])=>!uuid(id) || typeof revision!=='string' || !/^[a-f0-9]{64}:(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})?$/i.test(revision) || !/^[a-f0-9]{64}:/.test(revision))
  || typeof b.serviceCode!=='string' || !b.serviceCode.trim() || b.serviceCode.length>200
  || typeof b.amountLiteral!=='string' || amount===null || (b.amountCents!==undefined && b.amountCents!==amount)
  || !monetary || !identity || !rolePeriod || !quoteHasAmountLiteral(monetary.quote,b.amountLiteral)
  || [monetary,identity,rolePeriod].some(c=>!Object.hasOwn(b.documentRevisions as object,c.document_id))
  || !object(b.confirmations) || UNIT_ECONOMIC_CONFIRMATIONS.some(k=>(b.confirmations as Record<string,unknown>)[k]!==true)
  || typeof b.note!=='string' || b.note.trim().length<10 || b.note.trim().length>2000)
  throw Error('Cal documentar totes les dades i confirmacions de la preparació econòmica');
 const confirmations=Object.fromEntries(UNIT_ECONOMIC_CONFIRMATIONS.map(k=>[k,true])) as Record<Confirmation,true>;
 return {action:'prepare-unit-economic-draft',jobId:b.jobId,unitId:b.unitId,eventId:b.eventId,
  previousDraftId:previous,parentReviewId:parent,sourceHash:b.sourceHash,proposalHash:b.proposalHash,analysisHash:b.analysisHash,
  documentRevisions:Object.fromEntries(Object.entries(b.documentRevisions)) as Record<string,string>,serviceCode:b.serviceCode.trim(),
  amountLiteral:b.amountLiteral,amountCents:amount,monetaryCitation:monetary,identityCitation:identity,rolePeriodCitation:rolePeriod,
  confirmations,note:b.note.trim()};
}

/** Builds the private prototype's RPC arguments; this does not invoke it. */
export function unitEconomicDraftRpcArgs(record:string,b:UnitEconomicDraftRequest) {
 if(!uuid(record)) throw Error('Registre invàlid');
 return {p_record:record,p_job:b.jobId,p_unit:b.unitId,p_event:b.eventId,p_previous:b.previousDraftId,
  p_parent_review:b.parentReviewId,p_source_hash:b.sourceHash,p_proposal_hash:b.proposalHash,p_analysis_hash:b.analysisHash,
  p_revisions:b.documentRevisions,p_service:b.serviceCode,p_amount_cents:b.amountCents,p_amount_literal:b.amountLiteral,
  p_monetary:b.monetaryCitation,p_identity:b.identityCitation,p_role_period:b.rolePeriodCitation,
  p_confirmations:b.confirmations,p_reason:b.note};
}
