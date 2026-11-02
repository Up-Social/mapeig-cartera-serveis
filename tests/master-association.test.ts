import test from 'node:test';
import assert from 'node:assert/strict';
import {groupByMasterCode,legacyMasterKey} from '../lib/master-association';
import {readAllPages} from '../lib/paginated-query';

test('modern master FK is historical_master_code, not the official service code',()=>{
 const rows=[
  {id:'one',historical_master_code:'master-A',service_code:'official-B'},
  {id:'two',historical_master_code:'master-B',service_code:'master-A'},
 ];
 const grouped=groupByMasterCode(['master-A','master-B'],rows,'historical_master_code');
 assert.deepEqual(grouped.get('master-A')?.map(row=>row.id),['one']);
 assert.deepEqual(grouped.get('master-B')?.map(row=>row.id),['two']);
});

test('legacy probing distinguishes an existing historical FK from the original service-code FK',()=>{
 assert.equal(legacyMasterKey(null),'historical_master_code');
 assert.equal(legacyMasterKey({code:'42703'}),'service_code');
 assert.equal(legacyMasterKey({code:'PGRST204'}),'service_code');
 const error={code:'PGRST301'};assert.throws(()=>legacyMasterKey(error),value=>value===error);
 const rows=[{id:'legacy',service_code:'A'}];
 assert.deepEqual(groupByMasterCode(['A'],rows,'service_code').get('A'),rows);
});

test('all paginated associations remain assigned to their own master codes',async()=>{
 const rows=Array.from({length:1207},(_,i)=>({id:String(i).padStart(5,'0'),historical_master_code:i%2?'A':'B'}));
 const loaded=await readAllPages(async(from,to)=>({data:rows.slice(from,to+1),error:null}));
 const groups=groupByMasterCode(['A','B'],loaded,'historical_master_code');
 assert.equal(groups.get('A')?.length,603);assert.equal(groups.get('B')?.length,604);
 assert.ok(groups.get('A')?.every(row=>row.historical_master_code==='A'));
 assert.throws(()=>groupByMasterCode(['A'],[{historical_master_code:'B'}],'historical_master_code'));
 assert.throws(()=>groupByMasterCode(['A'],[{}],'historical_master_code'));
});
