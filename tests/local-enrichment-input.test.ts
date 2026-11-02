import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {loadLocalEnrichmentInput} from '../lib/pipeline/local-enrichment-input';
import {isLocalTypeBlocked} from '../lib/pipeline/local-matching-guard';
import {localEnrichmentSnapshot} from '../lib/pipeline/local-enrichment-commit';

function fixture(failure?:'documents'|'evidence'){
 const documents=Array.from({length:1001},(_,i)=>({id:String(i).padStart(4,'0'),status:i===1000?'failed':'fetched',url:`https://example.invalid/${i}`}));
 const effects={writes:0,provider:0,evidenceReads:0,ranges:[] as number[],order:[] as string[]};
 const db={rpc(){effects.writes++;throw Error('unexpected write');},from(table:string){let ids:string[]=[];const query={
  select(){return query;},eq(){return query;},order(field:string){if(table==='source_documents')effects.order.push(field);return query;},
  in(_field:string,value:string[]){ids=value;return query;},
  single(){return Promise.resolve({data:{id:'record',financing_type:'contractacio',source_payload:{}},error:null});},
  range(from:number,to:number){
   if(table==='source_documents'){
    effects.ranges.push(from);
    return Promise.resolve(failure==='documents'&&from===1000?{data:null,error:Error('page failed')}:{data:documents.slice(from,to+1),error:null});
   }
   if(table==='current_evidence_chunks'){
    effects.evidenceReads++;
    if(failure==='evidence')return Promise.resolve({data:null,error:Error('evidence failed')});
    return Promise.resolve({data:ids.includes('0000')?[{id:'chunk',source_document_id:'0000',ordinal:0,content:'official evidence'}]:[],error:null});
   }
   throw Error('unexpected read');
  }};return query;}} as unknown as SupabaseClient;
 return {db,documents,effects};
}

test('local enrichment captures all 1001 documents and evidence before constructing its snapshot',async()=>{
 const {db,effects}=fixture(),input=await loadLocalEnrichmentInput(db,'record');
 assert.equal(input.documents.length,1001);assert.equal(input.documents[1000].status,'failed');
 assert.deepEqual(effects.ranges,[0,500,1000]);assert.ok(effects.order.every(field=>field==='id'));
 assert.equal(input.evidence.length,1);assert.equal(localEnrichmentSnapshot(input.record,input.documents,input.evidence).documents.length,1001);
 assert.equal(effects.writes,0);
});

test('a failed document or evidence page stops before the intent, provider and result writes',async()=>{
 for(const failure of ['documents','evidence'] as const){
  const {db,effects}=fixture(failure);
  await assert.rejects(async()=>{await loadLocalEnrichmentInput(db,'record');effects.writes++;effects.provider++;},isLocalTypeBlocked);
  assert.equal(effects.writes,0);assert.equal(effects.provider,0);
  if(failure==='documents')assert.equal(effects.evidenceReads,0);
 }
});
