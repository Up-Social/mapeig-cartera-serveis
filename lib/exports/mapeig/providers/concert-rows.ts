import {concertCase,type ConcertCaseKey} from '@/lib/concerts/case-labels';
import {concertLineHref} from '@/lib/concerts/display-name';
import {currentDocumentTextConsistent} from '@/lib/concerts/document-text-integrity';
import {ECONOMIC_AMOUNT_LABELS,euroCents} from '@/lib/concerts/evolution';
import {municipalityReference} from '@/lib/concerts/geography';
import {printedOriginalSignatureDates,proposedConcertAwardDate} from '@/lib/concerts/proposed-award-date';
import {summarizeSignatureObservations,type SignatureObservation} from '@/lib/concerts/signature-observations';
import {economicConcertTerritory,type ReviewedConcertGeography} from '@/lib/concerts/supplemental-geography-projection';
import type {SourceDocument} from '@/lib/workbench-types';
import {OBSERVATIONS_KEY} from '../workbook';
import {MAPEIG_PROVINCES,type DetallRegistresRow,type ExtraColumn,type MapeigProvince,type ProviderResult} from '../types';

/** Rows read from the database, kept close to the table columns so the pure
 * mapping below can be tested without services. */
export type ConcertUnitRow={
 id:string;source_record_id:string;unit_key:string;provider_name:string|null;provider_nif:string|null;observed_provider_name:string|null;observed_service_name:string|null;
 service_code:string|null;catalog_version_id:string|null;observed_service_code:string|null;reses_code:string|null;amount:number|string|null;act_type:string;status:string;
 effective_start:string|null;effective_end:string|null;period:string|null;quantity:number|null;quantity_delta:number|null;territory:string|null;municipality:string|null;centre:string|null;
 document_id:string|null;page:number|null;pipeline_job_id:string|null;horizon_state:string|null;review_note:string|null;
};
export type ConcertRecordRow={id:string;source_record_id:string;title:string|null;record_url:string|null};
export type ConcertReviewRow={unit_id:string;version:number;status:'draft'|'approved'|'excluded';source_fingerprint:string;expected_job_id:string;operation:string;amount_cents:number|null;amount_kind:'exact'|'maximum'|'unknown';period_start:string|null;period_end:string|null;effective_at:string|null;funder:string|null};
export type ConcertGeographyRow={unit_id:string;municipality:string|null;county:string|null;province:string|null};
export type ConcertCorrectionRow={source_record_id:string;unit_id:string|null;field:string;value:string;valid:boolean};
export type ConcertPopulationRow={unit_id:string;job_id:string;sequence:number;decision:'confirmed'|'unknown';value:string|null};
export type ConcertJobRow={id:string;source_record_id:string;status:string};
export type ConcertEnrichmentRow={source_record_id:string;award_date:string|null;contracting_body:string|null;target_population:string|null;scope_facts:unknown};
export type ConcertProvisionRow={source_record_id:string;unit_id:string|null;award_date:string|null;contracting_body:string|null;target_population:string|null;call_url:string|null};
export type ConcertDocumentRow={
 id:string;source_record_id:string;url:string;document_type:string;source_fields:string[]|null;status:string;mime_type:string|null;storage_path:string|null;storage_sha256:string|null;
 active_extraction_id:string|null;extracted_text:string|null;extracted_text_hash:string|null;extraction_method:string|null;extraction_partial:boolean|null;extraction_coverage:unknown;quality_flags:string[]|null;
};
export type ConcertSignatureRow=SignatureObservation&{source_record_id:string};
export type ConcertMapeigData={
 units:ConcertUnitRow[];records:ConcertRecordRow[];reviews:ConcertReviewRow[];geography:ConcertGeographyRow[];supplemental:ReviewedConcertGeography[];
 corrections:ConcertCorrectionRow[];populations:ConcertPopulationRow[];latestJobs:ConcertJobRow[];enrichments:ConcertEnrichmentRow[];provisions:ConcertProvisionRow[];
 documents:ConcertDocumentRow[];signatures:ConcertSignatureRow[];
 gates:{supplementalGeography:boolean;signatureDates:boolean;printedDates:boolean};
};
export type ConcertRowOptions={origin:string;catalogCodes:Map<string,string>;includeLegacyWhenSplit?:boolean};

export const CONCERT_EXTRA_COLUMNS:readonly ExtraColumn[]=[
 {key:'lineState',header:'Estat de la línia',width:16},{key:'recordId',header:'ID registre',width:16},{key:'recordTitle',header:'Títol del registre',width:40},
 {key:'unitId',header:'ID línia',width:36},{key:'unitKey',header:'Clau de línia',width:30},{key:'actType',header:'Tipus d’acte',width:18},
 {key:'period',header:'Període',width:22},{key:'effectiveAt',header:'Data d’efectes',width:14},{key:'operation',header:'Operació econòmica',width:16},
 {key:'reviewState',header:'Estat revisió econòmica',width:18},{key:'amountKind',header:'Tipus d’import',width:24},{key:'municipality',header:'Municipi',width:20},
 {key:'county',header:'Comarca',width:20},{key:'resesCode',header:'Codi RESES',width:12},{key:'centre',header:'Centre',width:28},{key:'quantity',header:'Places',width:9},
 {key:'quantityDelta',header:'Variació de places',width:12},{key:'observedCode',header:'Codi observat',width:16},{key:'serviceName',header:'Nom del servei',width:36},
 {key:'codeOrigin',header:'Origen del codi',width:16},{key:'amountOrigin',header:'Origen de l’import',width:24},{key:'dateOrigin',header:'Origen de la data',width:24},
 {key:'otherDate',header:'Data alternativa',width:14},{key:'organOrigin',header:'Origen de l’òrgan',width:22},{key:'populationOrigin',header:'Origen de la població',width:24},
 {key:'territoryOrigin',header:'Origen del territori',width:24},{key:'horizonState',header:'Estat d’horitzó',width:16},{key:'reviewNote',header:'Nota de revisió',width:36},
 {key:'appLink',header:'Enllaç a l’aplicació',width:40},{key:OBSERVATIONS_KEY,header:'Observacions',width:60},
];
const LINE_STATE:Record<string,string>={draft:'Pendent de revisió',approved:'Aprovada',rejected:'Rebutjada'};
const REVIEW_STATE:Record<string,string>={draft:'Esborrany',approved:'Aprovada',excluded:'Exclosa'};
const OPERATION:Record<string,string>={award:'Adjudicació',renewal:'Pròrroga',delta:'Diferència',replacement:'Substitució',nonfinancial:'Sense efecte econòmic',correction:'Correcció'};
const ACT_LABEL=(actType:string)=>actType==='legacy'?'Línia global':(concertCase[actType as ConcertCaseKey]?.label??actType);
const isProvince=(value:string|null|undefined):value is MapeigProvince=>!!value&&(MAPEIG_PROVINCES as readonly string[]).includes(value);
const trimmed=(value:string|null|undefined)=>value?.trim()||null;
const scopeAuthority=(facts:unknown):string|null=>{
 if(!facts||typeof facts!=='object')return null;
 const authority=(facts as {documentary_authority?:{authority?:{value?:unknown}|null}}).documentary_authority?.authority;
 return typeof authority?.value==='string'?trimmed(authority.value):null;
};
const groupBy=<T,>(items:readonly T[],key:(item:T)=>string|null|undefined)=>{const map=new Map<string,T[]>();for(const item of items){const k=key(item);if(k==null)continue;map.set(k,[...(map.get(k)??[]),item]);}return map;};
function asSourceDocument(row:ConcertDocumentRow):SourceDocument{
 return {id:row.id,url:row.url,documentType:row.document_type,sourceFields:row.source_fields??[],status:row.status as SourceDocument['status'],mimeType:row.mime_type,
  archived:!!row.storage_path,currentTextConsistent:currentDocumentTextConsistent(row as unknown as Record<string,unknown>),extractedText:row.extracted_text,
  extractedTextHash:row.extracted_text_hash,revision:`${row.storage_sha256??''}:${row.active_extraction_id??''}`,textPreview:null,textLength:null,
  extractionMethod:row.extraction_method,extractionPartial:row.extraction_partial,extractionCoverage:row.extraction_coverage,qualityScore:null,qualityFlags:row.quality_flags??[],chunkCount:0};
}

/** Record-level «Data concessió»: the printed original signature prevails,
 * then the extracted date, then the digital signature (Carles, 03/11/2026);
 * the legacy provision is the last fallback. */
export function concertRecordAwardDate(input:{documents:ConcertDocumentRow[];signatures:ConcertSignatureRow[];enrichment:ConcertEnrichmentRow|undefined;provision:ConcertProvisionRow|undefined;gates:ConcertMapeigData['gates']}):{date:string|null;origin:string|null;other:string|null;note:string|null}{
 const documents=input.documents.map(asSourceDocument);
 const printed=input.gates.printedDates?printedOriginalSignatureDates(documents):[];
 if(printed===null){
  const fallback=input.enrichment?.award_date??input.provision?.award_date??null;
  return {date:fallback,origin:fallback?(input.enrichment?.award_date?'Data extreta del document':'Provisió aprovada'):null,other:null,note:'El document conté dates de signatura originals contradictòries; cal contrastar-les'};
 }
 const current=input.gates.signatureDates?input.signatures.filter(item=>documents.some(document=>document.id===item.document_id&&document.archived===true&&document.revision?.startsWith(`${item.document_sha256}:`))):[];
 const summaries=summarizeSignatureObservations(current);
 const digital=summaries.some(summary=>summary.conflict||!summary.observation)?[]:summaries.map(summary=>summary.observation!.local_date);
 const proposal=proposedConcertAwardDate(printed,digital,input.enrichment?.award_date??null);
 if(proposal){
  const origin={printed:'Signatura de l’original impresa al document (proposta pendent de validació)',extracted:'Data extreta del document',digital:'Signatura digital del document (proposta pendent de validació)'}[proposal.source];
  return {date:proposal.date,origin,other:proposal.other,note:null};
 }
 if(input.provision?.award_date)return {date:input.provision.award_date,origin:'Provisió aprovada',other:null,note:null};
 return {date:null,origin:null,other:null,note:printed.length>1?'Diverses dates de signatura originals; cap es proposa':'Data de concessió no identificada'};
}
/** Award lines carry the annex amount; other acts only an approved economic
 * review, signed by its operation (template rule: cessaments en negatiu). */
export function concertLineAmount(unit:ConcertUnitRow,review:ConcertReviewRow|undefined):{amount:number|null;origin:string|null;note:string|null}{
 if(unit.act_type==='award'||unit.act_type==='legacy'){
  if(unit.amount===null||unit.amount==='')return {amount:null,origin:null,note:'Import no acreditat'};
  const cents=euroCents(unit.amount);
  return cents===null?{amount:null,origin:null,note:'Import no interpretable'}:{amount:cents/100,origin:unit.act_type==='legacy'?'Import global del registre':'Import de l’annex de la resolució',note:null};
 }
 if(!review||review.status!=='approved')return {amount:null,origin:null,note:review?'Revisió econòmica no aprovada':'Revisió econòmica pendent'};
 if(review.amount_kind==='unknown'||review.amount_cents===null||review.operation==='nonfinancial'||review.operation==='correction')
  return {amount:null,origin:null,note:review.operation==='nonfinancial'?'Acte sense efecte econòmic':'Import no acreditat per la revisió econòmica'};
 if(review.operation==='replacement')return {amount:null,origin:null,note:'Total substitutiu: cal la diferència amb l’original'};
 let cents=review.amount_cents;
 if(unit.act_type==='termination'&&cents>0)cents=-cents;
 return {amount:cents/100,origin:`Revisió econòmica aprovada (${OPERATION[review.operation]??review.operation})`,note:null};
}
export function concertLineProvince(unit:ConcertUnitRow,geography:ConcertGeographyRow|undefined,supplemental:ReviewedConcertGeography|undefined,review:ConcertReviewRow|undefined):{province:MapeigProvince|null;municipality:string|null;county:string|null;origin:string|null;note:string|null}{
 if(geography&&isProvince(geography.province))return {province:geography.province,municipality:geography.municipality,county:geography.county,origin:'Geografia documental de la línia',note:null};
 const economic=economicConcertTerritory(unit.territory,supplemental,review);
 if(economic.issue)return {province:null,municipality:unit.municipality??unit.territory,county:null,origin:null,note:economic.issue};
 const literal=trimmed(economic.territory)??trimmed(unit.municipality);
 const reference=municipalityReference(literal);
 if(reference&&isProvince(reference.province))return {province:reference.province,municipality:reference.municipality,county:reference.county,origin:economic.applied?'Ubicació complementària confirmada (Idescat)':'Municipi de la línia (Idescat)',note:null};
 if(literal)return {province:null,municipality:literal,county:null,origin:null,note:`Província no resolta: ${literal}`};
 return {province:null,municipality:null,county:null,origin:null,note:'Territori no identificat'};
}

export function concertRowsFromData(data:ConcertMapeigData,options:ConcertRowOptions):ProviderResult{
 const records=new Map(data.records.map(r=>[r.id,r]));
 const reviews=new Map(data.reviews.map(r=>[r.unit_id,r]));
 const geography=new Map(data.geography.map(g=>[g.unit_id,g]));
 const supplemental=new Map(data.supplemental.map(g=>[g.unit_id,g]));
 const enrichments=new Map(data.enrichments.map(e=>[e.source_record_id,e]));
 const latestJobs=new Map(data.latestJobs.map(j=>[j.source_record_id,j]));
 const legacyProvisions=new Map(data.provisions.filter(p=>!p.unit_id).map(p=>[p.source_record_id,p]));
 const unitProvisions=new Map(data.provisions.filter(p=>p.unit_id).map(p=>[p.unit_id!,p]));
 const documentsByRecord=groupBy(data.documents,d=>d.source_record_id),documentsById=new Map(data.documents.map(d=>[d.id,d]));
 const signaturesByRecord=groupBy(data.signatures,s=>s.source_record_id);
 const unitsByRecord=groupBy(data.units,u=>u.source_record_id);
 const populationsByUnit=groupBy(data.populations,p=>p.unit_id);
 const corrections=data.corrections.filter(c=>c.valid);
 const correction=(field:string,unit:ConcertUnitRow)=>corrections.find(c=>c.field===field&&c.unit_id===unit.id)?.value??corrections.find(c=>c.field===field&&c.unit_id===null&&c.source_record_id===unit.source_record_id)?.value??null;
 const awardDates=new Map<string,ReturnType<typeof concertRecordAwardDate>>();
 const rows:DetallRegistresRow[]=[];
 let skippedLegacy=0;
 for(const unit of data.units){
  const record=records.get(unit.source_record_id);
  const siblings=unitsByRecord.get(unit.source_record_id)??[];
  if(unit.unit_key==='legacy'&&siblings.some(other=>other.unit_key!=='legacy')&&!options.includeLegacyWhenSplit){skippedLegacy+=1;continue;}
  const observations:string[]=[];
  const extras:DetallRegistresRow['extras']={};
  const review=reviews.get(unit.id),enrichment=enrichments.get(unit.source_record_id),legacyProvision=legacyProvisions.get(unit.source_record_id),provision=unitProvisions.get(unit.id)??legacyProvision;
  // A: source link
  const documents=documentsByRecord.get(unit.source_record_id)??[];
  const sourceUrl=record?.record_url??documents.find(d=>d.source_fields?.includes('record_url')&&d.url)?.url??(unit.document_id?documentsById.get(unit.document_id)?.url:null)??null;
  if(!sourceUrl)observations.push('Sense enllaç d’origen');
  // B, C: entity
  const providerName=trimmed(correction('provider_name',unit))??trimmed(unit.provider_name)??trimmed(unit.observed_provider_name);
  if(!providerName)observations.push('Entitat pendent de contrast');
  const providerNif=trimmed(correction('provider_nif',unit))??trimmed(unit.provider_nif);
  // E: award date (record level)
  if(!awardDates.has(unit.source_record_id))awardDates.set(unit.source_record_id,concertRecordAwardDate({documents,signatures:signaturesByRecord.get(unit.source_record_id)??[],enrichment,provision:legacyProvision,gates:data.gates}));
  const awardDate=awardDates.get(unit.source_record_id)!;
  if(awardDate.note)observations.push(awardDate.note);
  // F: amount
  const amount=concertLineAmount(unit,review);
  if(amount.note)observations.push(amount.note);
  // G: contracting body
  let contractingBody=trimmed(enrichment?.contracting_body),organOrigin:string|null='Òrgan signant del document';
  if(!contractingBody){contractingBody=scopeAuthority(enrichment?.scope_facts);organOrigin=contractingBody?'Autoritat documental verificada':null;}
  if(!contractingBody){contractingBody=trimmed(provision?.contracting_body);organOrigin=contractingBody?'Provisió aprovada':null;}
  if(!contractingBody){contractingBody=trimmed(review?.funder);organOrigin=contractingBody?'Finançador de la revisió econòmica':null;}
  if(!contractingBody)observations.push('Òrgan no identificat');
  // H: target population
  const job=unit.pipeline_job_id??latestJobs.get(unit.source_record_id)?.id??null;
  const events=(populationsByUnit.get(unit.id)??[]).filter(e=>e.job_id===job).sort((a,b)=>b.sequence-a.sequence);
  let targetPopulation:string|null=null,populationOrigin:string|null=null;
  if(events[0]?.decision==='confirmed'){targetPopulation=trimmed(events[0].value);populationOrigin='Població revisada per a la línia';}
  else if(events[0]?.decision==='unknown'){populationOrigin='Població revisada: desconeguda';observations.push('Població revisada: desconeguda');}
  else{
   const corrected=trimmed(correction('final_population',unit));
   if(corrected){targetPopulation=corrected;populationOrigin='Correcció documentada';}
   else if(trimmed(enrichment?.target_population)){targetPopulation=trimmed(enrichment?.target_population);populationOrigin='Població del registre';observations.push('Població del registre, no acreditada per línia');}
   else if(trimmed(provision?.target_population)){targetPopulation=trimmed(provision?.target_population);populationOrigin='Provisió aprovada';observations.push('Població del registre, no acreditada per línia');}
  }
  // I: province
  const territory=concertLineProvince(unit,geography.get(unit.id),supplemental.get(unit.id),review);
  if(territory.note)observations.push(territory.note);
  // K: Cartera code
  let carteraCode:string|null=null,codeOrigin:string|null=null;
  const correctedCode=trimmed(correction('service_code',unit));
  if(correctedCode){carteraCode=correctedCode;codeOrigin='Correcció documentada';}
  else if(unit.service_code&&unit.catalog_version_id){carteraCode=unit.service_code;codeOrigin=unit.status==='approved'?'Codi revisat':'Codi proposat';}
  else if(unit.observed_service_code&&options.catalogCodes.has(unit.observed_service_code)){carteraCode=unit.observed_service_code;codeOrigin='Codi observat a l’annex';observations.push('Codi observat a l’annex, pendent de revisió');}
  if(!carteraCode)observations.push('Codi pendent de revisió');
  const serviceName=carteraCode?options.catalogCodes.get(carteraCode)??trimmed(unit.observed_service_name):trimmed(unit.observed_service_name);
  if(unit.unit_key==='legacy')observations.push('Línia global del registre (sense desglossament per annex)');
  if(unit.status==='rejected')observations.push('Línia rebutjada: no s’ha de sumar');
  const period=trimmed(unit.period)??(unit.effective_start||unit.effective_end?`${unit.effective_start??'?'}/${unit.effective_end??'?'}`:null)??(review?.period_start||review?.period_end?`${review.period_start??'?'}/${review.period_end??'?'}`:null);
  Object.assign(extras,{
   lineState:LINE_STATE[unit.status]??unit.status,recordId:record?.source_record_id??unit.source_record_id,recordTitle:record?.title??null,unitId:unit.id,unitKey:unit.unit_key,
   actType:ACT_LABEL(unit.act_type),period,effectiveAt:review?.effective_at??null,operation:review?OPERATION[review.operation]??review.operation:null,
   reviewState:review?REVIEW_STATE[review.status]??review.status:null,amountKind:review?ECONOMIC_AMOUNT_LABELS[review.amount_kind]:null,
   municipality:territory.municipality,county:territory.county,resesCode:unit.reses_code,centre:unit.centre,quantity:unit.quantity,quantityDelta:unit.quantity_delta,
   observedCode:unit.observed_service_code,serviceName,codeOrigin,amountOrigin:amount.origin,dateOrigin:awardDate.origin,otherDate:awardDate.other,organOrigin,populationOrigin,
   territoryOrigin:territory.origin,horizonState:unit.horizon_state,reviewNote:unit.review_note,appLink:`${options.origin}${concertLineHref(unit.source_record_id,unit.id)}`,
  });
  rows.push({
   sourceUrl,sourceId:record?.source_record_id??unit.source_record_id,providerName,providerNif,mechanism:'Concert',awardDate:awardDate.date,amount:amount.amount,
   contractingBody,targetPopulation,province:territory.province,source:'e-Tauler',carteraCode,extras,observations,
  });
 }
 const notes:string[]=[];
 if(skippedLegacy)notes.push(`${skippedLegacy} línies globals de registres amb desglossament per annex no s’han exportat per no duplicar imports.`);
 if(!data.gates.supplementalGeography)notes.push('La geografia complementària revisada no està activada en aquest entorn; el territori surt del document i de la correspondència Idescat.');
 if(!data.gates.signatureDates)notes.push('Les dates de signatura digital no estan activades en aquest entorn; la data de concessió surt de la signatura impresa o de l’extracció.');
 if(!data.gates.printedDates)notes.push('Les dates de signatura impreses no s’han llegit en aquesta exportació; la data de concessió és la desada al registre.');
 notes.push('Concerts: la data de concessió és la del registre (resolució); la data d’efectes de cada línia, si la revisió econòmica la fixa, consta a la columna «Data d’efectes».');
 return {rows,notes};
}
