import {test} from 'node:test';import assert from 'node:assert/strict';import type {SupabaseClient} from '@supabase/supabase-js';
import {LineReadUnavailable,requireConsistentLineReads} from '../lib/concerts/line-read-guard';
test('disabling readers after a line exists fails closed instead of hiding it',async()=>{
 const beforeA=process.env.ENABLE_CONCERT_LINE_AWARDS,beforeB=process.env.CONCERT_LINE_READERS_READY;
 try{
  process.env.ENABLE_CONCERT_LINE_AWARDS='true';process.env.CONCERT_LINE_READERS_READY='true';
  const db={rpc:async()=>({data:true,error:null})} as unknown as SupabaseClient;
  await requireConsistentLineReads(db);
  process.env.ENABLE_CONCERT_LINE_AWARDS='false';
  await assert.rejects(requireConsistentLineReads(db),LineReadUnavailable);
  await requireConsistentLineReads({rpc:async()=>({data:false,error:null})} as unknown as SupabaseClient);
  await assert.rejects(requireConsistentLineReads({rpc:async()=>({data:null,error:{message:'schema unavailable'}})} as unknown as SupabaseClient),LineReadUnavailable);
 }finally{
  if(beforeA===undefined)delete process.env.ENABLE_CONCERT_LINE_AWARDS;else process.env.ENABLE_CONCERT_LINE_AWARDS=beforeA;
  if(beforeB===undefined)delete process.env.CONCERT_LINE_READERS_READY;else process.env.CONCERT_LINE_READERS_READY=beforeB;
 }
});
