import test from 'node:test';
import assert from 'node:assert/strict';
import {assertNoProviderReceiptsForConcertReview,reviewConcertDiscard} from '../lib/cloud/concert-discard-review';
import type {CloudDb} from '../lib/cloud/context';
import {CloudFailure} from '../lib/cloud/errors';

type Row=Record<string,unknown>;
const task='task',job='00000000-0000-4000-8000-000000000001';
const usage={input_tokens:100,output_tokens:20,input_tokens_details:{cached_tokens:10}};
const price=0.0000191;
function fixture(phase='enrichment'){
 const key=`ai:${job}:${phase}`;
 const tables:Record<string,Row[]>={
  cloud_checkpoints:[
   {task_id:task,item_key:key,value:{state:'received',response:{usage,output_text:'PRIVATE GENERATED TEXT'}}},
   {task_id:task,item_key:`usage:${job}:${phase==='matching'?'analysis':phase}`,value:structuredClone(usage)},
  ],
  cloud_budget_reservations:[{task_id:task,item_key:key,actual_usd:price,request_model:'gpt-6-luna',pricing_version:'openai-standard-2026-10-15'}],
 };
 const calls:Array<{name:string;args:Row}>=[];
 const reads:Array<{table:string;fields:string;from:number}>=[];
 const failure={table:'',price:false};
 const cost={value:price as unknown};
 class Query{
  filters:Array<(row:Row)=>boolean>=[];fields='';start=0;end=Infinity;
  constructor(private table:string){}
  select(fields:string){this.fields=fields;return this;}
  eq(key:string,value:unknown){this.filters.push(row=>row[key]===value);return this;}
  like(key:string,value:string){this.filters.push(row=>String(row[key]).startsWith(value.replace(/%$/,'')));return this;}
  contains(key:string,value:Row){this.filters.push(row=>Object.entries(value).every(([k,v])=>(row[key] as Row)?.[k]===v));return this;}
  order(){return this;}
  range(from:number,to:number){this.start=from;this.end=to;return this;}
  limit(n:number){this.end=n-1;return this;}
  then(resolve:(value:{data:Row[]|null;error:unknown})=>unknown,reject:(error:unknown)=>unknown){
   reads.push({table:this.table,fields:this.fields,from:this.start});
   const rows=(tables[this.table]??[]).filter(row=>this.filters.every(filter=>filter(row))).sort((a,b)=>String(a.item_key).localeCompare(String(b.item_key))).slice(this.start,this.end+1);
   const data=this.fields.includes('state:value')?rows.map(row=>({item_key:row.item_key,state:(row.value as Row)?.state,usage:((row.value as Row)?.response as Row)?.usage})):rows;
   return Promise.resolve(failure.table===this.table?{data:null,error:{message:'PRIVATE DATABASE ERROR'}}:{data,error:null}).then(resolve,reject);
  }
 }
 const db={from:(table:string)=>new Query(table),rpc:async(name:string,args:Row)=>{
  assert.equal(name,'ai_usage_cost_usd','the review fence must not write or settle usage');
  calls.push({name,args});
  return failure.price?{data:null,error:{message:'PRIVATE PRICE ERROR'}}:{data:cost.value,error:null};
 }} as unknown as CloudDb;
 const run=()=>assertNoProviderReceiptsForConcertReview(db,task);
 return {tables,calls,reads,failure,cost,run};
}
const receipt=(f:ReturnType<typeof fixture>)=>f.tables.cloud_checkpoints[0].value as Row;
const rejectsReason=(f:ReturnType<typeof fixture>,reason:string)=>assert.rejects(f.run,(error:unknown)=>{
 assert.ok(error instanceof CloudFailure);assert.equal(error.kind,'provider_reconciliation');
 assert.equal(error.diagnostic?.code,'EXISTING_PROVIDER_RECEIPT_REVIEW_REQUIRED');
 assert.deepEqual(error.diagnostic?.details,{reason});return true;
});

test('S1-6: a settled enrichment receipt permits a provisional review without another provider call',async()=>{
 const f=fixture();await f.run();
 assert.deepEqual(f.calls,[{name:'ai_usage_cost_usd',args:{p_usage:usage,p_model:'gpt-6-luna'}}]);
 assert.ok(f.reads.some(read=>read.fields==='item_key,state:value->>state,usage:value->response->usage'));
 const result=reviewConcertDiscard({classification:'discarded',reasons:['no_concert_award'],explanation:'',service_description:'',target_population:'',evidence_ordinals:[1],population_verified:false,social_service_verified:false,candidates:[],rule_audit:{version:'concert-title-no-award-v1',rule:'proposal'}},'concert',1);
 assert.equal(result.classification,'insufficient_evidence');assert.deepEqual(result.candidates,[]);
 assert.match(result.explanation,/provisional/);assert.match(result.explanation,/no acredita finançament/);
 assert.equal((receipt(f).response as Row).output_text,'PRIVATE GENERATED TEXT');
});

test('accounting accepts SQL-supported phase mappings and JSON object key reordering',async()=>{
 for(const phase of ['matching','positive-audit-v1','positive-audit-v2','positive-audit-v3','positive-audit-v4','contract-repair-v1','concert-role-review-v1','concert-role-review-v2','conveni']){
  const f=fixture(phase);f.tables.cloud_checkpoints[1].value={input_tokens_details:{cached_tokens:10},output_tokens:20,input_tokens:100};await f.run();
 }
});

test('sending and unknown retain precedence over accounting defects',async()=>{
 for(const state of ['sending','unknown']){
  const f=fixture();receipt(f).state=state;f.tables.cloud_budget_reservations=[];
  await assert.rejects(f.run,(error:unknown)=>error instanceof CloudFailure&&error.kind==='provider_unknown');assert.equal(f.calls.length,0);
 }
});

test('retry, rejected and malformed receipt phases remain pending',async()=>{
 for(const state of ['retry','rejected',null]){const f=fixture();receipt(f).state=state;await rejectsReason(f,'receipt_not_received');}
 const f=fixture('unrecognized');f.tables.cloud_checkpoints.pop();await rejectsReason(f,'unsupported_receipt_phase');
});

test('missing, invalid or mismatched usage never passes because a receipt says received',async()=>{
 const absent=fixture();absent.tables.cloud_checkpoints.pop();await rejectsReason(absent,'usage_missing');
 const different=fixture();different.tables.cloud_checkpoints[1].value={...usage,output_tokens:21};await rejectsReason(different,'usage_mismatch');
 for(const invalid of [null,{},[],{input_tokens:100,output_tokens:-1},{input_tokens:100.5,output_tokens:1}]){
  const f=fixture();(receipt(f).response as Row).usage=invalid;f.tables.cloud_checkpoints[1].value=invalid;await rejectsReason(f,'invalid_receipt_usage');
 }
});

test('missing reservation, unsettled and historical pricing remain pending',async()=>{
 const missing=fixture();missing.tables.cloud_budget_reservations=[];await rejectsReason(missing,'reservation_missing');
 for(const value of [null,-1,NaN,Infinity]){
  const f=fixture();f.tables.cloud_budget_reservations[0].actual_usd=value;await rejectsReason(f,'settlement_pending');
 }
 for(const version of [null,'future-price']){const f=fixture();f.tables.cloud_budget_reservations[0].pricing_version=version;await rejectsReason(f,'unsupported_pricing');}
});

test('database tariff must prove the settled amount including zero, not just its presence',async()=>{
 const wrong=fixture();wrong.cost.value=price+0.001;await rejectsReason(wrong,'settlement_mismatch');
 const invalid=fixture();invalid.cost.value=null;await rejectsReason(invalid,'settlement_mismatch');
 const free=fixture();free.cost.value=0;free.tables.cloud_budget_reservations[0].actual_usd=0;
 const zero={input_tokens:0,output_tokens:0};(receipt(free).response as Row).usage=zero;free.tables.cloud_checkpoints[1].value=zero;await free.run();
});

test('numeric JSON and PostgreSQL decimal strings compare exactly without float rounding',async()=>{
 for(const [actual,computed] of [['0.00154330000000000000','0.00154330000000000000'],['0.00154330000000000000',0.0015433],['0.0000001',1e-7],['0.000',0]]){
  const f=fixture();f.tables.cloud_budget_reservations[0].actual_usd=actual;f.cost.value=computed;await f.run();
 }
 const mismatch=fixture();mismatch.tables.cloud_budget_reservations[0].actual_usd='0.00154330000000000001';mismatch.cost.value='0.00154330000000000000';await rejectsReason(mismatch,'settlement_mismatch');
 for(const invalid of ['', ' ', '-1', 'Infinity','NaN','0x1','1e99999']){
  const f=fixture();f.tables.cloud_budget_reservations[0].actual_usd=invalid;await rejectsReason(f,'settlement_pending');
 }
});

test('orphan reservations and usage are not ignored even when no receipt exists',async()=>{
 const reservation=fixture();reservation.tables.cloud_checkpoints=[];await rejectsReason(reservation,'orphan_reservation');
 const usageOnly=fixture();usageOnly.tables.cloud_checkpoints.shift();usageOnly.tables.cloud_budget_reservations=[];await rejectsReason(usageOnly,'orphan_usage');
 const empty=fixture();empty.tables.cloud_checkpoints=[];empty.tables.cloud_budget_reservations=[];await empty.run();assert.equal(empty.calls.length,0);
});

test('accounting queries and pricing failures are explicit and do not expose database text',async()=>{
 for(const table of ['cloud_checkpoints','cloud_budget_reservations']){
  const f=fixture();f.failure.table=table;await assert.rejects(f.run,(error:unknown)=>error instanceof CloudFailure&&error.kind==='internal'&&!error.message.includes('PRIVATE'));
 }
 const f=fixture();f.failure.price=true;await assert.rejects(f.run,(error:unknown)=>error instanceof CloudFailure&&error.kind==='internal'&&error.diagnostic?.code==='RECEIPT_QUERY_FAILED');
});

test('pagination checks every receipt and reservation rather than trusting the first page',async()=>{
 const f=fixture();const template=structuredClone(f.tables);f.tables.cloud_checkpoints=[];f.tables.cloud_budget_reservations=[];
 for(let index=1;index<=501;index++){
  const id=`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`;
  for(const row of template.cloud_checkpoints)f.tables.cloud_checkpoints.push({...row,item_key:String(row.item_key).replace(job,id)});
  f.tables.cloud_budget_reservations.push({...template.cloud_budget_reservations[0],item_key:`ai:${id}:enrichment`,actual_usd:index===501?null:price});
 }
 await rejectsReason(f,'settlement_pending');
 assert.ok(f.reads.some(read=>read.table==='cloud_budget_reservations'&&read.from===500));
});
