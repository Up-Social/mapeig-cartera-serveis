import type {SourceRecord} from '../workbench-types';
import {declaredGeneralAnnexMaximumEvidence,extractColumnServiceObservations,extractColumnManagerObservations} from './annex-extraction';
import {recoverPrintedSupportCandidates} from './presentation';
import {concertLineAmountSummary} from './line-summary';

export type DocumentaryUnit={id:string;unit_key:string;document_id?:string|null;storage_sha256:string|null;page:number|null;provider_nif:string|null;reses_code:string|null;observed_service_code:string|null;quantity:number|null;amount:number|string|null;evidence_quote:string|null;act_type:string;observation?:{pendingRevision?:boolean}};
export type DocumentaryReport={document_id:string;document_sha256:string;annex:number;row_count:number;sum_cents:number;reconciled:boolean};
export type ConcertDocumentaryFacts={documentId:string;revision:string;lineCount:number;services:Array<{value:string;pages:number[]}>;managerCodes:Array<{value:string;page:number}>;populations:string[]|null;authority:{value:string;page:number}|null;period:{quote:string;page:number;condition:string|null}|null;summary:string};
const normalized=(value:string)=>value.replace(/\s+/g,' ').trim();

/** Only an unambiguous literal signature block, not actors cited in recitals.
 * No department/territory is inferred from a role or a budget centre code. */
export function concertSignedAuthority(text:string):ConcertDocumentaryFacts['authority']{
 const found:Array<{value:string;page:number}>=[];
 for(const part of text.split(/(?=^## Pàgina \d+\s*$)/m)){
  const page=Number(part.match(/^## Pàgina (\d+)/)?.[1]);
  if(!Number.isSafeInteger(page)||page<1)continue;
  for(const match of part.matchAll(/^\s*((?:El|La)\s+(?:Conseller(?:a)?|President(?:a)?|Alcalde(?:ssa)?|Director(?:a)?(?:\s+general)?|Secretari(?:a)?(?:\s+general)?)\b[^\n]{2,180})\r?\n[ \t]*Signat electr[oò]nicament\b/gmi)){
   found.push({value:normalized(match[1]),page});
  }
 }
 return found.length===1?found[0]:null;
}

/** Literal period attached to the same operative maximum as the annex total.
 * No date is assigned to an individual line or interpreted as its effective start. */
export function concertMaximumPeriod(text:string,totalCents:number):ConcertDocumentaryFacts['period']{
 const maximum=declaredGeneralAnnexMaximumEvidence(text);
 if(!maximum||maximum.amountCents!==totalCents)return null;
 const found:NonNullable<ConcertDocumentaryFacts['period']>[]=[];
 for(const part of text.split(/(?=^## Pàgina \d+\s*$)/m)){
  const page=Number(part.match(/^## Pàgina (\d+)/)?.[1]),body=normalized(part),at=body.indexOf(maximum.quote);
  if(!Number.isSafeInteger(page)||page<1||at<0||body.indexOf(maximum.quote,at+1)>=0)continue;
  const periods=[...body.slice(Math.max(0,at-350),at).matchAll(/\bper[ií]ode compr[eè]s entre [^.;]{1,220}?\bambd[oó]s inclosos\b/gi)];
  if(periods.length===1)found.push({quote:periods[0][0],page,condition:maximum.condition});
 }
 return found.length===1?found[0]:null;
}

/** Read-only projection of current documentary cells. It never overwrites
 * enrichment, catalogue interpretations, human decisions or monetary values. */
export function concertDocumentaryFacts(record:Pick<SourceRecord,'financingType'|'isHistorical'|'analysis'|'sourceDocuments'>,units:DocumentaryUnit[],reports:DocumentaryReport[]):ConcertDocumentaryFacts|null{
 if(record.financingType!=='concert'||record.isHistorical||record.analysis?.rules_version!=='concert-reconciled-annex-v1'||record.analysis.reliability_status==='invalidated')return null;
 return projectConcertDocumentaryFacts(record.sourceDocuments,units,reports);
}

/** Shared by the read-only UI and the Concert enrichment commit. */
export function projectConcertDocumentaryFacts(documents:SourceRecord['sourceDocuments'],units:DocumentaryUnit[],reports:DocumentaryReport[]):ConcertDocumentaryFacts|null{
 const amountSummary=concertLineAmountSummary(units,reports,true);
 if(amountSummary.reason!==null||amountSummary.totalCents===null)return null;
 const matchingDocuments=documents.filter(item=>item.id===units[0]?.document_id);
 if(matchingDocuments.length!==1)return null;
 const document=matchingDocuments[0];
 if(!document?.extractedText||document.currentTextConsistent!==true||document.archived!==true||!document.revision)return null;
 const [sha,extraction]=document.revision.split(':');
 if(!extraction||units.some(unit=>unit.storage_sha256!==sha))return null;
 const anchored=recoverPrintedSupportCandidates(units.map(unit=>({...unit,document_id:unit.document_id??null})),[{
  id:document.id,extracted_text:document.extractedText,storage_sha256:sha,extraction_method:document.extractionMethod,
  extraction_coverage:document.extractionCoverage,mime_type:document.mimeType,extraction_partial:document.extractionPartial??null,quality_flags:document.qualityFlags,
 }]);
 if(anchored.some(unit=>!unit.printed_support_candidate))return null;
 const cells=extractColumnServiceObservations(document.extractedText);
 if(cells.length!==units.length)return null;
 const observed=anchored.map(unit=>cells.filter(cell=>cell.page===unit.page&&cell.resesCode===unit.reses_code&&unit.unit_key===`official-annex:${sha}:0:${cell.row}`));
 if(observed.some(candidates=>candidates.length!==1))return null;
 const services=new Map<string,Set<number>>();
 for(const [cell] of observed){const pages=services.get(cell.value)??new Set<number>();pages.add(cell.page);services.set(cell.value,pages);}
 // Population is read from the literal service cell, never from a catalogue.
 // "amb auxiliar" describes service support, not a separate population.
 const populations=[...services.keys()].map(value=>value.match(/\bper a (.+?)(?:,?\s+amb auxiliar)?$/i)?.[1]?.trim()??null);
 const names=[...services.keys()];
 return {documentId:document.id,revision:document.revision,lineCount:units.length,
  services:[...services].map(([value,pages])=>({value,pages:[...pages]})),
  managerCodes:[...new Map(extractColumnManagerObservations(document.extractedText).map(cell=>[`${cell.page}:${cell.value}`,cell])).values()],
  populations:populations.every(value=>value!==null)?[...new Set(populations as string[])]:null,
  authority:concertSignedAuthority(document.extractedText),
  period:concertMaximumPeriod(document.extractedText,amountSummary.totalCents),
  summary:`L’annex documenta ${units.length} línies d’adjudicació. Serveis que consten a les línies: ${names.join(' · ')}.`,
 };
}
