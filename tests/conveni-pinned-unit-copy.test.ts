import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyPinnedUnitCopy} from '../lib/convenis/pinned-archive';
import {ARCHIVE_DOCUMENT_MAX_BYTES} from '../lib/convenis/archive-verification';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const body=Buffer.from('document economic source bytes');
const sha=createHash('sha256').update(body).digest('hex');
const source={path:`cases/${id(1)}/documents/${id(3)}/${sha}.pdf`,sha256:sha,object_id:id(4),version:id(5)};
const copy={path:`cases/${id(1)}/items/${id(2)}/documents/${id(3)}/${sha}.pdf`,sha256:sha,object_id:id(6),version:id(7)};
const input={storageUrl:'https://fixture.invalid',serviceKey:'fake-key',recordId:id(1),unitId:id(2),
 monetaryCitation:{document_id:id(3),page:2,quote:'Aportació prevista de la unitat'},source,copy};

test('verifies source and unit copy separately with their pinned versions',async()=>{
 const requests:string[]=[];
 const fetcher:typeof fetch=async(url,options)=>{
  const parsed=new URL(String(url));requests.push(`${parsed.pathname}?${parsed.searchParams}`);
  assert.equal(options?.redirect,'error');assert.equal(options?.cache,'no-store');
  return new Response(body);
 };
 const result=await verifyPinnedUnitCopy({...input,fetcher});
 assert.deepEqual(requests,[`/storage/v1/object/authenticated/cloud-documents/${source.path}?versionId=${source.version}`,
  `/storage/v1/object/authenticated/cloud-documents/${copy.path}?versionId=${copy.version}`]);
 assert.equal(result.sourceBytes,body.length);assert.equal(result.copyBytes,body.length);
 assert.equal('approved' in result,false);
});

test('rejects mismatched identity before making a request',async()=>{
 let calls=0;const fetcher:typeof fetch=async()=>{calls++;return new Response(body);};
 await assert.rejects(()=>verifyPinnedUnitCopy({...input,copy:{...copy,path:copy.path.replace(id(2),id(8))},fetcher}),/cita econòmica/);
 assert.equal(calls,0);
});

test('fails closed when source or copy is unavailable or has different bytes',async()=>{
 for(const failAt of [0,1]){
  for(const bad of ['missing','modified']){
   let calls=0;
   const fetcher:typeof fetch=async()=>calls++===failAt
    ?bad==='missing'?new Response(null,{status:404}):new Response('changed bytes')
    :new Response(body);
   await assert.rejects(()=>verifyPinnedUnitCopy({...input,fetcher}));
   assert.equal(calls,failAt+1);
  }
 }
});

test('aborts before consuming the second object when verification is interrupted',async()=>{
 const controller=new AbortController();let calls=0;
 const fetcher:typeof fetch=async()=>{
  calls++;if(calls===1)controller.abort();return new Response(body);
 };
 await assert.rejects(()=>verifyPinnedUnitCopy({...input,signal:controller.signal,fetcher}),/interrompuda/);
 assert.equal(calls,1);
});

test('does not start a request when the signal was already aborted',async()=>{
 const controller=new AbortController();controller.abort();let calls=0;
 const fetcher:typeof fetch=async()=>{calls++;return new Response(body);};
 await assert.rejects(()=>verifyPinnedUnitCopy({...input,signal:controller.signal,fetcher}),/interrompuda/);
 assert.equal(calls,0);
});

test('bounds each object before accepting the source and its copy',async()=>{
 for(const oversizedAt of [0,1]){
  let calls=0;
  const fetcher:typeof fetch=async()=>new Response(calls++===oversizedAt
   ?new Uint8Array(ARCHIVE_DOCUMENT_MAX_BYTES+1):body);
  await assert.rejects(()=>verifyPinnedUnitCopy({...input,fetcher}),/límit de bytes/);
  assert.equal(calls,oversizedAt+1);
 }
});
