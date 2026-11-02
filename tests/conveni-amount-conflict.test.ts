import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runConveniAmountTransaction} from '../lib/convenis/amount-migration';

const entry={id:'record',source_record_id:'synthetic',operation_id:'operation',source_hash:'hash',before_amount:2000};
const busy={code:'40001',message:'T19_DEDUP_BUSY'};
test('apply and revert retry only the exact conflict with identical operation scope',async()=>{
 for(const revert of [false,true]){
  const calls:Array<{name:string;args:unknown}>=[];const waits:number[]=[];
  const db={rpc:async(name:string,args:unknown)=>{calls.push({name,args});return {error:calls.length===1?busy:null};}};
  await runConveniAmountTransaction(db as never,entry,revert,async ms=>{waits.push(ms);});
  assert.equal(calls.length,2);assert.deepEqual(calls[1],calls[0]);assert.deepEqual(waits,[1000]);
  assert.equal(calls[0].name,revert?'revert_conveni_amount':'migrate_conveni_amount');
  assert.deepEqual(calls[0].args,revert?{p_operation:'operation'}:{p_record:'record',p_operation:'operation',p_hash:'hash',p_before:2000});
 }
});
test('unknown outcomes, stale reviews and other errors are not retried',async()=>{
 for(const error of [{code:'40001',message:'Simulació obsoleta'},{code:'',message:'fetch failed'},{code:'P0001',message:'T19_DEDUP_BUSY'}]){
  let calls=0;const db={rpc:async()=>{calls++;return {error};}};
  await assert.rejects(runConveniAmountTransaction(db as never,entry,false,async()=>{throw Error('unexpected delay');}),/Completed operations remain journaled/);
  assert.equal(calls,1);
 }
});
test('the retry limit preserves the original failure and never reports success',async()=>{
 let calls=0;const db={rpc:async()=>{calls++;return {error:busy};}};
 await assert.rejects(runConveniAmountTransaction(db as never,entry,true,async()=>{}),e=>e instanceof Error&&e.cause===busy);
 assert.equal(calls,3);
});
