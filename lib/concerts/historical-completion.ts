import {buildHistoricalConcertImportPlan} from './historical-import-plan';
import {type HistoricalQuery} from './historical-discovery';

type Receipt={sourceRecordId:string;payloadHash:string;outcome:'inserted'|'already_present'};
type CompletionEvidence={state:'running'|'uncertain';dispatch:'confirmed'|'unknown';historicalSourceContract:'verified'|'user_requested'|'unverified';queries:readonly HistoricalQuery[];retrievedAt:string;receipts:readonly Receipt[]};

/** Evaluates evidence only. This is not a database commit or a proof that the
 * receipts came from PostgreSQL. Final completion must recheck and commit the
 * same pages, manifest and receipts atomically while holding a valid lease. */
export function checkHistoricalCompletion(evidence:CompletionEvidence):{eligible:boolean;reason:string} {
 if(evidence.state!=='running'||evidence.dispatch!=='confirmed')return {eligible:false,reason:'EXECUTION_UNCERTAIN'};
 if(evidence.historicalSourceContract!=='verified'&&evidence.historicalSourceContract!=='user_requested')return {eligible:false,reason:'HISTORICAL_SOURCE_UNVERIFIED'};
 let plan:ReturnType<typeof buildHistoricalConcertImportPlan>;
 try {plan=buildHistoricalConcertImportPlan(evidence.queries,evidence.retrievedAt);}
 catch {return {eligible:false,reason:'SCAN_INCOMPLETE'};}
 if(!Array.isArray(evidence.receipts)||evidence.receipts.length!==plan.rows.length)return {eligible:false,reason:'RECEIPTS_INCOMPLETE'};
 const expected=new Map(plan.rows.map(row=>[row.source_record_id,row.source_payload_hash]));
 const seen=new Set<string>();
 for(const receipt of evidence.receipts){
  if(!receipt||!['inserted','already_present'].includes(receipt.outcome)||seen.has(receipt.sourceRecordId)
   ||!expected.has(receipt.sourceRecordId)||expected.get(receipt.sourceRecordId)!==receipt.payloadHash)
   return {eligible:false,reason:'RECEIPT_MISMATCH'};
  seen.add(receipt.sourceRecordId);
 }
 return {eligible:true,reason:'PAGES_AND_RECEIPTS_MATCH'};
}
