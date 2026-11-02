import {test} from 'node:test';
import assert from 'node:assert/strict';
import {journaledProviderRequest} from '../lib/provider-journal';
import type {SupabaseClient} from '@supabase/supabase-js';

test('a conflicting saved provider receipt stops before any provider call',async()=>{
 const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:{enabled:true,updated_at:'v1'},error:null})};
 let calls=0;const old=global.fetch;
 const db={from:()=>query,rpc:async()=>({data:null,error:{message:'PROVIDER_REQUEST_CHANGED'}})} as unknown as SupabaseClient;
 global.fetch=async()=>{calls++;throw Error('PROVIDER_MUST_NOT_BE_CALLED');};
 try {await assert.rejects(journaledProviderRequest(db,'fixture','positive-audit-v4',{model:'gpt-6-luna',input:'synthetic'}),/NEW_ANALYSIS_REQUIRED/);assert.equal(calls,0);}
 finally{global.fetch=old;}
});
