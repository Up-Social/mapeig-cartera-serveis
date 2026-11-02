import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('Concerts release with Conveni candidate flags off never accesses candidate SQL or Storage',async()=>{
 const old={...process.env},dir=await mkdtemp(join(tmpdir(),'conveni-disabled-'));let databaseAccesses=0;
 const globalWithDb=globalThis as typeof globalThis&{visualTestDb?:unknown};
 const previousDb=globalWithDb.visualTestDb;
 try{
  for(const key of Object.keys(process.env))if(key.startsWith('CONVENI_'))delete process.env[key];
  globalWithDb.visualTestDb=new Proxy({}, {get(){databaseAccesses++;throw Error('Candidate database must remain unused');}});
  const routes=[
   ['app/api/records/[id]/conveni/visual/route.ts',['GET','POST']],
   ['app/api/records/[id]/conveni/economic/route.ts',['GET','POST']],
   ['app/api/records/[id]/conveni/economic/prepare/route.ts',['GET','POST','DELETE']],
   ['app/api/records/[id]/conveni/economic/export/route.ts',['POST']],
  ] as const;
  for(const [index,[entry,methods]] of routes.entries()){
   const output=join(dir,`${index}.mjs`);
   await build({entryPoints:[entry],bundle:true,platform:'node',format:'esm',outfile:output,banner:{js:"import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);"},alias:{'@/lib/records-page':resolve('tests/fixtures/conveni-visual-db.ts'),'@':resolve('.')},logLevel:'silent'});
   const route=await import(pathToFileURL(output).href);
   for(const method of methods){
    const request=new Request(`https://fixture.example?jobId=${id(2)}&unitId=${id(3)}`,{method,...(method==='GET'?{}:{headers:{'content-type':'application/json'},body:'{}'})});
    const response:Response=await route[method](request,{params:Promise.resolve({id:id(1)})});
    assert.equal(response.status,404,`${entry} ${method}`);
    assert.match((await response.json()).error,/no disponible/);
   }
  }
  assert.equal(databaseAccesses,0);
 }finally{process.env=old;if(previousDb===undefined)delete globalWithDb.visualTestDb;else globalWithDb.visualTestDb=previousDb;await rm(dir,{recursive:true,force:true});}
});
test('independent economic routes reject incomplete flag combinations before RPC and keep legacy closure',async()=>{
 const old={...process.env},dir=await mkdtemp(join(tmpdir(),'conveni-config-'));let calls=0;
 try{
  const routes=[];
  for(const [i,entry] of ['app/api/records/[id]/conveni/economic/route.ts','app/api/records/[id]/conveni/economic/prepare/route.ts'].entries()){
   const output=join(dir,`${i}.mjs`);await build({entryPoints:[entry],bundle:true,platform:'node',format:'esm',outfile:output,alias:{'@/lib/records-page':resolve('tests/fixtures/conveni-visual-db.ts'),'@':resolve('.')},logLevel:'silent'});routes.push(await import(pathToFileURL(output).href));
  }
  (globalThis as typeof globalThis&{visualTestDb:unknown}).visualTestDb={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{enabled:false},error:null})})})}),rpc:async()=>{calls++;return {data:null,error:null};}};
  const params={params:Promise.resolve({id:id(1)})},get=()=>new Request(`http://local.invalid?jobId=${id(2)}&unitId=${id(3)}`),post=()=>new Request('http://local.invalid',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),del=()=>new Request('http://local.invalid',{method:'DELETE',headers:{'content-type':'application/json'},body:'{}'});
  const keys=['CONVENI_ECONOMIC_REVIEW_ENABLED','CONVENI_ECONOMIC_COVERAGE_ENABLED','CONVENI_ECONOMIC_RECONCILIATION_ENABLED'];
  delete process.env.CONVENI_INDEPENDENT_REVIEW_ENABLED;delete process.env.CONVENI_INDEPENDENT_READERS_READY;for(const k of keys)delete process.env[k];
  assert.equal((await routes[0].GET(get(),params)).status,404);assert.equal((await routes[1].GET(get(),params)).status,404);
  process.env.CONVENI_INDEPENDENT_REVIEW_ENABLED='true';process.env.CONVENI_INDEPENDENT_READERS_READY='true';
  for(let mask=0;mask<7;mask++){
   for(let i=0;i<3;i++)if(mask&(1<<i))process.env[keys[i]]='true';else delete process.env[keys[i]];
   for(const [route,method,request] of [[routes[0],'GET',get],[routes[0],'POST',post],[routes[1],'GET',get],[routes[1],'POST',post],[routes[1],'DELETE',del]] as const){
    const response:Response=await route[method](request(),params);assert.equal(response.status,503,`mask ${mask} ${method}`);assert.match((await response.json()).error,/activar conjuntament/);assert.equal(response.headers.get('cache-control'),'private, no-store');
   }
   assert.equal(calls,0);
  }
  for(const k of keys)process.env[k]='true';
  assert.equal((await routes[0].GET(get(),params)).status,200);assert.ok(calls>0);calls=0;
  assert.equal((await routes[1].GET(get(),params)).status,200);assert.ok(calls>0);calls=0;
  delete process.env.CONVENI_INDEPENDENT_READERS_READY;assert.equal((await routes[0].GET(get(),params)).status,503);assert.equal(calls,0);
 }finally{process.env=old;delete (globalThis as typeof globalThis&{visualTestDb?:unknown}).visualTestDb;await rm(dir,{recursive:true,force:true});}
});
