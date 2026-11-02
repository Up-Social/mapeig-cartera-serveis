import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LocalTypeBlocked} from '../lib/pipeline/local-matching-guard';
import {runLocalWorkerLoop} from '../lib/pipeline/local-worker-loop';

test('permanent worker waits on blocked tasks and processes compatible work arriving later',async()=>{
 let reads=0,waits=0,notices=0,stopping=false;const executed:string[]=[];
 await runLocalWorkerLoop({once:false,isStopping:()=>stopping,
  claim:async()=>{reads++;if(reads<=2)throw new LocalTypeBlocked();return 'compatible';},
  execute:async task=>{executed.push(task);stopping=true;},wait:async()=>{waits++;},
  onBlocked:()=>{notices++;},onError:()=>assert.fail('unexpected queue error')});
 assert.equal(reads,3);assert.equal(waits,2);assert.equal(notices,1);assert.deepEqual(executed,['compatible']);
});
test('one-shot worker reports blocked task without waiting or executing',async()=>{
 let waits=0,executions=0,notices=0;
 await assert.rejects(runLocalWorkerLoop({once:true,isStopping:()=>false,claim:async()=>{throw new LocalTypeBlocked();},
  execute:async()=>{executions++;},wait:async()=>{waits++;},onBlocked:()=>{notices++;},onError:()=>assert.fail('unexpected queue error')}),/LOCAL_TYPE_BLOCKED/);
 assert.deepEqual([waits,executions,notices],[0,0,1]);
});
test('empty one-shot queue and ordinary transient errors retain their previous behavior',async()=>{
 let waits=0,errors=0,stopping=false;
 await runLocalWorkerLoop({once:true,isStopping:()=>false,claim:async()=>null,execute:async()=>assert.fail(),wait:async()=>{waits++;},onBlocked:()=>assert.fail(),onError:()=>assert.fail()});
 await runLocalWorkerLoop({once:false,isStopping:()=>stopping,claim:async()=>{throw Error('queue');},execute:async()=>assert.fail(),wait:async()=>{waits++;stopping=true;},onBlocked:()=>assert.fail(),onError:()=>{errors++;}});
 assert.deepEqual([waits,errors],[1,1]);
});
