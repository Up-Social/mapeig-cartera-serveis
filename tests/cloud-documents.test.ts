import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Sandbox} from '@vercel/sandbox';
import {extractDocument} from '../lib/cloud/documents';
import {sha256} from '../lib/source-storage';
import type {Context} from '../lib/cloud/context';
test('OCR resumes persisted pages after each Sandbox disappears',async()=>{
 const journal=new Map<string,unknown>([['original:doc',{path:'private/mock',mime:'application/pdf',hash:'mock'}]]);
 const archivedHash=sha256(Buffer.from('%PDF-synthetic'));
 const archivedName=`${archivedHash}.pdf`;
 const db={storage:{from:()=>({download:async()=>({data:new Blob(['%PDF-synthetic']),error:null}),list:async()=>({data:[{name:archivedName}],error:null})})},rpc:async(name:string,args:Record<string,unknown>)=>{if(name==='cloud_checkpoint')journal.set(String(args.p_key),args.p_value);return {data:true,error:null};},from:(table:string)=>{let key='';const q={select:()=>q,eq:(name:string,value:string)=>{if(name==='item_key')key=value;return q;},single:async()=>({data:table==='source_documents'?{id:'doc',source_record_id:'record',url:'https://unused.invalid',storage_path:`cases/record/documents/doc/${archivedName}`,storage_sha256:archivedHash}:null,error:null}),maybeSingle:async()=>({data:journal.has(key)?{value:journal.get(key)}:null,error:null})};return q;}};
 const c={db,task:'test',owner:'owner',generation:1} as unknown as Context;
 const create=Sandbox.create;const env=process.env.CLOUD_SANDBOX_SNAPSHOT;process.env.CLOUD_SANDBOX_SNAPSHOT='mock';let recognized=0,stopped=0;
 Sandbox.create=async()=>({writeFiles:async()=>{},runCommand:async(_cmd:string,args:string[])=>{if(args[3]==='tesseract')recognized++;return {exitCode:0};},readFileToBuffer:async({path}:{path:string})=>Buffer.from(path.endsWith('info.txt')?'Pages: 2':path.endsWith('page.txt')?'Text sintètic de prova amb prou longitud per comprovar la recuperació de cada pàgina.':''),stop:async()=>{stopped++;}}) as unknown as Awaited<ReturnType<typeof create>>;
 try {
  await assert.rejects(extractDocument(c,'job','doc','https://unused.invalid',true),/yield/);
  assert.equal(recognized,1);assert.equal(stopped,1);
  await assert.rejects(extractDocument(c,'job','doc','https://unused.invalid',true),/yield/);
  assert.equal(recognized,2);
  const result=await extractDocument(c,'job','doc','https://unused.invalid',true);
  assert.equal(result.method,'pdf-ocr-markdown-v2');assert.equal(result.partial,false);assert.equal(recognized,2);assert.equal(stopped,3);
  await extractDocument(c,'job','doc','https://unused.invalid',true);assert.equal(stopped,3);
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
  rpc:async(name:string,args:Record<string,unknown>)=>{if(name==='cloud_checkpoint')journal.set(String(args.p_key),args.p_value);return {data:true,error:null};},
  from:(table:string)=>{let key='';const q={
   select:()=>q,
   eq:(name:string,value:string)=>{if(name==='item_key')key=value;return q;},
   single:async()=>({data:table==='source_documents'?{id:'doc',source_record_id:'record',url:'https://unused.invalid',storage_path:`cases/record/documents/doc/${name}`,storage_sha256:digest,mime_type:'text/html'}:null,error:null}),
   maybeSingle:async()=>({data:journal.has(key)?{value:journal.get(key)}:null,error:null}),
  };return q;},
 };
 const context={db,task:'test',owner:'owner',generation:1} as unknown as Context;
 const result=await extractDocument(context,'job','doc','https://unused.invalid',false);
 assert.match(result.text,/Document oficial arxivat/);
 assert.equal(result.method,'html-basic');
 assert.ok(journal.has('original:doc'));
});
