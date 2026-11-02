import type {SourceRecord} from '../workbench-types';
import {hasCurrentTextCoverage} from '../pipeline/document-coverage';
import {concertSignedAuthority} from './documentary-facts';
import {extractColumnManagerObservations} from './annex-extraction';

/** Verify saved authority metadata against the current extracted document. */
export function currentDocumentaryAuthority(record:Pick<SourceRecord,'financingType'|'isHistorical'|'externalEnrichment'|'sourceDocuments'>){
 if(record.financingType!=='concert'||record.isHistorical)return null;
 const value=record.externalEnrichment?.documentaryAuthority;
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
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
