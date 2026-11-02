import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkHistoricalCompletion} from '../lib/concerts/historical-completion';
import {buildHistoricalConcertImportPlan} from '../lib/concerts/historical-import-plan';
import {HISTORICAL_CONCERT_TERMS,type HistoricalQuery} from '../lib/concerts/historical-discovery';
const queries:HistoricalQuery[]=[
 {term:HISTORICAL_CONCERT_TERMS[0],pages:[{currentPage:0,totalPages:1,totalEdictes:1,edictes:[{id_edicte:'9',titol:'Concert social',descripcio:'',data_publicacio:'2021-02-01'}]}]},
 {term:HISTORICAL_CONCERT_TERMS[1],pages:[{currentPage:0,totalPages:0,totalEdictes:0,edictes:[]}]},
];
const retrievedAt='2026-10-29T12:00:00.000Z';
const row=buildHistoricalConcertImportPlan(queries,retrievedAt).rows[0];
const receipt={sourceRecordId:row.source_record_id,payloadHash:row.source_payload_hash,outcome:'inserted' as const};
const complete={state:'running' as const,dispatch:'confirmed' as const,historicalSourceContract:'verified' as const,queries,retrievedAt,receipts:[receipt]};
test('completion eligibility requires a confirmed dispatch, complete pages and matching receipts',()=>{
 assert.deepEqual(checkHistoricalCompletion(complete),{eligible:true,reason:'PAGES_AND_RECEIPTS_MATCH'});
 assert.equal(checkHistoricalCompletion({...complete,state:'uncertain'}).reason,'EXECUTION_UNCERTAIN');
 assert.equal(checkHistoricalCompletion({...complete,dispatch:'unknown'}).reason,'EXECUTION_UNCERTAIN');
 assert.equal(checkHistoricalCompletion({...complete,historicalSourceContract:'unverified'}).reason,'HISTORICAL_SOURCE_UNVERIFIED');
 assert.equal(checkHistoricalCompletion({...complete,queries:queries.slice(0,1)}).reason,'SCAN_INCOMPLETE');
 assert.equal(checkHistoricalCompletion({...complete,receipts:[]}).reason,'RECEIPTS_INCOMPLETE');
 assert.equal(checkHistoricalCompletion({...complete,receipts:[{...receipt,payloadHash:'0'.repeat(64)}]}).reason,'RECEIPT_MISMATCH');
 assert.equal(checkHistoricalCompletion({...complete,receipts:[{...receipt,sourceRecordId:'etauler:1:10'}]}).reason,'RECEIPT_MISMATCH');
 assert.equal(checkHistoricalCompletion({...complete,receipts:[receipt,receipt]}).reason,'RECEIPTS_INCOMPLETE');
 const empty:HistoricalQuery[]=queries.map(q=>({...q,pages:[{currentPage:0,totalPages:0,totalEdictes:0,edictes:[]}]}));
 assert.equal(checkHistoricalCompletion({...complete,queries:empty,receipts:[]}).eligible,true);
 const doubled:HistoricalQuery[]=[{...queries[0],pages:[{...queries[0].pages[0],totalEdictes:2,edictes:[queries[0].pages[0].edictes[0],{...queries[0].pages[0].edictes[0],id_edicte:'10'}]}]},queries[1]];
 assert.equal(checkHistoricalCompletion({...complete,queries:doubled,receipts:[receipt,receipt]}).reason,'RECEIPT_MISMATCH');
});
test('explicitly requested scan can finish only its validated pages and receipts without claiming source exhaustiveness',()=>{
 const result=checkHistoricalCompletion({...complete,historicalSourceContract:'user_requested'});
 assert.equal(result.eligible,true);
});
