import test from 'node:test';
import assert from 'node:assert/strict';
import {applyConcertRoleReview,concertRolesNeedingReview,concertRoleReviewSchema} from '../lib/concerts/role-evidence';
import {applyScopeRules,hasLiteralRoleEvidence,type RoleFacts} from '../lib/scope-rules';
import type {AnalysisOutput} from '../lib/analysis-contract';
const chunks=[{content:'No s’adjudica el servei de pis assistit per a joves majors de 18 anys.'},
 {content:'Resolc assignar el servei de pis assistit per a joves majors de 18 anys a l’entitat que consta a l’annex.'}];
const fact={state:'known' as const,value:'servei de pis assistit',kind:'yes',evidence_ordinals:[1],quotes:['Es finança el servei de pis assistit.']};
const roles:Partial<RoleFacts>={final_service:fact,financed_object:{...fact,kind:'service_financing',evidence_ordinals:[2],quotes:[chunks[1].content]},final_population:{...fact,kind:'population',value:'joves majors de 18 anys',evidence_ordinals:[2],quotes:[chunks[1].content]}};
const known={role:'final_service',state:'known',value:fact.value,kind:fact.kind,evidence_ordinal:2};
const unknown={role:'final_service',state:'unknown',value:null,kind:'unknown',evidence_ordinal:0};
test('a value mentioned in a negation cannot repair its own evidence',()=>{
 assert.deepEqual(concertRolesNeedingReview(roles,chunks),['final_service']);assert.equal(hasLiteralRoleEvidence(fact,chunks),false);
 assert.throws(()=>applyConcertRoleReview(roles,chunks,undefined));
 const rejected=applyConcertRoleReview(roles,chunks,{checks:[unknown]});assert.equal(rejected.roles.final_service?.state,'unknown');assert.equal(hasLiteralRoleEvidence(rejected.roles.final_service,chunks),false);
});
test('independent review selects the complete literal source and preserves the known fact',()=>{
 const reviewed=applyConcertRoleReview(roles,chunks,{checks:[known]});assert.deepEqual(reviewed.roles.final_service?.quotes,[chunks[1].content]);assert.deepEqual(reviewed.roles.final_service?.evidence_ordinals,[2]);assert.equal(hasLiteralRoleEvidence(reviewed.roles.final_service,chunks),true);assert.deepEqual(roles.final_service,fact);
 for(const patch of [{value:'servei residencial'}, {kind:'no'}])assert.throws(()=>applyConcertRoleReview(roles,chunks,{checks:[{...known,...patch}]}),/CHANGED_FACT/);
});
test('contradictory and already literal facts are never overwritten',()=>{
 for(const f of [{...fact,state:'contradictory' as const},{...fact,quotes:[chunks[0].content]}]){
  const complete={...roles,final_service:f};assert.deepEqual(concertRolesNeedingReview(complete,chunks),[]);assert.throws(()=>applyConcertRoleReview(complete,chunks,{checks:[known]}));
 }
});
test('missing, duplicated, foreign and out-of-range review decisions fail closed',()=>{
 for(const checks of [[],[null],[{...known,role:'direct_beneficiary'}],[{...known,evidence_ordinal:0}],[{...known,evidence_ordinal:3}],[{...unknown,evidence_ordinal:2}],[{...unknown,value:'inventat'}],[known,known]])assert.throws(()=>applyConcertRoleReview(roles,chunks,{checks}));
});
test('unknown and missing determinants require an explicit literal fact from independent review',()=>{
 const r={...roles,final_service:{...fact,state:'known' as const,evidence_ordinals:[2],quotes:[chunks[1].content]},final_population:{state:'unknown' as const,kind:'unknown',value:null,evidence_ordinals:[],quotes:[]}};
 const check={role:'final_population',state:'known',kind:'population',value:'joves majors de 18 anys',evidence_ordinal:2};
 for(const unknownRoles of [r,{...r,final_population:undefined}]){
  assert.deepEqual(concertRolesNeedingReview(unknownRoles,chunks),['final_population']);
  const reviewed=applyConcertRoleReview(unknownRoles,chunks,{checks:[check]});assert.equal(reviewed.roles.final_population?.value,check.value);assert.equal(hasLiteralRoleEvidence(reviewed.roles.final_population,chunks),true);
  for(const patch of [{value:'persones amb discapacitat intel·lectual'},{kind:'yes'},{value:'joves'}])assert.throws(()=>applyConcertRoleReview(unknownRoles,chunks,{checks:[{...check,...patch}]}));
 }
});
test('Mercè Pla population can be grounded without copying the recipient or changing a decision',()=>{
 const evidence=[{content:'Resolc modificar el servei de teràpia ocupacional per a persones amb discapacitat intel·lectual. L’entitat prestadora és Fundació Mercè Pla.'}];
 const literal={state:'known' as const,kind:'yes',value:'servei de teràpia ocupacional',evidence_ordinals:[1],quotes:[evidence[0].content]};
 const original:Partial<RoleFacts>={financed_object:{...literal,kind:'service_financing'},final_service:literal,final_population:{state:'unknown',kind:'unknown',value:null,evidence_ordinals:[],quotes:[]},economic_recipient:{...literal,kind:'entity',value:'Fundació Mercè Pla'}};
 const result:AnalysisOutput={classification:'in_portfolio',reasons:[],candidates:[],explanation:'Proposta pendent',service_description:'teràpia ocupacional',target_population:'persones amb discapacitat intel·lectual',population_verified:true,social_service_verified:true,evidence_ordinals:[1]};
 assert.equal(applyScopeRules(result,original,evidence).classification,'insufficient_evidence');
 const reviewed=applyConcertRoleReview(original,evidence,{checks:[{role:'final_population',state:'known',value:'persones amb discapacitat intel·lectual',kind:'population',evidence_ordinal:1}]});
 assert.equal(applyScopeRules(result,reviewed.roles,evidence).classification,'in_portfolio');assert.equal(original.final_population?.state,'unknown');assert.equal(reviewed.roles.economic_recipient?.value,'Fundació Mercè Pla');
 const unresolved=applyConcertRoleReview(original,evidence,{checks:[{...unknown,role:'final_population'}]});assert.equal(applyScopeRules(result,unresolved.roles,evidence).classification,'insufficient_evidence');
});
test('an intermediary or a contradiction does not supply a final population automatically',()=>{
 const r={...roles,final_population:{...fact,state:'unknown' as const,value:null,kind:'unknown',quotes:[],evidence_ordinals:[]},direct_beneficiary:{...fact,kind:'entity',value:'Entitat intermediària'}};
 const unresolved=applyConcertRoleReview(r,chunks,{checks:[known,{...unknown,role:'final_population'}]});assert.equal(unresolved.roles.final_population?.state,'unknown');
 const contradicted={...r,final_population:{...r.final_population,state:'contradictory' as const}};assert.deepEqual(concertRolesNeedingReview(contradicted,chunks),['final_service']);
});
test('v2 provider schema requires explicit value and kind',()=>{
 assert.deepEqual(concertRoleReviewSchema(['final_population'],2).properties.checks.items.required,['role','state','value','kind','evidence_ordinal']);
});
