import {test} from 'node:test';
import assert from 'node:assert/strict';
import {conveniBatchState,mergeConveniBatchAttention} from '../lib/convenis/batch-state';
import {currentAttentionCounts} from '../lib/batch-list';
test('approved with pending units remains visible for review without double-counting the record',()=>{
 const states=[{source_record_id:'a',approved_units:2,pending_units:1},{source_record_id:'b',approved_units:0,pending_units:2},{source_record_id:'c',approved_units:1,pending_units:0}];
 assert.deepEqual(states.map(conveniBatchState),['partial','review','approved']);
 const rows=[{id:'a',run_id:'run',destination:'approved',classification:'in_portfolio'},{id:'b',run_id:'run',destination:'review',classification:null},{id:'c',run_id:'run',destination:'approved',classification:'in_portfolio'}];
 const merged=mergeConveniBatchAttention(rows,states);assert.deepEqual(merged.map(r=>r.destination),['review','review','approved']);
 assert.equal(currentAttentionCounts(merged).get('run')?.review,2);assert.equal(rows[0].destination,'approved');
});

test('partial state gives review guidance instead of a completed result',async()=>{
 const {batchResultGuidance}=await import('../lib/batch-result-guidance');
 const guidance=batchResultGuidance({status:'approved',conveniState:'partial',currentDestination:'review'} as Parameters<typeof batchResultGuidance>[0]);
 assert.equal(guidance.kind,'review');assert.equal(guidance.label,'Aprovat amb unitats pendents');
});
