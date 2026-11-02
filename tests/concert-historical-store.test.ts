import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createExperimentalHistoricalStore} from '../lib/concerts/historical-experimental-store';
import {HISTORICAL_CONCERT_TERMS} from '../lib/concerts/historical-discovery';

const lease={owner:'synthetic',generation:2};
const snapshot={state:'running',dispatch:'confirmed',historicalSourceContract:'verified',inFlight:null,
 queries:HISTORICAL_CONCERT_TERMS.map(term=>({term,pages:[]})),retrievedAt:'2026-10-29T00:00:00.000Z',manifestHash:null,receipts:[]};
test('injected PostgREST adapter preserves CAS, intent, lease and operation arguments',async()=>{
 const calls:Array<{name:string;args:Record<string,unknown>}>=[];
 const client={async rpc(name:string,args:Record<string,unknown>){calls.push({name,args});
  return {error:null,data:name.endsWith('_read')?{revision:'7',snapshot}:name.endsWith('_reconcile_db')?'no_commit_confirmed':true};}};
 const {store,reconcileDatabaseOperation}=createExperimentalHistoricalStore(client);
 assert.equal((await store.read('attempt',lease)).revision,'7');
 const reservation={id:'a'.repeat(64),action:{kind:'fetch_page' as const,term:HISTORICAL_CONCERT_TERMS[0],page:0},
  progress:{phase:'reading_pages' as const,pagesRead:0,pagesTotal:null,recordsSaved:0,recordsTotal:null}};
 assert.equal(await store.begin('attempt',lease,'7',reservation),true);
 await store.apply('attempt',lease,reservation,{page:{currentPage:0,totalPages:0,totalEdictes:0,edictes:[]}});
 assert.equal(await reconcileDatabaseOperation('attempt',lease,reservation.id),'no_commit_confirmed');
 assert.deepEqual(calls.map(c=>c.name),['experimental_history_read','experimental_history_begin','experimental_history_apply','experimental_history_reconcile_db']);
 for(const call of calls){assert.equal(call.args.p_attempt,'attempt');assert.equal(call.args.p_owner,'synthetic');assert.equal(call.args.p_generation,2);}
 assert.equal(calls[1].args.p_revision,'7');assert.deepEqual(calls[1].args.p_reservation,reservation);
});
test('RPC errors and malformed or ambiguous responses fail closed',async()=>{
 const failed=createExperimentalHistoricalStore({async rpc(){return {data:null,error:{code:'synthetic'}};}});
 await assert.rejects(failed.store.read('attempt',lease),/HISTORY_STORE_UNAVAILABLE/);
 const malformed=createExperimentalHistoricalStore({async rpc(){return {data:{revision:7,snapshot},error:null};}});
 await assert.rejects(malformed.store.read('attempt',lease),/HISTORY_STORE_INVALID/);
 const unexpected=createExperimentalHistoricalStore({async rpc(){return {data:'maybe',error:null};}});
 await assert.rejects(unexpected.reconcileDatabaseOperation('attempt',lease,'a'.repeat(64)),/HISTORY_STORE_INVALID/);
});
