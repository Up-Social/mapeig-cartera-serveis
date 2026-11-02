import type {SourceRecord} from '../workbench-types';
import {hasCurrentTextCoverage} from '../pipeline/document-coverage';
import {hasCurrentConcertAward} from './no-award';
import {extractDiagnosticAnnex,safeDiagnosticTotal} from './diagnostic-annex';
import {storedAmountCents} from './annex-extraction';

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

type Draft={id:string;unit_key:string;document_id?:string|null;storage_path:string|null;storage_sha256:string|null;page:number|null;provider_nif:string|null;reses_code:string|null;observed_service_code:string|null;amount:number|string|null;evidence_quote:string|null;effective_start:string|null;effective_end:string|null;observation?:{pendingRevision?:boolean}};
/** Compare the live drafts with both separately printed subtotals. This is a
 * reading aid only: it cannot assert a SQL reconciliation or Storage bytes. */
export function diagnosticDraftComparison(record:Pick<SourceRecord,'id'|'financingType'|'isHistorical'|'title'|'sourceDocuments'>,units:readonly Draft[]){
 const report=diagnosticAwardReport(record);if(!report||report.rows.length!==units.length)return null;
 const doc=record.sourceDocuments.find(item=>item.id===report.documentId),sha=doc?.revision?.split(':')[0];
 if(!sha||!/^[a-f0-9]{64}$/.test(sha)||new Set(units.map(unit=>unit.id)).size!==units.length)return null;
 const normalized=(value:string|null)=>value?.replace(/\s+/g,' ').trim()??'';
 for(const row of report.rows){
  const matching:Draft[]=units.filter(unit=>unit.unit_key===`official-annex:${sha}:${row.annex}:${row.row}`);
  if(matching.length!==1)return null;
  const u:Draft=matching[0];
  if(u.document_id!==report.documentId||u.storage_sha256!==sha||u.storage_path!==`cases/${record.id}/items/${u.id}/documents/${report.documentId}/${sha}.pdf`||u.page!==row.page||u.provider_nif!==row.nif||u.reses_code!==row.resesCode||u.observed_service_code!==row.observedServiceCode||storedAmountCents(u.amount)!==row.amountCents||normalized(u.evidence_quote)!==normalized(row.quote)||u.effective_start!==(row.effectiveStart??null)||u.effective_end!==(row.effectiveEnd??null)||u.observation?.pendingRevision===true)return null;
 }
 return {count:report.rows.length,totalCents:report.totalCents};
}
