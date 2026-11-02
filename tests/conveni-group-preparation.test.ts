import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {ARCHIVE_DOCUMENT_MAX_BYTES,verifySelectedArchives} from '../lib/convenis/archive-verification';
import {GROUP_CONFIRMATIONS,groupLiteralCents,parseGroupPreparation,groupPreparationRpcArgs,selectedGroupDocuments} from '../lib/convenis/group-preparation';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const docs=[id(10),id(11)];const bytes=Buffer.from('Document sintètic arxivat');const sha=createHash('sha256').update(bytes).digest('hex');
const receipt=(doc:string)=>({path:`cases/${id(1)}/documents/${doc}/${sha}.pdf`,sha256:sha,object_id:id(8),version:id(9)});
const snapshot={[docs[0]]:receipt(docs[0]),[docs[1]]:receipt(docs[1])};
const confirmations=Object.fromEntries(GROUP_CONFIRMATIONS.map(key=>[key,true]));
const base={action:'prepare-group',jobId:id(2),unitId:id(3),eventId:id(4),previousPreparationId:null,parentReviewId:null,groupHash:'a'.repeat(64),analysisHash:'b'.repeat(64),sourceHash:'c'.repeat(32),documentRevisions:{[docs[0]]:`${sha}:`,[docs[1]]:`${sha}:`},heads:{'0':id(5),'1':id(6)},serviceCode:'1.1.1',amountLiteral:'20.000,00 €',totalCitation:{document_id:docs[0],page:1,quote:'L’aportació total és de 20.000,00 €.'},identityCitation:{document_id:docs[1],page:1,quote:'La Fundació té NIF G12345678.'},confirmations,note:'Revisió del total documentat'};
function fakeStorage(content:Uint8Array|Error,counts:{reads:number;paths:string[]}):SupabaseClient {
 return {storage:{from:(bucket:string)=>{assert.equal(bucket,'cloud-documents');return {download:(path:string,_:unknown,options:{signal:AbortSignal;cache:string})=>{assert.equal(options.cache,'no-store');counts.paths.push(path);return {asStream:async()=>{counts.reads++;if(content instanceof Error)return {data:null,error:content};return {data:new ReadableStream({start(controller){controller.enqueue(content);controller.close();}}),error:null};}};}};}}} as unknown as SupabaseClient;
}

test('request keeps literal evidence and every confirmation, without generating an allocation',()=>{
 const parsed=parseGroupPreparation(base);assert.equal(parsed.amountCents,2000000);
 const args=groupPreparationRpcArgs(id(1),parsed,snapshot);assert.equal(args.p_amount_cents,2000000);assert.deepEqual(args.p_archive_snapshot,snapshot);
 assert.ok(!('p_allocation' in args));
 for(const key of GROUP_CONFIRMATIONS)assert.throws(()=>parseGroupPreparation({...base,confirmations:{...confirmations,[key]:false}}));
 for(const value of ['1.234','-20','1,2','20.000,001',''])assert.equal(groupLiteralCents(value),null);
 assert.equal(groupLiteralCents('0,00 €'),0);assert.equal(groupLiteralCents('1234.56'),123456);
});

test('all current concept heads and their selected source documents are required',()=>{
 const parsed=parseGroupPreparation(base);
 const heads=[{concept_index:0,review_id:id(5),review_is_current:true,outcome:'select',reviewed_code:'1.1.1',selected_citation:{document_id:docs[1]}},{concept_index:1,review_id:id(6),review_is_current:true,outcome:'select',reviewed_code:'1.1.1',selected_citation:{document_id:docs[0]}}];
 assert.deepEqual(selectedGroupDocuments(parsed,heads),docs);
 assert.throws(()=>selectedGroupDocuments(parsed,[heads[0]]));
 assert.throws(()=>selectedGroupDocuments(parsed,[heads[0],{...heads[1],review_is_current:false}]));
 assert.throws(()=>selectedGroupDocuments(parsed,[heads[0],{...heads[1],reviewed_code:'other'}]));
 assert.throws(()=>selectedGroupDocuments(parsed,[heads[0],{...heads[1],concept_index:0}]));
});

test('streams every selected archived object once, never a public URL',async()=>{
 const calls={reads:0,paths:[] as string[]};const db=fakeStorage(bytes,calls);
 assert.deepEqual(await verifySelectedArchives(db,id(1),docs,snapshot),snapshot);
 assert.equal(calls.reads,2);assert.deepEqual(calls.paths,docs.map(doc=>receipt(doc).path));
});

test('missing, altered, unversioned, oversized or interrupted sources fail without recovery',async()=>{
 const calls={reads:0,paths:[] as string[]};
 await assert.rejects(()=>verifySelectedArchives(fakeStorage(Error('missing'),calls),id(1),docs,snapshot),/no està disponible/);
 await assert.rejects(()=>verifySelectedArchives(fakeStorage(Buffer.from('altered'),calls),id(1),docs,snapshot),/integritat/);
 await assert.rejects(()=>verifySelectedArchives(fakeStorage(bytes,calls),id(1),docs,{[docs[0]]:{...receipt(docs[0]),version:null},[docs[1]]:receipt(docs[1])}),/versió/);
 await assert.rejects(()=>verifySelectedArchives(fakeStorage(bytes,calls),id(1),docs,{[docs[0]]:receipt(docs[0])}),/incompleta/);
 await assert.rejects(()=>verifySelectedArchives(fakeStorage(new Uint8Array(ARCHIVE_DOCUMENT_MAX_BYTES+1),calls),id(1),docs,snapshot),/límit/);
 const ac=new AbortController();ac.abort();await assert.rejects(()=>verifySelectedArchives(fakeStorage(bytes,calls),id(1),docs,snapshot,ac.signal),/interromput/);
});

test('the action writes only after all selected source bytes verify, and surfaces a version race',async()=>{
 const {isGroupPreparationEnabled,performGroupPreparation}=await import('../lib/convenis/group-action');
 assert.equal(isGroupPreparationEnabled(),false);
 const parsed=parseGroupPreparation(base);
 const heads=[{concept_index:0,review_id:id(5),review_is_current:true,outcome:'select',reviewed_code:'1.1.1',selected_citation:{document_id:docs[1]}},{concept_index:1,review_id:id(6),review_is_current:true,outcome:'select',reviewed_code:'1.1.1',selected_citation:{document_id:docs[0]}}];
 function dbFor(content:Uint8Array|Error,race=false,preparationId:string|null=null){
  const calls={reads:0,paths:[] as string[],writes:0};const storage=fakeStorage(content,calls).storage;
  const db={storage,from:(table:string)=>{const query={select:()=>query,eq:()=>query,order:()=>query,
   single:async()=>({data:{group_hash:base.groupHash,analysis_hash:base.analysisHash,source_hash:base.sourceHash,parent_review_id:null,preparation_id:preparationId},error:null}),
   range:async()=>({data:table==='conveni_concept_proposals'?heads:[],error:null})};return query;},
   rpc:async(name:string)=>{if(name==='conveni_archive_snapshot')return {data:snapshot,error:null};if(name==='prepare_conveni_group_verified'){calls.writes++;return {data:null,error:race?{message:'Còpies arxivades canviades'}:null};}throw Error('Unexpected RPC');}};
  return {db:db as unknown as SupabaseClient,calls};
 }
 const blocked=dbFor(bytes);await assert.rejects(()=>performGroupPreparation(blocked.db,id(1),parsed),/desactivada/);assert.equal(blocked.calls.reads,0);assert.equal(blocked.calls.writes,0);
 const ok=dbFor(bytes);await performGroupPreparation(ok.db,id(1),parsed,undefined,true);assert.equal(ok.calls.reads,2);assert.equal(ok.calls.writes,1);
 const retry=dbFor(bytes,false,base.eventId);await performGroupPreparation(retry.db,id(1),parsed,undefined,true);assert.equal(retry.calls.reads,2);assert.equal(retry.calls.writes,1);
 const retryBad=dbFor(Buffer.from('altered'),false,base.eventId);await assert.rejects(()=>performGroupPreparation(retryBad.db,id(1),parsed,undefined,true),/integritat/);assert.equal(retryBad.calls.writes,0);
 const stale=dbFor(bytes,false,id(99));await assert.rejects(()=>performGroupPreparation(stale.db,id(1),parsed,undefined,true),/obsoleta/);assert.equal(stale.calls.reads,0);assert.equal(stale.calls.writes,0);
 const missing=dbFor(Error('unavailable'));await assert.rejects(()=>performGroupPreparation(missing.db,id(1),parsed,undefined,true),/no està disponible/);assert.equal(missing.calls.writes,0);
 const altered=dbFor(Buffer.from('altered'));await assert.rejects(()=>performGroupPreparation(altered.db,id(1),parsed,undefined,true),/integritat/);assert.equal(altered.calls.writes,0);
 const changed=dbFor(bytes,true);await assert.rejects(()=>performGroupPreparation(changed.db,id(1),parsed,undefined,true),/canviades/);assert.equal(changed.calls.reads,2);assert.equal(changed.calls.writes,1);
});

test('the request-wide byte budget also stops multiple individually valid documents',async()=>{
 const chunk=new Uint8Array(ARCHIVE_DOCUMENT_MAX_BYTES);const digest=createHash('sha256').update(chunk).digest('hex');
 const moreDocs=Array.from({length:5},(_,i)=>id(20+i));
 const receipts=Object.fromEntries(moreDocs.map(doc=>[doc,{path:`cases/${id(1)}/documents/${doc}/${digest}.pdf`,sha256:digest,object_id:id(8),version:id(9)}]));
 const calls={reads:0,paths:[] as string[]};
 await assert.rejects(()=>verifySelectedArchives(fakeStorage(chunk,calls),id(1),moreDocs,receipts),/límit/);
 assert.equal(calls.reads,5);
});

test('an abort actively releases a stalled Storage stream',async()=>{
 let canceled=false;
 const db={storage:{from:()=>({download:()=>({asStream:async()=>({data:new ReadableStream({cancel(){canceled=true;}}),error:null})})})}} as unknown as SupabaseClient;
 const ac=new AbortController();setTimeout(()=>ac.abort(),5);
 await assert.rejects(()=>verifySelectedArchives(db,id(1),docs,snapshot,ac.signal),/interromput/);
 assert.equal(canceled,true);
});

test('an abort also bounds a Storage request that never yields a response',async()=>{
 const db={storage:{from:()=>({download:()=>({asStream:()=>new Promise(()=>{})})})}} as unknown as SupabaseClient;
 const ac=new AbortController();setTimeout(()=>ac.abort(),5);
 await assert.rejects(()=>verifySelectedArchives(db,id(1),docs,snapshot,ac.signal),/interromput/);
});
