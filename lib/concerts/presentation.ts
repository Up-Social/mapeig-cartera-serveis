import {extractProgramAnnex,type ProgramLine} from './program-annex';
import {extractConcertChangeRows} from './change-extraction';
import {extractColumnAnnexRows,extractColumnSupportObservations,storedAmountCents} from './annex-extraction';
import {hasCurrentTextCoverage} from '../pipeline/document-input';

type DisplayUnit={id:string;document_id:string|null;page:number|null;provider_nif:string|null;reses_code:string|null;provider_name:string|null;observed_provider_name:string|null;status:string;pipeline_job_id?:string|null;recovered_provider_name?:string|null;recovered_service_name?:string|null};
/** Display-only recovery from the same document and exact documentary identity.
 * Never changes observations, reviews, financial inputs or source fingerprints. */
export function recoverConcertDisplayNames<T extends DisplayUnit>(units:T[],documents:Array<{id:string;extracted_text:string|null}>):T[]{
 const parsed=new Map<string,ProgramLine[]>();
 return units.map(unit=>{
  if(unit.status!=='draft'||unit.pipeline_job_id||unit.provider_name||!unit.document_id)return unit;
  if(!parsed.has(unit.document_id))parsed.set(unit.document_id,extractProgramAnnex(documents.find(d=>d.id===unit.document_id)?.extracted_text??''));
  const matches=parsed.get(unit.document_id)!.filter(r=>r.nif===unit.provider_nif&&r.resesCode===unit.reses_code&&r.page===unit.page);
  if(matches.length!==1)return unit;
  const row=matches[0];
  return {...unit,recovered_provider_name:row.observedProviderName!==unit.observed_provider_name?row.observedProviderName:null,recovered_service_name:row.observedServiceName};
 });
}

type ChangeUnit={id:string;document_id:string|null;page:number|null;provider_nif:string|null;reses_code:string|null;observed_service_code:string|null;amount:number|string|null;quantity_delta:number|null;evidence_quote:string|null;storage_sha256:string|null;act_type:string;centre:string|null};
type ChangeDocument={id:string;extracted_text:string|null;storage_sha256:string|null;extraction_method:string|null;extraction_coverage:unknown;mime_type:string|null;extraction_partial:boolean|null;quality_flags:string[]|null};
/** A page-local printed name is an observation, not a verified centre. Match
 * the complete existing economic anchor and reject ambiguous rows. */
export function recoverPrintedServiceCandidates<T extends ChangeUnit>(units:T[],documents:ChangeDocument[]):Array<T&{printed_service_candidate?:{name:string;page:number}}>{
 const parsed=new Map<string,ReturnType<typeof extractConcertChangeRows>>();
 const quote=(s:string)=>s.replace(/\s+/g,' ').trim();
 const anchor=(u:ChangeUnit)=>JSON.stringify([u.document_id,u.storage_sha256,u.page,u.provider_nif,u.reses_code,u.observed_service_code,u.quantity_delta,storedAmountCents(u.amount,true),u.evidence_quote?quote(u.evidence_quote):null]);
 const counts=new Map<string,number>();
 for(const unit of units){const key=anchor(unit);counts.set(key,(counts.get(key)??0)+1);}
 return units.map(unit=>{
  if(unit.centre||unit.act_type!=='modification'||!unit.document_id||!unit.page||!unit.provider_nif||!unit.reses_code||!unit.observed_service_code||!unit.evidence_quote||!unit.storage_sha256||!/^[0-9a-f]{64}$/.test(unit.storage_sha256)||unit.quantity_delta==null)return unit;
  const doc=documents.find(d=>d.id===unit.document_id);
  if(!doc?.extracted_text||doc.storage_sha256!==unit.storage_sha256||doc.extraction_partial!==false||doc.quality_flags?.some(flag=>['corrupt_text','incomplete_extraction'].includes(flag))||!hasCurrentTextCoverage(doc.extraction_method,doc.extraction_coverage,doc.mime_type,doc.extraction_partial))return unit;
  if(!parsed.has(doc.id))parsed.set(doc.id,extractConcertChangeRows(doc.extracted_text));
  const amount=storedAmountCents(unit.amount,true);
  const matches=parsed.get(doc.id)!.filter(row=>row.page===unit.page&&row.nif===unit.provider_nif&&row.resesCode===unit.reses_code&&row.observedServiceCode===unit.observed_service_code&&row.quantityDelta===unit.quantity_delta&&row.amountCents===amount&&quote(row.quote)===quote(unit.evidence_quote!));
  if(matches.length!==1||!matches[0].centreObservation)return unit;
  // A single printed row must not be lent to two distinct stored units, even
  // when one of those units already has a reviewed centre or another status.
  if(counts.get(anchor(unit))!==1)return unit;
  return {...unit,printed_service_candidate:{name:matches[0].centreObservation.centre,page:matches[0].page}};
 });
}

type SupportUnit={id:string;unit_key:string;document_id:string|null;storage_sha256:string|null;page:number|null;provider_nif:string|null;reses_code:string|null;observed_service_code:string|null;quantity:number|null;amount:number|string|null;evidence_quote:string|null};
/** Read-only candidate from the printed cell. Neither metadata checks nor this
 * comparison verify the physical bytes or prove extraction provenance. */
export function recoverPrintedSupportCandidates<T extends SupportUnit>(units:T[],documents:ChangeDocument[]):Array<T&{printed_support_candidate?:{value:string;page:number}}>{
 const parsed=new Map<string,{rows:ReturnType<typeof extractColumnAnnexRows>;support:ReturnType<typeof extractColumnSupportObservations>}>();
 const quote=(s:string)=>s.replace(/\s+/g,' ').trim();
 const anchor=(u:SupportUnit)=>JSON.stringify([u.document_id,u.storage_sha256,u.page,u.provider_nif,u.reses_code,u.observed_service_code,u.quantity,u.amount===null?null:storedAmountCents(u.amount),u.evidence_quote?quote(u.evidence_quote):null]);
 const counts=new Map<string,number>();
 for(const unit of units){const key=anchor(unit);counts.set(key,(counts.get(key)??0)+1);}
 return units.map(unit=>{
  if(!unit.document_id||!unit.storage_sha256||!/^[0-9a-f]{64}$/.test(unit.storage_sha256)||!unit.page||!unit.provider_nif||!unit.reses_code||!unit.observed_service_code||!unit.evidence_quote||!Number.isSafeInteger(unit.quantity)||(unit.quantity??0)<1||(unit.amount!==null&&storedAmountCents(unit.amount)===null)||counts.get(anchor(unit))!==1)return unit;
  const docs=documents.filter(d=>d.id===unit.document_id);
  if(docs.length!==1)return unit;
  const doc=docs[0];
  if(!doc.extracted_text||doc.storage_sha256!==unit.storage_sha256||doc.mime_type!=='application/pdf'||doc.extraction_partial!==false||!Array.isArray(doc.quality_flags)||doc.quality_flags.some(flag=>['corrupt_text','incomplete_extraction'].includes(flag))||typeof doc.extraction_coverage!=='object'||doc.extraction_coverage===null||!('complete' in doc.extraction_coverage)||doc.extraction_coverage.complete!==true||!hasCurrentTextCoverage(doc.extraction_method,doc.extraction_coverage,doc.mime_type,doc.extraction_partial))return unit;
  if(!parsed.has(doc.id))parsed.set(doc.id,{rows:extractColumnAnnexRows(doc.extracted_text),support:extractColumnSupportObservations(doc.extracted_text)});
  const data=parsed.get(doc.id)!;
  const matches=data.rows.filter(row=>row.page===unit.page&&row.nif===unit.provider_nif&&row.resesCode===unit.reses_code&&row.observedServiceCode===unit.observed_service_code&&row.quantity===unit.quantity&&row.amountCents===(unit.amount===null?null:storedAmountCents(unit.amount))&&quote(row.quote)===quote(unit.evidence_quote!));
  if(matches.length!==1||unit.unit_key!==`official-annex:${unit.storage_sha256}:0:${matches[0].row}`)return unit;
  const support=data.support.filter(item=>item.page===matches[0].page&&item.row===matches[0].row&&item.resesCode===matches[0].resesCode);
  if(support.length!==1)return unit;
  return {...unit,printed_support_candidate:{value:support[0].value,page:support[0].page}};
 });
}
