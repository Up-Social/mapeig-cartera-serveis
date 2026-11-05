import test from 'node:test';
import assert from 'node:assert/strict';
import {ConveniFailure,processConveni} from '../lib/convenis/process';

test('an unavailable annex past the default page limit blocks the Conveni before a provider call',async()=>{
 const documents=Array.from({length:1001},(_,i)=>({id:String(i).padStart(4,'0'),url:`https://example.invalid/${i}`,status:i===1000?'failed':'fetched',document_type:i===0?'agreement':'annex',extracted_text:'Text documental de prova',extraction_partial:false,extraction_method:'pdftotext',extraction_coverage:null,mime_type:'application/pdf',quality_flags:[],storage_path:`cases/record/documents/${i}/hash.pdf`,storage_sha256:'hash',active_extraction_id:null}));
 const service={service_code:'1',service_name:'Servei',parent_code:null,benefit_type:'service',description:'Descripció',target_population:'Persones',conditions:'Condicions',legal_reference:'Norma'};
 let providerCalls=0;const ranges:number[]=[];
 const db={rpc(name:string){return Promise.resolve({data:name==='screen_conveni_v2'?false:'hash',error:null});},from(table:string){
  const query={select(){return query;},eq(){return query;},in(){return query;},order(){return query;},single(){return Promise.resolve({data:table==='source_records'?{id:'record',financing_type:'conveni',title:'Conveni de prova',source_payload:{}}:{id:'version',entry_count:1},error:null});},limit(){return Promise.resolve({data:[service],error:null});},range(from:number,to:number){ranges.push(from);return Promise.resolve({data:documents.slice(from,to+1),error:null});}};
  return query;
 }};
 await assert.rejects(processConveni(db as never,{id:'job',source_record_id:'record'},async()=>{providerCalls++;return {}; }),(error:unknown)=>error instanceof ConveniFailure&&error.code==='COVERAGE_INCOMPLETE');
 assert.deepEqual(ranges,[0,500,1000]);assert.equal(providerCalls,0);
});

test('unknown partial status or missing archived path blocks Conveni before provider work',async()=>{
 const base={id:'doc',url:'https://example.invalid/0',status:'fetched',document_type:'agreement',extracted_text:'Text documental de prova',extraction_partial:false as boolean|null,extraction_method:'pdftotext',extraction_coverage:null as {complete:boolean}|null,mime_type:'application/pdf',quality_flags:[],storage_path:'cases/record/documents/doc/hash.pdf' as string|null,storage_sha256:'hash',active_extraction_id:null};
 const service={service_code:'1',service_name:'Servei',parent_code:null,benefit_type:'service',description:'Descripció',target_population:'Persones',conditions:'Condicions',legal_reference:'Norma'};
 for(const patch of [{extraction_partial:null},{extraction_partial:true},{storage_path:null},{extraction_coverage:{complete:false}}]){
  let calls=0;const documents=[{...base,...patch}];
  const db={rpc(name:string){return Promise.resolve({data:name==='screen_conveni_v2'?false:'hash',error:null});},from(table:string){
   const query={select(){return query;},eq(){return query;},in(){return query;},order(){return query;},single(){return Promise.resolve({data:table==='source_records'?{id:'record',financing_type:'conveni',title:'Conveni de prova',source_payload:{}}:{id:'version',entry_count:1},error:null});},limit(){return Promise.resolve({data:[service],error:null});},range(from:number,to:number){return Promise.resolve({data:documents.slice(from,to+1),error:null});}};return query;
  }};
  await assert.rejects(processConveni(db as never,{id:'job',source_record_id:'record'},async()=>{calls++;return {};}),(error:unknown)=>error instanceof ConveniFailure&&error.code==='COVERAGE_INCOMPLETE');
  assert.equal(calls,0,JSON.stringify(patch));
 }
});

test('a PDF without reliable page attribution stops before the provider request',async()=>{
 const document={id:'doc',url:'https://example.invalid/0',status:'fetched',document_type:'agreement',
  extracted_text:'Un document sintètic amb text en pàgines desconegudes.',extraction_partial:false,
  extraction_method:'pdftotext',extraction_coverage:null,mime_type:'application/pdf',quality_flags:[],
  storage_path:'cases/record/documents/doc/hash.pdf',storage_sha256:'hash',active_extraction_id:null};
 const service={service_code:'1',service_name:'Servei',parent_code:null,benefit_type:'service',description:'Descripció',target_population:'Persones',conditions:'Condicions',legal_reference:'Norma'};
 let calls=0;
 const db={rpc(name:string){return Promise.resolve({data:name==='screen_conveni_v2'?false:'hash',error:null});},from(table:string){
  const query={select(){return query;},eq(){return query;},in(){return query;},order(){return query;},
   single(){return Promise.resolve({data:table==='source_records'?{id:'record',financing_type:'conveni',title:'Conveni de prova',source_payload:{}}:{id:'version',entry_count:1},error:null});},
   limit(){return Promise.resolve({data:[service],error:null});},range(from:number,to:number){return Promise.resolve({data:[document].slice(from,to+1),error:null});}};
  return query;
 }};
 await assert.rejects(processConveni(db as never,{id:'job',source_record_id:'record'},async()=>{calls++;return {}; }),
  (error:unknown)=>error instanceof ConveniFailure&&error.code==='PAGE_COVERAGE_UNCERTAIN');
 assert.equal(calls,0);
});
