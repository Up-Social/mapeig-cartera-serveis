/** Run explicitly in an isolated environment: node --import tsx tests/conveni-signatories.browser.ts */
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {resolve} from 'node:path';

async function main(){
 const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ConveniSignatories} from './components/conveni-signatories';import {normalizeConveni} from './lib/convenis/contract';const source=normalizeConveni({'Organismes signants ens locals':'Ajuntament sintètic','Altres Organismes Signants':''});createRoot(document.getElementById('root')!).render(<ConveniSignatories source={source}/>);`,resolveDir:process.cwd(),sourcefile:'signatories-fixture.tsx',loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',alias:{'@':resolve('.')},logLevel:'silent'});
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.route('http://127.0.0.1:49112/',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
  await page.goto('http://127.0.0.1:49112/');await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.getByRole('heading',{name:'Organismes signants segons l’Excel'}).waitFor();
  assert.match(await page.locator('#root').innerText(),/camp buit no acredita que no hi hagi altres signants/);
  assert.match(await page.locator('#root').innerText(),/signant no és necessàriament el receptor/);
  console.log('PASS source signatories unknown displayed at mobile width; no classification or decisions');
 }finally{await browser.close();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
