import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {itemSourcePath} from '../lib/source-storage';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

for(const stalled of ['conveni_first_operation_begin','conveni_first_link_draft'] as const){
 test(`interrupted endpoint does not continue after ${stalled}, even if SQL returns late`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'mapeig-preparation-deadline-'));
  const oldEnv={...process.env},oldFetch=globalThis.fetch,fixture=globalThis as typeof globalThis&{visualTestDb?:unknown};
  try{
   const output=join(directory,'route.mjs');
   await build({entryPoints:['app/api/records/[id]/conveni/economic/prepare/route.ts'],bundle:true,platform:'node',format:'esm',outfile:output,
    alias:{'@/lib/records-page':resolve('tests/fixtures/conveni-visual-db.ts'),'@':resolve('.')},logLevel:'silent'});
   const bytes=Buffer.from('synthetic endpoint document'),sha=createHash('sha256').update(bytes).digest('hex');
   const source={path:`cases/${id(1)}/documents/${id(3)}/${sha}.pdf`,sha256:sha,object_id:id(4),version:id(5)};
   const copy={path:itemSourcePath(id(1),id(2),id(3),source.path),sha256:sha,object_id:id(7),version:id(16)};
   const citation={document_id:id(3),page:1,quote:'synthetic'},ids={ackId:id(8),draftId:id(6),receiptId:id(9),linkId:id(10)};
   const snapshot={draftId:id(6),recordId:id(1),unitId:id(2),draft:{},monetaryCitation:citation,identityCitation:citation,rolePeriodCitation:citation,archives:[{documentId:id(3),source,copy}]};
   const plan={...snapshot,archives:[{documentId:id(3),source,copy,copyPath:copy.path}]};
   const receipt={event_id:ids.receiptId,draft_id:ids.draftId,snapshot,kind:'physical-read-only-v1',verified_at:'2026-01-01T00:00:00Z'};
   const calls:string[]=[];const ac=new AbortController();let release:(()=>void)|undefined;
   fixture.visualTestDb={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:null})})})}),rpc:async(name:string)=>{
    calls.push(name);
    if(name===stalled)return new Promise(resolve=>{release=()=>resolve({data:null,error:null});setTimeout(()=>ac.abort(),5);});
    const data=name==='conveni_first_operation_begin'?{id:id(11),ids,state:'pending'}:
     name==='conveni_first_copy_plan'?plan:name==='conveni_first_copy_finish'?snapshot:name==='conveni_first_receipt_save'?receipt:null;
    return {data,error:null};
   }};
   process.env.CONVENI_ECONOMIC_REVIEW_ENABLED='true';delete process.env.CONVENI_INDEPENDENT_REVIEW_ENABLED;delete process.env.CONVENI_INDEPENDENT_READERS_READY;
   delete process.env.CONVENI_ECONOMIC_COVERAGE_ENABLED;process.env.NEXT_PUBLIC_SUPABASE_URL='https://storage.invalid';process.env.SUPABASE_SECRET_KEY='synthetic';
   globalThis.fetch=async()=>new Response(bytes,{status:200});
   const route=await import(pathToFileURL(output).href);
   const body={operationId:id(11),ackId:ids.ackId,draftId:ids.draftId,receiptId:ids.receiptId,linkId:ids.linkId,identityId:id(12),jobId:id(13),monetaryId:id(14),rolePeriodId:id(15),unitId:id(2),literal:'100,00',reviewer:'Persona',note:'Observació documentada',social:true,economic:true,manifest:true,historyConfirmed:false,historySnapshot:null};
   const response=await route.POST(new Request('http://local.invalid',{method:'POST',body:JSON.stringify(body),signal:ac.signal}),{params:Promise.resolve({id:id(1)})});
   assert.equal(response.status,409);assert.match((await response.json()).error,/pot haver continuat al servidor/);
   const before=[...calls];assert.ok(release);release();await new Promise<void>(resolve=>setImmediate(resolve));
   assert.deepEqual(calls,before);assert.ok(!calls.includes('conveni_first_operation_ready'));
   if(stalled==='conveni_first_operation_begin')assert.ok(!calls.includes('conveni_first_prepare_draft'));
   else assert.ok(calls.includes('conveni_first_receipt_save'));
  }finally{process.env=oldEnv;globalThis.fetch=oldFetch;delete fixture.visualTestDb;await rm(directory,{recursive:true,force:true});}
 });
}
