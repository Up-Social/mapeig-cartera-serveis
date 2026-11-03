import {originalSignatureEvidence,unambiguousOriginalSignature} from './original-signature-evidence';
import type {SourceDocument} from '../workbench-types';

export type ProposedAwardDate={date:string;source:'printed'|'extracted'|'digital';other:string|null};
const ISO=/^\d{4}-\d{2}-\d{2}$/;

/** Carles (03/11/2026): the signature date is shown as the proposed «Data
 * concessió», pending human validation, and the date printed for the original
 * prevails, also over a date the model extracted (the client reads it from the
 * footer, e.g. S1-9). Without a printed date the extracted one is kept, then the
 * digital signature. A differing date is reported; ambiguity proposes nothing. */
export function proposedConcertAwardDate(printed:readonly string[],digital:readonly string[],extracted:string|null=null):ProposedAwardDate|null{
 const p=[...new Set(printed.filter(date=>ISO.test(date)))],d=[...new Set(digital.filter(date=>ISO.test(date)))];
 const e=extracted&&ISO.test(extracted)?extracted:null;
 if(p.length===1)return {date:p[0],source:'printed',other:e&&e!==p[0]?e:d.length===1&&d[0]!==p[0]?d[0]:null};
 if(e)return {date:e,source:'extracted',other:null};
 if(p.length>1||d.length!==1)return null;
 return {date:d[0],source:'digital',other:null};
}

/** Printed original-signature dates from complete, current archived PDFs. */
export function printedOriginalSignatureDates(documents:readonly SourceDocument[]):string[]|null{
 const dates:string[]=[];
 for(const document of documents){
  const coverage=document.extractionCoverage;
  if(document.status!=='fetched'||document.mimeType!=='application/pdf'||!document.archived||document.currentTextConsistent!==true||document.extractionPartial!==false||!coverage||typeof coverage!=='object'||!('complete' in coverage)||coverage.complete!==true||document.qualityFlags.some(flag=>['corrupt_text','incomplete_extraction'].includes(flag))||!document.extractedText)continue;
  if(!originalSignatureEvidence(document.extractedText).length)continue;
  const match=unambiguousOriginalSignature(document.extractedText);
  if(!match)return null;
  dates.push((match.find(item=>item.page!==null)??match[0]).date);
 }
 return dates;
}
