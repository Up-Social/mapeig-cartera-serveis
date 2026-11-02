import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyPinnedArchive} from '../lib/convenis/pinned-archive';
import {ARCHIVE_DOCUMENT_MAX_BYTES} from '../lib/convenis/archive-verification';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const bytes=Buffer.from('synthetic archive');const sha=createHash('sha256').update(bytes).digest('hex');
const receipt={path:`cases/${id(1)}/documents/${id(2)}/${sha}.pdf`,sha256:sha,object_id:id(3),version:id(4)};
const input={storageUrl:'https://fixture.invalid',serviceKey:'fake-key',recordId:id(1),documentId:id(2),receipt};
test('requests the exact object version through authenticated Storage and verifies bytes',async()=>{
 let calls=0;
 const fetcher:typeof fetch=async(url,options)=>{calls++;const request=new URL(String(url));
  assert.equal(request.pathname,`/storage/v1/object/authenticated/cloud-documents/${receipt.path}`);
  assert.equal(request.searchParams.get('versionId'),receipt.version);assert.equal(options?.redirect,'error');assert.equal(options?.cache,'no-store');
  assert.equal(new Headers(options?.headers).get('authorization'),'Bearer fake-key');return new Response(bytes);};
 assert.deepEqual(await verifyPinnedArchive({...input,fetcher}),receipt);assert.equal(calls,1);
});
test('rejects altered bytes, stale versions, error responses and noncanonical identities',async()=>{
 for(const response of [new Response('replacement'),new Response('missing',{status:404}),new Response('gone',{status:400})])
  await assert.rejects(()=>verifyPinnedArchive({...input,fetcher:async()=>response}));
 await assert.rejects(()=>verifyPinnedArchive({...input,receipt:{...receipt,version:'bad'}}));
 await assert.rejects(()=>verifyPinnedArchive({...input,receipt:{...receipt,path:receipt.path.replace('/documents/','/items/')}}));
 for(const storageUrl of ['http://example.invalid','https://fixture.invalid/another','https://user:pass@fixture.invalid','https://fixture.invalid/?foo=1'])
  await assert.rejects(()=>verifyPinnedArchive({...input,storageUrl}));
});
test('bounds stream size and actively cancels stalled downloads',async()=>{
 let canceled=false;
 const stream=new ReadableStream<Uint8Array>({cancel(){canceled=true;}});
 const ac=new AbortController();setTimeout(()=>ac.abort(),10);
 await assert.rejects(()=>verifyPinnedArchive({...input,signal:ac.signal,fetcher:async()=>new Response(stream)}),/interrompuda/);
 assert.equal(canceled,true);
 await assert.rejects(()=>verifyPinnedArchive({...input,fetcher:async()=>new Response(new Uint8Array(ARCHIVE_DOCUMENT_MAX_BYTES+1))}),/límit/);
});
test('bounds an unresponsive request even if its transport ignores abort',async()=>{
 const ac=new AbortController();setTimeout(()=>ac.abort(),10);
 await assert.rejects(()=>verifyPinnedArchive({...input,signal:ac.signal,fetcher:()=>new Promise<Response>(()=>{})}),/interrompuda/);
});
test('returns the identity actually requested when the caller changes its receipt during the read',async()=>{
 const mutable={...receipt};
 const fetcher:typeof fetch=async(url)=>{
  assert.equal(new URL(String(url)).searchParams.get('versionId'),receipt.version);
  mutable.version=id(8);mutable.object_id=id(9);mutable.path=receipt.path.replace('.pdf','.txt');
  return new Response(bytes);
 };
 const verified=await verifyPinnedArchive({...input,receipt:mutable,fetcher});
 assert.deepEqual(verified,receipt);
 assert.notStrictEqual(verified,mutable);
});
test('does not accept replacement bytes by changing the expected digest during a download',async()=>{
 const mutable={...receipt};const replacement=Buffer.from('different synthetic document');
 const fetcher:typeof fetch=async()=>{
  mutable.sha256=createHash('sha256').update(replacement).digest('hex');
  return new Response(replacement);
 };
 await assert.rejects(()=>verifyPinnedArchive({...input,receipt:mutable,fetcher}),/integritat/);
});
