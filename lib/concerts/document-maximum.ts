import {declaredGeneralAnnexMaximumEvidence} from './annex-extraction';
import type {SourceDocument} from '../workbench-types';

type DocumentLine={document_id?:string|null;storage_sha256:string|null;evidence_quote:string|null;observation?:{pendingRevision?:boolean}};

/** An advisory about the loaded source, never a financial interpretation of its
 * individual rows. A stale or ambiguous source must not produce the notice. */
export function documentaryMaximumNotices(documents:SourceDocument[],lines:DocumentLine[]){
 const normalized=(value:string)=>value.replace(/\s+/g,' ').trim();
 return documents.flatMap(document=>{
  const related=lines.filter(line=>line.document_id===document.id);
  const [sha,extractionId]=document.revision?.split(':')??[];
  const coverage=document.extractionCoverage;
  if(!related.length||document.status!=='fetched'||document.archived!==true||document.extractionPartial!==false
   ||!document.mimeType?.includes('pdf')||!document.extractionMethod||!/^(?:pdf-(?:text|ocr)-markdown-v2|pdftotext(?:-layout)?|pdf-text)$/.test(document.extractionMethod)
   ||(typeof coverage==='object'&&coverage!==null&&'complete' in coverage&&coverage.complete===false)
   ||document.qualityFlags.some(flag=>['corrupt_text','incomplete_extraction'].includes(flag))
   ||!sha||!/^[0-9a-f]{64}$/.test(sha)||!extractionId||!document.extractedText)return [];
  const text=normalized(document.extractedText);
  if(related.some(line=>line.storage_sha256!==sha||line.observation?.pendingRevision===true||!line.evidence_quote||!text.includes(normalized(line.evidence_quote))))return [];
  const evidence=declaredGeneralAnnexMaximumEvidence(document.extractedText);
  return evidence?[{documentId:document.id,...evidence}]:[];
 });
}
