import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {captureVerifiedArchivePair,readVerifiedPopulationArchive,verifyPopulationArchive} from '../lib/concerts/population-archive';
import {MAX_PDF_BYTES} from '../lib/pipeline/document-input';

function dbFor(stream:ReadableStream<Uint8Array>):SupabaseClient {
 return {storage:{from:()=>({download:()=>({asStream:async()=>({data:stream,error:null})})})}} as unknown as SupabaseClient;
}
test('archive check hashes streamed bytes and rejects different content',async()=>{
 const data=Buffer.from('Document sintètic');const digest=createHash('sha256').update(data).digest('hex');
 const stream=()=>new ReadableStream<Uint8Array>({start(c){c.enqueue(data);c.close();}});
 await verifyPopulationArchive(dbFor(stream()),'fixture',digest);
 await assert.rejects(verifyPopulationArchive(dbFor(stream()),'fixture','a'.repeat(64)),/integritat/);
});
test('captured archive returns the exact verified bytes and rejects corruption or emptiness',async()=>{
 const data=Buffer.from('Font documental sintètica');const digest=createHash('sha256').update(data).digest('hex');
 const stream=(parts:Uint8Array[])=>new ReadableStream<Uint8Array>({start(c){for(const part of parts)c.enqueue(part);c.close();}});
 const result=await readVerifiedPopulationArchive(dbFor(stream([data.subarray(0,5),data.subarray(5)])),'fixture',digest);
 assert.deepEqual(result,data);
 await assert.rejects(readVerifiedPopulationArchive(dbFor(stream([data])),'fixture','a'.repeat(64)),/integritat/);
 const emptyHash=createHash('sha256').digest('hex');
 await assert.rejects(readVerifiedPopulationArchive(dbFor(stream([])),'fixture',emptyHash),/buida/);
});
test('capturing a pair requires both independent copies to match the expected hash',async()=>{
 const good=Buffer.from('Font i còpia');const bad=Buffer.from('Còpia diferent');const digest=createHash('sha256').update(good).digest('hex');
 const pair=(item:Buffer)=>({storage:{from:()=>({download:(path:string)=>({asStream:async()=>({data:new ReadableStream<Uint8Array>({start(c){c.enqueue(path==='font'?good:item);c.close();}}),error:null})})})}} as unknown as SupabaseClient);
 assert.deepEqual(await captureVerifiedArchivePair(pair(good),'font','unitat',digest),good);
 await assert.rejects(captureVerifiedArchivePair(pair(bad),'font','unitat',digest),/integritat/);
 await assert.rejects(captureVerifiedArchivePair(pair(good),'font','font',digest),/diferents/);
});
test('archive check rejects oversized streams and cancels an aborted read',async()=>{
 let cancelled=false;
 const oversized=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(MAX_PDF_BYTES+1));},cancel(){cancelled=true;}});
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
