import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizePhases,type ProgressState} from '../lib/pipeline-progress';
test('phase categories reconcile exactly and expose blocking separately',()=>{
 const states:ProgressState[]=['completed','error','blocked','pending','running','blocked'];
 const result=summarizePhases(states);
 assert.equal(result.completed+result.errors+result.blocked!+result.pending!+result.running!,result.total);
 assert.equal(result.errors,1);assert.equal(result.blocked,2);
 assert.equal(summarizePhases(['blocked']).state,'blocked');
 assert.equal(summarizePhases([]).state,'completed');
});
