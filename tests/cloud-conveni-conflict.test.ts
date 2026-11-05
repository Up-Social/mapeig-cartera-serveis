import {test} from 'node:test';
import assert from 'node:assert/strict';
import {preflightConveni,processConveni,ConveniFailure} from '../lib/convenis/process';
import type {ConveniAnalysis} from '../lib/convenis/contract';
import {cloudConveniConflictOptions,cloudConveniOptions} from '../lib/cloud/conveni-conflict';
import {providerRequest} from '../lib/cloud/provider';
import {CloudFailure,failureMessage} from '../lib/cloud/errors';
import type {Context} from '../lib/cloud/context';

const busy={code:'40001',message:'T19_DEDUP_BUSY'};
test('cloud preflight treats only the exact rolled-back conflict as transient before provider work',async()=>{
 let calls=0;
 const from=()=>{const q={select:()=>q,eq:()=>q,single:async()=>({data:{source_record_id:'record',financing_type:'conveni',title:'Conveni sintètic',source_payload:{}},error:null})};return q;};
 const db={rpc:async()=>{calls++;return {data:null,error:busy};},from};
 await assert.rejects(preflightConveni(db as never,'job',cloudConveniConflictOptions),e=>e instanceof CloudFailure&&e.kind==='transient'&&e.diagnostic?.operation==='screen_conveni');
 assert.equal(calls,1);
 await assert.rejects(preflightConveni(db as never,'job'),e=>e instanceof Error&&!(e instanceof CloudFailure)&&e.message==='T19_DEDUP_BUSY');
 for(const error of [{code:'40001',message:'stale review'},{code:'P0001',message:'T19_DEDUP_BUSY'}]){
  await assert.rejects(preflightConveni({rpc:async()=>({data:null,error}),from} as never,'job',cloudConveniConflictOptions),e=>e instanceof Error&&!(e instanceof CloudFailure));
 }
});

function conveniFixture(persistError:Record<string,string>){
 const journal=new Map<string,unknown>();const order:string[]=[];const calls:Array<{name:string;args:Record<string,unknown>}>=[];let commits=0;
 const quote='La Fundació Sintètica, entitat privada amb NIF G12345678, rep 1.000 euros públics per un servei social a persones grans a Vic durant 2025.';
 const document={id:'doc',url:'https://fixture.invalid/doc',status:'fetched',document_type:'agreement',extracted_text:`## Pàgina 1\n${quote}`,extraction_partial:false,extraction_method:'html-basic',extraction_coverage:{policy:'html-text-coverage-v1',complete:true},mime_type:'text/plain',quality_flags:[],storage_path:'cases/record/documents/doc/digest.txt',storage_sha256:'digest',active_extraction_id:'extraction'};
 const service={version_id:'v',service_code:'1',service_name:'Servei',parent_code:null,benefit_type:'service',description:'Descripció',target_population:'Persones',conditions:'Condicions',legal_reference:'Norma',normative_fields:{}};
 const db={rpc:async(name:string,args:Record<string,unknown>)=>{
  order.push(name);calls.push({name,args});
  if(name==='screen_conveni_v2'||name==='cloud_screen_conveni_v2')return {data:false,error:null};
  if(name==='conveni_source_hash')return {data:'hash',error:null};
  if(name==='persist_conveni'||name==='cloud_persist_conveni'){commits++;return commits===1?{data:null,error:persistError}:{data:true,error:null};}
  if(name==='cloud_checkpoint')journal.set(String(args.p_key),args.p_value);
  return {data:true,error:null};
 },from:(table:string)=>{let key='';const q={select:()=>q,eq:(name:string,v:string)=>{if(name==='item_key')key=v;return q;},in:()=>q,order:()=>q,
  single:async()=>({data:table==='source_records'?{id:'record',financing_type:'conveni',title:'Conveni sintètic',source_payload:{'Total aportacions previstes Generalitat':0,'Total aportacions previstes ens locals':1000}}:{id:'v',entry_count:1,general_context:''},error:null}),
  maybeSingle:async()=>({data:table==='app_settings'?{enabled:true,reason:null,updated_at:'2026-10-26T00:00:00Z'}:journal.has(key)?{value:journal.get(key)}:null,error:null}),
  range:async()=>({data:[document],error:null}),limit:async()=>({data:[service],error:null})};return q;}};
 const unit={recipient:'Fundació Sintètica',recipient_nif:'G12345678',recipient_nature:'private',joint:false,period:'2025',year:2025,amount_cents:100000,amount_state:'conditional',mixed:false,financiers:['Ajuntament'],territory:'Vic',classification:'in_portfolio',service_ref:'1 · Servei',social_assessment:{status:'social',explanation:'La prestació i població consten al document.',evidence:['Q1']},population:'Persones grans',description:'Servei social',explanation:'Proposta amb evidència.',reason:null,evidence:['Q1']};
 const answer={actors:[{name:'Fundació Sintètica',nif:'G12345678',nature:'private',roles:['recipient'],evidence:['Q1']}],instrument_grant:false,coverage_complete:true,unallocated_cents:0,summary:'Proposta sintètica.',units:[unit]};
 return {db,journal,order,calls,answer,get commits(){return commits;}};
}

test('cloud Conveni sends its lease to both mutation wrappers; local retains original RPCs',async()=>{
 const f=conveniFixture(busy);const c={db:f.db,task:'task',owner:'owner',generation:9} as unknown as Context;
 await assert.rejects(processConveni(f.db as never,{id:'job',source_record_id:'record'},async()=>({output_text:JSON.stringify(f.answer)}),cloudConveniOptions(c)),e=>e instanceof CloudFailure&&e.kind==='transient');
 for(const name of ['cloud_screen_conveni_v2','cloud_persist_conveni']){
  const call=f.calls.find(x=>x.name===name);assert.ok(call);
  assert.deepEqual([call.args.p_task,call.args.p_owner,call.args.p_generation,call.args.p_job],['task','owner',9,'job']);
 }
 assert.equal(f.order.includes('screen_conveni_v2'),false);assert.equal(f.order.includes('persist_conveni'),false);
});

test('cloud Conveni persist conflict resumes with received receipt, not another provider request',async()=>{
 const f=conveniFixture(busy),original=global.fetch;let calls=0;
 global.fetch=async()=>{calls++;return Response.json({id:'synthetic',output_text:JSON.stringify(f.answer)});};
 const c={db:f.db,task:'task',owner:'owner',generation:1} as unknown as Context;
 const run=()=>processConveni(f.db as never,{id:'job',source_record_id:'record'},body=>providerRequest(c,'ai:job:conveni',body),cloudConveniConflictOptions);
 try{
  await assert.rejects(run(),e=>e instanceof CloudFailure&&e.kind==='transient'&&e.diagnostic?.operation==='persist_conveni');
  assert.equal((f.journal.get('ai:job:conveni') as {state:string}).state,'received');
  assert.equal(await run(),true);assert.equal(calls,1);assert.equal(f.commits,2);
  assert.ok(f.order.indexOf('screen_conveni_v2')<f.order.indexOf('persist_conveni'));
 }finally{global.fetch=original;}
});

test('other serialization failures remain validation failures and never become retryable',async()=>{
 const f=conveniFixture({code:'40001',message:'stale source'}),original=global.fetch;
 global.fetch=async()=>Response.json({id:'synthetic',output_text:JSON.stringify(f.answer)});
 const c={db:f.db,task:'task',owner:'owner',generation:1} as unknown as Context;
 try{await assert.rejects(processConveni(f.db as never,{id:'job',source_record_id:'record'},body=>providerRequest(c,'ai:job:conveni',body),cloudConveniConflictOptions),e=>e instanceof ConveniFailure&&e.kind==='validation'&&e.code==='STALE_OR_INVALID_CONVENI');}
 finally{global.fetch=original;}
});

test('an uncertain Conveni provider result stays blocked on replay and never reaches persistence',async()=>{
 const f=conveniFixture(busy),original=global.fetch;let calls=0;
 global.fetch=async()=>{calls++;throw Error('synthetic timeout');};
 const c={db:f.db,task:'task',owner:'owner',generation:1} as unknown as Context;
 const run=()=>processConveni(f.db as never,{id:'job',source_record_id:'record'},body=>providerRequest(c,'ai:job:conveni',body),cloudConveniConflictOptions);
 try{
  await assert.rejects(run(),e=>e instanceof CloudFailure&&e.kind==='provider_unknown');
  await assert.rejects(run(),e=>e instanceof CloudFailure&&e.kind==='provider_unknown');
  assert.equal(calls,1);assert.equal(f.commits,0);assert.equal((f.journal.get('ai:job:conveni') as {state:string}).state,'sending');
 }finally{global.fetch=original;}
});

test('local Conveni caller retains its existing validation treatment',async()=>{
 const f=conveniFixture(busy);
 await assert.rejects(processConveni(f.db as never,{id:'job',source_record_id:'record'},async()=>({output_text:JSON.stringify(f.answer)})),e=>e instanceof ConveniFailure&&e.kind==='validation'&&e.code==='STALE_OR_INVALID_CONVENI');
 assert.equal(f.commits,1);
});

test('provider discard for missing catalog fit is persisted as an outside proposal with a specific diagnostic',async()=>{
 const f=conveniFixture(busy);
 const answer={...f.answer,units:[{...f.answer.units[0],classification:'discarded',service_ref:null,reason:'service_not_in_catalog'}]};
 // The first persist attempt meets the fixture's busy error; what matters is the payload sent.
 await assert.rejects(processConveni(f.db as never,{id:'job',source_record_id:'record'},async()=>({output_text:JSON.stringify(answer)})),/T19_DEDUP_BUSY/);
 const payload=f.calls.find(call=>call.name==='persist_conveni')?.args.p_payload as ConveniAnalysis;
 assert.equal(payload.units[0].classification,'out_of_portfolio');assert.equal(payload.units[0].original_classification,'discarded');assert.equal(payload.units[0].reason,null);
 assert.ok(payload.diagnostics?.some(d=>d.code==='CONVENI_DISCARD_REASON_CONFLICT'&&d.field==='reason'));
});

test('the SQL discard conflict keeps its specific diagnostic rather than a generic stale error',async()=>{
 const f=conveniFixture({code:'P0001',message:'La manca d’encaix en la cartera no justifica per si sola un descart.',details:'CONVENI_DISCARD_REASON_CONFLICT'});
 await assert.rejects(processConveni(f.db as never,{id:'job',source_record_id:'record'},async()=>({output_text:JSON.stringify(f.answer)})),
  e=>e instanceof ConveniFailure&&e.kind==='validation'&&e.code==='CONVENI_DISCARD_REASON_CONFLICT'&&e.diagnostic?.field==='reason');
 assert.equal(f.commits,1);
});

test('a response cut at the output limit is never parsed, even when it starts with a valid draft',async()=>{
 const f=conveniFixture(busy);
 // Runaway draft: a complete-looking proposal followed by repeated output until the limit.
 const draft=JSON.stringify(f.answer);
 const raw={status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[{type:'message',phase:'commentary',status:'incomplete',content:[{type:'output_text',text:`${draft}\n\n${draft}`}]}]};
 await assert.rejects(processConveni(f.db as never,{id:'job',source_record_id:'record'},async()=>raw),e=>e instanceof ConveniFailure&&e.kind==='validation'&&e.code==='PROVIDER_OUTPUT_INCOMPLETE');
 assert.equal(f.commits,0);
});

test('the Conveni prompt asks for a single final JSON message without drafts',async()=>{
 const f=conveniFixture(busy);let instructions='';
 await assert.rejects(processConveni(f.db as never,{id:'job',source_record_id:'record'},async body=>{instructions=String(body.instructions);return {output_text:JSON.stringify(f.answer)};}),/T19_DEDUP_BUSY/);
 assert.match(instructions,/únic missatge final en JSON: no escriguis cap missatge previ, esborrany, comentari ni repetició/);
});

test('an incomplete provider response explains that a reprocess runs a new analysis',()=>{
 const message=failureMessage(new CloudFailure('validation',5,{operation:'conveni_analysis',code:'PROVIDER_OUTPUT_INCOMPLETE'}));
 assert.match(message,/ha esgotat el límit de sortida/);assert.match(message,/anàlisi nova/);
});
