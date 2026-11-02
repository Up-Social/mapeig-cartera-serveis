/** Run explicitly: node --import tsx tests/conveni-economic-refresh.browser.ts */
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium,type Browser} from 'playwright';
import {resolve} from 'node:path';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function main(){
 const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ConveniEconomicCandidate} from './components/conveni-economic-form';createRoot(document.getElementById('root')!).render(<ConveniEconomicCandidate recordId="record" jobId="${id(1)}" unitId="${id(2)}" onSaved={()=>{}}/>);`,resolveDir:process.cwd(),sourcefile:'candidate-test.tsx',loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',alias:{'@':resolve('.')},logLevel:'silent'});
 const browser=await chromium.launch({headless:true});
 async function fixture(browser:Browser){
  const page=await browser.newPage(),attempts:Array<{eventId:string;reviewId:string}>=[];
  await page.route('http://127.0.0.1:49100/',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
  await page.route('**/api/records/record/conveni/economic**',async r=>{
   if(r.request().method()==='POST'){attempts.push(r.request().postDataJSON());const status=await page.evaluate(()=>(window as unknown as {postStatus:number}).postStatus);await r.fulfill({status,contentType:'application/json',body:JSON.stringify({error:'Resposta de prova'})});return;}
   const mode=await page.evaluate(()=>(window as unknown as {readMode:string}).readMode);
   if(mode==='error'){await r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'No es pot verificar la preparació econòmica.'})});return;}
   if(mode==='malformed'){await r.fulfill({status:200,contentType:'application/json',body:'{}'});return;}
   const changed=mode==='changed';await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({candidate:{jobId:id(1),unitId:id(2),receiptId:id(changed?5:3),linkId:id(changed?6:4),reviewer:'Nom declarat'},recovery:null})});
  });
  await page.goto('http://127.0.0.1:49100/');
  await page.evaluate(()=>{const w=window as unknown as {readMode:string;postMode:string;postStatus:number;aborted:number};w.readMode='valid';w.postMode='normal';w.postStatus=503;w.aborted=0;const original=window.fetch.bind(window);window.fetch=((input:RequestInfo|URL,init?:RequestInit)=>{const post=init?.method==='POST';const mode=post?w.postMode:w.readMode;if(mode==='fetch'||mode==='json'){init?.signal?.addEventListener('abort',()=>w.aborted++);if(mode==='fetch')return new Promise<Response>(()=>{});const response=new Response('{}');response.json=()=>new Promise(()=>{});return Promise.resolve(response);}if(post&&mode==='incomplete')return Promise.resolve(new Response('{}',{status:200}));return original(input,init);}) as typeof fetch;});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const check=page.getByRole('button',{name:'Comprova la preparació econòmica'}),note=page.getByLabel('Justificació'),confirm=page.getByRole('button',{name:'Confirma l’atribució'});
  async function load(){await check.click();await note.waitFor({state:'visible'});}
  async function fill(){await note.fill('Anotació que cal conservar');await page.getByLabel('He contrastat la naturalesa social, la població i l’encaix al catàleg.').check();await page.getByLabel('He contrastat l’import, el receptor i el període; no atribueixo un màxim o import compartit sense evidència.').check();await page.getByLabel('He revisat el conjunt de documents i annexos aplicables.').check();}
  return {page,attempts,check,note,confirm,load,fill};
 }
 try{
  {
   const f=await fixture(browser);await f.load();await f.fill();await f.page.clock.install();
   for(const mode of ['error','malformed','fetch','json']){
    await f.page.evaluate(v=>{(window as unknown as {readMode:string}).readMode=v;},mode);
    await f.check.click();if(mode==='fetch'||mode==='json')await f.page.clock.fastForward(15000);
    await f.page.getByRole('alert').waitFor();assert.equal(await f.note.isVisible(),false);
    await f.page.evaluate(()=>{(window as unknown as {readMode:string}).readMode='valid';});await f.load();assert.equal(await f.note.inputValue(),'Anotació que cal conservar');
   }
   await f.page.evaluate(()=>{(window as unknown as {readMode:string}).readMode='changed';});await f.load();assert.equal(await f.note.inputValue(),'');assert.equal(await f.confirm.isDisabled(),true);
   await f.page.close();
  }
  for(const mode of ['http','fetch','json','incomplete']){
   const f=await fixture(browser);await f.load();await f.fill();if(mode!=='http'){await f.page.clock.install();await f.page.evaluate(v=>{(window as unknown as {postMode:string}).postMode=v;},mode);}
   await f.confirm.click();if(mode==='fetch'||mode==='json')await f.page.clock.fastForward(35000);
   await f.page.getByRole('alert').waitFor();assert.equal(await f.confirm.isDisabled(),true);
   const count=f.attempts.length;await f.note.fill('Justificació modificada');assert.equal(await f.confirm.isDisabled(),true);assert.equal(f.attempts.length,count);
   await f.page.evaluate(()=>{(window as unknown as {readMode:string}).readMode='changed';});await f.check.click();await f.note.waitFor({state:'visible'});
   await f.fill();assert.equal(await f.confirm.isDisabled(),true,'refresh and remount cannot re-enable mutation');assert.equal(f.attempts.length,count);
   await f.page.getByText(/recarregar la pàgina no confirma/).waitFor();await f.page.close();
  }
  {
   const f=await fixture(browser);await f.load();await f.fill();await f.page.evaluate(()=>{(window as unknown as {postStatus:number}).postStatus=400;});await f.confirm.click();await f.page.getByText('Resposta de prova').waitFor();
   assert.equal(await f.confirm.isEnabled(),true,'initial validation rejection can be corrected');const first=f.attempts[0];await f.note.fill('Justificació corregida');await f.confirm.click();await f.page.waitForTimeout(30);assert.equal(f.attempts.length,2);assert.notEqual(f.attempts[1].eventId,first.eventId);await f.page.close();
  }
  console.log('PASS economic UI: reads fail closed; uncertain mutations cannot be resent after refresh or remount');
 }finally{await browser.close();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
