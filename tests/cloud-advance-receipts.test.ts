import {test} from 'node:test';
import assert from 'node:assert/strict';
import {advance} from '../lib/cloud/advance';

test('cloud entrypoint pauses an uncertain receipt before Conveni preflight or provider work',async()=>{
 const keys=['WORKER_EXECUTION_MODE','VERCEL_ENV','NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY'] as const;
 const saved=new Map(keys.map(key=>[key,process.env[key]]));const original=global.fetch;
 process.env.WORKER_EXECUTION_MODE='vercel_workflow';process.env.VERCEL_ENV='production';
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://vvzxlevbfjvzygorbpxn.supabase.co';process.env.SUPABASE_SECRET_KEY='synthetic-test-key';
 const calls:Array<{path:string;body:Record<string,unknown>|null}>=[];
 global.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  const body=typeof init?.body==='string'?JSON.parse(init.body) as Record<string,unknown>:null;
  calls.push({path:url.pathname,body});
  if(url.hostname!=='vvzxlevbfjvzygorbpxn.supabase.co')throw Error('Unexpected network destination');
  if(url.pathname.endsWith('/rpc/cloud_claim'))return Response.json(1);
  if(url.pathname.endsWith('/worker_tasks'))return Response.json({id:'task',run_id:'run',task_type:'process_run'});
  if(url.pathname.endsWith('/cloud_checkpoints'))return Response.json([{item_key:'ai:job:conveni'}]);
  if(url.pathname.endsWith('/rpc/cloud_checkpoint')||url.pathname.endsWith('/rpc/cloud_finish'))return Response.json(true);
  throw Error(`Unexpected request ${url.pathname}`);
 };
 try{
  assert.deepEqual(await advance('task','workflow'),{done:true,wait:0});
  assert.equal(calls.some(call=>call.path.endsWith('/rpc/cloud_screen_conveni_v2')),false);
  const finish=calls.find(call=>call.path.endsWith('/rpc/cloud_finish'));
  assert.equal(finish?.body?.p_state,'paused');assert.equal(finish?.body?.p_kind,'provider_unknown');
  const failure=calls.find(call=>call.path.endsWith('/rpc/cloud_checkpoint')&&call.body?.p_key==='last_failure');
  assert.equal((failure?.body?.p_value as {kind:string}).kind,'provider_unknown');
 }finally{
  global.fetch=original;for(const [key,value] of saved)if(value===undefined)delete process.env[key];else process.env[key]=value;
 }
});

test('cloud entrypoint requeues an exact preflight contention without provider work',async()=>{
 const keys=['WORKER_EXECUTION_MODE','VERCEL_ENV','NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY'] as const;
 const saved=new Map(keys.map(key=>[key,process.env[key]]));const original=global.fetch;
 process.env.WORKER_EXECUTION_MODE='vercel_workflow';process.env.VERCEL_ENV='production';
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://vvzxlevbfjvzygorbpxn.supabase.co';process.env.SUPABASE_SECRET_KEY='synthetic-test-key';
 const calls:Array<{path:string;body:Record<string,unknown>|null}>=[];
 global.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  const body=typeof init?.body==='string'?JSON.parse(init.body) as Record<string,unknown>:null;
  calls.push({path:url.pathname,body});
  if(url.hostname!=='vvzxlevbfjvzygorbpxn.supabase.co')throw Error('Unexpected network destination');
  if(url.pathname.endsWith('/rpc/cloud_claim'))return Response.json(1);
  if(url.pathname.endsWith('/worker_tasks'))return Response.json({id:'task',run_id:'run',task_type:'process_run'});
  if(url.pathname.endsWith('/cloud_checkpoints'))return Response.json([]);
  if(url.pathname.endsWith('/pipeline_jobs')&&url.searchParams.get('select')==='source_record_id')return Response.json({source_record_id:'record'});
  if(url.pathname.endsWith('/source_records'))return Response.json({financing_type:'conveni',title:'Conveni sintètic',source_payload:{}});
  if(url.pathname.endsWith('/pipeline_jobs'))return Response.json([{id:'job',source_record_id:'record',status:'ready',preparation_status:'ready',analysis_results:[]}]);
  if(url.pathname.endsWith('/rpc/cloud_screen_conveni_v2'))return Response.json({code:'40001',message:'T19_DEDUP_BUSY'},{status:409});
  if(url.pathname.endsWith('/rpc/cloud_checkpoint')||url.pathname.endsWith('/rpc/cloud_finish'))return Response.json(true);
  throw Error(`Unexpected request ${url.pathname}`);
 };
 try{
  assert.deepEqual(await advance('task','workflow'),{done:false,wait:5});
  assert.equal(calls.filter(call=>call.path.endsWith('/rpc/cloud_screen_conveni_v2')).length,1);
  assert.equal(calls.some(call=>call.path.endsWith('/rpc/cloud_commit')),false);
  const finish=calls.find(call=>call.path.endsWith('/rpc/cloud_finish'));
  assert.equal(finish?.body?.p_state,'pending');
  const retry=calls.find(call=>call.path.endsWith('/rpc/cloud_checkpoint')&&call.body?.p_key==='retry:job');
  assert.equal(retry?.body?.p_value,1);
 }finally{
  global.fetch=original;for(const [key,value] of saved)if(value===undefined)delete process.env[key];else process.env[key]=value;
 }
});
