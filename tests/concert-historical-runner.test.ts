import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nextHistoricalAction} from '../lib/concerts/historical-runner';
import {HISTORICAL_CONCERT_TERMS,type HistoricalQuery} from '../lib/concerts/historical-discovery';

test('a synthetic persisted snapshot resumes page collection, import and guarded closure',()=>{
 const queries:HistoricalQuery[]=HISTORICAL_CONCERT_TERMS.map(term=>({term,pages:[]}));
 const state={state:'running' as const,dispatch:'confirmed' as const,historicalSourceContract:'verified' as const,inFlight:null as null|{kind:'page'|'manifest'|'import'|'completion';id:string},queries,retrievedAt:'2026-10-29T12:00:00.000Z',manifestHash:null as string|null,receipts:[] as Array<{sourceRecordId:string;payloadHash:string;outcome:'inserted'|'already_present'}>};
 const restart=()=>JSON.parse(JSON.stringify(state)) as typeof state;
 assert.deepEqual(nextHistoricalAction(restart()),{kind:'fetch_page',term:HISTORICAL_CONCERT_TERMS[0],page:0});
 queries[0].pages.push({currentPage:0,totalPages:1,totalEdictes:1,edictes:[{id_edicte:'123',titol:'Concert social',descripcio:'',data_publicacio:'2022-01-01'}]});
 assert.deepEqual(nextHistoricalAction(restart()),{kind:'fetch_page',term:HISTORICAL_CONCERT_TERMS[1],page:0});
 queries[1].pages.push({currentPage:0,totalPages:0,totalEdictes:0,edictes:[]});
 const manifest=nextHistoricalAction(restart());assert.equal(manifest.kind,'persist_manifest');
 if(manifest.kind!=='persist_manifest')throw Error('Expected manifest');
 state.manifestHash=manifest.manifestHash;
 const batch=nextHistoricalAction(restart());assert.equal(batch.kind,'import_batch');
 if(batch.kind!=='import_batch')throw Error('Expected batch');
 assert.deepEqual(nextHistoricalAction(restart()),batch); // stable idempotency key across process restart
 assert.deepEqual(nextHistoricalAction({...restart(),inFlight:{kind:'import',id:batch.batchKey}}),{kind:'reconcile',reason:'OPERATION_UNCONFIRMED'});
 assert.deepEqual(nextHistoricalAction({...restart(),state:'uncertain'}),{kind:'reconcile',reason:'EXECUTION_UNCERTAIN'});
 state.receipts.push({sourceRecordId:batch.rows[0].source_record_id,payloadHash:batch.rows[0].source_payload_hash,outcome:'inserted'});
 assert.deepEqual(nextHistoricalAction(restart()),{kind:'verify_and_complete',manifestHash:manifest.manifestHash});
 assert.deepEqual(nextHistoricalAction({...restart(),state:'completed'}),{kind:'finished'});
 assert.deepEqual(nextHistoricalAction({...restart(),dispatch:'unknown'}),{kind:'reconcile',reason:'EXECUTION_UNCERTAIN'});
 assert.deepEqual(nextHistoricalAction({...restart(),historicalSourceContract:'unverified'}),{kind:'reconcile',reason:'HISTORICAL_SOURCE_UNVERIFIED'});
 assert.deepEqual(nextHistoricalAction({...restart(),manifestHash:'a'.repeat(64)}),{kind:'reconcile',reason:'MANIFEST_CHANGED'});
 assert.deepEqual(nextHistoricalAction({...restart(),manifestHash:null}),{kind:'reconcile',reason:'MANIFEST_MISSING'});
 assert.deepEqual(nextHistoricalAction({...restart(),queries:[queries[0],{...queries[1],pages:[]}]}),{kind:'reconcile',reason:'PAGES_LOST_AFTER_MANIFEST'});
 assert.deepEqual(nextHistoricalAction({...restart(),receipts:[{...state.receipts[0],payloadHash:'b'.repeat(64)}]}),{kind:'reconcile',reason:'RECEIPT_MISMATCH'});
});
