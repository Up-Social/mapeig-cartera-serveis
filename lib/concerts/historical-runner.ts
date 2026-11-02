import {createHash} from 'node:crypto';
import {HISTORICAL_CONCERT_TERMS,type HistoricalQuery} from './historical-discovery';
import {buildHistoricalConcertImportPlan} from './historical-import-plan';
import {checkHistoricalCompletion} from './historical-completion';

export type HistoricalReceipt={sourceRecordId:string;payloadHash:string;outcome:'inserted'|'already_present'};
export type HistoricalSnapshot={state:'running'|'uncertain'|'completed';dispatch:'confirmed'|'unknown';historicalSourceContract:'verified'|'user_requested'|'unverified';inFlight:null|{kind:'page'|'manifest'|'import'|'completion';id:string};queries:readonly HistoricalQuery[];retrievedAt:string;manifestHash:string|null;receipts:readonly HistoricalReceipt[]};
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Select a next unit from persisted state. No provider or database calls.
 * This pure selector is used by the dedicated workflow; the database journal
 * fences persistence and revalidates the manifest and receipts before closure. */
export function nextHistoricalAction(snapshot:HistoricalSnapshot) {
 if(snapshot.state==='completed')return {kind:'finished' as const};
 if(snapshot.state!=='running'||snapshot.dispatch!=='confirmed')return {kind:'reconcile' as const,reason:'EXECUTION_UNCERTAIN'};
 if(snapshot.historicalSourceContract!=='verified'&&snapshot.historicalSourceContract!=='user_requested')return {kind:'reconcile' as const,reason:'HISTORICAL_SOURCE_UNVERIFIED'};
 if(snapshot.inFlight!==null)return {kind:'reconcile' as const,reason:'OPERATION_UNCONFIRMED'};
 if(!Array.isArray(snapshot.queries)||snapshot.queries.length!==2)return {kind:'reconcile' as const,reason:'QUERY_SET_INVALID'};
 if(!Array.isArray(snapshot.receipts))return {kind:'reconcile' as const,reason:'RECEIPTS_INVALID'};
 if(snapshot.manifestHash!==null&&(typeof snapshot.manifestHash!=='string'||!/^[a-f0-9]{64}$/.test(snapshot.manifestHash)))return {kind:'reconcile' as const,reason:'MANIFEST_INVALID'};
 const missingPage=(term:typeof HISTORICAL_CONCERT_TERMS[number],page:number)=>snapshot.manifestHash!==null||snapshot.receipts.length>0
  ?{kind:'reconcile' as const,reason:'PAGES_LOST_AFTER_MANIFEST'}:{kind:'fetch_page' as const,term,page};
 for(const term of HISTORICAL_CONCERT_TERMS){
  const found=snapshot.queries.filter(q=>q&&q.term===term);
  if(found.length!==1||!Array.isArray(found[0].pages))return {kind:'reconcile' as const,reason:'QUERY_SET_INVALID'};
  const pages=found[0].pages;
  if(!pages.length)return missingPage(term,0);
  const first=pages[0];
  if(!first||!Number.isSafeInteger(first.totalEdictes)||first.totalEdictes<0||!Number.isSafeInteger(first.totalPages)||first.totalPages<0)return {kind:'reconcile' as const,reason:'PAGINATION_INVALID'};
  const total=first.totalEdictes===0?1:Math.ceil(first.totalEdictes/25);
  if(total>5000||!(first.totalPages===total||(first.totalEdictes===0&&first.totalPages===0))||pages.length>total)return {kind:'reconcile' as const,reason:'PAGINATION_INVALID'};
  for(let index=0;index<pages.length;index++){
   const page=pages[index],size=Math.min(25,Math.max(0,first.totalEdictes-index*25));
   if(!page||page.currentPage!==index||page.totalPages!==first.totalPages||page.totalEdictes!==first.totalEdictes||!Array.isArray(page.edictes)||page.edictes.length!==size)
    return {kind:'reconcile' as const,reason:'PAGINATION_CHANGED'};
  }
  if(pages.length<total)return missingPage(term,pages.length);
 }
 let plan:ReturnType<typeof buildHistoricalConcertImportPlan>;
 try {plan=buildHistoricalConcertImportPlan(snapshot.queries,snapshot.retrievedAt);}
 catch {return {kind:'reconcile' as const,reason:'SCAN_INCOMPLETE'};}
 const manifestHash=digest({window:plan.window,coverage:plan.coverage,rows:plan.rows});
 if(snapshot.manifestHash===null){
  if(snapshot.receipts.length)return {kind:'reconcile' as const,reason:'MANIFEST_MISSING'};
  return {kind:'persist_manifest' as const,manifestHash,rows:plan.rows};
 }
 if(snapshot.manifestHash!==manifestHash)return {kind:'reconcile' as const,reason:'MANIFEST_CHANGED'};
 const expected=new Map(plan.rows.map(r=>[r.source_record_id,r.source_payload_hash])),seen=new Set<string>();
 for(const receipt of snapshot.receipts){
  if(!receipt||!['inserted','already_present'].includes(receipt.outcome)||seen.has(receipt.sourceRecordId)||!expected.has(receipt.sourceRecordId)||expected.get(receipt.sourceRecordId)!==receipt.payloadHash)
   return {kind:'reconcile' as const,reason:'RECEIPT_MISMATCH'};
  seen.add(receipt.sourceRecordId);
 }
 const remaining=plan.rows.filter(row=>!seen.has(row.source_record_id)).slice(0,50);
 if(remaining.length)return {kind:'import_batch' as const,batchKey:digest({manifestHash,ids:remaining.map(r=>r.source_record_id)}),rows:remaining};
 const check=checkHistoricalCompletion({...snapshot,state:'running'});
 return check.eligible?{kind:'verify_and_complete' as const,manifestHash}:{kind:'reconcile' as const,reason:check.reason};
}
