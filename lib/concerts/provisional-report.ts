import type {SourceRecord} from '../workbench-types';
import {hasCurrentTextCoverage} from '../pipeline/document-coverage';
import {provisionalServiceAmounts} from './provisional-headings';

/** Read-only documentary subtotal of a proposal, not an award or balance. */
export function provisionalDocumentReport(record:Pick<SourceRecord,'title'|'financingType'|'isHistorical'|'sourceDocuments'>){
 if(record.financingType!=='concert'||record.isHistorical)return null;
 const documents=record.sourceDocuments.filter(doc=>doc.status==='fetched'&&doc.mimeType?.includes('pdf'));
 if(documents.length!==1)return null;
 const doc=documents[0];
 if(!doc.extractedText||doc.archived!==true||doc.currentTextConsistent!==true||doc.extractionPartial!==false||doc.qualityFlags.some(flag=>['corrupt_text','incomplete_extraction'].includes(flag))||!hasCurrentTextCoverage(doc.extractionMethod,doc.extractionCoverage,doc.mimeType,doc.extractionPartial))return null;
 const rows=provisionalServiceAmounts(record.title,doc.extractedText);
 if(!rows)return null;
 return {documentId:doc.id,rows,totalCents:rows.reduce((sum,row)=>sum+row.grossCents,0)};
}
