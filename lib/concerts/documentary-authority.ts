import type {SourceRecord} from '../workbench-types';
import {hasCurrentTextCoverage} from '../pipeline/document-coverage';
import {concertSignedAuthority} from './documentary-facts';
import {extractColumnManagerObservations} from './annex-extraction';

/** The single fetched PDF whose archived text is current and complete. */
function currentVerifiedConcertPdf(record:Pick<SourceRecord,'financingType'|'isHistorical'|'sourceDocuments'>){
 if(record.financingType!=='concert'||record.isHistorical)return null;
 const documents=record.sourceDocuments.filter(doc=>doc.status==='fetched'&&doc.mimeType?.includes('pdf'));
 if(documents.length!==1)return null;
 const doc=documents[0];
 if(!doc.extractedText||doc.archived!==true||doc.currentTextConsistent!==true||doc.extractionPartial!==false||doc.qualityFlags.some(flag=>['corrupt_text','incomplete_extraction'].includes(flag))||!hasCurrentTextCoverage(doc.extractionMethod,doc.extractionCoverage,doc.mimeType,doc.extractionPartial))return null;
 return doc as typeof doc&{extractedText:string};
}

/** Verify saved authority metadata against the current extracted document.
 * Without saved metadata, read the literal signer and printed manager codes
 * from the current verified PDF: they are document facts and do not depend on
 * line amounts being reconciled. Stale saved metadata is never replaced. */
export function currentDocumentaryAuthority(record:Pick<SourceRecord,'financingType'|'isHistorical'|'externalEnrichment'|'sourceDocuments'>){
 if(record.financingType!=='concert'||record.isHistorical)return null;
 const value=record.externalEnrichment?.documentaryAuthority;
 if(value==null){
  const doc=currentVerifiedConcertPdf(record);
  if(!doc)return null;
  const authority=concertSignedAuthority(doc.extractedText),managers=extractColumnManagerObservations(doc.extractedText);
  return authority||managers.length?{authority,managerCodes:managers}:null;
 }
 if(typeof value!=='object'||Array.isArray(value))return null;
 const metadata=value as Record<string,unknown>;
 if(metadata.version!=='concert-documentary-authority-v1'||typeof metadata.document_id!=='string'||typeof metadata.document_sha256!=='string'||typeof metadata.extraction_id!=='string'||typeof metadata.extracted_text_hash!=='string')return null;
 const documents=record.sourceDocuments.filter(doc=>doc.id===metadata.document_id);
 if(documents.length!==1)return null;
 const doc=documents[0];
 if(!doc.extractedText||doc.archived!==true||doc.currentTextConsistent!==true||doc.revision!==`${metadata.document_sha256}:${metadata.extraction_id}`||doc.extractedTextHash!==metadata.extracted_text_hash||doc.status!=='fetched'||doc.extractionPartial!==false||doc.qualityFlags.some(flag=>['corrupt_text','incomplete_extraction'].includes(flag))||!hasCurrentTextCoverage(doc.extractionMethod,doc.extractionCoverage,doc.mimeType,doc.extractionPartial))return null;
 const authority=concertSignedAuthority(doc.extractedText),managers=extractColumnManagerObservations(doc.extractedText);
 const saved=metadata.authority as {value?:unknown;page?:unknown}|null;
 const savedManagers=metadata.manager_codes;
 if((authority===null)!==(saved===null)||(authority&&(authority.value!==saved?.value||authority.page!==saved?.page))||
  !Array.isArray(savedManagers)||savedManagers.length!==managers.length||managers.some((item,index)=>item.value!==savedManagers[index]?.value||item.page!==savedManagers[index]?.page))return null;
 return {authority,managerCodes:managers};
}

/** Manager codes printed in the first column of a program annex. The heading
 * may be wrapped over several lines; never derive the signing authority from it.
 * A manager group row may carry only its printed places and cost totals. */
export function programAnnexManagers(text:string):Array<{value:string;page:number}>{
 const pages=text.split(/(?=^##\s+Pàgina\s+\d+\s*$)/m),found:Array<{value:string;page:number}>=[];
 for(const page of pages){
  const pageNumber=Number(page.match(/^##\s+Pàgina\s+(\d+)/m)?.[1]);
  const lines=page.split('\n');
  const header=lines.findIndex((line,i)=>/\bgestor\b/i.test(line)&&/\bNIF entitat\b/i.test(line)&&/\bcartera\b/i.test(lines.slice(Math.max(0,i-3),i+1).join(' '))&&/\bCodi S\b/i.test(line)&&/\bCentre\b/i.test(lines[i-1]??''));
  if(!pageNumber||header<0)continue;
  for(const line of lines.slice(header+1)){
   const match=line.match(/^\s*(BE\d{4})(?:\s+\d{1,4}\s+\d{1,3}(?:\.\d{3})*,\d{2}\s*€)?\s*$/);
   if(match)found.push({value:match[1],page:pageNumber});
  }
 }
 return [...new Map(found.map(item=>[`${item.page}:${item.value}`,item])).values()];
}

export function currentProgramAnnexManagers(record:Pick<SourceRecord,'financingType'|'isHistorical'|'sourceDocuments'>){
 const doc=currentVerifiedConcertPdf(record);
 if(!doc)return [];
 return programAnnexManagers(doc.extractedText).map(item=>({...item,documentId:doc.id}));
}
