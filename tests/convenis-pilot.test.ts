import test from 'node:test';
import assert from 'node:assert/strict';
import {assertPilotTarget,pilotRequest,pilotUsageCost,PILOT_API,PILOT_PROJECT,type PilotReceipt} from '../lib/convenis/pilot-budget';
const members=[{database_id:'approved',official_id:'2024/11/2476',expected_ai_calls:1},{database_id:'excluded',official_id:'2024/5/0721',expected_ai_calls:0}];
const body={model:'gpt-6-luna',max_output_tokens:16000,input:'Evidence',instructions:'Test'};
test('pilot rejects every target except its explicit local project',()=>{
 assert.doesNotThrow(()=>assertPilotTarget(PILOT_API,PILOT_PROJECT));
 for(const url of ['https://vvzxlevbfjvzygorbpxn.supabase.co','http://127.0.0.1:55421','http://127.0.0.1:55431/','http://127.0.0.1:55431@evil.test'])assert.throws(()=>assertPilotTarget(url,PILOT_PROJECT));
 assert.throws(()=>assertPilotTarget(PILOT_API,'cartera-workflow-test'));
});
test('pilot allows only selected paid records and approved model/output',()=>{
 assert.throws(()=>pilotRequest(body,'excluded',members,[]));assert.throws(()=>pilotRequest(body,'other',members,[]));
 assert.throws(()=>pilotRequest({...body,model:'other'},'approved',members,[]));
 assert.throws(()=>pilotRequest({...body,max_output_tokens:32000},'approved',members,[]));
 assert.deepEqual((pilotRequest(body,'approved',members,[]).request as Record<string,unknown>).reasoning,{effort:'none'});
});
test('pilot blocks unknown outcomes, exhausted budget, and a fourth repetition',()=>{
 const receipt:PilotReceipt={recordId:'approved',requestHash:'hash',reserved:.3,state:'sending'};
 assert.throws(()=>pilotRequest(body,'approved',members,[receipt]),/UNKNOWN/);
 assert.throws(()=>pilotRequest(body,'approved',members,[{...receipt,state:'received',actual:6}]),/TOTAL_BUDGET/);
 assert.throws(()=>pilotRequest(body,'approved',members,Array.from({length:4},()=>({...receipt,state:'received'}))),/CALL_LIMIT/);
 assert.throws(()=>pilotRequest({...body,input:'x'.repeat(1050000)},'approved',members,[]),/TOO_LARGE/);
});
test('pilot computes measured cost including cache and long context; invalid usage retains reservation',()=>{
 assert.equal(pilotUsageCost({input_tokens:100000,output_tokens:4000},200000),.012);
 assert.equal(pilotUsageCost({input_tokens:300000,output_tokens:4000},400000),.063);
 assert.equal(pilotUsageCost({input_tokens:100000,output_tokens:4000,input_tokens_details:{cached_tokens:50000,cache_write_tokens:10000}},200000),.00775);
 for(const usage of [null,{}, {input_tokens:300,output_tokens:-1},{input_tokens:300001,output_tokens:1},{input_tokens:1,output_tokens:16001},{input_tokens:1.2,output_tokens:1}])assert.throws(()=>pilotUsageCost(usage,300000));
});
