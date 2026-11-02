import {test} from 'node:test';
import assert from 'node:assert/strict';
import {acquireResource,type Context} from '../lib/cloud/context';
import {CloudFailure,CloudYield} from '../lib/cloud/errors';

function fixture(outcome:'lease_lost'|'busy'|'acquired'){
 const calls:Array<{name:string;args:Record<string,unknown>}>=[];
 const db={rpc:async(name:string,args:Record<string,unknown>)=>{
  calls.push({name,args});
  if(name==='cloud_acquire_sandbox'&&outcome==='lease_lost')return {error:{message:'CLOUD_LEASE_LOST',code:'P0001'}};
  return {data:outcome!=='busy',error:null};
 },from:(table:string)=>{const q={select:()=>q,eq:()=>q,single:async()=>({data:{blocked_kind:null},error:null}),
  maybeSingle:async()=>({data:table==='app_settings'?{enabled:true,reason:null,updated_at:'v1'}:null,error:null})};return q;}};
 return {calls,c:{db,task:'task',owner:'owner',generation:7} as unknown as Context};
}
test('expired Sandbox task is fenced by atomic acquisition before any work',async()=>{
 const {calls,c}=fixture('lease_lost');
 await assert.rejects(acquireResource(c,'sandbox'),(error:unknown)=>error instanceof CloudFailure);
 assert.deepEqual(calls,[{name:'cloud_acquire_sandbox',args:{p_task:'task',p_owner:'owner',p_generation:7}}]);
});
test('valid and busy Sandbox acquisitions retain their existing behavior',async()=>{
 const valid=fixture('acquired');await acquireResource(valid.c,'sandbox');
 assert.equal(valid.calls[0].name,'cloud_acquire_sandbox');
 const busy=fixture('busy');await assert.rejects(acquireResource(busy.c,'sandbox'),CloudYield);
});
test('AI resource acquisition remains unchanged',async()=>{
 const {calls,c}=fixture('acquired');await acquireResource(c,'ai');
 assert.deepEqual(calls,[{name:'cloud_resource',args:{p_name:'ai',p_owner:'owner'}}]);
});

test('resumed document with expired lease never creates or releases a Sandbox',async()=>{
 const {Sandbox}=await import('@vercel/sandbox');
 const {extractDocument}=await import('../lib/cloud/documents');
 const {sha256}=await import('../lib/source-storage');
 const bytes=Buffer.from('%PDF-synthetic'),digest=sha256(bytes),name=`${digest}.pdf`,path=`cases/record/documents/doc/${name}`,url='https://unused.invalid';
 const calls:string[]=[];let created=0;
 const db={storage:{from:()=>({download:async()=>({data:new Blob([bytes]),error:null}),list:async()=>({data:[{name}],error:null})})},
  rpc:async(name:string)=>{calls.push(name);return name==='cloud_acquire_sandbox'?{error:{message:'CLOUD_LEASE_LOST',code:'P0001'}}:name==='cloud_read_pdf_checkpoint'?{data:{found:false},error:null}:name==='cloud_ocr_page_journal_step'?{data:'new',error:null}:{data:true,error:null};},
  from:(table:string)=>{let key='';const q={select:()=>q,eq:(n:string,v:string)=>{if(n==='item_key')key=v;return q;},
   single:async()=>({data:{id:'doc',source_record_id:'record',url,storage_path:path,storage_sha256:digest},error:null}),
   maybeSingle:async()=>({data:table==='app_settings'?{enabled:true,reason:null,updated_at:'v1'}
    :key==='original:doc'?{value:{path,mime:'application/pdf',hash:digest}}
    :key.startsWith('pdf-input:')?{value:{sourceSha256:digest,sourcePath:path,sourceUrl:url,snapshotHash:sha256(Buffer.from('mock'))}}:null,error:null})};return q;}};
 const original=Sandbox.create,oldFetch=global.fetch,snapshot=process.env.CLOUD_SANDBOX_SNAPSHOT;
 process.env.CLOUD_SANDBOX_SNAPSHOT='mock';
 Sandbox.create=async()=>{created++;throw Error('Unexpected Sandbox');};
 global.fetch=async()=>{throw Error('Unexpected network request');};
 try {
  await assert.rejects(extractDocument({db,task:'expired',owner:'owner',generation:1} as unknown as Context,'job','doc',url,true),CloudFailure);
  assert.equal(created,0);
  assert.deepEqual(calls,['cloud_read_pdf_checkpoint','cloud_ocr_page_journal_step','cloud_acquire_sandbox']);
 }finally{Sandbox.create=original;global.fetch=oldFetch;if(snapshot===undefined)delete process.env.CLOUD_SANDBOX_SNAPSHOT;else process.env.CLOUD_SANDBOX_SNAPSHOT=snapshot;}
});
