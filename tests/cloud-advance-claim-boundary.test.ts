import {test} from 'node:test';
import assert from 'node:assert/strict';
import {advance} from '../lib/cloud/advance';

const keys=['WORKER_EXECUTION_MODE','VERCEL_ENV','NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY'] as const;
async function fixture(claim:'lost'|'failed'|'won',run:(calls:Array<{path:string;body:Record<string,unknown>|null}>)=>Promise<void>){
 const saved=new Map(keys.map(key=>[key,process.env[key]]));const original=global.fetch;
 process.env.WORKER_EXECUTION_MODE='vercel_workflow';process.env.VERCEL_ENV='production';
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://vvzxlevbfjvzygorbpxn.supabase.co';process.env.SUPABASE_SECRET_KEY='synthetic-test-key';
 const calls:Array<{path:string;body:Record<string,unknown>|null}>=[];
 global.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  if(url.hostname!=='vvzxlevbfjvzygorbpxn.supabase.co')throw Error('Unexpected network destination');
  const body=typeof init?.body==='string'?JSON.parse(init.body) as Record<string,unknown>:null;
  calls.push({path:url.pathname,body});
  if(url.pathname.endsWith('/rpc/cloud_claim'))return claim==='failed'?Response.json({code:'P0001',message:'synthetic claim failure'},{status:503}):Response.json(claim==='lost'?null:7);
  if(url.pathname.endsWith('/worker_tasks'))return Response.json({code:'P0001',message:'synthetic task read failure'},{status:503});
  if(url.pathname.endsWith('/rpc/cloud_checkpoint')||url.pathname.endsWith('/rpc/cloud_finish'))return Response.json(true);
  throw Error(`Unexpected request ${url.pathname}`);
 };
 try{await run(calls);}finally{global.fetch=original;for(const [key,value] of saved)if(value===undefined)delete process.env[key];else process.env[key]=value;}
}

test('a lost claim returns before any task read or failure handling',async()=>{
 await fixture('lost',async calls=>{
  assert.deepEqual(await advance('task','workflow'),{done:true,wait:0});
  assert.deepEqual(calls.map(c=>c.path),['/rest/v1/rpc/cloud_claim']);
 });
});

test('a failed claim propagates without touching or finishing another lease',async()=>{
 await fixture('failed',async calls=>{
  await assert.rejects(advance('task','workflow'),e=>typeof e==='object'&&e!==null&&'kind' in e&&e.kind==='internal');
  assert.deepEqual(calls.map(c=>c.path),['/rest/v1/rpc/cloud_claim']);
 });
});

test('a failure after a successful claim is handled with the acquired lease',async()=>{
 await fixture('won',async calls=>{
  assert.deepEqual(await advance('task','workflow'),{done:true,wait:0});
  const claim=calls.find(c=>c.path.endsWith('/rpc/cloud_claim'))!.body!;
  const failure=calls.find(c=>c.path.endsWith('/rpc/cloud_checkpoint'))!.body!;
  const finish=calls.find(c=>c.path.endsWith('/rpc/cloud_finish'))!.body!;
  assert.equal(failure.p_key,'last_failure');
  assert.equal((failure.p_value as {kind:string}).kind,'internal');
  for(const operation of [failure,finish])assert.deepEqual([operation.p_task,operation.p_owner,operation.p_generation],['task',claim.p_owner,7]);
  assert.equal(finish.p_state,'paused');assert.equal(finish.p_kind,'internal');
 });
});
