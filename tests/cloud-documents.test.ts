import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Sandbox} from '@vercel/sandbox';
import {extractDocument} from '../lib/cloud/documents';
import type {Context} from '../lib/cloud/context';
test('OCR resumes persisted pages after each Sandbox disappears',async()=>{
 const journal=new Map<string,unknown>([['original:doc',{path:'private/mock',mime:'application/pdf',hash:'mock'}]]);
 const db={storage:{from:()=>({download:async()=>({data:new Blob(['%PDF-synthetic']),error:null})})},rpc:async(name:string,args:Record<string,unknown>)=>{if(name==='cloud_checkpoint')journal.set(String(args.p_key),args.p_value);return {data:true,error:null};},from:()=>{let key='';const q={select:()=>q,eq:(name:string,value:string)=>{if(name==='item_key')key=value;return q;},maybeSingle:async()=>({data:journal.has(key)?{value:journal.get(key)}:null,error:null})};return q;}};
 const c={db,task:'test',owner:'owner',generation:1} as unknown as Context;
 const create=Sandbox.create;const env=process.env.CLOUD_SANDBOX_SNAPSHOT;process.env.CLOUD_SANDBOX_SNAPSHOT='mock';let recognized=0,stopped=0;
 Sandbox.create=async()=>({writeFiles:async()=>{},runCommand:async(_cmd:string,args:string[])=>{if(args[3]==='tesseract')recognized++;return {exitCode:0};},readFileToBuffer:async({path}:{path:string})=>Buffer.from(path.endsWith('info.txt')?'Pages: 2':path.endsWith('page.txt')?'Text sintètic de prova amb prou longitud per comprovar la recuperació de cada pàgina.':''),stop:async()=>{stopped++;}}) as unknown as Awaited<ReturnType<typeof create>>;
 try {
  await assert.rejects(extractDocument(c,'doc','https://unused.invalid',true),/yield/);
  assert.equal(recognized,1);assert.equal(stopped,1);
  await assert.rejects(extractDocument(c,'doc','https://unused.invalid',true),/yield/);
  assert.equal(recognized,2);
  const result=await extractDocument(c,'doc','https://unused.invalid',true);
  assert.equal(result.method,'tesseract-ocr');assert.equal(result.partial,false);assert.equal(recognized,2);assert.equal(stopped,3);
  await extractDocument(c,'doc','https://unused.invalid',true);assert.equal(stopped,3);
 }finally{Sandbox.create=create;if(env===undefined)delete process.env.CLOUD_SANDBOX_SNAPSHOT;else process.env.CLOUD_SANDBOX_SNAPSHOT=env;}
});
