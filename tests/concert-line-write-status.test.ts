import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readConcertWriteStatus} from '../lib/concerts/line-write-status';

test('decision availability fails closed when pause status cannot be read',async()=>{
 assert.deepEqual(await readConcertWriteStatus(async()=>({data:{enabled:true},error:null})),{state:'open',reason:null});
 assert.deepEqual(await readConcertWriteStatus(async()=>({data:{enabled:false,reason:'Manteniment'},error:null})),{state:'paused',reason:'Manteniment'});
 for(const data of [null,[],{}, {enabled:'true'}])assert.equal((await readConcertWriteStatus(async()=>({data,error:null}))).state,'unavailable');
 assert.equal((await readConcertWriteStatus(async()=>({data:{enabled:true},error:{message:'unavailable'}}))).state,'unavailable');
 assert.equal((await readConcertWriteStatus(async()=>{throw Error('network');})).state,'unavailable');
});
