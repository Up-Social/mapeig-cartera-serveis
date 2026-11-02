/** Run explicitly: node --import tsx tests/concert-award-availability.browser.ts */
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {resolve} from 'node:path';

async function main(){
 const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ConcertLineAward} from './components/concert-line-award';createRoot(document.getElementById('root')!).render(<ConcertLineAward recordId="record" unitId="unit" jobId="job" status="draft" serviceCode={null} quote={null} page={1} onSaved={()=>{}}/>);`,resolveDir:process.cwd(),sourcefile:'concert-award-test.tsx',loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',alias:{'@':resolve('.')},logLevel:'silent'});
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage();let mode:'disabled'|'error'|'ready'='disabled';
  await page.route('http://127.0.0.1:49101/',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
  await page.route('**/api/**',route=>{const url=route.request().url();if(url.includes('/population'))return route.fulfill({status:503,contentType:'application/json',body:'{}'});return route.fulfill({status:mode==='error'?503:200,contentType:'application/json',body:JSON.stringify(mode==='disabled'?{enabled:false}:mode==='ready'?{enabled:true,previousId:null}:{error:'private details'})});});
  async function open(){await page.goto('http://127.0.0.1:49101/');await page.addScriptTag({content:bundle.outputFiles[0].text});}
  await open();await page.getByText('La revisió econòmica individual encara no està disponible.',{exact:false}).waitFor();
  mode='error';await open();const alert=page.getByRole('alert');await alert.waitFor();assert.match(await alert.innerText(),/No s’ha pogut comprovar/);assert.doesNotMatch(await alert.innerText(),/private details/);
  mode='ready';await page.getByRole('button',{name:'Torna a comprovar'}).click();await page.getByText('No s’ha identificat un codi de servei',{exact:false}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Aprova la línia'}).isDisabled(),true);
  await page.getByText('No s’ha pogut carregar l’observació de població.').waitFor();
  console.log('PASS availability unavailable, error, retry, missing code and population fetch failure');
 }finally{await browser.close();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
