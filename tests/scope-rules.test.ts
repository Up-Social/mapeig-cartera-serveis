import test from 'node:test';
import assert from 'node:assert/strict';
import {applyScopeRules,ROLE_NAMES,type RoleFacts} from '../lib/scope-rules';
import type {AnalysisOutput} from '../lib/analysis-contract';
const text='Document fictici acreditatiu dels rols i de la prestació final.';
const chunks=[{content:text}];
const original:AnalysisOutput={classification:'out_of_portfolio',reasons:[],explanation:'Conclusió original del model amb evidència.',service_description:'Servei',target_population:'Persones',evidence_ordinals:[1],population_verified:true,social_service_verified:true,candidates:[]};
function roles(){return Object.fromEntries(ROLE_NAMES.map(n=>[n,{value:text,state:'known',kind:n==='final_service'?'yes':n==='financial_instrument'?'service_financing':'entity',evidence_ordinals:[1],quotes:[text]}])) as RoleFacts;}
test('a role-derived interadministrative exclusion remains pending until the roles are reviewed',()=>{
 const facts=roles();facts.financier.kind='administration';facts.economic_recipient.kind='administration';facts.final_service.kind='no';facts.financial_instrument.kind='interadministrative_transfer';
 const result=applyScopeRules(original,facts,chunks);assert.equal(result.classification,'insufficient_evidence');assert.deepEqual(result.reasons,[]);assert.equal(result.rule_audit.proposed_discard_reason,'interadministrative_transfer');assert.deepEqual(result.model_conclusion,original);assert.deepEqual(result.evidence_ordinals,[1]);
 facts.final_service.kind='yes';assert.equal(applyScopeRules(original,facts,chunks).classification,'out_of_portfolio');
});
test('a role-derived individual grant is proposed for review, distinct from funding a provider',()=>{
 const facts=roles();facts.economic_recipient.kind='person';facts.direct_beneficiary.kind='person';facts.financial_instrument.kind='direct_grant';
 const pending=applyScopeRules(original,facts,chunks);assert.equal(pending.classification,'insufficient_evidence');assert.deepEqual(pending.reasons,[]);assert.equal(pending.rule_audit.proposed_discard_reason,'individual_grant');
 facts.economic_recipient.kind='entity';assert.equal(applyScopeRules(original,facts,chunks).classification,'out_of_portfolio');
});
test('missing, contradictory or unsupported determinant facts are insufficient, never guessed from names',()=>{
 const missing=applyScopeRules(original,undefined,chunks);
 assert.equal(missing.classification,'insufficient_evidence');
 assert.deepEqual(missing.evidence_ordinals,[1]); // Source context survives even when every role is unknown.
 for(const state of ['unknown','contradictory'] as const){const f=roles();f.final_service.state=state;assert.equal(applyScopeRules(original,f,chunks).classification,'insufficient_evidence');}
 const f=roles();f.final_population.value='Persones';f.final_population.quotes=['Invented quote'];assert.equal(applyScopeRules(original,f,chunks).classification,'insufficient_evidence');
});
test('a model discard cannot be justified merely by a missing NIF, even when other roles are known',()=>{
 const proposal:AnalysisOutput={...original,classification:'discarded',reasons:['not_social_service'],explanation:'No consta el NIF del prestador, per tant cal descartar.'};
 const result=applyScopeRules(proposal,roles(),chunks);
 assert.equal(result.classification,'insufficient_evidence');
 assert.deepEqual(result.reasons,[]);
 assert.deepEqual(result.evidence_ordinals,[1]);
 assert.equal(result.rule_audit.rule,'model_discard_requires_review');
 assert.equal(result.rule_audit.discard_policy,'model-discard-review-v2');
 assert.deepEqual(result.model_conclusion,proposal);
 assert.equal(proposal.classification,'discarded');
});
test('a model discard remains pending even when its explanation does not identify the missing field',()=>{
 const proposal:AnalysisOutput={...original,classification:'discarded',reasons:['not_social_service'],explanation:'S’ha proposat descartar aquesta activitat.'};
 const result=applyScopeRules(proposal,roles(),chunks);
 assert.equal(result.classification,'insufficient_evidence');
 assert.deepEqual(result.model_conclusion,proposal);
});
test('a role-derived exclusion remains a review proposal despite an unrelated missing NIF',()=>{
 const proposal:AnalysisOutput={...original,classification:'discarded',reasons:['not_social_service'],explanation:'No consta el NIF del prestador, per tant cal descartar.'};
 const facts=roles();facts.financier.kind='administration';facts.economic_recipient.kind='administration';facts.final_service.kind='no';facts.financial_instrument.kind='interadministrative_transfer';
 const result=applyScopeRules(proposal,facts,chunks);
 assert.equal(result.classification,'insufficient_evidence');
 assert.deepEqual(result.reasons,[]);assert.equal(result.rule_audit.proposed_discard_reason,'interadministrative_transfer');
 assert.deepEqual(result.model_conclusion,proposal);
});
test('a literal citation cannot prove a role kind that contradicts the cited passage',()=>{
 const quote='L’ajuntament presta serveis socials a persones grans i rep finançament públic.';
 const role=(kind:string)=>({value:quote,state:'known' as const,kind,evidence_ordinals:[1],quotes:[quote]});
 const facts={financier:role('administration'),economic_recipient:role('administration'),final_service:role('no'),financial_instrument:role('interadministrative_transfer')};
 const result=applyScopeRules({...original,classification:'insufficient_evidence'},facts,[{content:quote}]);
 assert.equal(result.classification,'insufficient_evidence');assert.equal(result.rule_audit.proposed_discard_reason,'interadministrative_transfer');
 assert.match(result.explanation,/possible/);assert.match(result.explanation,/contrastar/);assert.deepEqual(result.evidence_ordinals,[1]);
});
test('an irrelevant unknown actor does not erase an accredited final service',()=>{
 const f=roles();f.financier.state='unknown';f.financier.kind='unknown';f.financier.value=null;f.financier.quotes=[];f.financier.evidence_ordinals=[];
 assert.equal(applyScopeRules({...original,classification:'in_portfolio'},f,chunks).classification,'in_portfolio');
});
test('peripheral ellipses do not invalidate an otherwise literal role quote',()=>{
 const f=roles();
 for(const fact of Object.values(f))fact.quotes=[`... ${text} ...`];
 assert.equal(applyScopeRules(original,f,chunks).classification,'out_of_portfolio');
});
test('PDF line breaks and harmless terminal punctuation preserve literal role evidence',()=>{
 const quote='Resolució per a la provisió directa de 25 places de la Xarxa de Serveis Socials d’Atenció Pública';
 const pdfChunks=[{content:`Document oficial. Resolució per a la provisió directa de 25 places de la Xarxa de\nServeis Socials d’Atenció Pública, en règim de concert social.`}];
 const f=roles();
 for(const role of ['financed_object','final_population','final_service'] as const){
  f[role].value=quote;
  f[role].evidence_ordinals=[1];
  f[role].quotes=[`${quote}.`];
 }
 assert.equal(applyScopeRules({...original,classification:'in_portfolio'},f,pdfChunks).classification,'in_portfolio');
});
test('exact official service codes and descriptions accredit service and population without accepting invented quotes',()=>{
 const official=`${text} Annex oficial: 1.2.3.3.2.2 Servei de residència assistida per a gent gran de caràcter temporal o permanent. Grau II.`;
 const f=roles();
 f.financed_object.quotes=['Resolució resumida però no literal'];
 f.final_service.quotes=['Resum no literal del servei final'];
 f.final_population.quotes=['per a la gent gran'];
 const result=applyScopeRules({...original,classification:'in_portfolio'},f,[{content:official}],{
  financed_object:{kind:'service_financing',evidence_ordinals:[1],basis:'official_service_code_and_description'},
  final_service:{kind:'yes',evidence_ordinals:[1],basis:'official_service_code_and_description'},
  final_population:{kind:'population',evidence_ordinals:[1],basis:'official_service_code_and_description'},
 });
 assert.equal(result.classification,'in_portfolio');
 assert.equal(result.rule_audit.rule,'retain_model');
 assert.deepEqual(result.rule_audit.evidence_ordinals,[1]);
});
test('official service evidence never hides a contradictory determinant role',()=>{
 const f=roles();f.final_population.state='contradictory';
 const result=applyScopeRules({...original,classification:'in_portfolio'},f,chunks,{
  final_population:{kind:'population',evidence_ordinals:[1],basis:'official_service_code_and_description'},
 });
 assert.equal(result.classification,'insufficient_evidence');
 assert.equal(result.rule_audit.rule,'unknown_determinant_role');
});
