import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ConveniEconomicForm} from '../components/conveni-economic-form';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('economic route is closed by default and requires three separate confirmations',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mapeig-economic-route-')),output=join(dir,'route.mjs'),old={...process.env};let committed=false,markerUnavailable=false;
 try{
  await build({entryPoints:['app/api/records/[id]/conveni/economic/route.ts'],bundle:true,platform:'node',format:'esm',outfile:output,alias:{'@/lib/records-page':resolve('tests/fixtures/conveni-visual-db.ts'),'@':resolve('.')},logLevel:'silent'});
  const route=await import(pathToFileURL(output).href);const calls:string[]=[];
  (globalThis as typeof globalThis&{visualTestDb:unknown}).visualTestDb={from:(name:string)=>{assert.equal(name,'app_settings');return {select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:markerUnavailable?{code:'PGRST202'}:null})})})};},rpc:async(name:string)=>{calls.push(name);return {data:name==='conveni_first_candidate_ready'?{jobId:id(2),unitId:id(3),linkId:id(4),receiptId:id(5),reviewer:'Nom declarat'}:name==='conveni_first_recovery_status'?(committed?{provisionId:id(9)}:null):{provision_id:id(9)},error:null};}};
  const params={params:Promise.resolve({id:id(1)})};const request=(body:unknown)=>new Request('http://local.invalid',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const body={eventId:id(6),reviewId:id(7),jobId:id(2),unitId:id(3),linkId:id(4),receiptId:id(5),reviewer:'Nom declarat',note:'Justificació econòmica',social:true,economic:true,manifest:true};
  delete process.env.CONVENI_ECONOMIC_REVIEW_ENABLED;assert.equal((await route.POST(request(body),params)).status,404);assert.equal(calls.length,0);
  process.env.CONVENI_ECONOMIC_REVIEW_ENABLED='true';
  for(const k of ['social','economic','manifest'])assert.equal((await route.POST(request({...body,[k]:false}),params)).status,400);
  markerUnavailable=true;assert.equal((await route.GET(new Request(`http://local.invalid?jobId=${id(2)}&unitId=${id(3)}`),params)).status,503);markerUnavailable=false;
  const preview=await route.GET(new Request(`http://local.invalid?jobId=${id(2)}&unitId=${id(3)}`),params);assert.equal(preview.status,200);assert.equal((await preview.json()).candidate.linkId,id(4));
  committed=true;const raced=await route.GET(new Request(`http://local.invalid?jobId=${id(2)}&unitId=${id(3)}`),params);const racedData=await raced.json();assert.equal(racedData.candidate,null);assert.equal(racedData.recovery.provisionId,id(9));
  delete process.env.CONVENI_DECISION_PHYSICAL_VERIFICATION_ENABLED;
  const pending=await route.POST(request(body),params);assert.equal(pending.status,503);assert.match((await pending.json()).error,/pendent/);assert.deepEqual(calls,['conveni_first_candidate_ready','conveni_first_recovery_status','conveni_first_candidate_ready','conveni_first_recovery_status']);
 }finally{process.env=old;delete (globalThis as typeof globalThis&{visualTestDb?:unknown}).visualTestDb;await rm(dir,{recursive:true,force:true});}
});
test('economic form separates social, financial and document confirmations',()=>{
 const html=renderToStaticMarkup(createElement(ConveniEconomicForm,{recordId:id(1),jobId:id(2),unitId:id(3),linkId:id(4),receiptId:id(5),reviewer:'Nom declarat',onSaved:()=>{}}));
 assert.match(html,/no representa un pagament/);assert.match(html,/naturalesa social/);assert.match(html,/import compartit/);assert.match(html,/conjunt de documents i annexos/);assert.match(html,/disabled/);
});
