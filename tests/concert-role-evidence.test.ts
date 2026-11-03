import test from 'node:test';
import assert from 'node:assert/strict';
import {applyConcertRoleReview,applyConcertRoleReviewWithDiagnostics,concertRolesNeedingReview,concertRoleReviewSchema,recoverOperativeConcertObject,exactConcertFinalServiceAccreditation} from '../lib/concerts/role-evidence';
import {applyScopeRules,hasLiteralRoleEvidence,type RoleFacts} from '../lib/scope-rules';
import type {AnalysisOutput} from '../lib/analysis-contract';
import {readFileSync} from 'node:fs';
const chunks=[{content:'No s’adjudica el servei de pis assistit per a joves majors de 18 anys.'},
 {content:'Resolc assignar el servei de pis assistit per a joves majors de 18 anys a l’entitat que consta a l’annex.'}];
const fact={state:'known' as const,value:'servei de pis assistit',kind:'yes',evidence_ordinals:[1],quotes:['Es finança el servei de pis assistit.']};
const roles:Partial<RoleFacts>={final_service:fact,financed_object:{...fact,kind:'service_financing',evidence_ordinals:[2],quotes:[chunks[1].content]},final_population:{...fact,kind:'population',value:'joves majors de 18 anys',evidence_ordinals:[2],quotes:[chunks[1].content]}};
const known={role:'final_service',state:'known',value:fact.value,kind:fact.kind,evidence_ordinal:2};
const unknown={role:'final_service',state:'unknown',value:null,kind:'unknown',evidence_ordinal:0};
test('exact audited candidates accredit only final service, without inferred candidate evidence',()=>{
 const initial={final_service:fact};
 const aligned={final_service:{...fact,state:'unknown' as const,quotes:[],evidence_ordinals:[]}};
 const explicit=[{code:'1.2.6.2.4.2',ordinals:[2]}];
 const accreditation=exactConcertFinalServiceAccreditation(initial,aligned,['1.2.6.2.4.1.1','1.2.6.2.4.2'],explicit,chunks);
 assert.deepEqual(accreditation,{kind:'yes',evidence_ordinals:[2],basis:'official_service_code_and_description'});
 assert.equal(exactConcertFinalServiceAccreditation(initial,aligned,['1.2.6.2.4.1.1'],explicit,chunks),undefined);
 for(const replacement of [{...fact,kind:'no'},{...fact,state:'contradictory' as const},{...fact,kind:'unknown'}]){
  assert.equal(exactConcertFinalServiceAccreditation({final_service:replacement},aligned,['1.2.6.2.4.2'],explicit,chunks),undefined);
  assert.equal(exactConcertFinalServiceAccreditation(initial,{final_service:replacement},['1.2.6.2.4.2'],explicit,chunks),undefined);
 }
 for(const ordinals of [[],[0],[3],[1.5]])assert.equal(exactConcertFinalServiceAccreditation(initial,aligned,['1.2.6.2.4.2'],[{code:'1.2.6.2.4.2',ordinals}],chunks),undefined);
 const original={classification:'in_portfolio',reasons:[],candidates:[],evidence_ordinals:[2],explanation:'Documentat',service_description:'Servei',target_population:'Pendent',population_verified:false,social_service_verified:true} as AnalysisOutput;
 const scoped=applyScopeRules(original,{financed_object:roles.financed_object,final_service:aligned.final_service},chunks,{final_service:accreditation!});
 assert.equal(scoped.classification,'insufficient_evidence');
 assert.deepEqual(scoped.rule_audit.blocked_roles,[{role:'final_population',reason:'missing_fact'}]);
});
test('a literal operative allocation can replace an ungrounded generic Concert object',()=>{
 const source=[{content:'RESOLC: 1. Assignar la plaça, en règim de concert social, a l’entitat exposada a l’Annex d’aquesta resolució, mitjançant procediment de modificació.'}];
 const previous={financed_object:{state:'known' as const,kind:'other',value:'Assignació de plaça',evidence_ordinals:[1],quotes:['Una cita diferent que no consta al document.']}};
 const recovered=recoverOperativeConcertObject(previous,source);
 assert.equal(recovered.recovered,true);assert.equal(recovered.roles?.financed_object?.kind,'service_financing');
 assert.equal(hasLiteralRoleEvidence(recovered.roles?.financed_object,source),true);assert.equal(previous.financed_object.kind,'other');
 for(const altered of [
  'RESOLC: 1. No assignar la plaça, en règim de concert social, a l’entitat.',
  'Es proposa assignar la plaça, en règim de concert social, a l’entitat.',
  'RESOLC: 1. Assignar la plaça, en règim de cessió, a l’entitat.',
 ])assert.equal(recoverOperativeConcertObject(previous,[{content:altered}]).recovered,false);
 assert.equal(recoverOperativeConcertObject(previous,[...source,...source]).recovered,false);
 assert.equal(recoverOperativeConcertObject({financed_object:{...previous.financed_object,state:'contradictory'}},source).recovered,false);
 assert.equal(recoverOperativeConcertObject({financed_object:{...previous.financed_object,quotes:[source[0].content]}},source).recovered,false);
});
test('S1-10 plural operative allocation recovers only its unsupported object',()=>{
 const clause='Assignar les places, en règim de concert social, a les entitats exposades a l’Annex d’aquesta resolució, mitjançant procediment de provisió directa';
 const source=[{content:`RESOLC: 1. ${clause}.`}];
 const previous={financed_object:{state:'known' as const,kind:'other',value:'Assignació de 13 places',evidence_ordinals:[1],quotes:['Cita històrica que no es troba al fragment.']},final_population:roles.final_population};
 const result=recoverOperativeConcertObject(previous,source);
 assert.equal(result.recovered,true);
 assert.equal(result.roles?.financed_object?.kind,'service_financing');
 assert.equal(hasLiteralRoleEvidence(result.roles?.financed_object,source),true);
 assert.equal(result.roles?.final_population,previous.final_population);
 assert.equal(result.roles?.final_service,undefined);
 assert.equal(previous.financed_object.kind,'other');
 for(const content of [`RESOLC: 1. No ${clause}`,`Es proposa ${clause}`,`RESOLC: 1. Es proposa ${clause}`,`RESOLC: 1. ${clause.replace('concert social','cessió')}`]){
  assert.equal(recoverOperativeConcertObject(previous,[{content}]).recovered,false);
 }
 for(const fact of [{...previous.financed_object,state:'contradictory' as const},{...previous.financed_object,quotes:[clause]}]){
  assert.equal(recoverOperativeConcertObject({...previous,financed_object:fact},source).recovered,false);
 }
 assert.equal(recoverOperativeConcertObject(previous,[...source,...source]).recovered,false);
});
test('S1-1 official resolution contains the operative allocation used as evidence',()=>{
 const text=readFileSync('tests/fixtures/official/nen-deu-modification-2025.txt','utf8');
 const fact={state:'known' as const,kind:'other',value:'Modificació i assignació d’una plaça',evidence_ordinals:[1],quotes:['Cita anterior no localitzable.']};
 const result=recoverOperativeConcertObject({financed_object:fact},[{content:text}]);
 assert.equal(result.recovered,true);assert.match(result.roles?.financed_object?.quotes[0]??'',/Assignar la plaça, en règim de concert social/);
 assert.equal(hasLiteralRoleEvidence(result.roles?.financed_object,[{content:text}]),true);
});
test('a value mentioned in a negation cannot repair its own evidence',()=>{
 assert.deepEqual(concertRolesNeedingReview(roles,chunks),['final_service']);assert.equal(hasLiteralRoleEvidence(fact,chunks),false);
 assert.throws(()=>applyConcertRoleReview(roles,chunks,undefined));
 const rejected=applyConcertRoleReview(roles,chunks,{checks:[unknown]});assert.equal(rejected.roles.final_service?.state,'unknown');assert.equal(hasLiteralRoleEvidence(rejected.roles.final_service,chunks),false);
});
test('independent review selects the complete literal source and preserves the known fact',()=>{
 const reviewed=applyConcertRoleReview(roles,chunks,{checks:[known]});assert.deepEqual(reviewed.roles.final_service?.quotes,[chunks[1].content]);assert.deepEqual(reviewed.roles.final_service?.evidence_ordinals,[2]);assert.equal(hasLiteralRoleEvidence(reviewed.roles.final_service,chunks),true);assert.deepEqual(roles.final_service,fact);
 for(const patch of [{value:'servei residencial'}, {kind:'no'}])assert.throws(()=>applyConcertRoleReview(roles,chunks,{checks:[{...known,...patch}]}),/CHANGED_FACT/);
});
test('case-only changes in a reviewed fact do not become a contradiction',()=>{
 const initial={...roles,final_population:{...roles.final_population!,value:'Persones amb discapacitat intel·lectual',quotes:['Cita anterior no localitzable al fragment seleccionat.']}};
 const evidence=[{content:'Resolc assignar el servei a persones amb discapacitat intel·lectual i en faig constar la població destinatària.'},chunks[1]];
 const review=[{...known,evidence_ordinal:2},{role:'final_population',state:'known',kind:'population',value:'persones amb discapacitat intel·lectual',evidence_ordinal:1}];
 const checked=applyConcertRoleReviewWithDiagnostics(initial,evidence,{checks:review});
 assert.equal(checked.roles.final_population?.state,'known');
 assert.equal(checked.roles.final_population?.value,'Persones amb discapacitat intel·lectual');
 assert.deepEqual(checked.issues,[]);
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

test('a nonliteral role reply becomes a field diagnosis without losing independently supported roles',()=>{
 const missing={state:'unknown' as const,value:null,kind:'unknown',evidence_ordinals:[],quotes:[]};
 const original={...roles,final_population:missing};
 const checked=applyConcertRoleReviewWithDiagnostics(original,chunks,{checks:[known,{role:'final_population',state:'known',value:'persones destinatàries inventades',kind:'population',evidence_ordinal:2}]});
 assert.equal(checked.roles.final_service?.state,'known');assert.equal(checked.roles.final_population?.state,'unknown');
 assert.deepEqual(checked.issues,[{role:'final_population',code:'unverifiable_quote',ordinal:2}]);
 assert.deepEqual(original.final_service,fact);assert.deepEqual(original.final_population,missing);
 assert.throws(()=>applyConcertRoleReviewWithDiagnostics(original,chunks,{checks:[known,known]}));
});

test('diagnostic recovery does not replace a known fact or accept a malformed response',()=>{
 const checked=applyConcertRoleReviewWithDiagnostics(roles,chunks,{checks:[{...known,value:'altre servei sense acreditar'}]});
 assert.equal(checked.roles.final_service?.state,'unknown');assert.equal(checked.roles.final_service?.value,fact.value);
 assert.equal(checked.issues[0].code,'changed_fact');
 assert.throws(()=>applyConcertRoleReviewWithDiagnostics(roles,chunks,{checks:[{...known,evidence_ordinal:999}]}));
});

test('an explicitly unknown reply never supplies its uncited value as a fact',()=>{
 const uncertain={...unknown,value:'servei sense cita',kind:'yes'};
 const checked=applyConcertRoleReviewWithDiagnostics(roles,chunks,{checks:[uncertain]});
 assert.equal(checked.roles.final_service?.state,'unknown');
 assert.deepEqual(checked.roles.final_service?.evidence_ordinals,[]);
 assert.deepEqual(checked.issues,[{role:'final_service',code:'inconsistent_unknown',ordinal:0}]);
 assert.throws(()=>applyConcertRoleReview(roles,chunks,{checks:[uncertain]}));
 for(const patch of [{evidence_ordinal:1},{value:{}},{kind:'foreign'}])assert.throws(()=>applyConcertRoleReviewWithDiagnostics(roles,chunks,{checks:[{...uncertain,...patch}]}));
});
