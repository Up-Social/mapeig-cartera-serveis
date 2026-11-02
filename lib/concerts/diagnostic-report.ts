import type {SourceRecord} from '../workbench-types';
import {hasCurrentTextCoverage} from '../pipeline/document-coverage';
import {hasCurrentConcertAward} from './no-award';
import {extractDiagnosticAnnex,safeDiagnosticTotal} from './diagnostic-annex';

/** Documentary reading of a definitive diagnostic annex; not a decision,
 * payment, accepted reconciliation or economic balance. */
export function diagnosticAwardReport(record:Pick<SourceRecord,'financingType'|'isHistorical'|'title'|'sourceDocuments'>){
 if(record.financingType!=='concert'||record.isHistorical)return null;
 const docs=record.sourceDocuments.filter(doc=>doc.status==='fetched'&&doc.mimeType?.includes('pdf'));
 if(docs.length!==1)return null;
 const doc=docs[0];
 if(!doc.extractedText||doc.archived!==true||doc.currentTextConsistent!==true||doc.extractionPartial!==false||doc.qualityFlags.some(flag=>['corrupt_text','incomplete_extraction'].includes(flag))||!hasCurrentTextCoverage(doc.extractionMethod,doc.extractionCoverage,doc.mimeType,doc.extractionPartial)||!hasCurrentConcertAward(record.title,doc.extractedText))return null;
 const rows=extractDiagnosticAnnex(doc.extractedText),total=safeDiagnosticTotal(rows);
 return rows.length>1&&total!==null?{documentId:doc.id,rows,totalCents:total}:null;
}
