/** Run explicitly: node --import tsx tests/concert-award-uncertain.browser.ts */
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {resolve} from 'node:path';
async function main(){
 const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ConcertLineAward} from './components/concert-line-award';createRoot(document.getElementById('root')!).render(<ConcertLineAward recordId="record" unitId="unit" jobId="job" status="draft" serviceCode="1.2.3" quote="Cita documental sintètica" page={1} onSaved={()=>{}}/>);`,resolveDir:process.cwd(),sourcefile:'award-uncertain-test.tsx',loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',alias:{'@':resolve('.')},logLevel:'silent'});
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage();let posts=0;
  await page.route('http://127.0.0.1:49102/',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
  await page.route('**/api/**',route=>{if(route.request().method()==='POST'){posts++;return route.abort('failed');}const body=route.request().url().includes('/population')?{snapshot:{event:{id:'synthetic-event'}}}:{enabled:true,previousId:null};return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});});
  await page.goto('http://127.0.0.1:49102/');await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.getByLabel('Import literal a la font').fill('100,00');
  await page.getByLabel('Justificació',{exact:true}).fill('Revisió sintètica completa');
  await page.getByLabel('Nom declarat de la persona revisora').fill('Persona revisora');
  await page.getByRole('checkbox').nth(0).check();await page.getByRole('checkbox').nth(1).check();await page.getByRole('checkbox').nth(2).check();
  const approve=page.getByRole('button',{name:'Aprova la línia'});await approve.click();
  const alert=page.getByRole('alert');await alert.waitFor();assert.match(await alert.innerText(),/Pot haver-se desat/);assert.equal(await approve.isDisabled(),true);
  await page.getByLabel('Import literal a la font').fill('200,00');assert.equal(await approve.isDisabled(),true);assert.equal(posts,1);
  console.log('PASS uncertain submission displays warning and blocks repeat in current component');
 }finally{await browser.close();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
