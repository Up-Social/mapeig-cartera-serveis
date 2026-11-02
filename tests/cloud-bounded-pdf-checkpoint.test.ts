import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readBoundedPdfCheckpoint,type Context} from '../lib/cloud/context';
import {CloudFailure} from '../lib/cloud/errors';

function fake(result:unknown,error:unknown=null){
 const calls:Array<{name:string;args:Record<string,unknown>}>=[];
 const c={db:{rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return {data:result,error};}},task:'task',owner:'owner',generation:7} as unknown as Context;
 return {c,calls};
}
test('bounded preflight read carries lease and source scope to the server',async()=>{
 const {c,calls}=fake({found:true,value:{rawText:'ok'}});
 assert.deepEqual(await readBoundedPdfCheckpoint(c,'job','doc','preflight','key',8_000_000),{found:true,value:{rawText:'ok'}});
 assert.deepEqual(calls,[{name:'cloud_read_pdf_checkpoint',args:{p_task:'task',p_owner:'owner',p_generation:7,p_job:'job',p_document:'doc',p_kind:'preflight',p_key:'key',p_max_text_bytes:8_000_000}}]);
});
test('oversized OCR and malformed responses cannot trigger a new read or provider work',async()=>{
 const large=fake(null,{message:'PDF_CHECKPOINT_TOO_LARGE',code:'P0001'});
 await assert.rejects(readBoundedPdfCheckpoint(large.c,'j','d','page','key',4),(error:unknown)=>error instanceof CloudFailure&&error.diagnostic?.code==='PDF_CHECKPOINT_TOO_LARGE');
 for(const value of [null,{}, {found:true}, {found:true,value:null}, {found:true,value:[]}, {found:'true'}]){
  const invalid=fake(value);
  await assert.rejects(readBoundedPdfCheckpoint(invalid.c,'j','d','page','key',4),CloudFailure);
 }
});
test('legacy OCR checks existence without returning historical payload',async()=>{
 const {c}=fake({found:true});
 assert.deepEqual(await readBoundedPdfCheckpoint(c,'j','d','legacy','old-key',0),{found:true});
});

test('uncertain and unverified OCR journal errors remain explicit and non-retryable',async()=>{
 const {rpc}=await import('../lib/cloud/context');
 for(const [message,code] of [['OCR_JOURNAL_UNCERTAIN','OCR_PAGE_OUTCOME_UNCERTAIN'],['OCR_JOURNAL_UNVERIFIED','OCR_JOURNAL_UNVERIFIED']] as const){
  const {c}=fake(null,{message,code:'P0001'});
  await assert.rejects(rpc(c.db,'cloud_ocr_page_journal_step',{}),(error:unknown)=>error instanceof CloudFailure&&error.kind==='validation'&&error.diagnostic?.code===code);
 }
});

test('OCR uncertainty messages are explicit and never expose provider diagnostics',async()=>{
 const {failureMessage}=await import('../lib/cloud/errors');
 const uncertain=new CloudFailure('validation',5,{operation:'ocr',code:'OCR_PAGE_OUTCOME_UNCERTAIN',message:'PRIVATE_PROVIDER_DETAIL'});
 const unverified=new CloudFailure('validation',5,{operation:'ocr',code:'OCR_JOURNAL_UNVERIFIED',message:'PRIVATE_PROVIDER_DETAIL'});
 assert.match(failureMessage(uncertain),/desconegut/);
 assert.match(failureMessage(unverified),/no es pot verificar/i);
 assert.doesNotMatch(failureMessage(uncertain),/PRIVATE_PROVIDER_DETAIL/);
 assert.equal(failureMessage(new CloudFailure('validation')), 'Resposta no vàlida.');
});
