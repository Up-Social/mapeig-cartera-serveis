import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {configureProcessing} from '../lib/processing-activation';

function fixture(enabled=false) {
 const events:string[]=[];
 let row={enabled,reason:enabled?null:'recovery',updated_at:'initial'};
 const db={from:(table:string)=>{
  assert.equal(table,'app_settings');
  let expected:string|undefined,value:typeof row|undefined;
  const q={select:()=>q,eq:(key:string,input:string)=>{if(key==='updated_at')expected=input;return q;},
   update:(input:typeof row)=>{value=input;events.push('enable');return q;},
   upsert:(input:typeof row)=>{value=input;events.push('pause');return q;},
   maybeSingle:async()=>({data:{...row},error:null}),
   single:async()=>{if(expected&&expected!==row.updated_at)return {data:null,error:{code:'STALE'}};row=value!;return {data:{...row},error:null};}};return q;
 }} as unknown as SupabaseClient;
 return {db,events,state:()=>row,incident:()=>{row={enabled:false,reason:'new_incident',updated_at:'changed'};}};
}

test('manual pause never calls inventory or creates a probe',async()=>{
 const f=fixture(true);
 const result=await configureProcessing(f.db,false,{audit:async()=>{throw Error('inventory must not run');},probe:async()=>{throw Error('probe must not run');}});
 assert.equal(result.enabled,false);assert.equal(result.reason,'operator_pause');assert.deepEqual(f.events,['pause']);
});

test('unsafe or active inventory prevents the first paid probe',async()=>{
 for(const before of [{healthy:false,activeCount:0},{healthy:true,activeCount:1}]){
  const f=fixture();let calls=0;
  await assert.rejects(configureProcessing(f.db,true,{audit:async()=>before,probe:async()=>{calls++;}}),/PROCESSING_INVENTORY_UNSAFE/);
  assert.equal(calls,0);assert.equal(f.state().enabled,false);assert.deepEqual(f.events,[]);
 }
});

test('inventory connectivity failure or probe failure never enables processing',async()=>{
 for(const failAt of ['inventory','probe']){
  const f=fixture();let audits=0;
  await assert.rejects(configureProcessing(f.db,true,{audit:async()=>{audits++;if(failAt==='inventory')throw Error('INVENTORY_UNAVAILABLE');return {healthy:true,activeCount:0};},probe:async()=>{throw Error('PROBE_UNAVAILABLE');}}),/UNAVAILABLE/);
  assert.equal(audits,1);assert.equal(f.state().enabled,false);assert.deepEqual(f.events,[]);
 }
});

test('a failed second inventory prevents activation after a successful probe',async()=>{
 const f=fixture();let audits=0,probes=0;
 await assert.rejects(configureProcessing(f.db,true,{audit:async()=>({healthy:++audits===1,activeCount:0}),probe:async()=>{probes++;}}),/PROCESSING_INVENTORY_UNSAFE/);
 assert.equal(audits,2);assert.equal(probes,1);assert.equal(f.state().enabled,false);assert.deepEqual(f.events,[]);
});

test('concurrent shutdown during verification wins over activation',async()=>{
 const f=fixture();
 await assert.rejects(configureProcessing(f.db,true,{audit:async()=>({healthy:true,activeCount:0}),probe:async()=>{f.incident();}}),/PROCESSING_STATE_CHANGED/);
 assert.equal(f.state().enabled,false);assert.equal(f.state().reason,'new_incident');
});

test('activation checks inventory, probes, checks again, then performs a single CAS update',async()=>{
 const f=fixture();
 const result=await configureProcessing(f.db,true,{audit:async()=>{f.events.push('inventory');return {healthy:true,activeCount:0};},probe:async()=>{f.events.push('probe');}});
 assert.equal(result.enabled,true);assert.deepEqual(f.events,['inventory','probe','inventory','enable']);
 // No worker task queries or updates occur: old paused tasks remain untouched.
});
