/** Run explicitly: node --import tsx tests/conveni-preparation-refresh.browser.ts */
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium,type Browser} from 'playwright';
import {resolve} from 'node:path';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function main(){
 const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ConveniEconomicPreparation} from './components/conveni-economic-form';createRoot(document.getElementById('root')!).render(<ConveniEconomicPreparation recordId="${id(1)}" jobId="${id(2)}" unitId="${id(3)}" onPrepared={()=>{(window as any).preparedCount++;}}/>);`,resolveDir:process.cwd(),sourcefile:'preparation-test.tsx',loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',alias:{'@':resolve('.')},logLevel:'silent'});
 const browser=await chromium.launch({headless:true});
 async function fixture(browser:Browser){
  const page=await browser.newPage(),attempts:Array<Record<string,unknown>>=[],deletions:Array<Record<string,unknown>>=[];
  const observations=['economic','identity','role_period'].map((role,i)=>({event_id:id(i+4),document_id:id(7),page:i+1,role,quote:`Cita ${role}`,declared_reviewer:'Revisora',created_at:'2026-11-01T10:00:00Z'}));
  const valid={independent:false,versionedHistory:null,history:{hasHistory:false},observations,operation:null,historyUnavailable:false,reconciliationAvailable:false,operationHistory:[]};
  const operation={id:id(8),record_id:id(1),job_id:id(2),unit_id:id(3),state:'pending',ids:{ackId:id(9),draftId:id(10),receiptId:id(11),linkId:id(12)},payload:{jobId:id(2),unitId:id(3),reviewer:'Revisora anterior',note:'Nota de preparació',literal:'10,00',monetaryId:id(4),identityId:id(5),rolePeriodId:id(6),historySnapshot:null}};
  await page.route('http://127.0.0.1:49101/',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
  await page.route('**/api/records/**/conveni/economic/prepare**',async r=>{
   if(r.request().method()==='POST'){attempts.push(r.request().postDataJSON());const status=await page.evaluate(()=>(window as unknown as {postStatus:number}).postStatus);await r.fulfill({status,contentType:'application/json',body:JSON.stringify({error:'Resposta de prova'})});return;}
   if(r.request().method()==='DELETE'){deletions.push(r.request().postDataJSON());const status=await page.evaluate(()=>(window as unknown as {deleteStatus:number}).deleteStatus);await r.fulfill({status,contentType:'application/json',body:JSON.stringify({error:'Conciliació incerta'})});return;}
   const mode=await page.evaluate(()=>(window as unknown as {readMode:string}).readMode);
   if(mode==='error'){await r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'No es pot carregar.'})});return;}
   const data=mode==='legacy'?{...valid,independent:true,versionedHistory:{record_id:id(1),unit_id:id(3),previous_id:null,events:[]},operation}:mode==='operation'?{...valid,operation}:mode==='reconcile'?{...valid,operation,reconciliationAvailable:true}:mode==='ready'?{...valid,operation:{...operation,state:'ready'}}:mode==='changed'?{...valid,observations:observations.map((o,i)=>i?o:{...o,quote:'Cita actualitzada'})}:valid;
   await r.fulfill({status:200,contentType:'application/json',body:mode==='malformed'?'{}':JSON.stringify(data)});
  });
  await page.goto('http://127.0.0.1:49101/');
  await page.evaluate(()=>{const w=window as unknown as {readMode:string;postMode:string;deleteMode:string;postStatus:number;deleteStatus:number;aborted:number;prepared:number};w.readMode='valid';w.postMode='normal';w.deleteMode='normal';w.postStatus=409;w.deleteStatus=409;w.aborted=0;w.prepared=0;const original=window.fetch.bind(window);window.fetch=((input:RequestInfo|URL,init?:RequestInit)=>{const post=init?.method==='POST',del=init?.method==='DELETE';const mode=post?w.postMode:del?w.deleteMode:w.readMode;if(mode==='fetch'||mode==='json'){init?.signal?.addEventListener('abort',()=>w.aborted++);if(mode==='fetch')return new Promise<Response>(()=>{});const r=new Response('{}');r.json=()=>new Promise(()=>{});return Promise.resolve(r);}if((post||del)&&mode==='incomplete')return Promise.resolve(new Response('{}',{status:200}));return original(input,init);}) as typeof fetch;});
  // The callback above intentionally records confirmed preparations only.
  await page.evaluate(()=>{(window as unknown as {preparedCount:number}).preparedCount=0;});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const load=page.getByRole('button',{name:'Carrega fonts i historial'}),submit=page.getByRole('button',{name:'Prepara i verifica les fonts'});
  async function loadForm(){await load.click();await submit.waitFor({state:'visible'});}
  async function fill(){await page.getByLabel('Cita de l’import').selectOption(id(4));await page.getByLabel('Cita d’identitat').selectOption(id(5));await page.getByLabel('Cita de receptor i període').selectOption(id(6));await page.getByLabel('Import literal de la cita').fill('10,00');await page.getByLabel('Nom declarat de qui revisa').fill('Revisora');await page.getByLabel('Justificació').fill('Anotació a conservar');await page.getByLabel('He contrastat naturalesa social, població i encaix al catàleg.').check();await page.getByLabel('He contrastat l’import, receptor i període; no atribueixo un màxim o import compartit sense evidència.').check();await page.getByLabel('He revisat tots els documents i annexos aplicables.').check();}
  return {page,attempts,deletions,load,submit,loadForm,fill};
 }
 try{
  {
   const f=await fixture(browser);await f.loadForm();await f.fill();await f.page.clock.install();
   for(const mode of ['error','malformed','fetch','json']){
    await f.page.evaluate(v=>{(window as unknown as {readMode:string}).readMode=v;},mode);await f.load.click();if(mode==='fetch'||mode==='json')await f.page.clock.fastForward(15000);await f.page.getByRole('alert').waitFor();assert.equal(await f.submit.isVisible(),false);
    await f.page.evaluate(()=>{(window as unknown as {readMode:string}).readMode='valid';});await f.loadForm();assert.equal(await f.page.getByLabel('Justificació').inputValue(),'Anotació a conservar');
   }
   await f.page.evaluate(()=>{(window as unknown as {readMode:string}).readMode='changed';});await f.loadForm();assert.equal(await f.page.getByLabel('Cita de l’import').inputValue(),'');assert.equal(await f.submit.isDisabled(),true);
   await f.page.evaluate(()=>{(window as unknown as {readMode:string}).readMode='legacy';});await f.load.click();await f.page.getByText(/es va registrar amb un contracte anterior/).waitFor();assert.equal(await f.page.getByRole('button',{name:'Continua la mateixa preparació'}).isDisabled(),true);await f.page.close();
  }
  for(const mode of ['http','fetch','json','incomplete']){
   const f=await fixture(browser);await f.loadForm();await f.fill();if(mode!=='http'){await f.page.clock.install();await f.page.evaluate(v=>{(window as unknown as {postMode:string}).postMode=v;},mode);}
   await f.submit.click();if(mode==='fetch'||mode==='json')await f.page.clock.fastForward(35000);await f.page.getByRole('alert').waitFor();await f.submit.waitFor({state:'visible'});assert.equal(await f.submit.isDisabled(),true);
   const count=f.attempts.length;await f.page.getByLabel('Justificació').fill('Anotació modificada');assert.equal(await f.submit.isDisabled(),true);assert.equal(f.attempts.length,count);
   for(const readMode of ['valid','operation','ready']){
    await f.page.evaluate(v=>{(window as unknown as {readMode:string}).readMode=v;},readMode);await f.load.click();
    if(readMode==='valid'){await f.submit.waitFor({state:'visible'});assert.equal(await f.submit.isDisabled(),true);}else{const resume=f.page.getByRole('button',{name:readMode==='ready'?'Consulta la preparació':'Continua la mateixa preparació'});await resume.waitFor({state:'visible'});assert.equal(await resume.isDisabled(),true);}
    assert.equal(f.attempts.length,count);
   }
   assert.equal(await f.page.evaluate(()=>(window as unknown as {preparedCount:number}).preparedCount),0);await f.page.getByText(/recarregar la pàgina no confirma/).waitFor();await f.page.close();
  }
  {
   const f=await fixture(browser);await f.page.evaluate(()=>{(window as unknown as {readMode:string}).readMode='operation';});await f.load.click();const resume=f.page.getByRole('button',{name:'Continua la mateixa preparació'});await resume.waitFor({state:'visible'});await resume.click();await f.page.getByRole('alert').waitFor();assert.equal(await resume.isDisabled(),true,'a failed resume is also uncertain');assert.equal(f.attempts.length,1);await f.page.close();
  }
  for(const mode of ['http','fetch','json','incomplete']){
   const f=await fixture(browser);await f.page.evaluate(()=>{(window as unknown as {readMode:string}).readMode='reconcile';});await f.load.click();const replace=f.page.getByRole('button',{name:'Confirma la substitució de l’intent'});await f.page.getByLabel('Motiu de la conciliació').fill('Motiu prou detallat');if(mode!=='http'){await f.page.clock.install();await f.page.evaluate(v=>{(window as unknown as {deleteMode:string}).deleteMode=v;},mode);}
   await replace.click();if(mode==='fetch'||mode==='json')await f.page.clock.fastForward(35000);await f.page.getByRole('alert').waitFor();
   await f.load.click();await replace.waitFor({state:'visible'});assert.equal(await replace.isDisabled(),true,'a later read cannot authorise another uncertain DELETE');assert.equal(await f.page.getByRole('button',{name:'Continua la mateixa preparació'}).isDisabled(),true);assert.ok(f.deletions.length<=1);await f.page.close();
  }
  {
   const f=await fixture(browser);await f.loadForm();await f.fill();await f.page.evaluate(()=>{(window as unknown as {postStatus:number}).postStatus=400;});await f.submit.click();await f.page.getByText('Resposta de prova').waitFor();await f.submit.waitFor({state:'visible'});assert.equal(await f.submit.isEnabled(),true,'an initial validation rejection can be corrected');const first=f.attempts[0];await f.page.getByLabel('Justificació').fill('Anotació corregida');await f.submit.click();await f.page.waitForTimeout(30);assert.equal(f.attempts.length,2);assert.notEqual(f.attempts[1].operationId,first.operationId);await f.page.close();
  }
  console.log('PASS preparation UI: stale reads hidden and uncertain mutations stay blocked after every preview');
 }finally{await browser.close();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
