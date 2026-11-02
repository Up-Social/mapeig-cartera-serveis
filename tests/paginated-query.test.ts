import test from 'node:test';
import assert from 'node:assert/strict';
import {chunks,readAllPages} from '../lib/paginated-query';

test('page through all records beyond the PostgREST response limit in stable order',async()=>{
 const source=Array.from({length:1201},(_,i)=>({id:String(i).padStart(5,'0')}));
 const ranges:Array<[number,number]>=[];
 const rows=await readAllPages(async(from,to)=>{ranges.push([from,to]);return {data:source.slice(from,to+1),error:null};});
 assert.deepEqual(ranges,[[0,499],[500,999],[1000,1499]]);
 assert.deepEqual(rows,source);
});

test('batch blocks keep each current row associated to its own selected record',async()=>{
 const selected=Array.from({length:205},(_,i)=>`record-${i}`);
 const source=selected.flatMap((id,i)=>[{id:`${id}-old`,source_record_id:id,current:false},{id:`${id}-new`,source_record_id:id,current:true},...(i===0?Array.from({length:1002},(_,j)=>({id:`${id}-${j}`,source_record_id:id,current:true})):[])]);
 const byRecord=new Map<string,string[]>();
 for(const block of chunks(selected,100)){
  // Mirrors a query whose validity filter is applied before pagination.
  const filtered=source.filter(row=>block.includes(row.source_record_id)&&row.current).sort((a,b)=>a.id.localeCompare(b.id));
  const rows=await readAllPages(async(from,to)=>({data:filtered.slice(from,to+1),error:null}));
  for(const row of rows)byRecord.set(row.source_record_id,[...(byRecord.get(row.source_record_id)??[]),row.id]);
 }
 assert.equal(byRecord.size,205);assert.equal(byRecord.get('record-0')?.length,1003);
 assert.deepEqual(byRecord.get('record-204'),['record-204-new']);
 assert.ok([...byRecord.values()].flat().every(id=>!id.endsWith('-old')));
});

test('an error or missing page fails closed and never returns a partial result',async()=>{
 await assert.rejects(()=>readAllPages(async(from)=>from===0?{data:[1,2],error:null}:{data:null,error:new Error('network')},2),/network/);
 await assert.rejects(()=>readAllPages(async()=>({data:null,error:null})),/pàgina vàlida/);
 await assert.rejects(()=>readAllPages(async()=>({data:[],error:null}),0),/Mida de pàgina invàlida/);
 assert.throws(()=>chunks([1],0));
});
