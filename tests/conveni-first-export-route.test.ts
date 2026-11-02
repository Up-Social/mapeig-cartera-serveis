import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('first-Conveni export is closed by default and finalizes the verified file hash before returning bytes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mapeig-first-export-')),output=join(dir,'route.cjs'),old={...process.env};
 try{
  await build({entryPoints:['app/api/records/[id]/conveni/economic/export/route.ts'],bundle:true,platform:'node',format:'cjs',outfile:output,alias:{'@/lib/records-page':resolve('tests/fixtures/conveni-visual-db.ts'),'@':resolve('.')},logLevel:'silent'});
  const route=await import(pathToFileURL(output).href);const calls:string[]=[];
  const provision={source_id:'fixture',source_reference:'synthetic',service_code:'1',amount:1000,award_date:'2025-01-01',mechanism:'Conveni',call_url:null,regulatory_basis_url:null,provider_name:'Entitat sintètica',provider_nif:null,contracting_body:null,target_population:null};
  (globalThis as typeof globalThis&{visualTestDb:unknown}).visualTestDb={rpc:async(name:string,args:Record<string,unknown>)=>{calls.push(name);if(name==='capture_conveni_first_export')return {data:{provision,proof:{catalog:{services:[{service_code:'1',service_name:'Servei sintètic'}]}}},error:null};assert.match(String(args.p_hash),/^[a-f0-9]{64}$/);return {data:{event_id:id(3),provision_id:id(2)},error:null};}};
  const params={params:Promise.resolve({id:id(1)})},request=()=>new Request('http://local.invalid',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({eventId:id(3),provisionId:id(2)})});
  delete process.env.CONVENI_ECONOMIC_REVIEW_ENABLED;assert.equal((await route.POST(request(),params)).status,404);assert.deepEqual(calls,[]);
  process.env.CONVENI_ECONOMIC_REVIEW_ENABLED='true';const response=await route.POST(request(),params);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.ok((await response.arrayBuffer()).byteLength>1000);assert.deepEqual(calls,['capture_conveni_first_export','finalize_conveni_first_export']);
 }finally{process.env=old;delete (globalThis as typeof globalThis&{visualTestDb?:unknown}).visualTestDb;await rm(dir,{recursive:true,force:true});}
});
