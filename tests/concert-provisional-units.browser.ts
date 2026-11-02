/** Run explicitly: node --import tsx tests/concert-provisional-units.browser.ts */
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {resolve} from 'node:path';

async function main(){
 const title='Acord proposta per a la provisió de serveis socials de prova en una ciutat fictícia';
 const extractedText=`## Pàgina 1\n${title}\nPROPOSA\nAssignar els serveis de prova.\n## Pàgina 2\nANNEX 1. SERVEIS ASSIGNATS\n1.- Servei fictici Alfa en règim de concert social\n2.- Servei fictici Beta en règim de gestió delegada\n## Pàgina 3\nANNEX 2. ALTRES DADES`;
 const record={id:'fixture',title,sourceDocuments:[{id:'proposal-document',documentType:'publication',status:'fetched',extractedText,textLength:extractedText.length,qualityFlags:[],currentTextConsistent:true,extractionPartial:false,extractionCoverage:{complete:true},archived:true}],corrections:[],currentJobStatus:'needs_review',analysis:null,isHistorical:false};
 const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ConcertUnits} from './components/concert-units';createRoot(document.getElementById('root')!).render(<ConcertUnits record={${JSON.stringify(record)} as never} services={[]}/>);`,resolveDir:process.cwd(),sourcefile:'concert-provisional-test.tsx',loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',alias:{'@':resolve('.')},logLevel:'silent'});
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage();
  await page.route('http://127.0.0.1:49100/',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
  const units=[{id:'line-1',document_id:'different-document' as string|null,unit_key:'narrative',act_type:'award',amount:null,status:'draft',provider_name:null,observed_service_name:null,observation:{},quantity:null}];
  await page.route('**/api/**',route=>{const url=route.request().url();const body=url.endsWith('/units')?{supported:true,units,reconciliations:[]}:url.endsWith('/concert-links')?{links:[]}:{supported:false};return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});});
  async function open(){await page.goto('http://127.0.0.1:49100/');await page.addScriptTag({content:bundle.outputFiles[0].text});await page.getByTestId('concert-unit').first().waitFor();}
  await open();
  const proposal=page.getByRole('region',{name:'Serveis de la proposta pendents de revisió'});
  assert.equal(await proposal.count(),1);
  assert.match(await proposal.innerText(),/Servei fictici Alfa/);
  assert.match(await proposal.innerText(),/no se n’ha deduït cap vinculació/);
  assert.match(await proposal.innerText(),/no són línies aprovades ni sumen finançament/);
  units[0].document_id='proposal-document';
  await open();assert.equal(await proposal.count(),0);
  assert.match(await page.getByRole('status').filter({hasText:'mateix document'}).innerText(),/això no acredita una resolució definitiva/);
  units[0].document_id=null;
  await open();assert.equal(await proposal.count(),0);
  assert.match(await page.getByRole('status').filter({hasText:'document d’origen'}).innerText(),/no es dedueix cap vinculació/);
  console.log('PASS provisional headings with distinct, identical and missing unit source');
 }finally{await browser.close();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
