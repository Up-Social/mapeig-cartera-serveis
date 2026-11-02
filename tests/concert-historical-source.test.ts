import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHistoricalEtaulerSource} from '../lib/concerts/historical-etauler-source';

test('source remains idle until invoked and builds the fixed read-only e-Tauler query',async()=>{
 let calls=0;
 const source=createHistoricalEtaulerSource(async(url,init)=>{
  calls++;assert.equal(url.origin,'https://tauler.seu-e.cat');assert.equal(url.pathname,'/api/edictes');
  assert.equal(url.searchParams.get('ens'),'1');assert.equal(url.searchParams.get('page'),'2');
  assert.equal(url.searchParams.get('size'),'25');assert.equal(init.method,'POST');assert.equal(init.redirect,'error');
  assert.deepEqual(JSON.parse(String(init.body)),{conceptes:[],cerca:'concert social',destacat:null,state:'0'});
  return new Response(JSON.stringify({currentPage:2,totalPages:3,totalEdictes:51,edictes:[]}));
 });
 assert.equal(calls,0);const result=await source.readPage('concert social',2,new AbortController().signal);
 assert.equal(calls,1);assert.deepEqual(result,{currentPage:2,totalPages:3,totalEdictes:51,edictes:[]});
});
test('response bytes are limited while reading and an oversized header is rejected',async()=>{
 let cancelled=false;
 const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(1_000_001));controller.enqueue(new Uint8Array(1_000_000));},cancel(){cancelled=true;}});
 const source=createHistoricalEtaulerSource(async()=>new Response(stream));
 await assert.rejects(source.readPage('concert social',0,new AbortController().signal),/SOURCE_RESPONSE_TOO_LARGE/);assert.equal(cancelled,true);
 const header=createHistoricalEtaulerSource(async()=>new Response('{}',{headers:{'content-length':'2000001'}}));
 await assert.rejects(header.readPage('concert social',0,new AbortController().signal),/SOURCE_RESPONSE_TOO_LARGE/);
});
test('abort interrupts a streaming read and cancels the response body',async()=>{
 let cancelled=false;
 const stream=new ReadableStream<Uint8Array>({cancel(){cancelled=true;}});
 const source=createHistoricalEtaulerSource(async()=>new Response(stream));
 const controller=new AbortController();const task=source.readPage('concert social',0,controller.signal);
 await new Promise(resolve=>setTimeout(resolve,0));controller.abort();
 await assert.rejects(task,/SOURCE_ABORTED/);assert.equal(cancelled,true);
});
test('late response after an ignored abort is cancelled and never parsed',async()=>{
 let resolveFetch!:(value:Response)=>void,cancelled=false;
 const source=createHistoricalEtaulerSource(()=>new Promise(resolve=>{resolveFetch=resolve;}));
 const controller=new AbortController();const task=source.readPage('concert social',0,controller.signal);
 controller.abort();
 const stream=new ReadableStream<Uint8Array>({cancel(){cancelled=true;}});resolveFetch(new Response(stream));
 await assert.rejects(task,/SOURCE_ABORTED/);assert.equal(cancelled,true);
});
test('invalid requests and non-success responses never parse a body',async()=>{
 let calls=0;const source=createHistoricalEtaulerSource(async()=>{calls++;return new Response('bad',{status:503});});
 await assert.rejects(source.readPage('concert social',-1,new AbortController().signal),/INVALID_SOURCE_REQUEST/);assert.equal(calls,0);
 await assert.rejects(source.readPage('concert social',0,new AbortController().signal),/SOURCE_UNAVAILABLE/);assert.equal(calls,1);
});
