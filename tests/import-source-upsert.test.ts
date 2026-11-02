import {test} from 'node:test';
import assert from 'node:assert/strict';
import {upsertImportedSourceBatch} from '../lib/pipeline/import-source-upsert';

const busy=()=>({code:'40001',message:'T19_DEDUP_BUSY'});

test('only a confirmed deduplication conflict retries the identical batch before succeeding',async()=>{
 const rows=[{source_dataset:'contractacions',source_record_id:'synthetic',title:'Fixture'}];
 const seen:unknown[]=[];const waits:number[]=[];let calls=0;
 await upsertImportedSourceBatch(async()=>{seen.push(rows);calls++;return {error:calls<3?busy():null};},async ms=>{waits.push(ms);});
 assert.equal(calls,3);assert.ok(seen.every(batch=>batch===rows));assert.deepEqual(waits,[1000,2000]);
});

test('retries stop after three confirmed conflicts and preserve the database error',async()=>{
 const error=busy();let calls=0;const waits:number[]=[];
 await assert.rejects(upsertImportedSourceBatch(async()=>{calls++;return {error};},async ms=>{waits.push(ms);}),e=>e===error);
 assert.equal(calls,3);assert.deepEqual(waits,[1000,2000]);
});

test('network uncertainty, other serialization failures and unrelated errors never retry',async()=>{
 for(const error of [{code:'40001',message:'stale review'}, {code:'40001',message:'T19_DEDUP_BUSY extra'}, {code:'XX000',message:'T19_DEDUP_BUSY'}, {code:'',message:'fetch failed'}]){
  let calls=0;await assert.rejects(upsertImportedSourceBatch(async()=>{calls++;return {error};},async()=>{throw Error('unexpected delay');}),e=>e===error);assert.equal(calls,1);
 }
});

test('a thrown or rejected request is not automatically repeated',async()=>{
 const error=Error('unknown request outcome');let calls=0;
 await assert.rejects(upsertImportedSourceBatch(async()=>{calls++;throw error;},async()=>{throw Error('unexpected delay');}),e=>e===error);
 assert.equal(calls,1);
});


test('a thrown conflict is not assumed to be a confirmed database rollback',async()=>{
 const error=busy();let calls=0;
 await assert.rejects(upsertImportedSourceBatch(async()=>{calls++;throw error;},async()=>{throw Error('unexpected delay');}),e=>e===error);
 assert.equal(calls,1);
});
