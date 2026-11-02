import {test} from 'node:test';import assert from 'node:assert/strict';import {handleAward} from '../lib/concerts/line-award-handler';
const record='11111111-1111-4111-8111-111111111111',unit='22222222-2222-4222-8222-222222222222',job='33333333-3333-4333-8333-333333333333',event='44444444-4444-4444-8444-444444444444',doc='55555555-5555-4555-8555-555555555555',source='66666666-6666-4666-8666-666666666666',item='77777777-7777-4777-8777-777777777777',decision='88888888-8888-4888-8888-888888888888',sha='a'.repeat(64);
const snapshot={document_id:doc,document_path:`cases/${record}/documents/${doc}/${sha}.pdf`,document_sha256:sha,unit_path:`cases/${record}/items/${unit}/documents/${doc}/${sha}.pdf`,unit_sha256:sha,source_object:source,source_version:'1',item_object:item,item_version:'2',population_event:event};
const payload={jobId:job,eventId:event,decisionId:decision,code:'1',amountLiteral:'12.000,00',quote:'cita',reason:'Revisió justificada',reviewer:'Persona',award:true,recipient:true,allocation:true};
const request=(body:unknown)=>new Request('http://fixture.invalid',{method:'POST',body:JSON.stringify(body)});
test('verifies both physical copies before the economic RPC',async()=>{const paths:string[]=[];const response=await handleAward(request(payload),record,unit,{snapshot:async()=>snapshot,verify:async(path)=>{paths.push(path);},decide:async(input)=>{assert.deepEqual(paths,[snapshot.document_path,snapshot.unit_path]);assert.equal(input.p_decision,decision);return decision;}});assert.equal(response.status,200);});
test('does not approve on corrupt copy or absent explicit confirmation',async()=>{let called=false;const deps={snapshot:async()=>snapshot,verify:async()=>{throw Error('corrupt');},decide:async()=>{called=true;return decision;}};assert.equal((await handleAward(request(payload),record,unit,deps)).status,409);assert.equal((await handleAward(request({...payload,recipient:false}),record,unit,deps)).status,400);assert.equal(called,false);});
test('explains where verification stopped without claiming an unknown outcome',async()=>{
 let called=false;
 const unavailable=await handleAward(request(payload),record,unit,{snapshot:async()=>{throw Error('internal');},verify:async()=>{},decide:async()=>{called=true;return decision;}});
 assert.equal(unavailable.status,503);assert.match((await unavailable.json()).error,/No s’ha enviat cap decisió/);assert.equal(called,false);
 const unverified=await handleAward(request(payload),record,unit,{snapshot:async()=>snapshot,verify:async()=>{throw Error('internal');},decide:async()=>{called=true;return decision;}});
 assert.equal(unverified.status,409);assert.match((await unverified.json()).error,/No s’ha pogut verificar la font/);assert.equal(called,false);
 const uncertain=await handleAward(request(payload),record,unit,{snapshot:async()=>snapshot,verify:async()=>{},decide:async()=>{throw Error('internal');}});
 assert.equal(uncertain.status,503);const message=(await uncertain.json()).error;assert.match(message,/Pot haver-se desat/);assert.doesNotMatch(message,/internal/);
});
