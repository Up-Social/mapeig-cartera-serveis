import {test} from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {handleIsolatedExport} from '../lib/concerts/line-export-handler';import type {FrozenLine} from '../lib/concerts/line-export';
const id='10000000-0000-4000-8000-000000000001';
const snapshot={source_id:'fixture',call_url:null,regulatory_basis_url:null,provider_name:'Entitat',provider_nif:null,mechanism:'Concert',award_date:null,amount:12000,contracting_body:null,target_population:null,source_reference:'fixture',service_code:'1',service_name:'1'};
const req=()=>new Request('http://fixture.invalid/',{method:'POST',body:JSON.stringify({ids:[id]})});
test('handler binds receipt to returned XLSX and does not trust caller rows',async()=>{
 let hash='';const res=await handleIsolatedExport(req(),{read:async()=>[{decision_id:id,snapshot}] as FrozenLine[],commit:async(_id,h)=>{hash=h;}});
 assert.equal(res.status,200);assert.equal(createHash('sha256').update(Buffer.from(await res.arrayBuffer())).digest('hex'),hash);
});
test('stale receipt fails without returning XLSX',async()=>{
 const res=await handleIsolatedExport(req(),{read:async()=>[{decision_id:id,snapshot}] as FrozenLine[],commit:async()=>{throw {code:'40001'};}});
 assert.equal(res.status,409);assert.match(res.headers.get('content-type')??'',/application\/json/);
});
test('missing selected line fails before committing',async()=>{
 let called=false;const res=await handleIsolatedExport(req(),{read:async()=>[],commit:async()=>{called=true;}});assert.equal(res.status,409);assert.equal(called,false);
});
