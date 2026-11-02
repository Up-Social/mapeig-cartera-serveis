import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {verifyPopulationArchive} from '../lib/concerts/population-archive';

function dbFor(stream:ReadableStream<Uint8Array>):SupabaseClient {
 return {storage:{from:()=>({download:()=>({asStream:async()=>({data:stream,error:null})})})}} as unknown as SupabaseClient;
}
test('archive check hashes streamed bytes and rejects different content',async()=>{
 const data=Buffer.from('Document sintètic');const digest=createHash('sha256').update(data).digest('hex');
 const stream=()=>new ReadableStream<Uint8Array>({start(c){c.enqueue(data);c.close();}});
 await verifyPopulationArchive(dbFor(stream()),'fixture',digest);
 await assert.rejects(verifyPopulationArchive(dbFor(stream()),'fixture','a'.repeat(64)),/integritat/);
});
test('archive check rejects oversized streams and cancels an aborted read',async()=>{
 let cancelled=false;
 const oversized=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(16*1024*1024+1));},cancel(){cancelled=true;}});
 await assert.rejects(verifyPopulationArchive(dbFor(oversized),'fixture','a'.repeat(64)),/límit/);assert.equal(cancelled,true);
 let stopped=false;const hanging=new ReadableStream<Uint8Array>({cancel(){stopped=true;}});
 const abort=new AbortController();const request=verifyPopulationArchive(dbFor(hanging),'fixture','a'.repeat(64),abort.signal);
 await new Promise(resolve=>setTimeout(resolve,0));abort.abort();
 await assert.rejects(request,/interrompuda/);assert.equal(stopped,true);
});
test('pre-aborted verification does not request Storage and late responses are cancelled',async()=>{
 let calls=0;
 const pre= {storage:{from:()=>({download:()=>{calls++;throw Error('unexpected');}})}} as unknown as SupabaseClient;
 const abort=new AbortController();abort.abort();await assert.rejects(verifyPopulationArchive(pre,'fixture','a'.repeat(64),abort.signal),/interrompuda/);assert.equal(calls,0);
 let deliver!:(value:unknown)=>void,cancelled=false;
 const deferred={storage:{from:()=>({download:()=>({asStream:()=>new Promise(resolve=>{deliver=resolve;})})})}} as unknown as SupabaseClient;
 const running=new AbortController();const request=verifyPopulationArchive(deferred,'fixture','a'.repeat(64),running.signal);running.abort();
 const stream=new ReadableStream<Uint8Array>({cancel(){cancelled=true;}});deliver({data:stream,error:null});
 await assert.rejects(request,/interrompuda/);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(cancelled,true);
});
