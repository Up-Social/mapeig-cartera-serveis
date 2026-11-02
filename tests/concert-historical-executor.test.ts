import {test} from 'node:test';
import assert from 'node:assert/strict';
import {advanceHistoricalRecovery,type HistoricalStore,type HistoricalSource} from '../lib/concerts/historical-executor';
import {HISTORICAL_CONCERT_TERMS,type HistoricalPage,type HistoricalQuery} from '../lib/concerts/historical-discovery';
import {checkHistoricalCompletion} from '../lib/concerts/historical-completion';
import type {HistoricalSnapshot} from '../lib/concerts/historical-runner';

const attemptId='synthetic-attempt',lease={owner:'synthetic-owner',generation:1};
function fixture(count=1){
 let revision=0,calls=0,active=false;
 let fault:''|'begin_lost'|'apply_before'|'apply_after'|'source_error'|'source_bad_page'='';
 const queries:HistoricalQuery[]=HISTORICAL_CONCERT_TERMS.map(term=>({term,pages:[]}));
 const snapshot:HistoricalSnapshot={state:'running',dispatch:'confirmed',historicalSourceContract:'verified',inFlight:null,queries,retrievedAt:'2026-10-29T12:00:00.000Z',manifestHash:null,receipts:[]};
 let savedProgress:unknown=null;
 const source:HistoricalSource={async readPage(term,page){
  calls++;
  if(fault==='source_error')throw Error('synthetic failure');
  const rows=term===HISTORICAL_CONCERT_TERMS[0]?Array.from({length:count},(_,i)=>({id_edicte:String(i+1),titol:`Concert social ${i+1}`,descripcio:'',data_publicacio:'2021-01-01'})):[];
  return {currentPage:fault==='source_bad_page'?page+1:page,totalPages:Math.ceil(rows.length/25),totalEdictes:rows.length,edictes:rows.slice(page*25,(page+1)*25)} satisfies HistoricalPage;
 }};
 const store:HistoricalStore={
  async read(id,requested){if(id!==attemptId||requested.owner!==lease.owner||requested.generation!==lease.generation)throw Error('lease');return {revision:String(revision),snapshot:structuredClone(snapshot)};},
  async begin(id,requested,expected,reservation){
   if(id!==attemptId||requested.owner!==lease.owner||requested.generation!==lease.generation||expected!==String(revision)||active||snapshot.inFlight)return false;
   const kinds={fetch_page:'page',persist_manifest:'manifest',import_batch:'import',verify_and_complete:'completion'} as const;
   active=true;snapshot.inFlight={kind:kinds[reservation.action.kind],id:reservation.id};savedProgress=reservation.progress;revision++;
   if(fault==='begin_lost')throw Error('commit response lost');
   return true;
  },
  async apply(id,requested,reservation,result){
   if(id!==attemptId||requested.owner!==lease.owner||requested.generation!==lease.generation||snapshot.inFlight?.id!==reservation.id)throw Error('lease or intent');
   if(fault==='apply_before')throw Error('commit did not happen');
   const action=reservation.action;
   if(action.kind==='fetch_page'){
    if(!result.page)throw Error('page');
    const query=snapshot.queries.find(q=>q.term===action.term);if(!query||query.pages.length!==action.page)throw Error('cursor');
    query.pages.push(structuredClone(result.page));
   }else if(action.kind==='persist_manifest')snapshot.manifestHash=action.manifestHash;
   else if(action.kind==='import_batch')snapshot.receipts=[...snapshot.receipts,...action.rows.map(row=>({sourceRecordId:row.source_record_id,payloadHash:row.source_payload_hash,outcome:'inserted' as const}))];
   else if(action.kind==='verify_and_complete'){
    if(snapshot.manifestHash!==action.manifestHash||!checkHistoricalCompletion({...snapshot,state:'running'}).eligible)throw Error('incomplete');
    snapshot.state='completed';
   }
   snapshot.inFlight=null;active=false;revision++;
   if(fault==='apply_after')throw Error('commit response lost');
  },
 };
 const run=()=>advanceHistoricalRecovery({attemptId,lease,store,source});
 return {snapshot,run,source,store,get calls(){return calls;},get progress(){return savedProgress;},setFault(value:typeof fault){fault=value;},
  reconcileKnownNoCommit(){snapshot.inFlight=null;active=false;revision++;}};
}

test('executor persists progress and finishes only after both queries and all receipts',async()=>{
 const f=fixture();
 const actions=[];
 for(let i=0;i<10;i++){const result=await f.run();if(result.status==='completed')break;assert.equal(result.status,'advanced');if(result.status==='advanced')actions.push(result.action);}
 assert.deepEqual(actions,['fetch_page','fetch_page','persist_manifest','import_batch','verify_and_complete']);
 assert.equal(f.calls,2);assert.equal(f.snapshot.state,'completed');assert.equal(f.snapshot.receipts.length,1);
 assert.deepEqual(f.progress,{phase:'verifying',pagesRead:2,pagesTotal:2,recordsSaved:1,recordsTotal:1});
 assert.deepEqual(await f.run(),{status:'completed'});
});
test('concurrent workers reserve one operation and make only one source call',async()=>{
 const f=fixture();const results=await Promise.all([f.run(),f.run()]);
 assert.deepEqual(results.map(r=>r.status).sort(),['advanced','yield']);assert.equal(f.calls,1);
});
test('source errors or malformed responses keep the intent and do not retry implicitly',async()=>{
 for(const fault of ['source_error','source_bad_page'] as const){
  const f=fixture();f.setFault(fault);assert.equal((await f.run()).status,'reconcile');assert.equal(f.snapshot.inFlight?.kind,'page');
  f.setFault('');assert.deepEqual(await f.run(),{status:'reconcile',reason:'OPERATION_UNCONFIRMED'});assert.equal(f.calls,1);
  f.reconcileKnownNoCommit();assert.equal((await f.run()).status,'advanced');assert.equal(f.calls,2);
 }
});
test('lost reservation or commit response never starts an unconfirmed operation twice',async()=>{
 const reserved=fixture();reserved.setFault('begin_lost');assert.deepEqual(await reserved.run(),{status:'reconcile',reason:'RESERVATION_UNCONFIRMED'});
 reserved.setFault('');assert.deepEqual(await reserved.run(),{status:'reconcile',reason:'OPERATION_UNCONFIRMED'});assert.equal(reserved.calls,0);
 const committed=fixture();committed.setFault('apply_after');assert.equal((await committed.run()).status,'reconcile');assert.equal(committed.calls,1);
 committed.setFault('');assert.equal((await committed.run()).status,'advanced');assert.equal(committed.calls,2);
 assert.equal(committed.snapshot.queries[0].pages.length,1);assert.equal(committed.snapshot.queries[1].pages.length,1);
});
test('partial import remains resumable only after reconciliation of the uncertain batch',async()=>{
 const f=fixture(51);
 for(let i=0;i<5;i++)assert.equal((await f.run()).status,'advanced'); // three pages, second term, manifest
 assert.equal((await f.run()).status,'advanced');assert.equal(f.snapshot.receipts.length,50);
 f.setFault('apply_before');assert.equal((await f.run()).status,'reconcile');assert.equal(f.snapshot.receipts.length,50);
 f.setFault('');assert.deepEqual(await f.run(),{status:'reconcile',reason:'OPERATION_UNCONFIRMED'});
 f.reconcileKnownNoCommit();assert.equal((await f.run()).status,'advanced');assert.equal(f.snapshot.receipts.length,51);
 assert.equal((await f.run()).status,'advanced');assert.equal((await f.run()).status,'completed');
});
test('unverified source capability or uncertain dispatch never call the source',async()=>{
 const f=fixture();f.snapshot.historicalSourceContract='unverified';assert.deepEqual(await f.run(),{status:'reconcile',reason:'HISTORICAL_SOURCE_UNVERIFIED'});assert.equal(f.calls,0);
 f.snapshot.historicalSourceContract='verified';f.snapshot.dispatch='unknown';assert.deepEqual(await f.run(),{status:'reconcile',reason:'EXECUTION_UNCERTAIN'});assert.equal(f.calls,0);
});
test('timeout aborts a source read, preserves intent and never silently retries',async()=>{
 const f=fixture();let aborted=false,calls=0;
 const hanging:HistoricalSource={readPage(_term,_page,signal){calls++;signal.addEventListener('abort',()=>{aborted=true;});return new Promise(()=>{});}};
 const run=()=>advanceHistoricalRecovery({attemptId,lease,store:f.store,source:hanging,pageTimeoutMs:10});
 assert.deepEqual(await run(),{status:'reconcile',reason:'OPERATION_UNCONFIRMED'});assert.equal(aborted,true);assert.equal(calls,1);
 assert.deepEqual(await run(),{status:'reconcile',reason:'OPERATION_UNCONFIRMED'});assert.equal(calls,1);
});
