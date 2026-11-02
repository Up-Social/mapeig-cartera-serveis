import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

test('guard status is checked, malformed responses fail closed, and late begin cannot continue',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mapeig-guard-test-')),oldEnv={...process.env},fixture=globalThis as typeof globalThis&{visualTestDb?:unknown};
 try{
  const output=join(dir,'route.mjs');await build({entryPoints:['app/api/records/[id]/conveni/economic/prepare/route.ts'],bundle:true,platform:'node',format:'esm',outfile:output,alias:{'@/lib/records-page':resolve('tests/fixtures/conveni-visual-db.ts'),'@':resolve('.')},logLevel:'silent'});
  const route=await import(pathToFileURL(output).href);let guard:unknown={blocked:true};const calls:string[]=[];let release:(()=>void)|undefined;const controller=new AbortController();
  fixture.visualTestDb={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:null})})})}),rpc:async(name:string)=>{calls.push(name);
   if(name==='conveni_first_guard_begin')return new Promise(r=>{release=()=>r({data:null,error:null});setTimeout(()=>controller.abort(),5);});
   const data=name==='conveni_first_history_candidate'?{hasHistory:false}:name==='conveni_visual_history_page'?[]:name==='conveni_first_guard_status'?guard:null;
   return {data,error:null};}};
  process.env.CONVENI_ECONOMIC_REVIEW_ENABLED='true';process.env.CONVENI_ECONOMIC_COVERAGE_ENABLED='true';process.env.CONVENI_ECONOMIC_RECONCILIATION_ENABLED='true';process.env.CONVENI_FIRST_PREPARATION_GUARD_ENABLED='true';process.env.NEXT_PUBLIC_SUPABASE_URL='https://storage.invalid';process.env.SUPABASE_SECRET_KEY='synthetic';delete process.env.CONVENI_INDEPENDENT_REVIEW_ENABLED;delete process.env.CONVENI_INDEPENDENT_READERS_READY;
  const params={params:Promise.resolve({id:id(1)})},get=()=>route.GET(new Request(`http://local.invalid?jobId=${id(2)}&unitId=${id(3)}`),params);
  const good=await get();assert.equal(good.status,200);assert.deepEqual((await good.json()).preparationGuard,{blocked:true});
  guard={blocked:'yes'};assert.equal((await get()).status,503);guard={blocked:false};
  const body={operationId:id(4),ackId:id(5),draftId:id(6),receiptId:id(7),linkId:id(8),identityId:id(9),jobId:id(2),monetaryId:id(10),rolePeriodId:id(11),unitId:id(3),literal:'100,00',reviewer:'Persona',note:'Observació documentada',social:true,economic:true,manifest:true,historyConfirmed:false,historySnapshot:null,coverageIds:[]};
  const response=await route.POST(new Request('http://local.invalid',{method:'POST',body:JSON.stringify(body),signal:controller.signal}),params);assert.equal(response.status,409);assert.match((await response.json()).error,/pot haver continuat al servidor/);
  const before=[...calls];assert.ok(release);release();await new Promise<void>(r=>setImmediate(r));assert.deepEqual(calls,before);assert.ok(!calls.includes('conveni_first_guard_step'));
  const del=await route.DELETE(new Request('http://local.invalid',{method:'DELETE'}),params);assert.equal(del.status,409);
  process.env.CONVENI_ECONOMIC_COVERAGE_ENABLED='false';assert.equal((await get()).status,503);
  delete process.env.CONVENI_FIRST_PREPARATION_GUARD_ENABLED;calls.length=0;const legacy=await get();assert.equal(legacy.status,200);assert.equal(Object.hasOwn(await legacy.json(),'preparationGuard'),false);assert.ok(!calls.includes('conveni_first_guard_status'));
 }finally{process.env=oldEnv;delete fixture.visualTestDb;await rm(dir,{recursive:true,force:true});}
});
