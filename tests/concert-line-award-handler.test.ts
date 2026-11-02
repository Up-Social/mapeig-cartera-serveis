import {test} from 'node:test';import assert from 'node:assert/strict';import {handleAward} from '../lib/concerts/line-award-handler';
const record='11111111-1111-4111-8111-111111111111',unit='22222222-2222-4222-8222-222222222222',job='33333333-3333-4333-8333-333333333333',event='44444444-4444-4444-8444-444444444444',doc='55555555-5555-4555-8555-555555555555',source='66666666-6666-4666-8666-666666666666',item='77777777-7777-4777-8777-777777777777',decision='88888888-8888-4888-8888-888888888888',sha='a'.repeat(64);
const snapshot={document_id:doc,document_path:`cases/${record}/documents/${doc}/${sha}.pdf`,document_sha256:sha,unit_path:`cases/${record}/items/${unit}/documents/${doc}/${sha}.pdf`,unit_sha256:sha,source_object:source,source_version:'1',item_object:item,item_version:'2',population_event:event};
const payload={jobId:job,eventId:event,decisionId:decision,code:'1',amountLiteral:'12.000,00',quote:'cita',reason:'Revisió justificada',reviewer:'Persona',award:true,recipient:true,allocation:true};
const request=(body:unknown)=>new Request('http://fixture.invalid',{method:'POST',body:JSON.stringify(body)});
const bytes=Buffer.from('document sintètic');
test('captures and retains verified evidence before the economic decision',async()=>{const steps:string[]=[];const response=await handleAward(request(payload),record,unit,{snapshot:async()=>snapshot,capture:async(s)=>{assert.deepEqual(s,snapshot);steps.push('capture');return bytes;},retain:async(r,j,u,s,b)=>{assert.deepEqual([r,j,u,s,b],[record,job,unit,snapshot,bytes]);steps.push('retain');},decide:async(input)=>{assert.deepEqual(steps,['capture','retain']);assert.equal(input.p_decision,decision);return decision;}});assert.equal(response.status,200);});
test('does not approve on corrupt copy, failed retention or absent confirmation',async()=>{let called=false;const deps={snapshot:async()=>snapshot,capture:async()=>{throw Error('corrupt');},retain:async()=>{},decide:async()=>{called=true;return decision;}};assert.equal((await handleAward(request(payload),record,unit,deps)).status,409);assert.equal((await handleAward(request({...payload,recipient:false}),record,unit,deps)).status,400);const unavailable=await handleAward(request(payload),record,unit,{...deps,capture:async()=>bytes,retain:async()=>{throw Error('unavailable');}});assert.equal(unavailable.status,503);assert.equal((await unavailable.json()).outcome,'not_sent');assert.equal(called,false);});
test('an interrupted retention never starts an economic decision',async()=>{
 const controller=new AbortController();let decided=false;
 const req=new Request('http://fixture.invalid',{method:'POST',body:JSON.stringify(payload),signal:controller.signal});
 const response=await handleAward(req,record,unit,{snapshot:async()=>snapshot,capture:async()=>bytes,retain:async()=>{controller.abort();},decide:async()=>{decided=true;return decision;}});
 assert.equal(response.status,503);assert.equal((await response.json()).outcome,'not_sent');assert.equal(decided,false);
});
test('rejects a stale event, mismatched hash or noncanonical paths before reading or retaining',async()=>{
 for(const stale of [{...snapshot,population_event:source},{...snapshot,unit_sha256:'b'.repeat(64)},{...snapshot,unit_path:snapshot.document_path},{...snapshot,document_path:`cases/${record}/documents/${doc}/unexpected.pdf` }]){
  let touched=false;
  const response=await handleAward(request(payload),record,unit,{snapshot:async()=>stale,capture:async()=>{touched=true;return bytes;},retain:async()=>{touched=true;},decide:async()=>{touched=true;return decision;}});
  assert.equal(response.status,409);assert.equal(touched,false);
 }
});
test('explains where verification stopped without claiming an unknown outcome',async()=>{
 let called=false;const capture=async()=>bytes,retain=async()=>{};
 const unavailable=await handleAward(request(payload),record,unit,{snapshot:async()=>{throw Error('internal');},capture,retain,decide:async()=>{called=true;return decision;}});
 assert.equal(unavailable.status,503);assert.match((await unavailable.json()).error,/No s’ha enviat cap decisió/);assert.equal(called,false);
 const unverified=await handleAward(request(payload),record,unit,{snapshot:async()=>snapshot,capture:async()=>{throw Error('internal');},retain,decide:async()=>{called=true;return decision;}});
 assert.equal(unverified.status,409);assert.match((await unverified.json()).error,/No s’ha pogut verificar la font/);assert.equal(called,false);
 const uncertain=await handleAward(request(payload),record,unit,{snapshot:async()=>snapshot,capture,retain,decide:async()=>{throw Error('internal');}});
 assert.equal(uncertain.status,503);const message=(await uncertain.json()).error;assert.match(message,/Pot haver-se desat/);assert.doesNotMatch(message,/internal/);
});
test('specific database rejections explain the block while unexpected outcomes remain uncertain',async()=>{
 const deps={snapshot:async()=>snapshot,capture:async()=>bytes,retain:async()=>{}};
 const unbalanced=await handleAward(request(payload),record,unit,{...deps,retain:async()=>{throw {code:'P0001',message:'DIAGNOSTIC_RECONCILIATION'};},decide:async()=>{throw Error('must not be called');}});
 assert.equal(unbalanced.status,409);const unbalancedBody=await unbalanced.json();assert.equal(unbalancedBody.outcome,'not_sent');assert.match(unbalancedBody.error,/imports.*conciliats/);
 const locked=await handleAward(request(payload),record,unit,{...deps,decide:async()=>{throw {code:'55P03'};}});
 assert.equal(locked.status,409);const lockedBody=await locked.json();assert.equal(lockedBody.outcome,'rolled_back');assert.match(lockedBody.error,/Una altra operació/);
 const stale=await handleAward(request(payload),record,unit,{...deps,decide:async()=>{throw {code:'P0001',message:'LINE_STORAGE_STALE'};}});
 assert.equal(stale.status,409);const staleBody=await stale.json();assert.equal(staleBody.outcome,'rolled_back');assert.match(staleBody.error,/còpia.*canviat/);
 const paused=await handleAward(request(payload),record,unit,{...deps,decide:async()=>{throw {code:'P0001',message:'LINE_WRITES_PAUSED'};}});
 assert.equal(paused.status,409);const pausedBody=await paused.json();assert.equal(pausedBody.outcome,'rolled_back');assert.match(pausedBody.error,/temporalment aturades/);
 const unknown=await handleAward(request(payload),record,unit,{...deps,decide:async()=>{throw {code:'P0001',message:'private database details'};}});
 assert.equal(unknown.status,503);const unknownBody=await unknown.json();assert.equal(unknownBody.outcome,'unknown');assert.doesNotMatch(unknownBody.error,/private/);
 const inherited=await handleAward(request(payload),record,unit,{...deps,decide:async()=>{throw {code:'P0001',message:'toString'};}});
 assert.equal(inherited.status,503);assert.equal((await inherited.json()).outcome,'unknown');
});
