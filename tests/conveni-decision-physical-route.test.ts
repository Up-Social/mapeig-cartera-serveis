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
test('economic decision verifies the scoped receipt and all cited physical bytes before either commit',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mapeig-economic-physical-')),output=join(dir,'route.mjs'),old={...process.env},originalFetch=globalThis.fetch;
 try{
  await build({entryPoints:['app/api/records/[id]/conveni/economic/route.ts'],bundle:true,platform:'node',format:'esm',outfile:output,alias:{'@/lib/records-page':resolve('tests/fixtures/conveni-visual-db.ts'),'@':resolve('.')},logLevel:'silent'});
  const route=await import(pathToFileURL(output).href);
  process.env.CONVENI_ECONOMIC_REVIEW_ENABLED='true';process.env.CONVENI_DECISION_PHYSICAL_VERIFICATION_ENABLED='true';
  process.env.CONVENI_ECONOMIC_COVERAGE_ENABLED='true';process.env.CONVENI_ECONOMIC_RECONCILIATION_ENABLED='true';
  process.env.NEXT_PUBLIC_SUPABASE_URL='https://storage.invalid';process.env.SUPABASE_SECRET_KEY='synthetic';delete process.env.LOCAL_REMOTE_LEGACY_SCHEMA;
  const bytes=Buffer.from('synthetic document'),sha=createHash('sha256').update(bytes).digest('hex');
  const citation=(n:number)=>({document_id:id(n),page:1,quote:'Synthetic'});
  const archives=[10,11].map((doc,index)=>{const source={path:`cases/${id(1)}/documents/${id(doc)}/${sha}.pdf`,sha256:sha,object_id:id(20+4*index),version:id(21+4*index)};
   return {documentId:id(doc),source,copy:{path:itemSourcePath(id(1),id(3),id(doc),source.path),sha256:sha,object_id:id(22+4*index),version:id(23+4*index)}};});
  const baseReceipt={event_id:id(5),draft_id:id(8),snapshot:{draftId:id(8),recordId:id(1),unitId:id(3),draft:{},monetaryCitation:citation(10),identityCitation:citation(10),rolePeriodCitation:citation(10),additionalCitations:[citation(11)],archives}};
  const body={eventId:id(6),reviewId:id(7),jobId:id(2),unitId:id(3),linkId:id(4),receiptId:id(5),reviewer:'Nom declarat',note:'Justificació econòmica',social:true,economic:true,manifest:true};
  const request=(value:unknown)=>new Request('http://local.invalid',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)}),params={params:Promise.resolve({id:id(1)})};
  for(const independent of [false,true])for(const scenario of ['valid','historical','source-altered','copy-altered','unavailable','snapshot-changed','scope','rpc-error','historical-unverifiable','commit-abort'] as const){
   process.env.CONVENI_INDEPENDENT_REVIEW_ENABLED=String(independent);process.env.CONVENI_INDEPENDENT_READERS_READY=String(independent);
   let reads=0,commits=0,physical=0,releaseCommit:((value:{data:{provision_id:string};error:null})=>void)|undefined;const controller=new AbortController(),requested=independent?{...body,previousId:null}:body;
   const receipt=scenario==='historical'?{...baseReceipt,snapshot:{...baseReceipt.snapshot,additionalCitations:undefined,archives:archives.slice(0,1)}}:baseReceipt;
   (globalThis as typeof globalThis&{visualTestDb:unknown}).visualTestDb={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:independent?{enabled:true}:null,error:null})})})}),rpc:async(name:string,args:Record<string,string>)=>{
    if(name==='conveni_decision_receipt_candidate'){
     reads++;assert.deepEqual(args,{p_record:id(1),p_job:id(2),p_unit:id(3),p_event:id(6),p_review:id(7),p_previous:null,p_link:id(4),p_receipt:id(5),p_actor:'Nom declarat',p_note:'Justificació econòmica',p_independent:independent});
     if(scenario==='rpc-error')return {error:{message:'synthetic'},data:null};
     if(scenario==='historical-unverifiable')return {error:{message:'ECONOMIC_HISTORICAL_REQUEST_UNVERIFIABLE'},data:null};
     if(scenario==='scope')return {error:null,data:{...receipt,snapshot:{...receipt.snapshot,unitId:id(77)}}};
     if(scenario==='snapshot-changed'&&reads===2)return {error:null,data:{...receipt,changed:true}};
     return {error:null,data:receipt};
    }
    assert.equal(name,'conveni_decision_commit_candidate');commits++;if(scenario==='commit-abort'){controller.abort();return new Promise(resolve=>{releaseCommit=resolve;});}return {data:{provision_id:id(9)},error:null};
   }};
   globalThis.fetch=async(url,options)=>{physical++;assert.equal(options?.method,'GET');const path=new URL(String(url)).pathname;
    if(scenario==='unavailable')return new Response(null,{status:503});
    if((scenario==='source-altered'&&path.endsWith(archives[0].source.path))||(scenario==='copy-altered'&&path.endsWith(archives[0].copy.path)))return new Response('altered');
    return new Response(bytes);};
   const base=request(requested);const response=await route.POST(new Request(base,{signal:controller.signal}),params);
   if(scenario==='valid'||scenario==='historical'){assert.equal(response.status,200,`${independent}/${scenario}`);assert.equal(commits,1);assert.equal(reads,2);assert.equal(physical,scenario==='historical'?2:4);}
   else if(scenario==='commit-abort'){assert.equal(response.status,409);assert.match((await response.json()).error,/si la decisió s’ha desat/);assert.equal(commits,1);assert.ok(releaseCommit);releaseCommit({data:{provision_id:id(9)},error:null});await new Promise(resolve=>setImmediate(resolve));assert.equal(commits,1);assert.equal(reads,2);}
   else if(scenario==='historical-unverifiable'){assert.equal(response.status,409);assert.match((await response.json()).error,/no es pot verificar tota la petició original/);assert.equal(commits,0);}
   else{assert.equal(response.status,409,`${independent}/${scenario}`);assert.equal(commits,0);}
  }
 }finally{globalThis.fetch=originalFetch;process.env=old;delete (globalThis as typeof globalThis&{visualTestDb?:unknown}).visualTestDb;await rm(dir,{recursive:true,force:true});}
});
