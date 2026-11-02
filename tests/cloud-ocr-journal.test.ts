import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Sandbox} from '@vercel/sandbox';
import {extractDocument} from '../lib/cloud/documents';
import {CloudFailure} from '../lib/cloud/errors';
import {sha256} from '../lib/source-storage';
import {fakeOcrJournal} from './cloud-ocr-journal-fixture';
import type {Context} from '../lib/cloud/context';

type Failure='render'|'after-begin'|'tesseract'|'before-confirm'|'after-confirm';
function fixture(failure:Failure){
 const bytes=Buffer.from('%PDF-synthetic'),digest=sha256(bytes),name=`${digest}.pdf`,url='https://unused.invalid';
 const path=`cases/record/documents/doc/${name}`,journal=new Map<string,unknown>();
 let fail=true,created=0,closed=0,recognized=0;
 const db={storage:{from:()=>({download:async()=>({data:new Blob([bytes]),error:null}),list:async()=>({data:[{name}],error:null})})},
  rpc:async(name:string,args:Record<string,unknown>)=>{
   if(name==='cloud_checkpoint')journal.set(String(args.p_key),args.p_value);
   if(name==='cloud_read_pdf_checkpoint'){const k=String(args.p_key);return {data:journal.has(k)?{found:true,...(args.p_kind==='legacy'?{}:{value:journal.get(k)})}:{found:false},error:null};}
   if(name==='cloud_ocr_page_journal_step'){
    if(fail&&failure==='before-confirm'&&args.p_action==='confirm'){fail=false;return {data:null,error:{message:'mock interruption',code:'P0001'}};}
    const response=fakeOcrJournal(journal,args);
    if(fail&&((failure==='after-begin'&&args.p_action==='begin')||(failure==='after-confirm'&&args.p_action==='confirm'))){fail=false;return {data:null,error:{message:'mock lost response',code:'P0001'}};}
    return response;
   }
   return {data:true,error:null};
  },
  from:(table:string)=>{let item='';const q={select:()=>q,eq:(n:string,v:string)=>{if(n==='item_key')item=v;return q;},single:async()=>({data:{id:'doc',source_record_id:'record',url,storage_path:path,storage_sha256:digest},error:null}),maybeSingle:async()=>({data:table==='app_settings'?{enabled:true,reason:null,updated_at:'v1'}:journal.has(item)?{value:journal.get(item)}:null,error:null})};return q;}};
 const original=Sandbox.create,oldFetch=global.fetch,oldSnapshot=process.env.CLOUD_SANDBOX_SNAPSHOT;
 process.env.CLOUD_SANDBOX_SNAPSHOT='mock';global.fetch=async()=>{throw Error('NETWORK_FORBIDDEN');};
 Sandbox.create=async(options)=>{created++;return {currentSession:()=>({sessionId:'synthetic',writeFiles:async()=>{},
  runCommand:async(_cmd:string,args:string[])=>{
   if(args[3]==='pdftoppm'&&failure==='render'&&fail){fail=false;return {exitCode:1};}
   if(args[3]==='tesseract'){recognized++;if(failure==='tesseract'&&fail){fail=false;throw Error('mock interruption');}}
   return {exitCode:0};},
  readFileToBuffer:async({path:input}:{path:string})=>Buffer.from(input.endsWith('info.txt')?'Pages: 1':input.endsWith('page.txt')?'Text OCR sintètic suficient per verificar una pàgina i els seus destinataris.':''),
  stop:async()=>{closed++;return {session:{status:'stopped'},snapshot:options?.persistent===false?undefined:{id:'unexpected'}};}})} as unknown as Awaited<ReturnType<typeof original>>;};
 return {context:{db,task:'task',owner:'owner',generation:1} as unknown as Context,journal,counts:()=>({created,closed,recognized}),
  restore(){Sandbox.create=original;global.fetch=oldFetch;if(oldSnapshot===undefined)delete process.env.CLOUD_SANDBOX_SNAPSHOT;else process.env.CLOUD_SANDBOX_SNAPSHOT=oldSnapshot;}};
}
for(const failure of ['after-begin','tesseract','before-confirm'] as const)test(`uncertain ${failure} stops before a second VM or OCR`,async()=>{
 const f=fixture(failure);try{
  await assert.rejects(extractDocument(f.context,'job','doc','https://unused.invalid',true),CloudFailure);
  const first=f.counts();
  await assert.rejects(extractDocument(f.context,'job','doc','https://unused.invalid',true),(error:unknown)=>error instanceof CloudFailure&&error.diagnostic?.code==='OCR_PAGE_OUTCOME_UNCERTAIN');
  assert.deepEqual(f.counts(),first);assert.equal(first.created,1);assert.equal(first.closed,1);
  assert.equal(first.recognized,failure==='after-begin'?0:1);
 }finally{f.restore();}
});
test('lost confirmation response reuses committed page without a new VM',async()=>{
 const f=fixture('after-confirm');try{
  await assert.rejects(extractDocument(f.context,'job','doc','https://unused.invalid',true),CloudFailure);
  const first=f.counts();const result=await extractDocument(f.context,'job','doc','https://unused.invalid',true);
  assert.equal(result.partial,false);assert.equal(result.method,'pdf-ocr-markdown-v2');assert.deepEqual(f.counts(),first);
  assert.equal(first.created,1);assert.equal(first.recognized,1);
 }finally{f.restore();}
});
test('render failure before OCR start allows a later bounded retry',async()=>{
 const f=fixture('render');try{
  await assert.rejects(extractDocument(f.context,'job','doc','https://unused.invalid',true),CloudFailure);
  await assert.rejects(extractDocument(f.context,'job','doc','https://unused.invalid',true),/yield/);
  const result=await extractDocument(f.context,'job','doc','https://unused.invalid',true);
  assert.equal(result.partial,false);assert.deepEqual(f.counts(),{created:2,closed:2,recognized:1});
 }finally{f.restore();}
});
test('missing preflight with an earlier started page does not create another VM',async()=>{
 const f=fixture('after-begin');try{
  await assert.rejects(extractDocument(f.context,'job','doc','https://unused.invalid',true),CloudFailure);
  const preflight=[...f.journal.keys()].find(key=>key.startsWith('pdf-preflight:'))!;
  f.journal.delete(preflight);
  const first=f.counts();
  await assert.rejects(extractDocument(f.context,'job','doc','https://unused.invalid',true),(error:unknown)=>error instanceof CloudFailure&&error.diagnostic?.code==='OCR_PAGE_OUTCOME_UNCERTAIN');
  assert.deepEqual(f.counts(),first);
 }finally{f.restore();}
});
test('confirmed page with missing preflight does not trigger a new VM',async()=>{
 const f=fixture('after-confirm');try{
  await assert.rejects(extractDocument(f.context,'job','doc','https://unused.invalid',true),CloudFailure);
  const key=[...f.journal.keys()].find(k=>k.startsWith('pdf-preflight:'))!;f.journal.delete(key);
  const first=f.counts();
  await assert.rejects(extractDocument(f.context,'job','doc','https://unused.invalid',true),(error:unknown)=>error instanceof CloudFailure&&error.diagnostic?.code==='OCR_PAGE_EXISTS_ELSEWHERE');
  assert.deepEqual(f.counts(),first);
 }finally{f.restore();}
});
test('legacy preflight without image identity cannot be rebound after input loss',async()=>{
 const f=fixture('after-confirm');try{
  await assert.rejects(extractDocument(f.context,'job','doc','https://unused.invalid',true),CloudFailure);
  const key=[...f.journal.keys()].find(k=>k.startsWith('pdf-preflight:'))!;
  const preflight=f.journal.get(key) as Record<string,unknown>;const {snapshotHash:_,...legacy}=preflight;void _;
  f.journal.set(key,legacy);
  const input=[...f.journal.keys()].find(k=>k.startsWith('pdf-input:'))!;f.journal.delete(input);
  const first=f.counts();
  await assert.rejects(extractDocument(f.context,'job','doc','https://unused.invalid',true),(error:unknown)=>error instanceof CloudFailure&&error.diagnostic?.code==='DOCUMENT_CHECKPOINT_SOURCE_CHANGED');
  assert.equal(f.journal.has(input),false);assert.deepEqual(f.counts(),first);
 }finally{f.restore();}
});
