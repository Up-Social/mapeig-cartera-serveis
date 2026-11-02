import test from 'node:test';
import assert from 'node:assert/strict';
import {programLineEvidenceOrdinals} from '../lib/cloud/program-analysis';
import type {DocumentedCorrection} from '../lib/human-resolution';

const line={id:'unit',document_id:'doc',reses_code:'S12345',unit_key:'official-program:hash:S12345:0',observed_service_name:'Servei de suport per a persones grans',evidence_quote:'S12345 · Centre Prova · Servei de suport per a persones grans · 3 places'};
const same={source_document_id:'doc',content:'S12345 · Centre Prova · Servei de suport per a persones grans · 3 places'};
test('a program service needs the RESES and its own printed service in the literal row quote',()=>{
 assert.deepEqual(programLineEvidenceOrdinals(line,[],[same]),[1]);
 assert.deepEqual(programLineEvidenceOrdinals(line,[],[{...same,source_document_id:'other'}]),[]);
 assert.deepEqual(programLineEvidenceOrdinals(line,[],[{...same,content:'S12345 · Centre Prova. Una altra tipologia de servei.'}]),[]);
 assert.deepEqual(programLineEvidenceOrdinals({...line,evidence_quote:'S12345 · Centre Prova · Servei diferent'},[],[same]),[]);
 const otherRow={...same,content:'S12345 · Centre Prova · Servei diferent. S99999 · Servei de suport per a persones grans'};
 assert.deepEqual(programLineEvidenceOrdinals({...line,evidence_quote:otherRow.content},[],[otherRow]),[]);
});
test('a human correction is cited from its own current document, not an unrelated RESES chunk',()=>{
 const correction:DocumentedCorrection={id:'c',unit_id:'unit',field:'service_code',value:'1.2.3',previous_value:null,document_id:'amendment',document_revision:'hash',page:1,evidence:'Servei corregit per a persones grans',visual_check:true,reason:'Contrast documental',reviewer:'local',valid:true,created_at:'2024-01-01'};
 const corrected={source_document_id:'amendment',content:'El Servei corregit per a persones grans es confirma.'};
 assert.deepEqual(programLineEvidenceOrdinals(line,[correction],[same,corrected]),[2]);
 assert.deepEqual(programLineEvidenceOrdinals(line,[correction],[same]),[]);
 assert.deepEqual(programLineEvidenceOrdinals(line,[{...correction,valid:false}],[same]),[1]);
});

test('a program with no line-level evidence remains insufficient rather than falling through to generic matching',async()=>{
 const {programAnalysis}=await import('../lib/cloud/program-analysis');
 const report={document_id:'doc',document_sha256:'hash',coverage:{complete:true},reconciled:true,row_count:1};
 const stored={...line,page:1,observed_service_code:'1.2.3',amount:100,storage_path:'archive',storage_sha256:'hash'};
 const db={from(table:string){
  const data=table==='record_units'?[stored]:table==='concert_annex_reconciliations'?[report]:[];
  const query={select(){return query;},eq(){return query;},order(){return query;},range(){return Promise.resolve({data,error:null});},then(resolve:(value:unknown)=>unknown){return Promise.resolve({data,error:null}).then(resolve);}};
  return query;
 }};
 const catalog=[{service_code:'1.2.3',service_name:'Servei de suport per a persones grans',benefit_type:'service',target_population:'Gent gran',legal_reference:'legal/1.2.3',normative_fields:{}}];
 const result=await programAnalysis({db:db as never},'record',catalog as never,[{source_document_id:'doc',content:'S12345 · una altra tipologia documental que no coincideix'}]);
 assert.equal(result?.classification,'insufficient_evidence');assert.deepEqual(result?.candidates,[]);assert.equal(result?.rule_audit.evidence_binding_version,'program-line-evidence-v1');
 assert.ok((result?.rule_audit.diagnostics as Array<{code:string}>).some(item=>item.code==='no_program_line_evidence'));
});

test('a cited program service does not claim that its population was printed on the line',async()=>{
 const {programAnalysis}=await import('../lib/cloud/program-analysis');
 const report={document_id:'doc',document_sha256:'hash',coverage:{complete:true},reconciled:true,row_count:1};
 const stored={...line,observed_service_name:'Servei de suport residencial',evidence_quote:'S12345 · Centre Prova · Servei de suport residencial · 3 places',page:1,observed_service_code:'1.2.3',amount:100,storage_path:'archive',storage_sha256:'hash'};
 const db={from(table:string){
  const data=table==='record_units'?[stored]:table==='concert_annex_reconciliations'?[report]:[];
  const query={select(){return query;},eq(){return query;},order(){return query;},range(){return Promise.resolve({data,error:null});}};
  return query;
 }};
 const catalog=[{service_code:'1.2.3',service_name:'Servei de suport residencial',benefit_type:'service',target_population:'Gent gran',legal_reference:'legal/1.2.3',normative_fields:{}}];
 const result=await programAnalysis({db:db as never},'record',catalog as never,[{source_document_id:'doc',content:stored.evidence_quote}]);
 assert.equal(result?.classification,'in_portfolio');
 assert.match(result!.candidates[0].evidence_explanation,/població destinatària.*pendent de contrast documental/i);
 assert.doesNotMatch(result!.candidates[0].evidence_explanation,/destinataris impresos/i);
});
