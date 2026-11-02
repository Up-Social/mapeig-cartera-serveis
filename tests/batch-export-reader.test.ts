import test from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {readBatchExport} from '../lib/batch-export-reader';

type Row={id:string;source_record_id:string;run_id?:string;status?:string;unit_key?:string;superseded_at?:string|null};
type Table='pipeline_jobs'|'conveni_reviewed_provisions'|'record_units';
const id=(n:number)=>String(n).padStart(5,'0');
function mockDb(tables:Record<Table,Row[]>,fail?:{table:Table;from:number}){
 const requests:Array<{table:Table;from:number;ids:number;ordered:boolean}>=[];
 const db={from(table:Table){
  let rows=tables[table].slice(),from=0,to=0,ids=0,ordered=false;
  const query={
   select(){return query;},
   eq(key:keyof Row,value:unknown){rows=rows.filter(row=>row[key]===value);return query;},
   neq(key:keyof Row,value:unknown){rows=rows.filter(row=>row[key]!==value);return query;},
   is(key:keyof Row,value:unknown){rows=rows.filter(row=>row[key]===value);return query;},
   in(key:keyof Row,values:string[]){ids=values.length;rows=rows.filter(row=>values.includes(String(row[key])));return query;},
   order(key:keyof Row){assert.equal(key,'id');ordered=true;rows.sort((a,b)=>a.id.localeCompare(b.id));return query;},
   range(start:number,end:number){from=start;to=end;return query;},
   returns(){requests.push({table,from,ids,ordered});return Promise.resolve(fail?.table===table&&fail.from===from?{data:null,error:new Error(`failed ${table} page ${from}`)}:{data:rows.slice(from,to+1),error:null});},
  };return query;
 }};
 return {db:db as unknown as SupabaseClient,requests};
}
function fixtures(){
 const jobs=Array.from({length:1205},(_,i)=>({id:`j${id(i)}`,source_record_id:`r${id(i)}`,run_id:'run'}));
 jobs.push({id:'j99999',source_record_id:'r00000',run_id:'run'});
 const provisions:Row[]=Array.from({length:1202},(_,i)=>({id:`p${id(i)}`,source_record_id:'r00000',superseded_at:null}));
 provisions.push({...provisions[100]},{id:'psuperseded',source_record_id:'r00000',superseded_at:'2020-01-01'});
 const units=Array.from({length:1203},(_,i)=>({id:`u${id(i)}`,source_record_id:'r00000',status:'draft',unit_key:`key${i}`}));
 units.push({...units[100]},{id:'ulegacy',source_record_id:'r00000',status:'draft',unit_key:'legacy'},{id:'uapproved',source_record_id:'r00000',status:'approved',unit_key:'key'});
 return {pipeline_jobs:jobs,conveni_reviewed_provisions:provisions,record_units:units};
}
test('pages all jobs, provisions and pending units, groups record IDs and deduplicates identities',async()=>{
 const {db,requests}=mockDb(fixtures());const result=await readBatchExport(db,'run',true);
 assert.equal(result.recordIds.length,1205);assert.equal(result.provisions.length,1202);
 assert.equal(new Set(result.provisions.map(row=>row.id)).size,1202);
 assert.equal(result.pendingCounts.get('r00000'),1203);
 assert.ok(requests.filter(r=>r.table==='pipeline_jobs').some(r=>r.from===1000));
 for(const table of ['conveni_reviewed_provisions','record_units'] as const){
  assert.ok(requests.some(r=>r.table===table&&r.from===1000));
  assert.ok(requests.filter(r=>r.table===table).every(r=>r.ids>0&&r.ids<=100&&r.ordered));
 }
 assert.ok(requests.every(r=>r.ordered));
});
test('a failure on any later page is propagated without returning a partial export',async()=>{
 for(const table of ['pipeline_jobs','conveni_reviewed_provisions','record_units'] as const){
  const {db}=mockDb(fixtures(),{table,from:1000});
  await assert.rejects(readBatchExport(db,'run',true),new RegExp(`failed ${table} page 1000`));
 }
});
test('legacy schema does not query units and an empty batch never sends an empty IN filter',async()=>{
 const {db,requests}=mockDb(fixtures());const result=await readBatchExport(db,'run',false);
 assert.equal(result.pendingCounts.size,0);assert.equal(requests.some(r=>r.table==='record_units'),false);
 const empty=mockDb({pipeline_jobs:[],conveni_reviewed_provisions:[],record_units:[]});
 assert.deepEqual(await readBatchExport(empty.db,'empty',true),{recordIds:[],provisions:[],pendingCounts:new Map()});
 assert.deepEqual(empty.requests.map(r=>r.table),['pipeline_jobs']);
});
