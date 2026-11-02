import {fakeOcrJournal} from './cloud-ocr-journal-fixture';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Sandbox} from '@vercel/sandbox';
import {extractDocument} from '../lib/cloud/documents';
import {CloudFailure} from '../lib/cloud/errors';
import {sha256} from '../lib/source-storage';
import type {Context} from '../lib/cloud/context';
import {cleanTextWithCoverage,hasCurrentTextCoverage} from '../lib/pipeline/document-input';
test('OCR resumes persisted pages after each Sandbox disappears',async()=>{
 const journal=new Map<string,unknown>([
  ['original:doc',{path:'private/mock',mime:'application/pdf',hash:sha256(Buffer.from('%PDF-synthetic'))}],
  ['document:doc:readable-markdown-v2',{text:'## Pàgina 1\n\n',method:'pdf-text-markdown-v2',hash:'mock',mime:'application/pdf',partial:true,extraction_version:'readable-markdown-v2'}],
 ]);
 const archivedHash=sha256(Buffer.from('%PDF-synthetic'));
 const archivedName=`${archivedHash}.pdf`;
 const db={storage:{from:()=>({download:async()=>({data:new Blob(['%PDF-synthetic']),error:null}),list:async()=>({data:[{name:archivedName}],error:null})})},rpc:async(name:string,args:Record<string,unknown>)=>{if(name==='cloud_checkpoint')journal.set(String(args.p_key),args.p_value);if(name==='cloud_ocr_page_journal_step')return fakeOcrJournal(journal,args);if(name==='cloud_read_pdf_checkpoint'){const key=String(args.p_key);return {data:journal.has(key)?{found:true,...(args.p_kind==='legacy'?{}:{value:journal.get(key)})}:{found:false},error:null};}return {data:true,error:null};},from:(table:string)=>{let key='';const q={select:()=>q,eq:(name:string,value:string)=>{if(name==='item_key')key=value;return q;},single:async()=>({data:table==='source_documents'?{id:'doc',source_record_id:'record',url:'https://unused.invalid',storage_path:`cases/record/documents/doc/${archivedName}`,storage_sha256:archivedHash}:null,error:null}),maybeSingle:async()=>({data:table==='app_settings'?{enabled:true,reason:null,updated_at:'2026-10-26T00:00:00Z'}:journal.has(key)?{value:journal.get(key)}:null,error:null})};return q;}};
 const c={db,task:'test',owner:'owner',generation:1} as unknown as Context;
 const create=Sandbox.create;const env=process.env.CLOUD_SANDBOX_SNAPSHOT;process.env.CLOUD_SANDBOX_SNAPSHOT='mock';let recognized=0,stopped=0,created=0,pdfText=0,pdfInfo=0;const renderDpis:string[]=[];
 Sandbox.create=async(options)=>{created++;return ({currentSession:()=>({sessionId:'synthetic-session',writeFiles:async()=>{},runCommand:async(_cmd:string,args:string[])=>{if(args[3]==='tesseract')recognized++;if(args[3]==='pdftotext')pdfText++;if(args.includes('pdfinfo /tmp/source.pdf > /tmp/info.txt 2>/dev/null'))pdfInfo++;if(args[3]==='pdftoppm')renderDpis.push(args[args.indexOf('-r')+1]);return {exitCode:0};},readFileToBuffer:async({path}:{path:string})=>Buffer.from(path.endsWith('info.txt')?'Pages: 2':path.endsWith('page.txt')?'Text sintètic de prova amb prou longitud per comprovar la recuperació de cada pàgina.':''),stop:async()=>{stopped++;return {session:{status:'stopped'},snapshot:options?.persistent===false?undefined:{id:'unexpected-persistent-snapshot'}};}})}) as unknown as Awaited<ReturnType<typeof create>>;};
 try {
  await assert.rejects(extractDocument(c,'job','doc','https://unused.invalid',true),/yield/);
  assert.equal(recognized,1);assert.equal(stopped,1);
  const preflightKey=[...journal.keys()].find(key=>key.startsWith('pdf-preflight:'))!;
  const preflight=journal.get(preflightKey) as Record<string,unknown>;
  journal.set(preflightKey,{...preflight,sourcePath:'other/path'});
  await assert.rejects(extractDocument(c,'job','doc','https://unused.invalid',true),(error:unknown)=>error instanceof CloudFailure&&error.diagnostic?.code==='INVALID_DOCUMENT_CHECKPOINT');
  journal.set(preflightKey,preflight);
  const inputKey=[...journal.keys()].find(key=>key.startsWith('pdf-input:'))!;
  const savedInput=journal.get(inputKey);journal.delete(inputKey);process.env.CLOUD_SANDBOX_SNAPSHOT='other-image';
  await assert.rejects(extractDocument(c,'job','doc','https://unused.invalid',true),(error:unknown)=>error instanceof CloudFailure&&error.diagnostic?.code==='DOCUMENT_CHECKPOINT_SOURCE_CHANGED');
  assert.equal(journal.has(inputKey),false);assert.equal(created,1);assert.equal(recognized,1);
  journal.set(inputKey,savedInput);process.env.CLOUD_SANDBOX_SNAPSHOT='mock';
  const ocrKey=[...journal.keys()].find(key=>key.startsWith('ocr-v2:'))!;
  const page=journal.get(ocrKey) as Record<string,unknown>;
  journal.set(ocrKey,{...page,text:'corrupt checkpoint'});
  await assert.rejects(extractDocument(c,'job','doc','https://unused.invalid',true),(error:unknown)=>error instanceof CloudFailure&&error.diagnostic?.code==='INVALID_DOCUMENT_CHECKPOINT');
  journal.set(ocrKey,page);
  assert.equal(created,1);assert.equal(recognized,1);
  await assert.rejects(extractDocument(c,'job','doc','https://unused.invalid',true),/yield/);
  assert.equal(recognized,2);
  const result=await extractDocument(c,'job','doc','https://unused.invalid',true);
  assert.equal(result.method,'pdf-ocr-markdown-v2');assert.equal(result.partial,false);assert.equal(recognized,2);assert.equal(stopped,2);assert.equal(created,2);assert.equal(pdfText,1);assert.equal(pdfInfo,1);assert.deepEqual(renderDpis,['300','300']);
  assert.deepEqual(result.coverage,{pages:[{page:1,method:'ocr',defects:[]},{page:2,method:'ocr',defects:[]}],complete:true,ocrEngine:'tesseract',ocrLanguages:['cat','spa'],ocrDpi:300});
  await extractDocument(c,'job','doc','https://unused.invalid',true);assert.equal(stopped,2);
 }finally{Sandbox.create=create;if(env===undefined)delete process.env.CLOUD_SANDBOX_SNAPSHOT;else process.env.CLOUD_SANDBOX_SNAPSHOT=env;}
});

test('a new execution reuses a verified archived source when the official URL is unavailable',async()=>{
 const bytes=Buffer.from('<html><body>Document oficial arxivat amb contingut suficient per acreditar la lectura de la font original.</body></html>');
 const digest=sha256(bytes);
 const name=`${digest}.html`;
 const journal=new Map<string,unknown>();
 const db={
  storage:{from:()=>({
   list:async()=>({data:[{name}],error:null}),
   download:async()=>({data:new Blob([bytes]),error:null}),
  })},
  rpc:async(name:string,args:Record<string,unknown>)=>{if(name==='cloud_checkpoint')journal.set(String(args.p_key),args.p_value);if(name==='cloud_ocr_page_journal_step')return fakeOcrJournal(journal,args);if(name==='cloud_read_pdf_checkpoint'){const key=String(args.p_key);return {data:journal.has(key)?{found:true,...(args.p_kind==='legacy'?{}:{value:journal.get(key)})}:{found:false},error:null};}return {data:true,error:null};},
  from:(table:string)=>{let key='';const q={
   select:()=>q,
   eq:(name:string,value:string)=>{if(name==='item_key')key=value;return q;},
   single:async()=>({data:table==='source_documents'?{id:'doc',source_record_id:'record',url:'https://unused.invalid',storage_path:`cases/record/documents/doc/${name}`,storage_sha256:digest,mime_type:'text/html'}:null,error:null}),
   maybeSingle:async()=>({data:table==='app_settings'?{enabled:true,reason:null,updated_at:'2026-10-26T00:00:00Z'}:journal.has(key)?{value:journal.get(key)}:null,error:null}),
  };return q;},
 };
 const context={db,task:'test',owner:'owner',generation:1} as unknown as Context;
 const result=await extractDocument(context,'job','doc','https://unused.invalid',false);
 assert.match(result.text,/Document oficial arxivat/);
 assert.equal(result.method,'html-basic');
 assert.ok(journal.has('original:doc'));
});

test('long HTML is explicitly incomplete and an older complete checkpoint is not trusted',async()=>{
 const bytes=Buffer.from(`<html><body>${'Contingut substantiu. '.repeat(10000)}EVIDENCIA FINAL</body></html>`);
 const digest=sha256(bytes),name=`${digest}.html`;
 const {EXTRACTION_VERSION}=await import('../lib/pipeline/readable-document');
 const key=`document:doc:${EXTRACTION_VERSION}`;
 const journal=new Map<string,unknown>([[key,{text:'Antic text truncat',method:'html-basic',hash:'old',mime:'text/html',partial:false,extraction_version:EXTRACTION_VERSION}]]);
 let downloads=0;
 const db={storage:{from:()=>({list:async()=>({data:[{name}],error:null}),download:async()=>{downloads++;return {data:new Blob([bytes]),error:null};}})},
  rpc:async(name:string,args:Record<string,unknown>)=>{if(name==='cloud_checkpoint')journal.set(String(args.p_key),args.p_value);if(name==='cloud_ocr_page_journal_step')return fakeOcrJournal(journal,args);if(name==='cloud_read_pdf_checkpoint'){const key=String(args.p_key);return {data:journal.has(key)?{found:true,...(args.p_kind==='legacy'?{}:{value:journal.get(key)})}:{found:false},error:null};}return {data:true,error:null};},
  from:(table:string)=>{let item='';const q={select:()=>q,eq:(name:string,value:string)=>{if(name==='item_key')item=value;return q;},
   single:async()=>({data:table==='source_documents'?{id:'doc',source_record_id:'record',url:'https://unused.invalid',storage_path:`cases/record/documents/doc/${name}`,storage_sha256:digest,mime_type:'text/html'}:null,error:null}),
   maybeSingle:async()=>({data:journal.has(item)?{value:journal.get(item)}:null,error:null})};return q;}};
 const result=await extractDocument({db,task:'test',owner:'owner',generation:1} as unknown as Context,'job','doc','https://unused.invalid',false);
 assert.equal(result.partial,true);
 assert.equal(result.text.length,200000);
 assert.ok(!result.text.includes('EVIDENCIA FINAL'));
 assert.equal((result.coverage as {complete:boolean}).complete,false);
 assert.ok(downloads>0);
});

test('HTML coverage policy distinguishes old checkpoints and exact length boundaries',()=>{
 assert.equal(hasCurrentTextCoverage('html-basic',null),false);
 assert.equal(hasCurrentTextCoverage(null,null,'text/plain'),false);
 assert.equal(hasCurrentTextCoverage('pdf-text-markdown-v2',null),true);
 assert.equal(hasCurrentTextCoverage(null,null,null),false);
 assert.equal(hasCurrentTextCoverage(null,null,'application/octet-stream'),false);
 assert.equal(hasCurrentTextCoverage('pdftotext',null,'application/pdf'),true);
 assert.equal(hasCurrentTextCoverage('pdf-text-markdown-v2',{complete:false},'application/pdf',false),false);
 assert.equal(hasCurrentTextCoverage('pdf-ocr-markdown-v2',{complete:true},'application/pdf',true),false);
 assert.equal(hasCurrentTextCoverage('pdf-text-markdown-v2',null,'application/pdf',true),false);
 assert.equal(hasCurrentTextCoverage('pdf-text-markdown-v2',{complete:true},'application/pdf',false),true);
 assert.equal(hasCurrentTextCoverage('pdftotext',null,'application/pdf',false),true);
 assert.equal(hasCurrentTextCoverage('source-payload-fallback',null,null),false);
 const exact=cleanTextWithCoverage('a'.repeat(200000));
 assert.equal(exact.partial,false);
 assert.equal(hasCurrentTextCoverage('html-basic',exact.coverage),true);
 const tooLong=cleanTextWithCoverage('a'.repeat(200001));
 assert.equal(tooLong.partial,true);
 assert.equal(hasCurrentTextCoverage('html-basic',tooLong.coverage),false);
});

test('complete extraction checkpoints are reused only for the same verified source bytes',async()=>{
 const {EXTRACTION_VERSION}=await import('../lib/pipeline/readable-document');
 const {hash}=await import('../lib/pipeline/chunks');
 const {CloudFailure}=await import('../lib/cloud/errors');
 const bytes=Buffer.from('%PDF-current synthetic source');
 const digest=sha256(bytes),encodedHash=hash(bytes.toString('base64'));
 const name=`${digest}.pdf`,key=`document:doc:${EXTRACTION_VERSION}`;
 let downloads=0,checkpointWrites=0;
 const journal=new Map<string,unknown>();
 const db={storage:{from:()=>({list:async()=>({data:[{name}],error:null}),download:async()=>{downloads++;return {data:new Blob([bytes]),error:null};}})},
  rpc:async(name:string)=>{if(name==='cloud_checkpoint')checkpointWrites++;return {data:true,error:null};},
  from:(table:string)=>{let item='';const q={select:()=>q,eq:(name:string,value:string)=>{if(name==='item_key')item=value;return q;},
   single:async()=>({data:table==='source_documents'?{id:'doc',source_record_id:'record',url:'https://unused.invalid',storage_path:`cases/record/documents/doc/${name}`,storage_sha256:digest,mime_type:'application/pdf'}:null,error:null}),
   maybeSingle:async()=>({data:journal.has(item)?{value:journal.get(item)}:null,error:null})};return q;}};
 const context={db,task:'test',owner:'owner',generation:1} as unknown as Context;
 const cached={text:'## Pàgina 1\n\nText documental conservat.',method:'pdf-text-markdown-v2',hash:encodedHash,mime:'application/pdf',partial:false,extraction_version:EXTRACTION_VERSION};
 journal.set('legacy-ocr-pending:doc',{version:'legacy-ocr-pending-v1'});
 for(const acceptedHash of [encodedHash,digest]){
  journal.set(key,{...cached,hash:acceptedHash});
  assert.deepEqual(await extractDocument(context,'job','doc','https://unused.invalid',false),{...cached,hash:acceptedHash,source_sha256:digest,source_url:'https://unused.invalid',source_path:`cases/record/documents/doc/${name}`});
 }
 for(const conflict of [{source_path:'different/path'},{source_sha256:sha256(Buffer.from('old'))},{source_url:'https://changed.invalid'}]){
  journal.set(key,{...cached,...conflict});
  await assert.rejects(extractDocument(context,'job','doc','https://unused.invalid',false),(error:unknown)=>error instanceof CloudFailure&&error.diagnostic?.code==='DOCUMENT_CHECKPOINT_SOURCE_CHANGED');
 }
 for(const invalidHash of [undefined,'',sha256(Buffer.from('%PDF-previous'))]){
  journal.set(key,{...cached,hash:invalidHash});
  await assert.rejects(extractDocument(context,'job','doc','https://unused.invalid',false),(error:unknown)=>error instanceof CloudFailure&&error.diagnostic?.code==='DOCUMENT_CHECKPOINT_SOURCE_CHANGED');
 }
 await assert.rejects(extractDocument(context,'job','doc','https://old.invalid',false),(error:unknown)=>error instanceof CloudFailure&&error.diagnostic?.code==='DOCUMENT_SOURCE_CHANGED');
 assert.equal(downloads,8);assert.equal(checkpointWrites,0);
});

test('HTML truncation does not leave an unpaired UTF-16 surrogate in a checkpoint',()=>{
 const result=cleanTextWithCoverage('a'.repeat(199999)+'😀'+'final');
 assert.equal(result.partial,true);assert.equal(result.text.length,199999);
 assert.doesNotMatch(result.text,/[\uD800-\uDFFF]/);
 assert.equal(JSON.parse(JSON.stringify(result)).text,result.text);
});
