/** Synthetic browser test for the private candidate; no remote services. */
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {resolve} from 'node:path';
async function main(){
 const component=resolve('components/conveni-economic-form.tsx');
 const parser=resolve('lib/convenis/preparation-preview.ts');
 const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ConveniEconomicPreparation} from ${JSON.stringify(component)};createRoot(document.getElementById('root')!).render(<ConveniEconomicPreparation recordId="00000000-0000-4000-8000-000000000001" jobId="00000000-0000-4000-8000-000000000002" unitId="00000000-0000-4000-8000-000000000003" onPrepared={()=>{}}/>);`,resolveDir:process.cwd(),sourcefile:'guard-ui.tsx',loader:'tsx'},loader:{'.txt':'tsx'},bundle:true,write:false,platform:'browser',format:'iife',alias:{'@/lib/convenis/preparation-preview':parser,'@':resolve('.')},logLevel:'silent'});
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const observations=['economic','identity','role_period'].map((role,i)=>({event_id:id(i+4),document_id:id(7),page:i+1,role,quote:`Cita ${role}`,declared_reviewer:'Revisora',created_at:'2026-11-01T10:00:00Z'}));
  const valid={independent:false,versionedHistory:null,history:{hasHistory:false},observations,operation:null,historyUnavailable:false,reconciliationAvailable:false,operationHistory:[]};
  const operation={id:id(8),record_id:id(1),job_id:id(2),unit_id:id(3),state:'pending',ids:{ackId:id(9),draftId:id(10),receiptId:id(11),linkId:id(12)},payload:{jobId:id(2),unitId:id(3),reviewer:'Revisora',note:'Nota de preparació',literal:'10,00',monetaryId:id(4),identityId:id(5),rolePeriodId:id(6),historySnapshot:null}};
  await page.route('http://127.0.0.1:49101/',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
  await page.route('**/api/records/**/conveni/economic/prepare**',async r=>{
   if(r.request().method()==='POST'){await page.evaluate(()=>{(window as unknown as {mode:string}).mode='blockedOperation';});await r.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Resposta incerta'})});return;}
   const mode=await page.evaluate(()=>(window as unknown as {mode:string}).mode);
   const guard=mode==='malformed'?{blocked:'yes',versionedBlocked:false}:mode==='versioned'?{blocked:false,versionedBlocked:true}:{blocked:mode==='blocked'||mode==='blockedOperation',versionedBlocked:false};
   const data=mode==='off'?valid:{...valid,preparationGuard:guard,...(mode==='blockedOperation'?{operation}: {})};
   await r.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto('http://127.0.0.1:49101/');await page.evaluate(()=>{(window as unknown as {mode:string}).mode='off';});await page.addScriptTag({content:bundle.outputFiles[0].text});
  const load=page.getByRole('button',{name:'Carrega fonts i historial'}),submit=page.getByRole('button',{name:'Prepara i verifica les fonts'});
  await load.click();await submit.waitFor({state:'visible'});
  await page.evaluate(()=>{(window as unknown as {mode:string}).mode='malformed';});await load.click();await page.getByRole('alert').waitFor();assert.equal(await submit.isVisible(),false);
  await page.evaluate(()=>{(window as unknown as {mode:string}).mode='blocked';});await load.click();await page.getByText(/Una preparació anterior pot continuar/).waitFor();assert.equal(await submit.isVisible(),false);
  await page.evaluate(()=>{(window as unknown as {mode:string}).mode='versioned';});await load.click();await submit.waitFor({state:'visible'});
  await page.evaluate(()=>{(window as unknown as {mode:string}).mode='ready';});await load.click();await submit.waitFor({state:'visible'});
  await page.getByLabel('Cita de l’import').selectOption(id(4));await page.getByLabel('Cita d’identitat').selectOption(id(5));await page.getByLabel('Cita de receptor i període').selectOption(id(6));
  await page.getByLabel('Import literal de la cita').fill('10,00');await page.getByLabel('Nom declarat de qui revisa').fill('Revisora');await page.getByLabel('Justificació').fill('Anotació a conservar');
  await page.getByLabel('He contrastat naturalesa social, població i encaix al catàleg.').check();await page.getByLabel('He contrastat l’import, receptor i període; no atribueixo un màxim o import compartit sense evidència.').check();await page.getByLabel('He revisat tots els documents i annexos aplicables.').check();
  await submit.click();await page.getByText(/Una preparació anterior pot continuar/).waitFor();assert.equal(await page.getByRole('button',{name:'Continua la mateixa preparació'}).isDisabled(),true);assert.equal(await submit.isVisible(),false);assert.equal(await page.getByRole('button',{name:'Confirma la substitució de l’intent'}).count(),0);
  console.log('PASS integrated UI: flag off, malformed status, versioned available, active block and lost-response reload');
 }finally{await browser.close();}
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
