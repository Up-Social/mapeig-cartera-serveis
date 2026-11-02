import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createClient} from '@supabase/supabase-js';
import {analyzeRecord} from '../../lib/cloud/analysis';
import {handleCloudFailure} from '../../lib/cloud/failure-handler';
import {CloudFailure} from '../../lib/cloud/errors';

const pg=process.env.REVIEW_TEST_PG!, rest=process.env.REVIEW_TEST_REST!;
if(!/^mapeig-review-[a-f0-9]{12}-pg$/.test(pg)||!/^mapeig-review-[a-f0-9]{12}-rest$/.test(rest))throw Error('Invalid isolated container names');
const bridge:typeof fetch=async(input,init)=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
 if(url.origin!=='http://fixture.invalid')throw Error('External HTTP forbidden');
 const headers=new Headers(init?.headers);const args=['exec',pg,'curl','-sS','--max-time','8','-w','\n%{http_code}','-X',init?.method??'GET'];
 for(const name of ['accept','content-type','prefer','range','range-unit']){const value=headers.get(name);if(value)args.push('-H',`${name}: ${value}`);}
 if(typeof init?.body==='string')args.push('--data-binary',init.body);
 args.push(`http://${rest}:3000${url.pathname.replace(/^\/rest\/v1/, '')}${url.search}`);
 const output=execFileSync('docker',args,{encoding:'utf8'}),cut=output.lastIndexOf('\n'),status=Number(output.slice(cut+1)),body=output.slice(0,cut);
 return new Response(status===204||status===205||status===304?null:body,{status,headers:{'Content-Type':'application/json'}});
};
let externalCalls=0;globalThis.fetch=async()=>{externalCalls++;throw Error('External provider forbidden');};
const db=createClient('http://fixture.invalid','synthetic',{global:{fetch:bridge},auth:{persistSession:false,autoRefreshToken:false}});
const owner='60000000-0000-4000-8000-000000000001';
async function main(){
for(let n=1;n<=11;n++){
 const suffix=String(n).padStart(12,'0'),record=`10000000-0000-4000-8000-${suffix}`,job=`20000000-0000-4000-8000-${suffix}`,task=`30000000-0000-4000-8000-${suffix}`;
 const context={db,task,owner,generation:1};
 if(n===1||n===9){
  await analyzeRecord(context,{id:job,source_record_id:record},'matching');
  const view=await db.from('current_record_results').select('classification,destination,execution_status,human_reviewed').eq('id',record).single();
  if(view.error)throw view.error;
  assert.equal(view.data.classification,'insufficient_evidence');assert.equal(view.data.destination,'issues');assert.equal(view.data.execution_status,'needs_review');assert.equal(view.data.human_reviewed,false);
  if(n===9){const analysis=await db.from('analysis_results').select('rule_audit').eq('pipeline_job_id',job).single();if(analysis.error)throw analysis.error;assert.equal(analysis.data.rule_audit.version,'concert-program-lines-v2');}
 } else {
  let caught:unknown;try{await analyzeRecord(context,{id:job,source_record_id:record},'matching');}catch(error){caught=error;}
  assert.ok(caught instanceof CloudFailure);assert.equal(caught.kind,n===4||n===5?'provider_unknown':'provider_reconciliation');
  await handleCloudFailure(context,caught,job,'matching');
  const t=await db.from('worker_tasks').select('execution_state').eq('id',task).single();if(t.error)throw t.error;assert.equal(t.data.execution_state,'paused');
  const a=await db.from('analysis_results').select('id').eq('pipeline_job_id',job);if(a.error)throw a.error;assert.equal(a.data.length,0);
  const receiptJob=n===6?'90000000-0000-4000-8000-000000000001':job;const phase=n===6?'enrichment':n===7?'concert-role-review-v2':'matching';const key=`ai:${receiptJob}:${phase}`;const receipt=await db.from('cloud_checkpoints').select('value').eq('task_id',task).eq('item_key',key).single();if(receipt.error)throw receipt.error;
  assert.equal(receipt.data.value.state,({2:'received',3:'retry',4:'sending',5:'unknown',6:'received',7:'received',8:'rejected',10:'received',11:'received'} as Record<number,string>)[n]);
  const budget=await db.from('cloud_budget_reservations').select('reserved_usd,actual_usd').eq('task_id',task).eq('item_key',key).single();if(budget.error)throw budget.error;
  assert.equal(Number(budget.data.reserved_usd),0.42);assert.equal(budget.data.actual_usd,null);
 }
}
assert.equal(externalCalls,0);console.log('PASS: isolated cloud+PostgREST+SQL; uncertain/previous receipts paused and preserved, no provider call, no-receipt review reaches issues');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
