/** Run explicitly in isolation: node --import tsx tests/conveni-unit-amount-warning.browser.ts */
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {resolve} from 'node:path';

async function main(){
 const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {Unit} from './components/conveni-study';
const unit={key:'synthetic',recipient:'Entitat sintètica',recipient_nif:null,recipient_nature:'unknown',joint:false,period:'2025',year:2025,amount_cents:271400,amount_state:'planned',mixed:false,financiers:[],territory:null,classification:'insufficient_evidence',service_code:null,population:'Persones',description:'Activitat',explanation:'Pendent',reason:null,evidence:[{document_id:'doc',page:1,quote:'L’entitat presta suport social.'}],blockers:[]};
createRoot(document.getElementById('root')!).render(<Unit row={{unit_id:'u',job_id:'j',review_id:null,outcome:null,reviewed_job:null,reviewed_code:null,review_note:null,data:unit}} concepts={[]} preparationAvailable={false} documents={[]} conceptHistory={[]} services={[]} disabled={true} save={async()=>{}}/>);`,resolveDir:process.cwd(),sourcefile:'unit-warning-fixture.tsx',loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',alias:{'@':resolve('.')},plugins:[{name:'next-navigation-stub',setup(build){
  build.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'fixture'}));
  build.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'js',contents:`export function useRouter(){return {refresh(){},push(){}}}`}));
 }}],logLevel:'silent'});
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.on('pageerror',error=>console.error('Fixture page error:',error));
  await page.route('http://127.0.0.1:49113/',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
  await page.goto('http://127.0.0.1:49113/');await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.getByText(/cites proposades per a aquesta unitat/).waitFor({timeout:5000});
  const text=await page.locator('#root').innerText();
  assert.match(text,/Import proposat per la IA/);assert.match(text,/una altra part del document/);assert.doesNotMatch(text,/No consta al document/);
  console.log('PASS unit proposal warning at mobile width; no classification or decision');
 }finally{await browser.close();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
