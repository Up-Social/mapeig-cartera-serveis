import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {ConveniIndependentReadUnavailable,requireConsistentConveniReads} from '../lib/convenis/independent-read-guard';
const db=(value:unknown,error:unknown=null)=>({from:(name:string)=>{assert.equal(name,'app_settings');return {select:()=>({eq:()=>({maybeSingle:async()=>({data:value,error})})})};}} as unknown as SupabaseClient);
test('compatibility marker fails closed on rollback, partial flags and read errors',async()=>{
 const a=process.env.CONVENI_INDEPENDENT_REVIEW_ENABLED,b=process.env.CONVENI_INDEPENDENT_READERS_READY,legacy=process.env.LOCAL_REMOTE_LEGACY_SCHEMA;
 try{
  delete process.env.CONVENI_INDEPENDENT_REVIEW_ENABLED;delete process.env.CONVENI_INDEPENDENT_READERS_READY;
  await requireConsistentConveniReads(db(null)); // old schema, before candidate migration
  await requireConsistentConveniReads(db({enabled:false}));
  await assert.rejects(requireConsistentConveniReads(db({enabled:true})),ConveniIndependentReadUnavailable);
  await assert.rejects(requireConsistentConveniReads(db(null,{code:'PGRST202'})),ConveniIndependentReadUnavailable);
  await assert.rejects(requireConsistentConveniReads({from:()=>{throw Error('network');}} as unknown as SupabaseClient),ConveniIndependentReadUnavailable);
  await assert.rejects(requireConsistentConveniReads(db({enabled:null})),ConveniIndependentReadUnavailable);
  process.env.CONVENI_INDEPENDENT_REVIEW_ENABLED='true';
  await assert.rejects(requireConsistentConveniReads(db({enabled:false})),ConveniIndependentReadUnavailable);
  process.env.CONVENI_INDEPENDENT_READERS_READY='true';
  await assert.rejects(requireConsistentConveniReads(db(null)),ConveniIndependentReadUnavailable);
  await requireConsistentConveniReads(db({enabled:false}));await requireConsistentConveniReads(db({enabled:true}));
  process.env.LOCAL_REMOTE_LEGACY_SCHEMA='true';await assert.rejects(requireConsistentConveniReads(db({enabled:true})),ConveniIndependentReadUnavailable);delete process.env.LOCAL_REMOTE_LEGACY_SCHEMA;
  delete process.env.CONVENI_INDEPENDENT_REVIEW_ENABLED;
  await assert.rejects(requireConsistentConveniReads(db({enabled:true})),ConveniIndependentReadUnavailable);
 }finally{if(a===undefined)delete process.env.CONVENI_INDEPENDENT_REVIEW_ENABLED;else process.env.CONVENI_INDEPENDENT_REVIEW_ENABLED=a;if(b===undefined)delete process.env.CONVENI_INDEPENDENT_READERS_READY;else process.env.CONVENI_INDEPENDENT_READERS_READY=b;if(legacy===undefined)delete process.env.LOCAL_REMOTE_LEGACY_SCHEMA;else process.env.LOCAL_REMOTE_LEGACY_SCHEMA=legacy;}
});
