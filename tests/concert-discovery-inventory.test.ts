import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readConcertDiscoveryInventory} from '../lib/concerts/discovery-inventory';

test('Concerts discovery reads all ordered pages before calculating stale records',async()=>{
 const records=Array.from({length:1203},(_,i)=>({id:String(i).padStart(5,'0'),source_record_id:`concert-${i}`}));
 const pages:number[]=[];
 const inventory=await readConcertDiscoveryInventory(async(from,to)=>{pages.push(from);return {data:records.slice(from,to+1),error:null,count:records.length};});
 assert.deepEqual(pages,[0,500,1000]);
 assert.equal(inventory.length,1203);
 const expected=new Set(records.slice(0,1200).map(record=>record.source_record_id));
 assert.deepEqual(inventory.filter(record=>!expected.has(record.source_record_id)),records.slice(1200));
});

test('a failed or malformed later page stops inventory before any partial result is returned',async()=>{
 for(const bad of [{data:null,error:Error('database unavailable'),count:null},{data:null,error:null,count:null}]){
  let calls=0;
  await assert.rejects(readConcertDiscoveryInventory(async()=>{calls++;return calls===1?{data:Array.from({length:500},(_,i)=>({id:String(i).padStart(5,'0'),source_record_id:String(i)})),error:null,count:501}:bad;}),/inventari complet/);
  assert.equal(calls,2);
 }
});


test('rejects a server-capped page, missing count, count drift and repeated ids',async()=>{
 const records=Array.from({length:501},(_,i)=>({id:String(i).padStart(5,'0'),source_record_id:`concert-${i}`}));
 const cases=[
  async()=>({data:records.slice(0,100),error:null,count:501}),
  async()=>({data:records.slice(0,100),error:null,count:null}),
  async(from:number)=>({data:from===0?records.slice(0,500):records.slice(500),error:null,count:from===0?501:502}),
  async(from:number)=>({data:from===0?records.slice(0,500):[records[499]],error:null,count:501}),
 ];
 for(const page of cases)await assert.rejects(readConcertDiscoveryInventory(page),/inventari complet/);
});
