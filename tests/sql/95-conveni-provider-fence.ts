import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {providerRequest} from '../../lib/cloud/provider';
import type {Context} from '../../lib/cloud/context';

const container=process.env.TEST_CONTAINER!;
if(!/^mapeig-conveni-schema-[a-f0-9]{12}$/.test(container))throw Error('fixture container required');
const task='ee000001-0000-4000-8000-000000000004',owner='ee000001-0000-4000-8000-000000000005';
const task2='ee000001-0000-4000-8000-000000000007',owner2='ee000001-0000-4000-8000-000000000008';
const key='ai:ee000001-0000-4000-8000-000000000003:conveni';
const mode=process.env.FIXTURE_MODE??'original';
const esc=(v:string)=>`'${v.replaceAll("'","''")}'`;
function sql(statement:string){return execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:statement,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();}
const args=(input:Record<string,unknown>)=>Object.entries(input).map(([name,value])=>`${name} => ${name==='p_value'||name==='p_usage'?`${esc(JSON.stringify(value))}::jsonb`:value===null?'null':typeof value==='boolean'||typeof value==='number'?String(value):typeof value==='object'?`${esc(JSON.stringify(value))}::jsonb`:esc(String(value))}`).join(',');
let reads=0;let releaseReads!:()=>void;const readBarrier=new Promise<void>(resolve=>{releaseReads=resolve;});
const db={from(table:string){let item='',selectedTask=task;const q={select(){return q;},eq(name:string,value:string){if(name==='item_key')item=value;if(name==='task_id')selectedTask=value;return q;},
 async maybeSingle(){
  if(table==='app_settings')return {data:{enabled:true,reason:null,updated_at:null},error:null};
  if(table!=='cloud_checkpoints')throw Error(`unexpected ${table}`);
  if(mode==='same-task-cross-client'&&item===key&&reads<2){reads++;if(reads===2)releaseReads();await readBarrier;return {data:null,error:null};}
  const value=sql(`select value::text from public.cloud_checkpoints where task_id=${esc(selectedTask)} and item_key=${esc(item)};`);
  return {data:value?{value:JSON.parse(value)}:null,error:null};
 },async single(){if(table==='cloud_resources')return {data:{blocked_kind:null},error:null};throw Error('unexpected single');}};return q;},
 async rpc(name:string,input:Record<string,unknown>){try{
  const out=sql(`select to_jsonb(public.${name}(${args(input)}))::text;`);
  return {data:out?JSON.parse(out):null,error:null};
 }catch(error){const stderr=String((error as {stderr?:unknown}).stderr??'');return {data:null,error:{message:stderr,code:'P0001'}};}}
};
const originalFetch=globalThis.fetch;const originalKey=process.env.OPENAI_API_KEY;
let calls=0;let sendResponse!:()=>void;const providerGate=new Promise<void>(resolve=>{sendResponse=resolve;});
globalThis.fetch=async()=>{
 calls++;
 if(['lifecycle-429','same-task-429'].includes(mode)&&calls===1)return Response.json({error:{code:'rate_limit'}},{status:429});
 if(['lifecycle-5xx','same-task-5xx'].includes(mode))return Response.json({error:{code:'temporary'}},{status:500});
 if(mode==='lifecycle-timeout')throw Error('simulated timeout');
 if(mode==='lifecycle-401')return Response.json({error:{code:'invalid_api_key'}},{status:401});
 if(['same-task','same-task-different','same-task-other'].includes(mode))await providerGate;
 return Response.json({status:'completed',usage:{input_tokens:10,output_tokens:10}});
};
process.env.OPENAI_API_KEY='fixture';
async function main(){try {
 const c={db,task,owner,generation:mode==='lifecycle-expired'?2:1} as unknown as Context;
 const body={model:'gpt-6-luna',input:'fixture',max_output_tokens:100};
 if(mode==='same-task-cross-client'){
  const second={...c,db:{...db}} as unknown as Context;
  await Promise.all([providerRequest(c,key,body),providerRequest(second,key,body)]);
  assert.equal(calls,2);
  console.log('PASS reproduced duplicate send with copied lease across separate clients');return;
 }
 if(mode.startsWith('same-task')){
  const secondKey=mode==='same-task-other'?`${key}:other`:key;
  const a=providerRequest(c,key,body),b=providerRequest(c,secondKey,mode==='same-task-different'?{...body,input:'different'}:body);
  if(!['same-task-429','same-task-5xx'].includes(mode)){
   for(let i=0;i<50&&calls===0;i++)await new Promise(resolve=>setTimeout(resolve,10));
   assert.equal(calls,1);assert.equal(sql("select owner::text from cloud_resources where name='ai'"),owner);sendResponse();
  }
  const results=await Promise.allSettled([a,b]);
  if(mode==='same-task-different')assert.deepEqual(results.map(r=>r.status),['fulfilled','rejected']);
  else if(['same-task-429','same-task-5xx'].includes(mode))assert.ok(results.every(r=>r.status==='rejected'));
  else assert.ok(results.every(r=>r.status==='fulfilled'));
  assert.equal(calls,mode==='same-task-other'?2:1);
  if(mode==='same-task-429'){assert.equal((await providerRequest(c,key,body)).status,'completed');assert.equal(calls,2);}
  if(mode==='same-task-5xx')assert.equal(sql(`select value->>'state' from cloud_checkpoints where task_id=${esc(task)} and item_key=${esc(key)}`),'sending');
  assert.equal(sql("select coalesce(owner::text,'released') from cloud_resources where name='ai'"),'released');
  console.log(`PASS ${mode}: overlapping calls wait, preserve resource and journal without unwanted resend`);return;
 }
 if(mode==='cross-replay'){
  assert.equal((await providerRequest(c,key,body)).status,'completed');assert.equal(calls,1);
  const second={db,task:task2,owner:owner2,generation:1} as unknown as Context;
  await assert.rejects(providerRequest(second,key,body));assert.equal(calls,1);
  assert.equal(sql(`select count(*) from cloud_budget_reservations where task_id=${esc(task2)} and item_key=${esc(key)};`),'0');
  console.log('PASS real providerRequest: another task does not resend or create a second reserve');return;
 }
 if(mode==='lifecycle-foreign'||mode==='lifecycle-resource-expired'){
  const foreign='ee000001-0000-4000-8000-000000000006';
  sql(`update cloud_resources set owner=${esc(foreign)},lease_until=now()+interval '${mode==='lifecycle-foreign'?'4 minutes':'-1 second'}' where name='ai';`);
  if(mode==='lifecycle-foreign'){
   await assert.rejects(providerRequest(c,key,body),(e:unknown)=>e instanceof Error&&e.name==='Error'&&e.message==='yield');
   assert.equal(calls,0);assert.equal(sql("select owner::text from cloud_resources where name='ai'"),foreign);
  }else{
   assert.equal((await providerRequest(c,key,body)).status,'completed');assert.equal(calls,1);
   assert.equal(sql("select coalesce(owner::text,'released') from cloud_resources where name='ai'"),'released');
  }
  console.log(`PASS ${mode}: foreign lease respected and expired resource recoverable`);return;
 }
 if(mode==='lifecycle-expired'){
  await assert.rejects(providerRequest(c,key,body));assert.equal(calls,0);
  assert.equal(sql("select coalesce(owner::text,'released') from cloud_resources where name='ai'"),'released');
  console.log('PASS expired task lease cannot send or acquire AI resource');return;
 }
 if(mode.startsWith('lifecycle')){
  const expected=mode==='lifecycle-429'?'transient':mode==='lifecycle-401'?'credentials':'provider_unknown';
  await assert.rejects(providerRequest(c,key,body),(e:unknown)=>e instanceof Error&&'kind'in e&&e.kind===expected);
  if(mode==='lifecycle-429'){
   assert.equal((await providerRequest(c,key,body)).status,'completed');assert.equal(calls,2);
  }else{
   if(mode==='lifecycle-401')assert.equal(sql("select blocked_kind from cloud_resources where name='ai'"),'credentials');
   else await assert.rejects(providerRequest(c,key,body),(e:unknown)=>e instanceof Error&&'kind'in e&&e.kind==='provider_unknown');
   assert.equal(calls,1);
  }
  assert.equal(sql("select coalesce(owner::text,'released') from cloud_resources where name='ai'"),'released');
  console.log(`PASS ${mode}: resource released, uncertain sends not repeated`);return;
 }
 throw Error('Unknown synthetic mode');
} finally {globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=originalKey;}}
void main();
