import {createHash} from 'node:crypto';
import {classifyConcertEvent} from './event-classification';
import {validateHistoricalConcertScan,type HistoricalQuery} from './historical-discovery';
import {historicalCanonicalHash} from './historical-canonical';

/** Build an import plan only. The caller must persist it using an atomic,
 * insert-only transaction with receipts; this function performs no writes. */
export function buildHistoricalConcertImportPlan(queries:readonly HistoricalQuery[],retrievedAt:string) {
 const timestamp=new Date(retrievedAt);
 if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(retrievedAt)||Number.isNaN(timestamp.getTime())||timestamp.toISOString()!==retrievedAt)throw new Error('INVALID_RETRIEVAL_TIME');
 const scan=validateHistoricalConcertScan(queries);
 const rows=scan.records.map((record,index)=>{
  const {edict,matchedTerms,sourceRecordId}=record;
  const classification=classifyConcertEvent(edict.titol,edict.descripcio);
  const payload={...edict,matched_terms:matchedTerms};
  const legacyHashMaterial=JSON.stringify(payload);
  const payloadHash=createHash('sha256').update(legacyHashMaterial).digest('hex');
  const discovered={...edict,source_dataset:'concerts',financing_type:'concert',source_record_id:sourceRecordId,
   record_url:`https://tauler.seu-e.cat/detall?idEns=1&idEdicte=${edict.id_edicte}`,matched_terms:matchedTerms,
   event_type:classification.eventType,counts_as_new_financing:classification.countsAsNewFinancing,source_payload_hash:payloadHash};
  const row={source_dataset:'concerts',source_record_id:sourceRecordId,mechanism:'Concert social / gestió delegada',
   title:edict.titol.trim(),provider_name:null,amount:null,processing_status:'pendent',
   source_file:'https://tauler.seu-e.cat/api/edictes',source_sheet:'edictes',source_row:index+2,
   source_payload:{...discovered,connector:'etauler',retrieved_at:retrievedAt,period_from:scan.window.from,period_to:scan.window.to},source_payload_hash:payloadHash,
   historical_legacy_hash_material:legacyHashMaterial};
  return {...row,historical_validation_hash:historicalCanonicalHash(row)};
 });
 return {window:scan.window,coverage:scan.coverage,pagesRead:scan.pagesRead,rowsRead:scan.rowsRead,rows};
}
