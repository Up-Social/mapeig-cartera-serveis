import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleCloudFailure} from '../lib/cloud/failure-handler';
import {CloudFailure,CloudYield} from '../lib/cloud/errors';
import type {Context} from '../lib/cloud/context';
import {isConveniMissingFieldMessage} from '../lib/convenis/missing-field-messages';

function fixture(commitError:unknown=null){
 const values=new Map<string,unknown>();const calls:Array<{name:string;args:Record<string,unknown>}>=[];
 const db={rpc:async(name:string,args:Record<string,unknown>)=>{
  calls.push({name,args});
  if(name==='cloud_checkpoint')values.set(String(args.p_key),args.p_value);
  if(name==='cloud_commit'&&commitError)return {data:null,error:commitError};
  return {data:true,error:null};
 },from:()=>{let key='';const q={select:()=>q,eq:(name:string,v:string)=>{if(name==='item_key')key=v;return q;},maybeSingle:async()=>({data:values.has(key)?{value:values.get(key)}:null,error:null})};return q;}};
 return {values,calls,c:{db,task:'task',owner:'owner',generation:1} as unknown as Context};
}
const conflict={code:'40001',message:'T19_DEDUP_BUSY'};
test('missing Conveni fields reach the public cloud error without leaking provider content',async()=>{
 const labels={CONVENI_RECIPIENT_MISSING:'receptor',CONVENI_PERIOD_MISSING:'període',CONVENI_POPULATION_MISSING:'població destinatària',CONVENI_DESCRIPTION_MISSING:'descripció del servei'};
 for(const [code,label] of Object.entries(labels)){
  const {c,calls}=fixture();
  await handleCloudFailure(c,new CloudFailure('validation',5,{operation:'conveni_analysis',code,message:'PRIVATE PROVIDER TEXT'}),'job','matching');
  const payload=calls.find(call=>call.name==='cloud_commit')?.args.p_data as {message:string};
  assert.ok(payload);assert.ok(payload.message.includes(label));assert.match(payload.message,/pendent/);assert.doesNotMatch(payload.message,/PRIVATE/);
 }
});
test('multiple missing fields survive the cloud commit as fixed, displayable messages',async()=>{
 const {c,calls}=fixture();
 const details=[{code:'CONVENI_RECIPIENT_MISSING',message:'PRIVATE'},
  {code:'CONVENI_PERIOD_MISSING',message:'PRIVATE'},
  ...Array.from({length:120},()=>({code:'CONVENI_RECIPIENT_MISSING',message:'PRIVATE'})),
  {code:'CONVENI_POPULATION_MISSING',message:'PRIVATE'},
  {code:'CONVENI_PERIOD_MISSING',message:'PRIVATE'},
  {code:'PRIVATE',message:'PRIVATE'}];
 await handleCloudFailure(c,new CloudFailure('validation',5,{operation:'conveni_analysis',code:'CONVENI_RECIPIENT_MISSING',details}),'job','matching');
 const payload=calls.find(call=>call.name==='cloud_commit')?.args.p_data as {message:string};
 assert.equal(payload.message.split('\n').length,3);
 assert.match(payload.message,/receptor/);assert.match(payload.message,/període/);assert.match(payload.message,/població destinatària/);
 assert.doesNotMatch(payload.message,/PRIVATE/);assert.equal(isConveniMissingFieldMessage(payload.message),true);
 assert.equal(isConveniMissingFieldMessage(payload.message+'\nPRIVATE'),false);
 assert.equal(isConveniMissingFieldMessage('La proposta indica que el NIF del receptor no està acreditat. No és motiu de descart; queda pendent de contrast.'),true);
});
test('unknown primary failure stays visible and unrelated details do not change other failures',async()=>{
 const {c,calls}=fixture();
 const details=[{code:'CONVENI_PERIOD_MISSING',message:'PRIVATE'}];
 await handleCloudFailure(c,new CloudFailure('validation',5,{operation:'conveni_analysis',code:'CONVENI_CITATION_UNVERIFIABLE',details}),'job','matching');
 const payload=calls.find(call=>call.name==='cloud_commit')?.args.p_data as {message:string};
 assert.match(payload.message,/^Resposta no vàlida\./);assert.match(payload.message,/període/);
 assert.equal(isConveniMissingFieldMessage(payload.message),true);
 assert.equal(isConveniMissingFieldMessage('Resposta no vàlida.\nPRIVATE'),false);
});
test('conflict while recording a document failure is retried and eventually paused',async()=>{
 const {c,calls,values}=fixture(conflict);
 for(let i=1;i<=3;i++){
  const result=await handleCloudFailure(c,new CloudFailure('document',5,{operation:'ocr',code:'OCR_TEXT_TOO_LARGE'}),'job','document_extraction');
  assert.deepEqual(result,i<3?{done:false,wait:5}:{done:true,wait:0});
  assert.equal(values.get('retry:job'),i);
 }
 const finishes=calls.filter(call=>call.name==='cloud_finish');
 assert.deepEqual(finishes.map(call=>call.args.p_state),['pending','pending','paused']);
 assert.equal(finishes[2].args.p_kind,'transient');
 const last=values.get('last_failure') as {diagnostic:{code:string;details:Record<string,unknown>}};
 assert.equal(last.diagnostic.code,'T19_DEDUP_BUSY');
 assert.deepEqual(last.diagnostic.details,{original_failure_kind:'document',original_failure_code:'OCR_TEXT_TOO_LARGE'});
});

test('an uncertain provider result is paused without committing a domain error',async()=>{
 const {c,calls}=fixture(conflict);
 const result=await handleCloudFailure(c,new CloudFailure('provider_unknown',5,{operation:'provider_release',code:'PROVIDER_UNKNOWN_RESOURCE_RELEASE_UNCONFIRMED'}),'job','matching');
 assert.deepEqual(result,{done:true,wait:0});
 assert.equal(calls.some(call=>call.name==='cloud_commit'),false);
 assert.equal(calls.find(call=>call.name==='cloud_finish')?.args.p_kind,'provider_unknown');
});

test('competing Conveni journal is paused for reconciliation without clearing receipts or reserves',async()=>{
 const {c,calls,values}=fixture();
 values.set('ai:job:conveni',{state:'sending',attempt:1});
 const outcome=await handleCloudFailure(c,new CloudFailure('provider_reconciliation',5,{operation:'cloud_checkpoint',code:'EXISTING_PROVIDER_RECEIPT_REVIEW_REQUIRED'}),'job','matching');
 assert.deepEqual(outcome,{done:true,wait:0});
 assert.deepEqual(values.get('ai:job:conveni'),{state:'sending',attempt:1});
 assert.equal(calls.some(call=>['cloud_commit','cloud_budget_settle','cloud_budget_reserve'].includes(call.name)),false);
 assert.equal(calls.find(call=>call.name==='cloud_finish')?.args.p_kind,'provider_reconciliation');
});

test('unrelated commit errors are propagated and do not finish a task as pending',async()=>{
 const {c,calls}=fixture({code:'40001',message:'stale review'});
 await assert.rejects(handleCloudFailure(c,new CloudFailure('validation'),'job','matching'),e=>e instanceof CloudFailure&&e.kind==='internal');
 assert.equal(calls.some(call=>call.name==='cloud_finish'),false);
});

test('yield retains the existing pending transition',async()=>{
 const {c,calls}=fixture();
 assert.deepEqual(await handleCloudFailure(c,new CloudYield(30),undefined,'load_task'),{done:false,wait:30});
 assert.equal(calls.find(call=>call.name==='cloud_finish')?.args.p_state,'pending');
});


test('sensitive original diagnostics are not copied into the retry checkpoint',async()=>{
 const {c,values}=fixture(conflict);
 await handleCloudFailure(c,new CloudFailure('validation',5,{operation:'private',code:'PRIVATE DOCUMENT CONTENT',message:'SENSITIVE',details:{text:'SENSITIVE'}}),'job','matching');
 const last=JSON.stringify(values.get('last_failure'));
 assert.equal(last.includes('SENSITIVE'),false);assert.equal(last.includes('PRIVATE'),false);
 assert.equal((values.get('last_failure') as {diagnostic:{details:{original_failure_code:null}}}).diagnostic.details.original_failure_code,null);
});

test('lease failure prevents the handler from finishing or requeuing the task',async()=>{
 const {c,calls}=fixture(conflict);const original=c.db.rpc.bind(c.db);
 c.db.rpc=(async(name:string,args:Record<string,unknown>)=>name==='cloud_checkpoint'?{data:null,error:{code:'P0001',message:'CLOUD_LEASE_EXPIRED'}}:original(name,args)) as unknown as typeof c.db.rpc;
 await assert.rejects(handleCloudFailure(c,new CloudFailure('document'),'job','document_extraction'));
 assert.equal(calls.some(call=>call.name==='cloud_finish'),false);
});
