/** Run explicitly in an isolated environment: node --import tsx tests/issues-missing-fields.browser.ts */
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {resolve} from 'node:path';

async function main(){
 const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {IssuesWorkbench} from './app/issues/issues-workbench';import {SourceComparison} from './components/source-comparison';import {classifyIssue} from './lib/issue-types';import {CloudFailure,failureMessage} from './lib/cloud/errors';
 const message=failureMessage(new CloudFailure('validation',5,{operation:'conveni_analysis',code:'CONVENI_RECIPIENT_MISSING',details:[{code:'CONVENI_PERIOD_MISSING'},{code:'CONVENI_PROPOSAL_NIF_UNIDENTIFIED'}]}));
 const record={id:'record',title:'Conveni sintètic',sourceRecordId:'EXP',financingType:'conveni',sourceDataset:'convenis',matchingCandidates:[],sourceDocuments:[],unverifiedCandidateObservations:[],batchNumber:null,currentJobStatus:'error',matchingError:message,operationProgress:{state:'incident',step:'matching',failureKind:'validation'}};
 const issue=classifyIssue(record);if(!issue)throw new Error('Expected incident');
 const comparison={...record,financingType:'subvencio',sourceDataset:'raisc_subvencions',sourceFile:'fixture.xlsx',sourcePayload:{'CIF Beneficiari':'A12345678'},externalEnrichment:null,providerName:null,mechanism:null,amount:null};
 createRoot(document.getElementById('root')!).render(<><IssuesWorkbench result={{issues:[issue],total:1,page:1,pageCount:1,pageSize:20,metrics:{total:1,rejected:0,insufficient:0,technical:1,source:0}}} filters={{page:1,query:'',type:'totes'}}/><SourceComparison record={comparison}/></>);`,resolveDir:process.cwd(),sourcefile:'issues-fixture.tsx',loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',alias:{'@':resolve('.')},plugins:[{name:'next-stubs',setup(build){
  build.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'next-stub'}));
  build.onLoad({filter:/.*/,namespace:'next-stub'},args=>({loader:'jsx',resolveDir:process.cwd(),contents:args.path==='next/link'?`import React from 'react';export default function Link({children,href,...props}){return <a href={href} {...props}>{children}</a>}`:`export function useRouter(){return {refresh(){},push(){}}} export function usePathname(){return '/issues'} export function useSearchParams(){return new URLSearchParams()}`}));
 }}],logLevel:'silent'});
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  page.on('pageerror',error=>console.error('PAGE ERROR',error));
  await page.route('http://127.0.0.1:49101/',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
  await page.goto('http://127.0.0.1:49101/');await page.addScriptTag({content:bundle.outputFiles[0].text});
  const summary=page.getByText(/No s’ha identificat el receptor/).first();await summary.waitFor({timeout:5000});
  assert.match(await summary.innerText(),/període/);assert.match(await summary.innerText(),/NIF del receptor/);
  assert.equal(await page.getByRole('button',{name:'Reintent no disponible'}).isDisabled(),true);
  assert.match(await page.getByRole('row').filter({hasText:'A12345678'}).innerText(),/No disponible al resultat documental/);
  console.log('PASS issues display fixed missing recipient, period and NIF diagnostics in the summary');
 }finally{await browser.close();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
