import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {CopyPreparationUncertain,createFirstCopyPreparer} from '../lib/convenis/first-copy-preparer';
import {preparationErrorMessage} from '../lib/convenis/preparation-error-message';
import {itemSourcePath} from '../lib/source-storage';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

for(const scenario of ['valid','valid-historical','source-altered','copy-altered','unavailable','snapshot-changed'] as const){
 test(`legacy receipt replay checks all physical objects and SQL freshness (${scenario})`,async()=>{
  const bytes=Buffer.from('synthetic historic archive'),sha=createHash('sha256').update(bytes).digest('hex');
  const citation=(doc:number)=>({document_id:id(doc),page:1,quote:'synthetic'});
  const archives=[3,10].map((doc,index)=>{
   const source={path:`cases/${id(1)}/documents/${id(doc)}/${sha}.pdf`,sha256:sha,object_id:id(20+index*4),version:id(21+index*4)};
   const copy={path:itemSourcePath(id(1),id(2),id(doc),source.path),sha256:sha,object_id:id(22+index*4),version:id(23+index*4)};
   return {documentId:id(doc),source,copy};
  });
  const coverage=scenario==='valid-historical'?{}:{additionalCitations:[citation(10)]};
  const snapshot={draftId:id(6),recordId:id(1),unitId:id(2),draft:{},monetaryCitation:citation(3),identityCitation:citation(3),rolePeriodCitation:citation(3),...coverage,archives:scenario==='valid-historical'?archives.slice(0,1):archives};
  const receipt={event_id:id(7),draft_id:id(6),snapshot,kind:'physical-read-only-v1' as const,verified_at:'2026-01-01T00:00:00Z'};
  let finds=0;const reads:string[]=[];
  const never=async()=>{throw Error('Replay must not plan, copy or save');};
  const prepare=createFirstCopyPreparer({storage:{storageUrl:'https://storage.invalid',serviceKey:'synthetic',fetcher:async(url,options)=>{
   assert.equal(options?.method,'GET');const path=new URL(String(url)).pathname;reads.push(path);
   if(scenario==='unavailable'&&path.endsWith(archives[1].copy.path))return new Response(null,{status:503});
   if((scenario==='source-altered'&&path.endsWith(archives[0].source.path))||(scenario==='copy-altered'&&path.endsWith(archives[0].copy.path)))return new Response('altered');
   return new Response(bytes);
  }},find:async()=>{finds++;return scenario==='snapshot-changed'&&finds===2?{...receipt,verified_at:'2026-02-01T00:00:00Z'}:receipt;},plan:never,finishPlan:never,save:never});
  if(scenario==='valid'||scenario==='valid-historical'){
   assert.deepEqual(await prepare({draftId:id(6),eventId:id(7)}),receipt);
   assert.equal(finds,2);assert.equal(reads.length,scenario==='valid'?4:2);
  }else{
   await assert.rejects(()=>prepare({draftId:id(6),eventId:id(7)}));
   assert.equal(finds,scenario==='snapshot-changed'?2:1);
  }
 });
}

test('an interrupted legacy receipt replay cannot copy or save after a stalled Storage stream',async()=>{
 const bytes=Buffer.from('synthetic historic archive'),sha=createHash('sha256').update(bytes).digest('hex');
 const source={path:`cases/${id(1)}/documents/${id(3)}/${sha}.pdf`,sha256:sha,object_id:id(4),version:id(5)};
 const copy={path:itemSourcePath(id(1),id(2),id(3),source.path),sha256:sha,object_id:id(8),version:id(9)};
 const citation={document_id:id(3),page:1,quote:'synthetic'};
 const snapshot={draftId:id(6),recordId:id(1),unitId:id(2),draft:{},monetaryCitation:citation,identityCitation:citation,rolePeriodCitation:citation,archives:[{documentId:id(3),source,copy}]};
 const receipt={event_id:id(7),draft_id:id(6),snapshot,kind:'physical-read-only-v1' as const,verified_at:'2026-01-01T00:00:00Z'};
 let finds=0,plans=0,saves=0,posts=0,cancelled=0,started!:()=>void;
 const streamStarted=new Promise<void>(resolve=>{started=resolve;});
 const prepare=createFirstCopyPreparer({storage:{storageUrl:'https://storage.invalid',serviceKey:'synthetic',fetcher:async(_url,options)=>{
  if(options?.method==='POST')posts++;
  return new Response(new ReadableStream({pull(){started();return new Promise<void>(()=>{});},cancel(){cancelled++;}}));
 }},find:async()=>{finds++;return receipt;},plan:async()=>{plans++;throw Error('Unexpected plan');},
 finishPlan:async()=>{throw Error('Unexpected finish');},save:async()=>{saves++;throw Error('Unexpected save');}});
 const controller=new AbortController();
 try{
  const task=prepare({draftId:id(6),eventId:id(7)},controller.signal);
  await streamStarted;const deadline=setTimeout(()=>controller.abort(),5);
  task.finally(()=>clearTimeout(deadline)).catch(()=>{});
  await assert.rejects(()=>task,/interrompud|temps|interrupted/i);
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(finds,1);assert.equal(plans,0);assert.equal(posts,0);assert.equal(saves,0);assert.equal(cancelled,1);
 }finally{controller.abort();}
});

test('an interrupted upload reports uncertainty and does not retry or save a receipt',async()=>{
 const bytes=Buffer.from('synthetic archived document');
 const sha=createHash('sha256').update(bytes).digest('hex');
 const source={path:`cases/${id(1)}/documents/${id(3)}/${sha}.pdf`,sha256:sha,object_id:id(4),version:id(5)};
 const citation={document_id:id(3),page:1,quote:'synthetic'};
 const plan={draftId:id(6),recordId:id(1),unitId:id(2),draft:{},monetaryCitation:citation,identityCitation:citation,rolePeriodCitation:citation,
  archives:[{documentId:id(3),source,copy:null,copyPath:itemSourcePath(id(1),id(2),id(3),source.path)}]};
 const methods:string[]=[];let saves=0;
 const prepare=createFirstCopyPreparer({
  storage:{storageUrl:'https://storage.invalid',serviceKey:'synthetic',fetcher:async(_url,options)=>{
   methods.push(options?.method??'GET');if(options?.method==='POST')throw Error('synthetic disconnect');
   return new Response(bytes,{status:200});
  }},
  plan:async()=>plan,finishPlan:async()=>{throw Error('Unexpected finish');},
  find:async()=>null,save:async()=>{saves++;throw Error('Unexpected save');},
 });
 await assert.rejects(()=>prepare({draftId:id(6),eventId:id(7)}),error=>{
  assert.ok(error instanceof CopyPreparationUncertain);assert.equal(error.stage,'copy');
  assert.match(preparationErrorMessage(error),/No s’ha pogut confirmar si s’ha creat la còpia/);
  assert.match(preparationErrorMessage(error),/Revisa l’estat de la preparació i els comprovants abans de continuar/);return true;
 });
 assert.deepEqual(methods,['GET','POST']);assert.equal(saves,0);
});

for(const behavior of ['pending','reject'] as const){
 test(`an unconfirmed upload does not wait for response-body cancellation (${behavior})`,async()=>{
  const bytes=Buffer.from('synthetic archived document');
  const sha=createHash('sha256').update(bytes).digest('hex');
  const source={path:`cases/${id(1)}/documents/${id(3)}/${sha}.pdf`,sha256:sha,object_id:id(4),version:id(5)};
  const citation={document_id:id(3),page:1,quote:'synthetic'};
  const plan={draftId:id(6),recordId:id(1),unitId:id(2),draft:{},monetaryCitation:citation,identityCitation:citation,rolePeriodCitation:citation,
   archives:[{documentId:id(3),source,copy:null,copyPath:itemSourcePath(id(1),id(2),id(3),source.path)}]};
  let cancellations=0,saves=0,posts=0;
  const prepare=createFirstCopyPreparer({storage:{storageUrl:'https://storage.invalid',serviceKey:'synthetic',fetcher:async(_url,options)=>{
   if(options?.method!=='POST')return new Response(bytes,{status:200});
   posts++;return new Response(new ReadableStream({cancel(){cancellations++;return behavior==='pending'?new Promise<void>(()=>{}):Promise.reject(Error('cancel failed'));}}),{status:409});
  }},plan:async()=>plan,finishPlan:async()=>{throw Error('Unexpected finish');},find:async()=>null,save:async()=>{saves++;throw Error('Unexpected save');}});
  const controller=new AbortController();let deadline:ReturnType<typeof setTimeout>|undefined;
  try{
   const result=prepare({draftId:id(6),eventId:id(7)},controller.signal).then(()=>null,error=>error);
   const error=await Promise.race([result,new Promise<never>((_,reject)=>{deadline=setTimeout(()=>{controller.abort();reject(Error('preparation hung during cancellation'));},500);})]);
   assert.ok(error instanceof CopyPreparationUncertain);assert.equal(error.stage,'copy');
   assert.equal(cancellations,1);assert.equal(posts,1);assert.equal(saves,0);
  }finally{if(deadline)clearTimeout(deadline);controller.abort();}
 });
}

test('a confirmed upload continues to finish even when body cancellation never settles',async()=>{
 const bytes=Buffer.from('synthetic archived document'),sha=createHash('sha256').update(bytes).digest('hex');
 const source={path:`cases/${id(1)}/documents/${id(3)}/${sha}.pdf`,sha256:sha,object_id:id(4),version:id(5)};
 const citation={document_id:id(3),page:1,quote:'synthetic'};
 const plan={draftId:id(6),recordId:id(1),unitId:id(2),draft:{},monetaryCitation:citation,identityCitation:citation,rolePeriodCitation:citation,
  archives:[{documentId:id(3),source,copy:null,copyPath:itemSourcePath(id(1),id(2),id(3),source.path)}]};
 let finished=0,cancellations=0;
 const prepare=createFirstCopyPreparer({storage:{storageUrl:'https://storage.invalid',serviceKey:'synthetic',fetcher:async(_url,options)=>
  options?.method==='POST'?new Response(new ReadableStream({cancel(){cancellations++;return new Promise<void>(()=>{});}}),{status:200}):new Response(bytes,{status:200})},
  plan:async()=>plan,finishPlan:async()=>{finished++;throw Error('synthetic finish failure');},find:async()=>null,save:async()=>{throw Error('Unexpected save');}});
 let deadline:ReturnType<typeof setTimeout>|undefined;
 try{
  const result=prepare({draftId:id(6),eventId:id(7)}).then(()=>null,error=>error);
  const error=await Promise.race([result,new Promise<never>((_,reject)=>{deadline=setTimeout(()=>reject(Error('preparation hung during cancellation')),500);})]);
  assert.match(String(error),/synthetic finish failure/);assert.equal(cancellations,1);assert.equal(finished,1);
 }finally{if(deadline)clearTimeout(deadline);}
});

test('uncertain receipt has a distinct explanation and internal errors stay private',()=>{
 const error=new CopyPreparationUncertain('receipt','private storage details');
 assert.match(preparationErrorMessage(error),/No s’ha pogut confirmar el comprovant/);
 assert.doesNotMatch(preparationErrorMessage(error),/private storage details/);
 assert.match(preparationErrorMessage({message:'PREPARATION_RECONCILIATION_REQUIRED'}),/preparació anterior pendent/);
 assert.match(preparationErrorMessage({message:'MANIFEST_NEEDS_FULL_REVIEW'}),/No s’ha atribuït cap import/);
 assert.doesNotMatch(preparationErrorMessage(Error('secret synthetic diagnostic')),/secret synthetic diagnostic/);
});

test('an uncertain receipt write requests reconciliation without a second write or upload',async()=>{
 const bytes=Buffer.from('synthetic archived document');
 const sha=createHash('sha256').update(bytes).digest('hex');
 const source={path:`cases/${id(1)}/documents/${id(3)}/${sha}.pdf`,sha256:sha,object_id:id(4),version:id(5)};
 const copy={path:itemSourcePath(id(1),id(2),id(3),source.path),sha256:sha,object_id:id(8),version:id(9)};
 const citation={document_id:id(3),page:1,quote:'synthetic'};
 const snapshot={draftId:id(6),recordId:id(1),unitId:id(2),draft:{},monetaryCitation:citation,identityCitation:citation,rolePeriodCitation:citation,archives:[{documentId:id(3),source,copy}]};
 const plan={...snapshot,archives:[{documentId:id(3),source,copy,copyPath:copy.path}]};
 const methods:string[]=[];let finds=0,saves=0;
 const prepare=createFirstCopyPreparer({storage:{storageUrl:'https://storage.invalid',serviceKey:'synthetic',fetcher:async(_url,options)=>{
  methods.push(options?.method??'GET');return new Response(bytes,{status:200});
 }},plan:async()=>plan,finishPlan:async()=>snapshot,find:async()=>{finds++;if(finds>1)throw Error('synthetic timeout');return null;},
 save:async()=>{saves++;throw Error('synthetic timeout');}});
 await assert.rejects(()=>prepare({draftId:id(6),eventId:id(7)}),error=>{
  assert.ok(error instanceof CopyPreparationUncertain);assert.equal(error.stage,'receipt');
  assert.match(preparationErrorMessage(error),/No s’ha pogut confirmar el comprovant/);return true;
 });
 assert.deepEqual(methods,['GET','GET']);assert.equal(saves,1);assert.equal(finds,2);
});

for(const hanging of ['find','plan','finish','save','confirm'] as const){
 test(`an interrupted ${hanging} RPC leaves an uncertain outcome and starts no later RPC`,async()=>{
  const bytes=Buffer.from('synthetic archived document'),sha=createHash('sha256').update(bytes).digest('hex');
  const source={path:`cases/${id(1)}/documents/${id(3)}/${sha}.pdf`,sha256:sha,object_id:id(4),version:id(5)};
  const copy={path:itemSourcePath(id(1),id(2),id(3),source.path),sha256:sha,object_id:id(8),version:id(9)};
  const citation={document_id:id(3),page:1,quote:'synthetic'};
  const snapshot={draftId:id(6),recordId:id(1),unitId:id(2),draft:{},monetaryCitation:citation,identityCitation:citation,rolePeriodCitation:citation,archives:[{documentId:id(3),source,copy}]};
  const plan={...snapshot,archives:[{documentId:id(3),source,copy,copyPath:copy.path}]};
  const receipt={event_id:id(7),draft_id:id(6),snapshot,kind:'physical-read-only-v1' as const,verified_at:'2026-01-01T00:00:00Z'};
  const calls:string[]=[];let release:(()=>void)|undefined,finds=0;
  const step=<T>(name:string,value:T):Promise<T>=>{calls.push(name);if(name!==hanging)return Promise.resolve(value);return new Promise<T>(resolve=>{release=()=>resolve(value);});};
  const prepare=createFirstCopyPreparer({storage:{storageUrl:'https://storage.invalid',serviceKey:'synthetic',fetcher:async(_url,options)=>{
   calls.push(options?.method??'GET');return new Response(bytes,{status:200});
  }},find:()=>{finds++;return step(finds===2?'confirm':'find',null);},plan:()=>step('plan',plan),finishPlan:()=>step('finish',snapshot),
   save:()=>{if(hanging==='confirm'){calls.push('save');return Promise.reject(Error('synthetic failure'));}return step('save',receipt);}});
  const ac=new AbortController();const task=prepare({draftId:id(6),eventId:id(7)},ac.signal);
  setTimeout(()=>ac.abort(),5);
  await assert.rejects(()=>task,error=>{
   assert.ok(error instanceof CopyPreparationUncertain);assert.equal(error.stage,hanging==='save'||hanging==='confirm'?'receipt':'operation');
   if(hanging!=='save'&&hanging!=='confirm')assert.match(preparationErrorMessage(error),/pot haver continuat al servidor/);
   return true;
  });
  const callsAtAbort=[...calls];assert.ok(release);release();await new Promise<void>(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,callsAtAbort);assert.equal(calls.filter(name=>name==='save').length,hanging==='save'||hanging==='confirm'?1:0);
  assert.equal(calls.filter(name=>name==='find').length,1);
 });
}

test('an already interrupted request does not start any database operation',async()=>{
 let calls=0;const never=async()=>{calls++;throw Error('unexpected database operation');};
 const prepare=createFirstCopyPreparer({storage:{storageUrl:'https://storage.invalid',serviceKey:'synthetic'},
  find:never,plan:never,finishPlan:never,save:never});
 const ac=new AbortController();ac.abort();
 await assert.rejects(()=>prepare({draftId:id(6),eventId:id(7)},ac.signal),error=>error instanceof CopyPreparationUncertain&&error.stage==='operation');
 assert.equal(calls,0);
});

test('the preparation endpoint explains an uncertain copy and stops before linking',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'mapeig-preparation-message-'));
 const oldEnv={...process.env},oldFetch=globalThis.fetch;
 const fixtureGlobal=globalThis as typeof globalThis&{visualTestDb?:unknown};
 try{
  const output=join(directory,'route.mjs');
  await build({entryPoints:['app/api/records/[id]/conveni/economic/prepare/route.ts'],bundle:true,platform:'node',format:'esm',outfile:output,
   alias:{'@/lib/records-page':resolve('tests/fixtures/conveni-visual-db.ts'),'@':resolve('.')},logLevel:'silent'});
  const bytes=Buffer.from('synthetic endpoint document'),sha=createHash('sha256').update(bytes).digest('hex');
  const source={path:`cases/${id(1)}/documents/${id(3)}/${sha}.pdf`,sha256:sha,object_id:id(4),version:id(5)};
  const citation={document_id:id(3),page:1,quote:'synthetic'},copyPath=itemSourcePath(id(1),id(2),id(3),source.path);
  const plan={draftId:id(6),recordId:id(1),unitId:id(2),draft:{},monetaryCitation:citation,identityCitation:citation,rolePeriodCitation:citation,
   archives:[{documentId:id(3),source,copy:null,copyPath}]};
  const calls:string[]=[];const ids={ackId:id(8),draftId:id(6),receiptId:id(9),linkId:id(10)};
  fixtureGlobal.visualTestDb={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:null})})})}),rpc:async(name:string)=>{
   calls.push(name);const data=name==='conveni_first_operation_begin'?{id:id(11),ids,state:'pending'}:name==='conveni_first_copy_plan'?plan:null;
   return {data,error:null};
  }};
  process.env.CONVENI_ECONOMIC_REVIEW_ENABLED='true';delete process.env.CONVENI_INDEPENDENT_REVIEW_ENABLED;delete process.env.CONVENI_INDEPENDENT_READERS_READY;
  delete process.env.CONVENI_ECONOMIC_COVERAGE_ENABLED;process.env.NEXT_PUBLIC_SUPABASE_URL='https://storage.invalid';process.env.SUPABASE_SECRET_KEY='synthetic';
  const methods:string[]=[];globalThis.fetch=async(_url,options)=>{methods.push(options?.method??'GET');if(options?.method==='POST')throw Error('synthetic disconnect');return new Response(bytes,{status:200});};
  const route=await import(pathToFileURL(output).href);
  const body={operationId:id(11),ackId:ids.ackId,draftId:ids.draftId,receiptId:ids.receiptId,linkId:ids.linkId,identityId:id(12),jobId:id(13),monetaryId:id(14),rolePeriodId:id(15),unitId:id(2),literal:'100,00',reviewer:'Persona',note:'Observació documentada',social:true,economic:true,manifest:true,historyConfirmed:false,historySnapshot:null};
  const response=await route.POST(new Request('http://local.invalid',{method:'POST',body:JSON.stringify(body)}),{params:Promise.resolve({id:id(1)})});
  assert.equal(response.status,409);const result=await response.json();assert.match(result.error,/No s’ha pogut confirmar si s’ha creat la còpia/);
  assert.match(result.error,/Revisa l’estat de la preparació i els comprovants abans de continuar/);assert.deepEqual(methods,['GET','POST']);
  assert.ok(!calls.includes('conveni_first_receipt_save'));assert.ok(!calls.includes('conveni_first_link_draft'));
 }finally{process.env=oldEnv;globalThis.fetch=oldFetch;delete fixtureGlobal.visualTestDb;await rm(directory,{recursive:true,force:true});}
});
