/** Run explicitly: node --import tsx tests/concert-support-proposal.browser.ts */
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {resolve} from 'node:path';
async function main(){
 const code='1.2.6.2.4.1';
 const services=[{code,name:'Servei STO agrupador'},{code:`${code}.1`,name:'Servei de teràpia ocupacional per a persones amb discapacitat intel·lectual'},{code:`${code}.2`,name:'Servei de teràpia ocupacional per a persones amb discapacitat intel·lectual, amb auxiliar'}];
 const record={id:'fixture',title:'Resolució de provisió',sourceDocuments:[],corrections:[],currentJobStatus:'needs_review',analysis:null,isHistorical:false};
 const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ConcertUnits} from './components/concert-units';createRoot(document.getElementById('root')!).render(<ConcertUnits record={${JSON.stringify(record)} as never} services={${JSON.stringify(services)}}/>);`,resolveDir:process.cwd(),sourcefile:'support-proposal-test.tsx',loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',alias:{'@':resolve('.')},logLevel:'silent'});
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage();
  await page.route('http://127.0.0.1:49103/',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
  const rows=['STOI','STOAI','SOII'].map((value,index)=>({id:`line-${index}`,unit_key:`line-${index}`,document_id:'doc',act_type:'award',status:'draft',amount:null,observed_service_code:code,provider_name:`Entitat ${index}`,provider_nif:null,reses_code:`S1000${index}`,observation:{},printed_support_candidate:{value,page:4}}));
  await page.route('**/api/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(route.request().url().endsWith('/units')?{supported:true,units:rows,reconciliations:[]}:{links:[]})}));
  await page.goto('http://127.0.0.1:49103/');await page.addScriptTag({content:bundle.outputFiles[0].text});
  const lines=page.getByTestId('concert-unit');await lines.first().waitFor();
  assert.match(await lines.nth(0).innerText(),/Proposta de codi específic: 1\.2\.6\.2\.4\.1\.1/);
  assert.match(await lines.nth(1).innerText(),/Proposta de codi específic: 1\.2\.6\.2\.4\.1\.2/);
  assert.doesNotMatch(await lines.nth(2).innerText(),/Proposta de codi específic/);
  assert.match(await lines.nth(0).innerText(),/No modifica el codi observat ni aprova la línia o el finançament/);
  console.log('PASS support codes are proposals only and unknown values are not inferred');
 }finally{await browser.close();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
