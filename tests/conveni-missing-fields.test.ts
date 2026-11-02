import test from 'node:test';
import assert from 'node:assert/strict';
import {validateConveni,type ConveniAnalysis,type ConveniUnit} from '../lib/convenis/contract';
import {ConveniValidationError} from '../lib/convenis/diagnostics';
import {ConveniFailure,processConveni,assertConveniDiscardsReviewed} from '../lib/convenis/process';
import {CloudFailure,failureMessage} from '../lib/cloud/errors';

const quote='La Fundació rep una aportació per al servei a persones grans.';
const evidence=[{document_id:'doc',page:1,quote}];
const documents=[{id:'doc',storage_sha256:'hash',extracted_text:`## Pàgina 1\n${quote}`}];
const payload={'Total aportacions previstes Generalitat':100,'Total aportacions previstes ens locals':0};
const unit:ConveniUnit={key:'',recipient:'Fundació',recipient_nif:null,recipient_nature:'unknown',joint:false,period:'2025',year:2025,amount_cents:10000,amount_state:'planned',mixed:false,financiers:[],territory:null,classification:'in_portfolio',service_code:'1.1',population:'Persones grans',description:'Servei',explanation:'Proposta',reason:null,evidence,blockers:[]};
const analysis=(units:ConveniUnit[]):ConveniAnalysis=>({actors:[],units,instrument_grant:false,coverage_complete:true,unallocated_cents:0,summary:'Proposta'});
const validate=(units:ConveniUnit[])=>validateConveni(analysis(units),payload,documents,new Set(['1.1']));

test('missing recipient and period produce separate actionable incidence diagnostics without inventing a unit',()=>{
 const proposal={...unit,recipient:'  ',period:'',population:'',description:''};
 assert.throws(()=>validate([proposal]),(error:unknown)=>{
  assert.ok(error instanceof ConveniValidationError);
  assert.deepEqual(error.diagnostics.map(item=>item.code),['CONVENI_RECIPIENT_MISSING','CONVENI_PERIOD_MISSING','CONVENI_POPULATION_MISSING','CONVENI_DESCRIPTION_MISSING','CONVENI_PROPOSAL_NIF_UNIDENTIFIED']);
  assert.match(error.message,/receptor.*proposta.*pendent/);
  assert.deepEqual(error.diagnostics.map(item=>item.field),['recipient','period','population','description','recipient_nif']);
  return true;
 });
 assert.equal(proposal.recipient,'  ');assert.equal(proposal.period,'');assert.equal(proposal.classification,'in_portfolio');
});

test('missing population and description prevent unsupported positive classification with named diagnostics',()=>{
 for(const classification of ['in_portfolio','out_of_portfolio'] as const){
  const proposal={...unit,classification,service_code:classification==='in_portfolio'?'1.1':null,population:'',description:'  '};
  assert.throws(()=>validate([proposal]),(error:unknown)=>error instanceof ConveniValidationError&&error.diagnostics[0].code==='CONVENI_POPULATION_MISSING'&&error.diagnostics[1].code==='CONVENI_DESCRIPTION_MISSING');
 }
});

test('missing facts in an insufficient proposal remain pending without changing replay payloads',()=>{
 const proposal={...unit,classification:'insufficient_evidence' as const,service_code:null,population:'',description:'',amount_cents:null};
 const result=validate([proposal]);
 assert.equal(result.units[0].classification,'insufficient_evidence');assert.equal(result.units[0].reason,null);
 assert.equal(result.units[0].amount_cents,null);assert.ok(result.units[0].blockers.includes('missing_amount'));
 assert.equal(result.diagnostics,undefined);assert.equal(result.units[0].population,'');assert.equal(result.units[0].description,'');
});

test('unverifiable citations retain priority while missing facts and funding diagnostics remain visible',()=>{
 const proposal={...unit,period:'',population:'',evidence:[{...evidence[0],page:2}],amount_cents:null};
 assert.throws(()=>validate([proposal]),(error:unknown)=>{
  assert.ok(error instanceof ConveniValidationError);assert.equal(error.diagnostic.code,'CONVENI_CITATION_UNVERIFIABLE');
  for(const code of ['CONVENI_PERIOD_MISSING','CONVENI_POPULATION_MISSING','CONVENI_AMOUNT_UNRESOLVED'])assert.ok(error.diagnostics.some(item=>item.code===code));
  return true;
 });
});

test('an independently documented exclusion is not inferred from missing population',()=>{
 const proposal={...unit,classification:'discarded' as const,service_code:null,population:'',description:'',reason:'excluded_amendment'};
 const result=validate([proposal]);
 assert.equal(result.units[0].reason,'excluded_amendment');assert.equal(result.units[0].classification,'discarded');
 assert.equal(result.units[0].population,'');assert.equal(result.diagnostics,undefined);
});

test('pipeline reports a missing period as an incidence without persisting a fabricated unit',async()=>{
 const text='La Fundació Sintètica rep una aportació pública per a un servei social a persones grans.';
 const doc={id:'doc',url:'https://fixture.invalid/doc',status:'fetched',document_type:'agreement',extracted_text:`## Pàgina 1\n${text}`,extraction_partial:false,extraction_method:'html-basic',extraction_coverage:{policy:'html-text-coverage-v1',complete:true},mime_type:'text/plain',quality_flags:[],storage_path:'cases/record/documents/doc/digest.txt',storage_sha256:'digest',active_extraction_id:'extraction'};
 const service={version_id:'v',service_code:'1',service_name:'Servei',parent_code:null,benefit_type:'service',description:'Descripció',target_population:'Persones',conditions:'Condicions',legal_reference:'Norma',normative_fields:{}};
 let commits=0;
 const db={rpc:async(name:string)=>{if(name==='screen_conveni')return {data:false,error:null};if(name==='conveni_source_hash')return {data:'hash',error:null};if(name==='persist_conveni')commits++;return {data:true,error:null};},from:(table:string)=>{
  const q={select:()=>q,eq:()=>q,in:()=>q,order:()=>q,single:async()=>({data:table==='source_records'?{id:'record',financing_type:'conveni',title:'Conveni sintètic',source_payload:payload}:{id:'v',entry_count:1,general_context:''},error:null}),range:async()=>({data:[doc],error:null}),limit:async()=>({data:[service],error:null})};return q;
 }};
 const answer={actors:[],instrument_grant:false,coverage_complete:true,unallocated_cents:0,summary:'Proposta',units:[{recipient:'Fundació Sintètica',recipient_nif:null,recipient_nature:'unknown',joint:false,period:'',year:null,amount_cents:10000,amount_state:'planned',mixed:false,financiers:[],territory:null,classification:'insufficient_evidence',service_ref:null,social_assessment:{status:'uncertain',explanation:'Pendent',evidence:['Q1']},population:'',description:'',explanation:'Pendent',reason:null,evidence:['Q1']}]};
 await assert.rejects(processConveni(db as never,{id:'job',source_record_id:'record'},async()=>({output_text:JSON.stringify(answer)})),(error:unknown)=>{
  assert.ok(error instanceof ConveniFailure);assert.equal(error.kind,'validation');assert.equal(error.code,'CONVENI_PERIOD_MISSING');
  assert.ok(error.diagnostics?.some(item=>item.code==='CONVENI_POPULATION_MISSING'));
  return true;
 });
 assert.equal(commits,0);
});

test('pipeline leaves a structured missing-NIF discard as an incidence without persisting it',async()=>{
 const text='La Fundació Sintètica rep una aportació pública per a un servei social a persones grans.';
 const doc={id:'doc',url:'https://fixture.invalid/doc',status:'fetched',document_type:'agreement',extracted_text:`## Pàgina 1\n${text}`,extraction_partial:false,extraction_method:'html-basic',extraction_coverage:{policy:'html-text-coverage-v1',complete:true},mime_type:'text/plain',quality_flags:[],storage_path:'cases/record/documents/doc/digest.txt',storage_sha256:'digest',active_extraction_id:'extraction'};
 const service={version_id:'v',service_code:'1',service_name:'Servei',parent_code:null,benefit_type:'service',description:'Descripció',target_population:'Persones',conditions:'Condicions',legal_reference:'Norma',normative_fields:{}};
 let commits=0;
 const db={rpc:async(name:string)=>{if(name==='screen_conveni')return {data:false,error:null};if(name==='conveni_source_hash')return {data:'hash',error:null};if(name==='persist_conveni')commits++;return {data:true,error:null};},from:(table:string)=>{
  const q={select:()=>q,eq:()=>q,in:()=>q,order:()=>q,single:async()=>({data:table==='source_records'?{id:'record',financing_type:'conveni',title:'Conveni sintètic',source_payload:payload}:{id:'v',entry_count:1,general_context:''},error:null}),range:async()=>({data:[doc],error:null}),limit:async()=>({data:[service],error:null})};return q;
 }};
 const answer={actors:[],instrument_grant:false,coverage_complete:true,unallocated_cents:0,summary:'Proposta',units:[{recipient:'Fundació Sintètica',recipient_nif:null,recipient_nature:'unknown',joint:false,period:'2025',year:2025,amount_cents:10000,amount_state:'planned',mixed:false,financiers:[],territory:null,classification:'discarded',service_ref:null,social_assessment:{status:'uncertain',explanation:'Pendent',evidence:['Q1']},population:'',description:'',explanation:'NIF pendent',reason:'missing_nif',evidence:['Q1']}]};
 await assert.rejects(processConveni(db as never,{id:'job',source_record_id:'record'},async()=>({output_text:JSON.stringify(answer)})),(error:unknown)=>{
  assert.ok(error instanceof ConveniFailure);assert.equal(error.kind,'validation');assert.equal(error.code,'CONVENI_DISCARD_MISSING_NIF');assert.match(error.message,/NIF.*pendent/);return true;
 });
 assert.equal(commits,0);
});

test('an already persisted historical analysis returns before request or revalidation',async()=>{
 let requests=0,persist=0;
 const row={id:'record',financing_type:'conveni',title:'Conveni històric',source_payload:{}};
 const db={rpc:async(name:string)=>{if(name==='screen_conveni')return {data:true,error:null};if(name==='persist_conveni')persist++;return {data:true,error:null};},from:()=>{
  const q={select:()=>q,eq:()=>q,single:async()=>({data:row,error:null})};return q;
 }};
 assert.equal(await processConveni(db as never,{id:'old-job',source_record_id:'record'},async()=>{requests++;return {};}),true);
 assert.equal(requests,0);assert.equal(persist,0);
});


test('model discard review barrier blocks free-text and documented exclusions without changing the proposal',()=>{
 for(const reason of ['No es pot identificar el NIF','excluded_amendment']){
  const candidate=validate([{...unit,classification:'discarded',service_code:null,reason}]);
  const before=JSON.stringify(candidate);
  assert.throws(()=>assertConveniDiscardsReviewed(candidate),(error:unknown)=>error instanceof ConveniValidationError&&error.diagnostic.code==='CONVENI_MODEL_DISCARD_REVIEW_REQUIRED');
  assert.equal(JSON.stringify(candidate),before);
 }
});

test('model discard inside a mixed group blocks the entire proposal without approving the other concept',()=>{
 const candidate=validate([unit,{...unit,classification:'discarded',service_code:null,reason:'No consta el NIF'}]);
 assert.equal(candidate.units.length,1);assert.equal(candidate.units[0].classification,'insufficient_evidence');
 assert.ok(candidate.units[0].concepts?.some(concept=>concept.classification==='discarded'));
 const before=JSON.stringify(candidate);
 assert.throws(()=>assertConveniDiscardsReviewed(candidate),(error:unknown)=>error instanceof ConveniValidationError&&error.diagnostic.code==='CONVENI_MODEL_DISCARD_REVIEW_REQUIRED');
 assert.equal(JSON.stringify(candidate),before);
});

test('model discard incidence has a fixed user-facing message without provider text',()=>{
 const message=failureMessage(new CloudFailure('validation',0,{operation:'conveni',code:'CONVENI_MODEL_DISCARD_REVIEW_REQUIRED',message:'Untrusted provider text'}));
 assert.match(message,/descart.*pendent de contrast documental/);assert.doesNotMatch(message,/Untrusted/);
});

test('pipeline holds any free-text discard as an incidence without persisting it',async()=>{
 const text='La Fundació Sintètica rep una aportació pública per a un servei social a persones grans.';
 const doc={id:'doc',url:'https://fixture.invalid/doc',status:'fetched',document_type:'agreement',extracted_text:`## Pàgina 1\n${text}`,extraction_partial:false,extraction_method:'html-basic',extraction_coverage:{policy:'html-text-coverage-v1',complete:true},mime_type:'text/plain',quality_flags:[],storage_path:'cases/record/documents/doc/digest.txt',storage_sha256:'digest',active_extraction_id:'extraction'};
 const service={version_id:'v',service_code:'1',service_name:'Servei',parent_code:null,benefit_type:'service',description:'Descripció',target_population:'Persones',conditions:'Condicions',legal_reference:'Norma',normative_fields:{}};
 let commits=0;
 const db={rpc:async(name:string)=>{if(name==='screen_conveni')return {data:false,error:null};if(name==='conveni_source_hash')return {data:'hash',error:null};if(name==='persist_conveni')commits++;return {data:true,error:null};},from:(table:string)=>{
  const q={select:()=>q,eq:()=>q,in:()=>q,order:()=>q,single:async()=>({data:table==='source_records'?{id:'record',financing_type:'conveni',title:'Conveni sintètic',source_payload:payload}:{id:'v',entry_count:1,general_context:''},error:null}),range:async()=>({data:[doc],error:null}),limit:async()=>({data:[service],error:null})};return q;
 }};
 const answer={actors:[],instrument_grant:false,coverage_complete:true,unallocated_cents:0,summary:'Proposta',units:[{recipient:'Fundació Sintètica',recipient_nif:null,recipient_nature:'unknown',joint:false,period:'2025',year:2025,amount_cents:10000,amount_state:'planned',mixed:false,financiers:[],territory:null,classification:'discarded',service_ref:null,social_assessment:{status:'uncertain',explanation:'Pendent',evidence:['Q1']},population:'',description:'',explanation:'NIF pendent',reason:'No es pot identificar el NIF',evidence:['Q1']}]};
 await assert.rejects(processConveni(db as never,{id:'job',source_record_id:'record'},async()=>({output_text:JSON.stringify(answer)})),(error:unknown)=>{
  assert.ok(error instanceof ConveniFailure);assert.equal(error.kind,'validation');assert.equal(error.code,'CONVENI_MODEL_DISCARD_REVIEW_REQUIRED');assert.match(error.message,/descart.*pendent/);
  const message=failureMessage(new CloudFailure('validation',5,{operation:'conveni_analysis',code:error.code,details:error.diagnostics}));
  assert.match(message,/NIF del receptor a la proposta/);assert.doesNotMatch(message,/NIF.*no existeix/);return true;
 });
 assert.equal(commits,0);
});

