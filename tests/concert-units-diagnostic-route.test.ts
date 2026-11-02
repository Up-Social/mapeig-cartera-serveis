import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

test('units remain visible when the current reconciliation cannot be read or is malformed',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'concert-units-'));const previous=[process.env.ENABLE_CONCERT_LINE_AWARDS,process.env.CONCERT_LINE_READERS_READY];
 try{
  const pages=join(dir,'pages.js'),presentation=join(dir,'presentation.js'),schema=join(dir,'schema.js'),storage=join(dir,'storage.js'),out=join(dir,'route.mjs');
  await writeFile(pages,'export async function readPages(){return globalThis.testPages.shift()}');
  await writeFile(presentation,'export const recoverConcertDisplayNames=(units)=>units;export const recoverPrintedServiceCandidates=(units)=>units;export const recoverPrintedSupportCandidates=(units)=>units;');
  await writeFile(schema,'export function hasUnitSchema(){return true}');
  await writeFile(storage,'export async function archiveUnitSource(){}');
  await build({entryPoints:['app/api/records/[id]/units/route.ts'],bundle:true,platform:'node',format:'esm',outfile:out,alias:{'@/lib/records-page':resolve('tests/fixtures/conveni-visual-db.ts'),'@/lib/read-pages':pages,'@/lib/concerts/presentation':presentation,'@/lib/runtime-schema':schema,'@/lib/source-storage':storage,'@':resolve('.')},logLevel:'silent'});
  const route=await import(pathToFileURL(out).href);process.env.ENABLE_CONCERT_LINE_AWARDS='true';process.env.CONCERT_LINE_READERS_READY='true';
  const doc={extracted_text:'ANNEX 1 Serveis assignats',quality_flags:[]},id='00000000-0000-4000-8000-000000000001';
  const globals=globalThis as typeof globalThis&{testPages:unknown[];visualTestDb:unknown};
  for(const rpc of [async()=>({data:{recognized:true,report:{revision:1}},error:null}),async()=>({data:null,error:{message:'unavailable'}}),async()=>{throw Error('network');}]){
   globals.testPages=[[],[],[],[],[doc],[]];globals.visualTestDb={from:()=>({}),rpc};
   const response=await route.GET(new Request('http://fixture.invalid'),{params:Promise.resolve({id})});const body=await response.json();
   assert.equal(response.status,200);assert.deepEqual(body.units,[]);assert.equal(body.diagnosticReconciliationStatus,'unavailable');assert.equal(body.diagnosticReconciliation,null);
  }
  globals.testPages=[[],[],[],[],[{...doc,extracted_text:'text no disponible'}],[]];globals.visualTestDb={from:()=>({}),rpc:async()=>({data:{recognized:true,report:null},error:null})};
  const response=await route.GET(new Request('http://fixture.invalid'),{params:Promise.resolve({id})});assert.equal((await response.json()).diagnosticReconciliationStatus,'absent');
  process.env.ENABLE_CONCERT_LINE_AWARDS='false';
  const chain={select(){return this;},eq(){return this;},async maybeSingle(){return {data:{id},error:null};}};
  globals.visualTestDb={from:()=>chain,rpc:async()=>({data:null,error:{message:'DIAGNOSTIC_REVIEW_INDIVIDUAL_REQUIRED'}})};
  const body={unitId:'00000000-0000-4000-8000-000000000002',expectedJobId:'00000000-0000-4000-8000-000000000003',approve:true,note:'Revisió documentada'};
  const rejected=await route.POST(new Request('http://fixture.invalid',{method:'POST',body:JSON.stringify(body)}),{params:Promise.resolve({id})});
  assert.equal(rejected.status,409);assert.match((await rejected.json()).error,/revisar individualment/);
 }finally{
  if(previous[0]===undefined)delete process.env.ENABLE_CONCERT_LINE_AWARDS;else process.env.ENABLE_CONCERT_LINE_AWARDS=previous[0];
  if(previous[1]===undefined)delete process.env.CONCERT_LINE_READERS_READY;else process.env.CONCERT_LINE_READERS_READY=previous[1];
  delete (globalThis as typeof globalThis&{testPages?:unknown}).testPages;delete (globalThis as typeof globalThis&{visualTestDb?:unknown}).visualTestDb;
  await rm(dir,{recursive:true,force:true});
 }
});
