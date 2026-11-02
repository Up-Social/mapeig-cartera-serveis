import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {BatchAnalysisFacts} from '../components/batch-analysis-facts';
import {batchResultGuidance,batchResultClassification} from '../lib/batch-result-guidance';
import type {StoredAnalysis} from '../lib/analysis-contract';
import type {BatchJob} from '../lib/batch-types';
const base:StoredAnalysis={id:'synthetic',classification:'in_portfolio',reasons:[],explanation:'Proposta sintètica de correspondència.',service_description:'Servei sintètic conservat',target_population:'Població sintètica pendent de contrast.',catalog_version_id:'synthetic-catalog',rules_version:'evidence-roles-v2',reviewed_classification:null,review_notes:null,evidence:[{content:'Fragment documental sintètic conservat.'}]};
const render=(analysis:BatchJob['analysis'])=>renderToStaticMarkup(createElement(BatchAnalysisFacts,{analysis}));
test('batch population is visibly a proposal with a nearby caveat and unchanged service/evidence messages',()=>{
 const before=JSON.stringify(base),html=render(base);
 assert.match(html,/Destinataris proposats per l’anàlisi · pendent de contrastar/);
 assert.match(html,/Aquesta descripció no acredita per si sola/);
 assert.ok(html.includes(base.target_population));assert.ok(html.includes(base.service_description));assert.match(html,/1 fragment\(s\)/);
 assert.equal(JSON.stringify(base),before);assert.doesNotMatch(html,/prové del catàleg|procedeix del catàleg/);
});
test('null, absent and empty populations retain the current fallback without an empty caveat',()=>{
 assert.equal(render(null),'');assert.equal(render(undefined),'');
 for(const target_population of [null,undefined,'','  \n  ']){
  const html=render({...base,target_population,service_description:'',evidence:[]} as StoredAnalysis);
  assert.match(html,/No identificats a l’anàlisi · pendents de contrast/);assert.match(html,/No prou acreditat/);assert.match(html,/Cap fragment acreditat/);
  assert.doesNotMatch(html,/Aquesta descripció no acredita per si sola/);
 }
});
test('long population is preserved in full, without a new disclosure or truncation',()=>{
 const population='Descripció de les persones destinatàries que cal contrastar. '.repeat(30);
 const html=render({...base,target_population:population});assert.ok(html.includes(population.trim()));assert.doesNotMatch(html,/<details|line-clamp|truncate/);
});
test('invalidated analysis is not shown as an identified service or current population',()=>{
 const html=render({...base,reliability_status:'invalidated'});
 assert.match(html,/resultat no és fiable/i);assert.match(html,/no acredita el servei ni els destinataris/);
 assert.doesNotMatch(html,/Servei identificat/);assert.ok(!html.includes(base.service_description));assert.ok(!html.includes(base.target_population));
});
test('deterministic Concerts identify the catalog-derived population as needing line-specific review',()=>{
 for(const rules_version of ['concert-reconciled-annex-v1','concert-program-lines-v2']){
  const html=render({...base,rules_version});
  assert.match(html,/Text de població de l’anàlisi/);assert.match(html,/pot derivar de la descripció del catàleg/);
  assert.match(html,/No acredita la població de cada línia/);assert.ok(html.includes(base.target_population));
  assert.doesNotMatch(html,/Destinataris proposats per l’anàlisi/);
  const missing=render({...base,rules_version,target_population:''});
  assert.match(missing,/No identificats a l’anàlisi · pendents de contrast/);assert.doesNotMatch(missing,/pot derivar/);
 }
});
test('rendering does not change classifications or guidance for financing types and special states',()=>{
 for(const financingType of ['concert','contractacio','subvencio','conveni'] as const)for(const analysis of [base,{...base,classification:'insufficient_evidence' as const},{...base,reliability_status:'invalidated' as const},{...base,rule_audit:{rule:'review_by_recipient'}},{...base,reviewed_classification:'in_portfolio' as const}]){
  const job:BatchJob={id:'synthetic-job',sourceRecordId:'synthetic-record',sourceDataset:'contractacions',externalId:'synthetic-reference',title:'Títol sintètic',financingType,status:'needs_review',analysis,matchingCandidates:[],hasProvision:false,preparationStatus:'ready',preparationMessage:null,errorMessage:null,enrichmentStatus:'completed',enrichmentError:null,processingStatus:'needs_review'};
  const before=JSON.stringify({classification:batchResultClassification(job),guidance:batchResultGuidance(job),job});render(job.analysis);
  assert.equal(JSON.stringify({classification:batchResultClassification(job),guidance:batchResultGuidance(job),job}),before);
 }
});
