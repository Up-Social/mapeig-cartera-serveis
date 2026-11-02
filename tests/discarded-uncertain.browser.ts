/** Run explicitly: node --import tsx tests/discarded-uncertain.browser.ts */
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {resolve} from 'node:path';

type FixtureWindow = Window & {requests:number;fixtureRefreshes:number;release:(mode:string)=>void};

async function main(){
 const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {DiscardedSelection} from './app/discarded/discarded-selection';const row={id:'00000000-0000-4000-8000-000000000001',job_id:'00000000-0000-4000-8000-000000000002',result_token:'fixture',source_record_id:'TEST-1',source_dataset:'test',financing_type:'conveni',title:'Fixture',batch_number:null,human_reviewed:false,job_created_at:null,reasons:[],explanation:'',evidence:[]};createRoot(document.getElementById('root')!).render(<DiscardedSelection rows={[row]} origin="test"/>);`,resolveDir:process.cwd(),sourcefile:'discard-uncertain-test.tsx',loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',alias:{'@':resolve('.')},plugins:[{name:'next-fixture',setup(b){b.onResolve({filter:/^next\/(navigation|link)$/},args=>({path:args.path,namespace:'next-fixture'}));b.onLoad({filter:/.*/,namespace:'next-fixture'},args=>({loader:'js',resolveDir:process.cwd(),contents:args.path.endsWith('navigation')?`export function useRouter(){return {refresh(){window.fixtureRefreshes=(window.fixtureRefreshes||0)+1}}}`:`import React from 'react';export default function Link({href,children,...props}){return React.createElement('a',{href,...props},children)}`}));}}],logLevel:'silent'});
 const browser=await chromium.launch({headless:true});
 try{
  for(const mode of ['network','uncertain','proxy502','proxy503','incomplete','missingId','malformed','complete','pending','history']){
   const page=await browser.newPage();
   await page.route('http://127.0.0.1:49101/',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
   await page.goto('http://127.0.0.1:49101/');
   await page.evaluate(()=>{const w=window as unknown as FixtureWindow;w.requests=0;w.fixtureRefreshes=0;w.fetch=()=>{w.requests++;return new Promise((resolve,reject)=>{w.release=(mode:string)=>{if(mode==='network')return reject(new TypeError('network'));const id='00000000-0000-4000-8000-000000000003';const body=mode==='history'?{rejection:'preserved_history',error:'Historial conservat'}:mode==='uncertain'?{uncertain:true,error:'incert'}:mode.startsWith('proxy')?{error:'gateway failed'}:mode==='incomplete'?{}:mode==='missingId'?{deleted:1,pending:0}:mode==='complete'?{deleted:1,pending:0,purgeId:id}:mode==='pending'?{pending:true,purgeId:id}:null;return resolve(new Response(mode==='malformed'?'not json':JSON.stringify(body),{status:mode==='history'?409:mode==='uncertain'||mode==='proxy503'?503:mode==='proxy502'?502:200,headers:{'Content-Type':'application/json'}}));};});};});
   await page.addScriptTag({content:bundle.outputFiles[0].text});
   await page.getByRole('checkbox',{name:'Seleccionar TEST-1'}).check();
   await page.getByRole('button',{name:'Eliminar seleccionats'}).click();
   const confirm=page.getByRole('button',{name:'Confirmo l’eliminació de 1'});
   await confirm.focus();await confirm.press('Enter');
   assert.equal(await page.getByRole('button',{name:'Verificant i eliminant…'}).isDisabled(),true);
   assert.equal(await page.evaluate(()=>(window as unknown as FixtureWindow).requests),1);
   await page.evaluate(value=>(window as unknown as FixtureWindow).release(value),mode);
   const expected=mode==='history'?/Historial conservat/:mode==='complete'?/Eliminació completa/:mode==='pending'?/neteja de fitxers pendent/:/pot continuar en curs/;
   await page.getByRole('status').getByText(expected).waitFor();
   assert.equal(await page.getByRole('checkbox',{name:'Seleccionar TEST-1'}).isChecked(),mode==='history');
   assert.equal(await page.getByRole('button',{name:'Eliminar seleccionats'}).isDisabled(),mode!=='history');
   assert.equal(await page.evaluate(()=>(window as unknown as FixtureWindow).requests),1);
   assert.equal(await page.evaluate(()=>(window as unknown as FixtureWindow).fixtureRefreshes),mode==='history'?0:1);
   await page.waitForTimeout(100);
   assert.match(await page.getByRole('status').innerText(),expected);
   await page.close();
  }
  console.log('PASS deletion UI: malformed/incomplete responses stay uncertain; valid complete/pending responses and no automatic resend; refresh is not terminal-state proof');
 }finally{await browser.close();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
