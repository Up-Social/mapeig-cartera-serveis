import {test} from 'node:test';import assert from 'node:assert/strict';
import {build} from 'esbuild';import {mkdtemp,rm,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';
test('global review explains when this annex requires individual review',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'diagnostic-review-'));
 try{
  const actions=join(dir,'actions.js'),records=join(dir,'records.js'),out=join(dir,'route.mjs');
  await writeFile(actions,'export async function reviewMatching(){throw globalThis.reviewTestFailure}');
  await writeFile(records,'export async function getSourceRecord(){throw Error("unexpected read")}');
  await build({entryPoints:['app/api/records/[id]/review/route.ts'],bundle:true,platform:'node',format:'esm',outfile:out,alias:{'@/app/actions':actions,'@/lib/records-page':records,'@':resolve('.')},logLevel:'silent'});
  const route=await import(pathToFileURL(out).href),id='00000000-0000-4000-8000-000000000001';
  const state=globalThis as typeof globalThis&{reviewTestFailure:unknown};state.reviewTestFailure={message:'DIAGNOSTIC_REVIEW_INDIVIDUAL_REQUIRED'};
  const response=await route.POST(new Request('http://fixture.invalid',{method:'POST',body:JSON.stringify({outcome:'select'})}),{params:Promise.resolve({id})});
  assert.equal(response.status,409);assert.match((await response.json()).error,/Revisa i aprova cada línia individualment/);
  state.reviewTestFailure={code:'55P03'};
  const locked=await route.POST(new Request('http://fixture.invalid',{method:'POST',body:JSON.stringify({outcome:'select'})}),{params:Promise.resolve({id})});
  assert.equal(locked.status,409);assert.match((await locked.json()).error,/Una altra operació/);
 }finally{delete (globalThis as typeof globalThis&{reviewTestFailure?:unknown}).reviewTestFailure;await rm(dir,{recursive:true,force:true});}
});
