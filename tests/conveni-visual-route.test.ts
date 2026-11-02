import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('visual endpoint is disabled by default and prepares only verified bytes and explicit assertions',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mapeig-visual-route-'));const output=join(dir,'route.mjs');const old={...process.env},original=globalThis.fetch;
 try{
  await build({entryPoints:['app/api/records/[id]/conveni/visual/route.ts'],bundle:true,platform:'node',format:'esm',outfile:output,alias:{'@/lib/records-page':resolve('tests/fixtures/conveni-visual-db.ts'),'@':resolve('.')},logLevel:'silent'});
  const route=await import(pathToFileURL(output).href);const bytes=Buffer.from('%PDF-1.4 synthetic-only');const sha=createHash('sha256').update(bytes).digest('hex');
  const snapshot={recordId:id(1),documentId:id(2),document_state:{},source:{path:`cases/${id(1)}/documents/${id(2)}/${sha}.pdf`,sha256:sha,object_id:id(3),version:id(4)}};
  const calls:string[]=[];(globalThis as typeof globalThis&{visualTestDb:unknown}).visualTestDb={rpc:async(name:string,args:Record<string,unknown>)=>{calls.push(name);if(name==='conveni_visual_source')return {data:snapshot,error:null};if(name==='conveni_visual_save_read')return {data:{event_id:args.p_event,document_id:args.p_document,snapshot:args.p_snapshot},error:null};if(name==='conveni_visual_assert')return {data:{},error:null};if(name==='conveni_visual_history')return {data:[{event_id:id(6)}],error:null};throw Error(name);}};
  process.env.NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:1234';process.env.SUPABASE_SECRET_KEY='synthetic';delete process.env.CONVENI_VISUAL_REVIEW_ENABLED;
  globalThis.fetch=async()=>new Response(Uint8Array.from(bytes));
  const req=(body:unknown)=>new Request('http://local.invalid',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const params={params:Promise.resolve({id:id(1)})};const open={action:'open',documentId:id(2),eventId:id(5)};
  assert.equal((await route.POST(req(open),params)).status,404);assert.deepEqual(calls,[]);
  assert.equal((await route.GET(req({}),params)).status,404);
  process.env.CONVENI_VISUAL_REVIEW_ENABLED='true';
  assert.equal((await route.POST(req({...open,source:snapshot.source}),params)).status,400);assert.deepEqual(calls,[]);
  const pdf=await route.POST(req(open),params);assert.equal(pdf.status,200);assert.equal(pdf.headers.get('cache-control'),'private, no-store');assert.deepEqual(new Uint8Array(await pdf.arrayBuffer()),new Uint8Array(bytes));
  const assertion={action:'assert',documentId:id(2),eventId:id(6),readId:id(5),page:1,role:'economic',quote:'Cita sintètica llarga',reviewer:'Nom declarat',rationale:'Justificació sintètica',confirmed:true};
  assert.equal((await route.POST(req({...assertion,confirmed:false}),params)).status,400);assert.equal((await route.POST(req(assertion),params)).status,200);
  delete process.env.CONVENI_ECONOMIC_COVERAGE_ENABLED;assert.equal((await route.POST(req({...assertion,role:'coverage'}),params)).status,400);
  process.env.CONVENI_ECONOMIC_REVIEW_ENABLED='true';process.env.CONVENI_ECONOMIC_COVERAGE_ENABLED='true';assert.equal((await route.POST(req({...assertion,role:'coverage'}),params)).status,200);
  const history=await route.GET(req({}),params);assert.equal(history.status,200);assert.deepEqual(await history.json(),{observations:[{event_id:id(6)}]});assert.deepEqual(calls,['conveni_visual_source','conveni_visual_save_read','conveni_visual_assert','conveni_visual_assert','conveni_visual_history']);
 }finally{globalThis.fetch=original;process.env=old;delete (globalThis as typeof globalThis&{visualTestDb?:unknown}).visualTestDb;await rm(dir,{recursive:true,force:true});}
});
