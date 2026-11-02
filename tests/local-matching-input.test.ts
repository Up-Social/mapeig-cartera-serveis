import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {captureLocalMatchingInput,verifyLocalMatchingInput} from '../lib/pipeline/local-matching-input';

const service={version_id:'catalog',service_code:'1',service_name:'Service',parent_code:null,benefit_type:'service',description:'Description',target_population:'People',conditions:'Conditions',legal_reference:'Law',normative_fields:{}};
const version={id:'catalog',active:true,validated:true,entry_count:1,general_context:'Context'};
const source={id:'source',financing_type:'contractacio',source_dataset:'contractacions',source_record_id:'ext',mechanism:'Contract',title:'Title',provider_name:null,amount:null,source_payload:{a:1},deduplication_key:'key',record_enrichments:null};
const document={id:'document',url:'https://example.invalid',document_type:'publication',status:'fetched',mime_type:'application/pdf',text_length:400,extraction_method:'pdf-text',extraction_coverage:null,quality_flags:[],extraction_partial:false,active_extraction_id:'extract',storage_path:null,storage_sha256:null,extracted_text_hash:null};
const evidence={id:'chunk',source_document_id:'document',ordinal:0,content:'Synthetic evidence'};
function fixture(){
 let verification:string|null='local-matching-input-v1:'+ 'a'.repeat(64);let expected:Record<string,unknown>|null=null;const reads:string[]=[];
 const db={from(table:string){reads.push(table);
  const q={select(){return q;},eq(){return q;},in(){return q;},order(){return q;},limit(){return q;},single:async()=>({data:table==='source_records'?structuredClone(source):structuredClone(version),error:null}),
   range:async()=>({data:table==='source_documents'?[structuredClone(document)]:[structuredClone(evidence)],error:null}),
   then(resolve:(v:unknown)=>void){resolve({data:[structuredClone(service)],error:null});}};return q;},
  async rpc(name:string,args:Record<string,unknown>){assert.equal(name,'local_verify_matching_input');expected=args.p_expected as Record<string,unknown>;return {data:verification,error:null};}} as unknown as SupabaseClient;
 return {db,reads,expected:()=>expected,respond:(v:string|null)=>{verification=v;}};
}

test('capture reads complete inputs, fixes them in memory, and revalidates the same fingerprint',async()=>{
 const f=fixture();const capture=await captureLocalMatchingInput(f.db,{id:'job',run_id:'run',source_record_id:'source'});
 assert.equal(capture.fingerprint,'local-matching-input-v1:'+ 'a'.repeat(64));assert.equal(Object.isFrozen(capture),true);assert.equal(Object.isFrozen(capture.evidence[0]),true);
 assert.deepEqual(f.reads,['source_records','catalog_versions','official_services','source_documents','current_evidence_chunks']);
 assert.equal((f.expected()!.source as Record<string,unknown>).deduplication_key,'key');
 assert.equal((f.expected()!.documents as Array<Record<string,unknown>>)[0].document_type,'publication');
 assert.match(String((f.expected()!.chunks as Array<Record<string,unknown>>)[0].content_sha256),/^[0-9a-f]{64}$/);
 assert.equal('content' in (f.expected()!.chunks as Array<Record<string,unknown>>)[0],false);
 await verifyLocalMatchingInput(f.db,capture);
 f.respond(null);await assert.rejects(verifyLocalMatchingInput(f.db,capture),/LOCAL_TYPE_BLOCKED/);
});

test('missing or changed DB capture blocks before any provider call',async()=>{
 const f=fixture();f.respond(null);let calls=0;
 await assert.rejects(async()=>{await captureLocalMatchingInput(f.db,{id:'job',run_id:'run',source_record_id:'source'});calls++;},/LOCAL_TYPE_BLOCKED/);
 assert.equal(calls,0);
});
