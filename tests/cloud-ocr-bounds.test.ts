import {fakeOcrJournal} from './cloud-ocr-journal-fixture';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Sandbox} from '@vercel/sandbox';
import {extractDocument} from '../lib/cloud/documents';
import {CloudFailure} from '../lib/cloud/errors';
import {sha256} from '../lib/source-storage';
import {hash} from '../lib/pipeline/chunks';
import {EXTRACTION_VERSION} from '../lib/pipeline/readable-document';
import type {Context} from '../lib/cloud/context';

function fixture(failure:'preflight'|'ocr'|'pages'|'none'){
 const bytes=Buffer.from('%PDF-synthetic');const digest=sha256(bytes),name=`${digest}.pdf`;
 const source={id:'doc',source_record_id:'record',url:'https://unused.invalid',storage_path:`cases/record/documents/doc/${name}`,storage_sha256:digest,extracted_text:'## Pàgina 1\n\nOriginal anterior.',active_extraction_id:'00000000-0000-4000-8000-000000000001'};
 const journal=new Map<string,unknown>();let closes=0,creates=0,reads=0,recognized=0;
 const db={storage:{from:()=>({download:async()=>({data:new Blob([bytes]),error:null}),list:async()=>({data:[{name}],error:null})})},rpc:async(name:string,args:Record<string,unknown>)=>{if(name==='cloud_checkpoint')journal.set(String(args.p_key),args.p_value);if(name==='cloud_ocr_page_journal_step')return fakeOcrJournal(journal,args);if(name==='cloud_read_pdf_checkpoint'){const key=String(args.p_key);return {data:journal.has(key)?{found:true,...(args.p_kind==='legacy'?{}:{value:journal.get(key)})}:{found:false},error:null};}return {data:true,error:null};},from:(table:string)=>{let key='';const q={select:()=>q,eq:(name:string,value:string)=>{if(name==='item_key')key=value;return q;},single:async()=>({data:table==='source_documents'?source:null,error:null}),maybeSingle:async()=>({data:table==='app_settings'?{enabled:true}:journal.has(key)?{value:journal.get(key)}:null,error:null})};return q;}};
 const original=Sandbox.create;
 Sandbox.create=async(options)=>{creates++;return {currentSession:()=>({sessionId:'synthetic',writeFiles:async()=>{},runCommand:async(_cmd:string,args:string[])=>{if(args[3]==='tesseract')recognized++;return {exitCode:args.some(a=>failure==='preflight'&&a.includes('wc -c < /tmp/source.txt')||failure==='ocr'&&a.includes('wc -c < /tmp/page.txt'))?1:0};},readFileToBuffer:async({path}:{path:string})=>{reads++;return Buffer.from(path.endsWith('info.txt')?`Pages: ${failure==='pages'?2001:1}`:path.endsWith('page.txt')?'Text sintètic suficient per identificar el servei i els destinataris del programa.':'');},stop:async()=>{closes++;return {session:{status:'stopped'},snapshot:options?.persistent===false?undefined:{id:'unexpected'}};}})} as unknown as Awaited<ReturnType<typeof original>>;};
 return {context:{db,task:'test',owner:'owner',generation:1} as unknown as Context,source,journal,restore:()=>{Sandbox.create=original;},counts:()=>({closes,creates,reads,recognized})};
}
test('oversized preflight and OCR output, and excessive pages, fail explicitly and close the VM',async()=>{
 const before=process.env.CLOUD_SANDBOX_SNAPSHOT;process.env.CLOUD_SANDBOX_SNAPSHOT='mock';
 try {for(const [scenario,code] of [['preflight','PDF_TEXT_TOO_LARGE'],['ocr','OCR_TEXT_TOO_LARGE'],['pages','PDF_PAGE_LIMIT']] as const){
  const f=fixture(scenario);try{
   await assert.rejects(extractDocument(f.context,'job','doc','https://unused.invalid',true),(error:unknown)=>error instanceof CloudFailure&&error.diagnostic?.code===code);
   assert.equal(f.counts().closes,1);assert.equal(f.counts().creates,1);
   assert.equal([...f.journal.keys()].some(k=>k.startsWith('ocr-v2:')),false);
  }finally{f.restore();}
 }}finally{if(before===undefined)delete process.env.CLOUD_SANDBOX_SNAPSHOT;else process.env.CLOUD_SANDBOX_SNAPSHOT=before;}
});
test('targeted OCR cannot resume after prior extraction changes',async()=>{
 const before=process.env.CLOUD_SANDBOX_SNAPSHOT;process.env.CLOUD_SANDBOX_SNAPSHOT='mock';const f=fixture('none');
 try{
  await assert.rejects(extractDocument(f.context,'job','doc','https://unused.invalid',true,[1]),/yield/);
  f.source.extracted_text='## Pàgina 1\n\nUna lectura anterior diferent.';
  await assert.rejects(extractDocument(f.context,'job','doc','https://unused.invalid',true,[1]),(error:unknown)=>error instanceof CloudFailure&&error.diagnostic?.code==='DOCUMENT_CHECKPOINT_SOURCE_CHANGED');
  assert.equal(f.counts().creates,1);assert.equal(f.counts().closes,1);
 }finally{f.restore();if(before===undefined)delete process.env.CLOUD_SANDBOX_SNAPSHOT;else process.env.CLOUD_SANDBOX_SNAPSHOT=before;}
});

test('legacy OCR without an image identity remains pending, even with the same archived source',async()=>{
 const before=process.env.CLOUD_SANDBOX_SNAPSHOT;process.env.CLOUD_SANDBOX_SNAPSHOT='mock';
 try {for(const bound of [true,false]){
  const f=fixture('none');try{
   const bytes=Buffer.from('%PDF-synthetic');
   const key=`ocr:${hash(bytes.toString('base64'))}:1:dpi300:${EXTRACTION_VERSION}`;
   f.journal.set(key,{text:'Text sintètic suficient per identificar el servei i els destinataris del programa.'});
   if(bound)f.journal.set('original:doc',{path:f.source.storage_path,mime:'application/pdf',hash:f.source.storage_sha256});
   await assert.rejects(extractDocument(f.context,'job','doc','https://unused.invalid',true),(error:unknown)=>error instanceof CloudFailure&&error.diagnostic?.code==='LEGACY_OCR_SOURCE_UNVERIFIED');
   assert.equal(f.counts().closes,1);assert.equal(f.counts().recognized,0);
  }finally{f.restore();}
 }}finally{if(before===undefined)delete process.env.CLOUD_SANDBOX_SNAPSHOT;else process.env.CLOUD_SANDBOX_SNAPSHOT=before;}
});
test('a resumed OCR cannot switch the sandbox image',async()=>{
 const before=process.env.CLOUD_SANDBOX_SNAPSHOT;process.env.CLOUD_SANDBOX_SNAPSHOT='image-a';const f=fixture('none');
 try{
  await assert.rejects(extractDocument(f.context,'job','doc','https://unused.invalid',true),/yield/);
  process.env.CLOUD_SANDBOX_SNAPSHOT='image-b';
  await assert.rejects(extractDocument(f.context,'job','doc','https://unused.invalid',true),(error:unknown)=>error instanceof CloudFailure&&error.diagnostic?.code==='DOCUMENT_CHECKPOINT_SOURCE_CHANGED');
  assert.equal(f.counts().creates,1);assert.equal(f.counts().recognized,1);
 }finally{f.restore();if(before===undefined)delete process.env.CLOUD_SANDBOX_SNAPSHOT;else process.env.CLOUD_SANDBOX_SNAPSHOT=before;}
});

test('a recovered legacy OCR uncertainty marker blocks repetition without calling OCR',async()=>{
 const before=process.env.CLOUD_SANDBOX_SNAPSHOT;process.env.CLOUD_SANDBOX_SNAPSHOT='mock';const f=fixture('none');
 f.journal.set('legacy-ocr-pending:doc',{version:'legacy-ocr-pending-v1'});
 try{
  await assert.rejects(extractDocument(f.context,'job','doc','https://unused.invalid',true),(error:unknown)=>error instanceof CloudFailure&&error.diagnostic?.code==='LEGACY_OCR_SOURCE_UNVERIFIED');
  assert.equal(f.counts().recognized,0);assert.equal(f.counts().closes,1);
 }finally{f.restore();if(before===undefined)delete process.env.CLOUD_SANDBOX_SNAPSHOT;else process.env.CLOUD_SANDBOX_SNAPSHOT=before;}
});


test('a valid-looking pre-journal OCR page is not reused or repeated',async()=>{
 const before=process.env.CLOUD_SANDBOX_SNAPSHOT;process.env.CLOUD_SANDBOX_SNAPSHOT='mock';const f=fixture('none');
 const digest=f.source.storage_sha256,path=f.source.storage_path,url=f.source.url,image=sha256(Buffer.from('mock'));
 const identity={documentId:'doc',sourceSha256:digest,sourcePath:path,sourceUrl:url};
 f.journal.set(`pdf-input:doc:${EXTRACTION_VERSION}`,{sourceSha256:digest,sourcePath:path,sourceUrl:url,snapshotHash:image});
 f.journal.set(`pdf-preflight:doc:${digest}:${EXTRACTION_VERSION}:pdf-preflight-v1`,{version:'pdf-preflight-v1',...identity,snapshotHash:image,rawText:'',rawHash:sha256(Buffer.from('')),pageCount:1,exitCode:0});
 const text='Text OCR sintètic suficient per representar una pàgina completa i verificable.';
 f.journal.set(`ocr-v2:doc:${digest}:1:dpi300:${EXTRACTION_VERSION}`,{version:'ocr-page-v2',...identity,page:1,dpi:300,text,textHash:sha256(Buffer.from(text))});
 try{
  await assert.rejects(extractDocument(f.context,'job','doc',url,true),(error:unknown)=>error instanceof CloudFailure&&error.diagnostic?.code==='OCR_JOURNAL_UNVERIFIED');
  assert.equal(f.counts().creates,0);assert.equal(f.counts().recognized,0);
 }finally{f.restore();if(before===undefined)delete process.env.CLOUD_SANDBOX_SNAPSHOT;else process.env.CLOUD_SANDBOX_SNAPSHOT=before;}
});
