import test from 'node:test';
import assert from 'node:assert/strict';
import {purgeTargets} from '../lib/storage-purge';
test('purge is complete only after absence is verified; retries are idempotent',async()=>{
 const target={id:'1',bucket:'cloud-documents',path:'fixture'};let exists=true;let recorded=false;
 const record=async(_id:string,complete:boolean)=>{recorded=complete;};
 let result=await purgeTargets([target],{remove:async()=>{},exists:async()=>exists,record});assert.equal(result.pending,1);assert.equal(recorded,false);
 result=await purgeTargets([target],{remove:async()=>{exists=false;},exists:async()=>exists,record});assert.equal(result.complete,true);assert.equal(recorded,true);
 result=await purgeTargets([target],{remove:async()=>{},exists:async()=>exists,record});assert.equal(result.complete,true);
 result=await purgeTargets([target],{remove:async()=>{throw Error('storage unavailable');},exists:async()=>exists,record});assert.equal(result.pending,1);assert.equal(recorded,false);
});
