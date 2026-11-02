import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

test('preserved review history and retained Concert evidence explain the rejection without starting Storage purge',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'discard-history-'));
 try{
  const cache=join(dir,'cache.js'),purge=join(dir,'purge.js'),out=join(dir,'route.mjs');
  await writeFile(cache,'export function revalidatePath() { throw Error("unexpected revalidation"); }');
  await writeFile(purge,'export async function purgeDeletion() { throw Error("unexpected purge"); }');
  await build({entryPoints:['app/api/discarded/delete/route.ts'],bundle:true,platform:'node',format:'esm',outfile:out,alias:{'@/lib/records-page':resolve('tests/fixtures/conveni-visual-db.ts'),'@/lib/discard-deletion':purge,'next/cache':cache,'@':resolve('.')},logLevel:'silent'});
  const route=await import(pathToFileURL(out).href);let calls=0,code='PRESERVED_HISTORY_EXISTS';
  (globalThis as typeof globalThis&{visualTestDb:unknown}).visualTestDb={rpc:async(name:string)=>{assert.equal(name,'delete_discarded_records');calls++;return {data:null,error:{message:code}};}};
  const selection=[{id:'00000000-0000-4000-8000-000000000001',job_id:'00000000-0000-4000-8000-000000000002',result_token:'fixture'}];
  const response=await route.POST(new Request('http://local.invalid',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({selection,confirmedCount:1})}));
  assert.equal(response.status,409);assert.match((await response.json()).error,/No s’ha eliminat cap registre.*revisions o comprovants/);assert.equal(calls,1);
  code='CONCERT_EVIDENCE_RETAINED';
  const retained=await route.POST(new Request('http://local.invalid',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({selection,confirmedCount:1})}));
  const body=await retained.json();assert.equal(retained.status,409);assert.equal(body.rejection,'concert_evidence_retained');assert.match(body.error,/No s’ha eliminat cap registre.*evidència o conciliacions/);assert.equal(calls,2);
 }finally{delete (globalThis as typeof globalThis&{visualTestDb?:unknown}).visualTestDb;await rm(dir,{recursive:true,force:true});}
});

test('uncertain deletion response does not claim that no records were deleted',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'discard-uncertain-'));
 try{
  const cache=join(dir,'cache.js'),purge=join(dir,'purge.js'),out=join(dir,'route.mjs');
  await writeFile(cache,'export function revalidatePath() { throw Error("unexpected revalidation"); }');
  await writeFile(purge,'export async function purgeDeletion() { throw Error("unexpected purge"); }');
  await build({entryPoints:['app/api/discarded/delete/route.ts'],bundle:true,platform:'node',format:'esm',outfile:out,alias:{'@/lib/records-page':resolve('tests/fixtures/conveni-visual-db.ts'),'@/lib/discard-deletion':purge,'next/cache':cache,'@':resolve('.')},logLevel:'silent'});
  const route=await import(pathToFileURL(out).href);
  const selection=[{id:'00000000-0000-4000-8000-000000000001',job_id:'00000000-0000-4000-8000-000000000002',result_token:'fixture'}];
  for(const rpc of [async()=>({data:null,error:{message:'gateway timeout'}}),async()=>{throw Error('connection reset');},async()=>({data:null,error:null}),async()=>({data:'not-a-uuid',error:null})]){
   (globalThis as typeof globalThis&{visualTestDb:unknown}).visualTestDb={rpc};
   const response=await route.POST(new Request('http://local.invalid',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({selection,confirmedCount:1})}));
   assert.equal(response.status,503);
   const result=await response.json();assert.equal(result.uncertain,true);assert.match(result.error,/No s’ha pogut confirmar.*revisa/i);assert.doesNotMatch(result.error,/No s’ha eliminat cap registre/);
  }
 }finally{delete (globalThis as typeof globalThis&{visualTestDb?:unknown}).visualTestDb;await rm(dir,{recursive:true,force:true});}
});
