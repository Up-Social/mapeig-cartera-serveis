import test from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {loadConcertEvolution} from '../lib/concerts/evolution-store';
import {concertEvolution,type EconomicUnit,type EconomicReview,type EconomicLink} from '../lib/concerts/evolution';
const unit=(id:string,record:string,document:string|null,act='award'):EconomicUnit=>({id,source_record_id:record,document_id:document,unit_key:`line-${id}`,act_type:act,status:'approved',source_fingerprint:`fp-${id}`,provider_name:'Entitat',observed_provider_name:null,provider_nif:'G12345678',reses_code:'S01150',service_code:'1.2.3',observed_service_code:'1.2.3',territory:'Barcelona',period:'2024',amount:1000,effective_start:null,effective_end:null,horizon_state:'in_scope',page:1,storage_path:`cases/${id}`,storage_sha256:`hash-${id}`,evidence_quote:`Passatge de la línia ${id}`});
const review=(id:string,job:string,operation:'award'|'delta',amount:number):EconomicReview=>({unit_id:id,version:1,status:'approved',source_fingerprint:`fp-${id}`,expected_job_id:job,operation,amount_cents:amount,amount_kind:'exact',period_start:'2024-01-01',period_end:'2024-12-31',effective_at:operation==='award'?'2024-01-01':'2024-02-01',funder:'Administració',corrects_unit_id:null,evidence_quote:'Passatge literal del document',review_note:'Revisió documentada'});
const link: EconomicLink={id:'link',later_unit_id:'out',earlier_unit_id:'base',root_unit_id:'base',status:'confirmed',version:1,evidence:'Cita de la resolució anterior',relation_kind:'modification',review_note:'Confirmat'};
type Row=Record<string,unknown>;
function mockDb(tables:Record<string,Row[]>){
 const requests:Array<{table:string;from:number}>=[];
 const db={rpc:async()=>({data:false,error:null}),from(table:string){
  let rows=[...(tables[table]??[])];
  const query={select(){return query;},order(key:string,options?:{ascending?:boolean}){rows.sort((a,b)=>String(a[key]??'').localeCompare(String(b[key]??''))*(options?.ascending===false?-1:1));return query;},
   in(key:string,values:unknown[]){rows=rows.filter(row=>values.includes(row[key]));return query;},
   eq(key:string,value:unknown){rows=rows.filter(row=>(row[key]??false)===value);return query;},
   range(from:number,to:number){requests.push({table,from});return Promise.resolve({data:rows.slice(from,to+1),error:null});},
   then(resolve:(value:unknown)=>unknown,reject:(reason:unknown)=>unknown){return Promise.resolve({data:rows,error:null}).then(resolve,reject);}};
  return query;
 }};return {db:db as unknown as SupabaseClient,requests};
}
test('a call reference never becomes a missing economic movement',async()=>{
 const base=unit('base','call-record','base-doc');
 const links=[{id:'call-link',earlier_record_id:'call-record',later_record_id:'award-record',evidence:'Convocatòria documentada',status:'candidate',link_kind:'call'},
  {id:'change-link',earlier_record_id:'call-record',later_record_id:'change-record',evidence:'Canvi documentat',status:'candidate',link_kind:'modification'}];
 const {db}=mockDb({concert_economic_source:[base as unknown as Row],concert_unit_links:[],concert_record_links:links,
  concert_economic_reviews:[review('base','job-base','award',100000) as unknown as Row],source_documents:[],
  source_records:[{id:'call-record',title:'Resolució',source_payload:{}}],pipeline_jobs:[{id:'job-base',source_record_id:'call-record',status:'approved',verification_only:false,created_at:'2024-01-01'},{id:'verification',source_record_id:'call-record',status:'needs_review',verification_only:true,created_at:'2025-01-01'}]});
 const result=await loadConcertEvolution(db,'call-record');
 assert.deepEqual(result.missingLines?.map(link=>link.later_record_id),['change-record']);
 assert.equal(result.publications[0]?.job_id,'job-base');
});
test('a related amendment with an unlinked or candidate line keeps the original balance pending',async()=>{
 for(const unitLinkStatus of ['none','candidate','confirmed'] as const){
  const base=unit('base','base-record','base-doc'),amendment=unit('change','amendment-record','amendment-doc','amendment');
  const unitLinks=unitLinkStatus==='none'?[]:[{...link,id:'amendment-link',later_unit_id:'change',status:unitLinkStatus}];
  const {db}=mockDb({concert_economic_source:[base,amendment] as unknown as Row[],concert_unit_links:unitLinks as unknown as Row[],
   concert_record_links:[{id:'record-link',earlier_record_id:'base-record',later_record_id:'amendment-record',evidence:'Esmena candidata',status:'candidate',link_kind:'amendment'}],
   concert_economic_reviews:[review('base','job-base','award',100000) as unknown as Row],source_documents:[],
   source_records:[{id:'base-record',title:'Resolució',source_payload:{}},{id:'amendment-record',title:'Esmena',source_payload:{}}],
   pipeline_jobs:[{id:'job-base',source_record_id:'base-record',status:'approved',verification_only:false,created_at:'2024-01-01'}]});
  const scoped=await loadConcertEvolution(db,'base-record');
  const global=await loadConcertEvolution(db);
  for(const current of [scoped,global]){
   const balance=concertEvolution(current,'2024-12-31').balances.find(value=>value.rootIds.includes('base'));
   assert.equal(balance?.amountCents,null,unitLinkStatus);
   if(unitLinkStatus!=='confirmed')assert.equal(current.missingLines?.length,1,unitLinkStatus);
  }
 }
});
test('a later line known outside the horizon does not block the original balance',async()=>{
 const base=unit('base','base-record','base-doc'),outside={...unit('change','amendment-record','amendment-doc','amendment'),horizon_state:'out_of_scope'};
 const {db}=mockDb({concert_economic_source:[base,outside] as unknown as Row[],concert_unit_links:[],
  concert_record_links:[{id:'record-link',earlier_record_id:'base-record',later_record_id:'amendment-record',evidence:'Esmena',status:'candidate',link_kind:'amendment'}],
  concert_economic_reviews:[review('base','job-base','award',100000) as unknown as Row],source_documents:[],
  source_records:[{id:'base-record',title:'Resolució',source_payload:{}}],pipeline_jobs:[{id:'job-base',source_record_id:'base-record',status:'approved',verification_only:false,created_at:'2024-01-01'}]});
 const scoped=await loadConcertEvolution(db,'base-record');
 assert.equal(scoped.missingLines?.length,0);
 assert.equal(concertEvolution(scoped,'2024-12-31').balances[0]?.amountCents,100000);
});
test('a link to a rejected or out-of-horizon predecessor cannot resolve an amendment',async()=>{
 for(const patch of [{status:'rejected'},{horizon_state:'out_of_scope'},{status:'draft'}]){
  const base=unit('base','base-record','base-doc'),invalid={...unit('invalid','base-record','base-doc'),...patch};
  const amendment=unit('change','amendment-record','amendment-doc','amendment');
  const {db}=mockDb({concert_economic_source:[base,invalid,amendment] as unknown as Row[],
   concert_unit_links:[{...link,id:'invalid-link',later_unit_id:'change',earlier_unit_id:'invalid'}] as unknown as Row[],
   concert_record_links:[{id:'record-link',earlier_record_id:'base-record',later_record_id:'amendment-record',evidence:'Esmena',status:'candidate',link_kind:'amendment'}],
   concert_economic_reviews:[review('base','job-base','award',100000) as unknown as Row],source_documents:[],
   source_records:[{id:'base-record',title:'Resolució',source_payload:{}},{id:'amendment-record',title:'Esmena',source_payload:{}}],
   pipeline_jobs:[{id:'job-base',source_record_id:'base-record',status:'approved',verification_only:false,created_at:'2024-01-01'}]});
  const result=await loadConcertEvolution(db,'base-record');
  assert.equal(result.missingLines?.length,1);
  assert.equal(concertEvolution(result,'2024-12-31').balances.find(b=>b.rootIds.includes('base'))?.amountCents,null);
 }
});
test('record and global projections include an unlinked sibling, including one without document identity',async()=>{
 for(const missingDocument of [false,true]){
  const base=unit('base','base-record','base-doc'),out=unit('out','transfer','transfer-doc','modification'),incoming=unit('incoming','transfer',missingDocument?null:'transfer-doc','modification');
  const unrelated=Array.from({length:1002},(_,i)=>unit(`unrelated-${String(i).padStart(4,'0')}`,`other-${i}`,`other-doc-${i}`));
  const units=[base,out,incoming,...unrelated];
  const records=[...new Set(units.map(u=>u.source_record_id))].map(id=>({id,title:'Resolució',source_payload:{}}));
  const jobs=records.map(r=>({id:r.id==='base-record'?'job-base':r.id==='transfer'?'job-transfer':`job-${r.id}`,source_record_id:r.id,status:'approved',created_at:'2024-01-01'}));
  const documents=[...new Set(units.map(u=>u.document_id).filter((v):v is string=>!!v))].map(id=>({id,extracted_text:null,extracted_text_hash:null,extraction_partial:false,status:'fetched',quality_flags:[]}));
  const {db,requests}=mockDb({concert_economic_source:units as unknown as Row[],concert_unit_links:[link] as unknown as Row[],concert_record_links:[],concert_economic_reviews:[review('base','job-base','award',100000),review('out','job-transfer','delta',-30000),review('incoming','job-transfer','delta',30000)] as unknown as Row[],source_documents:documents,source_records:records,pipeline_jobs:jobs});
  const scoped=await loadConcertEvolution(db,'base-record');
  assert.deepEqual(scoped.units.map(u=>u.id).sort(),['base','incoming','out']);
  const global=await loadConcertEvolution(db);
  const one=concertEvolution(scoped,'2024-12-31'),all=concertEvolution(global,'2024-12-31');
  assert.equal(one.balances.find(b=>b.rootIds.includes('base'))?.amountCents,null);
  assert.equal(all.balances.find(b=>b.rootIds.includes('base'))?.amountCents,null);
  assert.equal(one.individualBalances.find(b=>b.rootId==='base')?.amountCents,70000);
  assert.ok(requests.some(r=>r.table==='concert_economic_source'&&r.from===1000));
 }
});
