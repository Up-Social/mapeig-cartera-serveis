import test from 'node:test';
import assert from 'node:assert/strict';
import {applyScopeRules,ROLE_NAMES,type RoleFacts} from '../lib/scope-rules';
import type {AnalysisOutput} from '../lib/analysis-contract';
const text='Document fictici acreditatiu dels rols i de la prestació final.';
const chunks=[{content:text}];
const original:AnalysisOutput={classification:'out_of_portfolio',reasons:[],explanation:'Conclusió original del model amb evidència.',service_description:'Servei',target_population:'Persones',evidence_ordinals:[1],population_verified:true,social_service_verified:true,candidates:[]};
function roles(){return Object.fromEntries(ROLE_NAMES.map(n=>[n,{value:text,state:'known',kind:n==='final_service'?'yes':n==='financial_instrument'?'service_financing':'entity',evidence_ordinals:[1],quotes:[text]}])) as RoleFacts;}
test('pure interadministrative transfer requires documented roles and absence of final service',()=>{
 const facts=roles();facts.financier.kind='administration';facts.economic_recipient.kind='administration';facts.final_service.kind='no';facts.financial_instrument.kind='interadministrative_transfer';
 const result=applyScopeRules(original,facts,chunks);assert.equal(result.classification,'discarded');assert.deepEqual(result.reasons,['interadministrative_transfer']);assert.deepEqual(result.model_conclusion,original);
 facts.final_service.kind='yes';assert.equal(applyScopeRules(original,facts,chunks).classification,'out_of_portfolio');
});
test('direct individual grants are distinct from funding a provider',()=>{
 const facts=roles();facts.economic_recipient.kind='person';facts.direct_beneficiary.kind='person';facts.financial_instrument.kind='direct_grant';
 assert.deepEqual(applyScopeRules(original,facts,chunks).reasons,['individual_grant']);
 facts.economic_recipient.kind='entity';assert.equal(applyScopeRules(original,facts,chunks).classification,'out_of_portfolio');
});
test('missing, contradictory or unsupported determinant facts are insufficient, never guessed from names',()=>{
 assert.equal(applyScopeRules(original,undefined,chunks).classification,'insufficient_evidence');
 for(const state of ['unknown','contradictory'] as const){const f=roles();f.economic_recipient.state=state;assert.equal(applyScopeRules(original,f,chunks).classification,'insufficient_evidence');}
 const f=roles();f.financier.value='Ajuntament de Prova';f.financier.quotes=['Invented quote'];assert.equal(applyScopeRules(original,f,chunks).classification,'insufficient_evidence');
});
