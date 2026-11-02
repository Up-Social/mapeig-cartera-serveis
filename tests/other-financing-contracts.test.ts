import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisSchema,applyFinancingClassification,validateAnalysis,type AnalysisOutput} from '../lib/analysis-contract';
import {evidenceRejectionReasons} from '../lib/evidence-eligibility';
import type {OfficialService} from '../lib/official-catalog';

// Synthetic provider responses exercise shared contracts, not semantic model accuracy.
const catalog=[{service_code:'1.2.3',service_name:'Servei sintètic',benefit_type:'service',legal_reference:'legal/1.2.3',normative_fields:{}} as OfficialService];
const candidate={code:'1.2.3',score:0.9,rationale:'Servei acreditat',evidence_ordinals:[1],evidence_explanation:'Prestació documentada',population_compatible:true,legal_reference:'legal/1.2.3'};
const positive:AnalysisOutput={classification:'in_portfolio',reasons:[],explanation:'Servei social i població acreditats documentalment.',service_description:'Servei sintètic acreditat',target_population:'Persones destinatàries',evidence_ordinals:[1],population_verified:true,social_service_verified:true,candidates:[candidate]};
for(const family of ['contractacio','subvencio'] as const){
 test(`${family}: documented in-portfolio response retains its eligible service`,()=>{
  assert.equal(validateAnalysis(applyFinancingClassification(positive,family),catalog,1).candidates[0].code,'1.2.3');
 });
 test(`${family}: social service outside the catalog remains allowed and requires complete evidence`,()=>{
  const value={...positive,classification:'out_of_portfolio' as const,candidates:[]};
  const allowed:readonly string[]=analysisSchema({},family).classification.enum;
  assert.ok(allowed.includes('out_of_portfolio'));
  assert.equal(validateAnalysis(applyFinancingClassification(value,family),catalog,1).classification,'out_of_portfolio');
  assert.throws(()=>validateAnalysis(value,catalog,1,false));
 });
 test(`${family}: non-social result needs a reason and no candidate`,()=>{
  const value={...positive,classification:'discarded' as const,reasons:['not_social_service'],candidates:[]};
  assert.equal(validateAnalysis(applyFinancingClassification(value,family),catalog,1).classification,'discarded');
  assert.throws(()=>validateAnalysis({...value,reasons:[]},catalog,1));
 });
 test(`${family}: unknown facts remain insufficient without proposed services`,()=>{
  const value={...positive,classification:'insufficient_evidence' as const,candidates:[],population_verified:false,social_service_verified:false};
  assert.equal(validateAnalysis(applyFinancingClassification(value,family),catalog,1).classification,'insufficient_evidence');
  assert.throws(()=>validateAnalysis({...value,candidates:[candidate]},catalog,1));
 });
 test(`${family}: incomplete extraction is a technical evidence problem, never complete coverage`,()=>{
  const content='Document oficial sobre un projecte i els destinataris del servei. '.repeat(10);
  assert.ok(evidenceRejectionReasons({content,coverageVerified:false}).includes('incomplete_extraction'));
 });
}

import {applyScopeRules, type RoleFact, type RoleFacts} from '../lib/scope-rules';
import {financingTypeForDataset} from '../lib/financing-types';
import {importedComparisonFields,compareSourceField} from '../lib/source-comparison';
import {isReviewOutcomeAllowed,reviewValidation} from '../lib/review-contract';
import {selectEvidenceWindow} from '../lib/cloud/evidence-window';

// These roles and quotations are constructed examples, not inferred facts or client cases.
const textByRole={
 financed_object:'L’objecte finançat és el servei de suport social domiciliari.',
 financier:'El departament concedent amb NIF S1111111A finança el projecte.',
 economic_recipient:'La fundació prestadora amb NIF G22222222 rep la subvenció.',
 direct_beneficiary:'La fundació prestadora rep l’aportació econòmica del projecte.',
 service_provider:'La fundació prestadora executa el servei social domiciliari.',
 final_population:'El servei s’adreça a persones grans en situació de dependència.',
 final_service:'El projecte presta atenció social domiciliària a les persones usuàries.',
 financial_instrument:'L’aportació finança la prestació d’un servei social final.',
};
function makeFacts(){
 const chunks=Object.values(textByRole).map(content=>({content}));
 const kinds={financed_object:'service_financing',financier:'administration',economic_recipient:'entity',direct_beneficiary:'entity',service_provider:'entity',final_population:'population',final_service:'yes',financial_instrument:'service_financing'};
 const facts=Object.fromEntries(Object.entries(textByRole).map(([role,value],i)=>[role,{value,state:'known',kind:kinds[role as keyof typeof kinds],evidence_ordinals:[i+1],quotes:[value]}])) as RoleFacts;
 return {chunks,facts};
}
function setFact(facts:RoleFacts,chunks:{content:string}[],name:keyof RoleFacts,kind:string,text:string){
 chunks.push({content:text});facts[name]={value:text,state:'known',kind,evidence_ordinals:[chunks.length],quotes:[text]};
}
for(const family of ['contractacio','subvencio'] as const){
 test(`${family}: funded provider is not an individual grant; the final population remains separate`,()=>{
  const {facts,chunks}=makeFacts();
  const result=applyScopeRules(positive,facts,chunks);
  assert.equal(result.classification,'in_portfolio');assert.equal(result.rule_audit.rule,'retain_model');
  assert.equal(result.rule_audit.roles?.economic_recipient?.value,textByRole.economic_recipient);
  assert.equal(result.rule_audit.roles?.final_population?.value,textByRole.final_population);
  assert.equal(validateAnalysis(applyFinancingClassification(result,family),catalog,chunks.length).candidates[0].code,'1.2.3');
 });
 test(`${family}: a proposed individual grant keeps the role evidence for human review`,()=>{
  const {facts,chunks}=makeFacts();
  setFact(facts,chunks,'economic_recipient','person','La persona física rep directament l’ajut econòmic individual.');
  setFact(facts,chunks,'direct_beneficiary','person','La mateixa persona física és beneficiària directa de l’ajut.');
  setFact(facts,chunks,'financial_instrument','direct_grant','L’instrument consisteix en un ajut individual a la persona.');
  const result=applyScopeRules(positive,facts,chunks);
  assert.equal(result.classification,'insufficient_evidence');assert.deepEqual(result.reasons,[]);assert.deepEqual(result.candidates,[]);
  assert.equal(result.rule_audit.proposed_discard_reason,'individual_grant');assert.deepEqual(result.evidence_ordinals,[9,10,11,1]);
  assert.equal(validateAnalysis(result,catalog,chunks.length).classification,'insufficient_evidence');assert.deepEqual(result.model_conclusion,positive);
  setFact(facts,chunks,'economic_recipient','entity','Una entitat gestora rep l’aportació per prestar un servei.');
  assert.equal(applyScopeRules(positive,facts,chunks).classification,'in_portfolio');
 });
 test(`${family}: a public recipient with a final service differs from a pure transfer`,()=>{
  const {facts,chunks}=makeFacts();
  setFact(facts,chunks,'economic_recipient','administration','L’ajuntament destinatari rep els fons de l’administració.');
  setFact(facts,chunks,'financial_instrument','interadministrative_transfer','La Generalitat transfereix fons a l’ajuntament destinatari.');
  assert.equal(applyScopeRules(positive,facts,chunks).classification,'in_portfolio');
  setFact(facts,chunks,'final_service','no','La transferència no finança cap prestació de servei final.');
  const result=applyScopeRules(positive,facts,chunks);
  assert.equal(result.classification,'insufficient_evidence');assert.deepEqual(result.reasons,[]);assert.equal(result.rule_audit.proposed_discard_reason,'interadministrative_transfer');
  assert.equal(validateAnalysis(result,catalog,chunks.length).classification,'insufficient_evidence');assert.deepEqual(result.model_conclusion,positive);
 });
 test(`${family}: a missing, contradictory or nonliteral population quote blocks the positive result`,()=>{
  const {facts,chunks}=makeFacts();
  for(const patch of [
   {state:'unknown',kind:'unknown',value:null,evidence_ordinals:[],quotes:[]},
   {state:'contradictory'},
   {quotes:['Persones adultes descrites en una altra font inexistent.']},
   {evidence_ordinals:[1]},
  ] as Partial<RoleFact>[]){
   const result=applyScopeRules(positive,{...facts,final_population:{...facts.final_population,...patch}},chunks);
   assert.equal(result.classification,'insufficient_evidence');assert.deepEqual(result.candidates,[]);
   assert.equal(result.rule_audit.blocked_roles[0].role,'final_population');
  }
 });
 test(`${family}: a fabricated candidate citation index or incompatible legal reference is rejected`,()=>{
  assert.throws(()=>validateAnalysis({...positive,candidates:[{...candidate,evidence_ordinals:[2]}]},catalog,1));
  assert.throws(()=>validateAnalysis({...positive,candidates:[{...candidate,legal_reference:'legal/altre'}]},catalog,1));
  assert.throws(()=>validateAnalysis({...positive,candidates:[{...candidate,population_compatible:false}]},catalog,1));
 });
 test(`${family}: outside and reject remain explicit review choices with required justification`,()=>{
  assert.equal(isReviewOutcomeAllowed(family,'outside'),true);
  assert.ok(reviewValidation('outside','',[]));assert.equal(reviewValidation('outside','Servei documentat fora de cartera',[]),null);
  assert.ok(reviewValidation('reject','Motiu revisat',[]));assert.equal(reviewValidation('reject','Motiu revisat',['not_social_service']),null);
 });
}

test('grant source uses the recipient NIF and grant date, not the grantor or publication date',()=>{
 for(const sourceDataset of ['raisc_ccaa','raisc_local']){
  assert.equal(financingTypeForDataset(sourceDataset),'subvencio');
  const fields=importedComparisonFields({sourceDataset,sourcePayload:{'CIF Beneficiari':'G22222222','CIF Concedent':'S1111111A','Data concessió':'03/05/2025','Data publicació':'09/05/2025','Entitat, OO.AA. o Departament convocant':'Departament fictici'}});
  assert.deepEqual(fields,{nif:'G22222222',date:'2025-05-03',contractingBody:'Departament fictici'});
 }
 const contract=importedComparisonFields({sourceDataset:'contractacions',sourcePayload:{'Data publicació':'09/05/2025','Órgano de contratación':'Administració fictícia'}});
 assert.equal(financingTypeForDataset('contractacions'),'contractacio');assert.equal(contract.date,null);assert.equal(contract.contractingBody,'Administració fictícia');
});
test('source comparison retains zero, missing data and discrepancies without summing a global amount',()=>{
 assert.deepEqual([compareSourceField('Import',0,500).effective,compareSourceField('Import',0,500).status],[0,'Discrepància']);
 assert.deepEqual([compareSourceField('Import',null,500).effective,compareSourceField('Import',null,500).status],[500,'Falta a l’Excel']);
 assert.deepEqual([compareSourceField('Import',1000,500).effective,compareSourceField('Import',1000,500).status],[1000,'Discrepància']);
});
test('unselected intermediate evidence is not attributed to the selected fragments',()=>{
 const all=Array.from({length:14},(_,i)=>({source_document_id:'doc',ordinal:i+1,content:i===6?textByRole.final_population:`Clàusula administrativa sintètica número ${i+1}.`}));
 const selected=selectEvidenceWindow(all);
 assert.equal(selected.some(chunk=>chunk.content===textByRole.final_population),false);
 const {facts}=makeFacts();facts.final_population={...facts.final_population,evidence_ordinals:[7]};
 const result=applyScopeRules(positive,facts,selected);
 assert.equal(result.classification,'insufficient_evidence');
 assert.equal(result.rule_audit.blocked_roles[0].reason,'unverifiable_quote');
});
