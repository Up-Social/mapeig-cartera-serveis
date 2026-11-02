import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {advance} from '../../lib/cloud/advance';

const container=process.env.TEST_CONTAINER!;
if(!/^mapeig-conveni-schema-[a-f0-9]{12}$/.test(container))throw Error('isolated fixture required');
const task='aa010101-0000-4000-8000-000000000004';
const run='aa010101-0000-4000-8000-000000000002';
const job='aa010101-0000-4000-8000-000000000003';
const record='aa010101-0000-4000-8000-000000000001';
const esc=(s:string)=>`'${s.replaceAll("'","''")}'`;
function sql(statement:string){return execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:statement,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();}
const args=(input:Record<string,unknown>)=>Object.entries(input).map(([key,v])=>`${key} => ${key==='p_value'?`${esc(JSON.stringify(v))}::jsonb`:v===null?'null':typeof v==='number'?String(v):esc(String(v))}`).join(',');
const calls:Array<{name:string;body:Record<string,unknown>|null}>=[];
let release!:()=>void,entered!:()=>void;
const gate=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{entered=r;});
const original=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
 if(u.hostname!=='vvzxlevbfjvzygorbpxn.supabase.co')throw Error('network prohibited');
 const body=typeof init?.body==='string'?JSON.parse(init.body) as Record<string,unknown>:null;
 const name=u.pathname.split('/').at(-1)!;calls.push({name,body});
 if(name==='cloud_claim'||name==='cloud_checkpoint'||name==='cloud_finish'||name==='cloud_mark_existing_analysis_review'){
  const result=sql(`set role service_role; select coalesce(to_jsonb(public.${name}(${args(body!)}))::text,'null');`);
  return Response.json(result?JSON.parse(result):null);
 }
 if(name==='worker_tasks')return Response.json({id:task,run_id:run,task_type:'process_run'});
 if(name==='pipeline_jobs')return Response.json([{id:job,source_record_id:record,status:'queued',preparation_status:'ready',analysis_results:process.env.FIXTURE_MODE==='existing'?[{id:'synthetic'}]:[]}]);
 if(name==='cloud_checkpoints')return Response.json((init?.headers as Record<string,string>)?.Accept?.includes('object')?null:[]);
 if(name==='cloud_screen_conveni'){
  entered();await gate;
  if(process.env.FIXTURE_MODE==='failure')return Response.json({code:'40001',message:'T19_DEDUP_BUSY'},{status:409});
  return Response.json(process.env.FIXTURE_MODE!=='existing');
 }
 throw Error(`unexpected ${u.pathname}`);
};
async function main(){
 const first=advance(task,'workflow-one');await started;
 const firstOwner=sql(`select lease_owner::text from worker_tasks where id=${esc(task)}`);
 const second=await advance(task,'workflow-two');
 assert.deepEqual(second,{done:true,wait:0});
 assert.equal(sql(`select lease_owner::text from worker_tasks where id=${esc(task)}`),firstOwner);
 assert.equal(calls.filter(x=>x.name==='cloud_screen_conveni').length,1);
 assert.equal(calls.filter(x=>x.name==='cloud_finish').length,0);
 release();const result=await first;
 assert.deepEqual(result,process.env.FIXTURE_MODE==='failure'?{done:false,wait:5}:{done:false,wait:1});
 assert.equal(calls.filter(x=>x.name==='cloud_finish').length,1);
 assert.equal(sql(`select execution_state from worker_tasks where id=${esc(task)}`),'pending');
 if(process.env.FIXTURE_MODE==='existing'){
  assert.equal(calls.filter(x=>x.name==='cloud_mark_existing_analysis_review').length,1);
  assert.equal(sql(`select status from pipeline_jobs where id=${esc(job)}`),'needs_review');
 }
 const owners=calls.filter(x=>x.name==='cloud_claim').map(x=>x.body?.p_owner);
 assert.equal(owners.length,2);assert.notEqual(owners[0],owners[1]);
 assert.equal(calls.some(x=>x.name==='conveni_bind_begin'),false);
 console.log(`PASS real advance with distinct owners: second invocation blocked before preflight; winner ${process.env.FIXTURE_MODE}`);
}
main().finally(()=>{globalThis.fetch=original;});
