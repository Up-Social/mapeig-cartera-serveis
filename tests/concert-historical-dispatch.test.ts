import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dispatchHistoricalOnce,type HistoricalDispatcher} from '../lib/concerts/historical-dispatch';

test('disabled or unconfirmed reservation never dispatches a workflow',async()=>{
 let starts=0,reserves=0;
 const dispatcher:HistoricalDispatcher={async reserve(){reserves++;throw Error('unknown commit');},async start(){starts++;return 'w';},async confirm(){throw Error('unexpected');},async markUnknown(){throw Error('unexpected');}};
 assert.equal((await dispatchHistoricalOnce({enabled:false,dispatcher})).status,'disabled');assert.equal(reserves,0);
 assert.equal((await dispatchHistoricalOnce({enabled:true,dispatcher})).status,'review_required');assert.equal(reserves,1);assert.equal(starts,0);
});
test('timeout never sends a second workflow, even after a late response',async()=>{
 let starts=0,unknown=0,confirms=0;let finish!:(value:string)=>void;
 const late=new Promise<string>(resolve=>{finish=resolve;});
 const dispatcher:HistoricalDispatcher={async reserve(){return true;},async start(){starts++;return late;},async confirm(){confirms++;},async markUnknown(){unknown++;}};
 const result=await dispatchHistoricalOnce({enabled:true,dispatcher,timeoutMs:10});
 assert.equal(result.status,'review_required');finish('late');await late;await Promise.resolve();
 assert.equal(starts,1);assert.equal(unknown,1);assert.equal(confirms,0);
});
test('confirmed dispatch and existing reservation have distinct outcomes',async()=>{
 let starts=0,confirms=0;let acquired=true;
 const dispatcher:HistoricalDispatcher={async reserve(){return acquired;},async start(){starts++;return 'workflow';},async confirm(){confirms++;},async markUnknown(){throw Error('unexpected');}};
 assert.equal((await dispatchHistoricalOnce({enabled:true,dispatcher})).status,'started');
 acquired=false;assert.equal((await dispatchHistoricalOnce({enabled:true,dispatcher})).status,'already_reserved');
 assert.equal(starts,1);assert.equal(confirms,1);
});
test('a reservation timeout cannot cause a later dispatch when the database replies late',async()=>{
 let finish!:(value:boolean)=>void;let starts=0;
 const late=new Promise<boolean>(resolve=>{finish=resolve;});
 const dispatcher:HistoricalDispatcher={async reserve(){return late;},async start(){starts++;return 'workflow';},async confirm(){throw Error('unexpected');},async markUnknown(){throw Error('unexpected');}};
 assert.equal((await dispatchHistoricalOnce({enabled:true,dispatcher,timeoutMs:10})).status,'review_required');
 finish(true);await late;await Promise.resolve();assert.equal(starts,0);
});
test('unavailable uncertainty marker cannot hang the request indefinitely',async()=>{
 const dispatcher:HistoricalDispatcher={async reserve(){return true;},async start(){throw Error('unknown');},async confirm(){throw Error('unexpected');},async markUnknown(){return new Promise<void>(()=>{});}};
 const result=await dispatchHistoricalOnce({enabled:true,dispatcher,timeoutMs:10});
 assert.equal(result.status,'review_required');assert.equal('reason' in result&&result.reason,'DISPATCH_UNCONFIRMED');
});
test('lost confirmation is reported for reconciliation without restarting the workflow',async()=>{
 let starts=0,marked=0,finish!:()=>void;
 const late=new Promise<void>(resolve=>{finish=resolve;});
 const dispatcher:HistoricalDispatcher={async reserve(){return true;},async start(){starts++;return 'workflow';},async confirm(){await late;},async markUnknown(){marked++;}};
 const result=await dispatchHistoricalOnce({enabled:true,dispatcher,timeoutMs:10});
 assert.equal(result.status,'review_required');finish();await late;await Promise.resolve();
 assert.equal(starts,1);assert.equal(marked,1);
});
