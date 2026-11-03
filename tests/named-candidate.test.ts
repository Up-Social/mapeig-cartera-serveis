import test from 'node:test';import assert from 'node:assert/strict';
import {addNamedCandidates,bindExplicitCodeCandidates,keepOfficiallyNamedCandidates,findExplicitServiceEvidence,prioritizeExplicitServices} from '../lib/named-candidate';import type {AnalysisOutput} from '../lib/analysis-contract';import type {OfficialService} from '../lib/official-catalog';
const service={service_code:'1.2.7.5',service_name:'Servei prelaboral',benefit_type:'service',legal_reference:'legal',description:'Preparació laboral',target_population:'Persones amb malaltia mental',conditions:'Acreditació',normative_fields:{}} as OfficialService;
const base:AnalysisOutput={classification:'in_portfolio',reasons:[],explanation:'El document acredita un servei social específic.',service_description:'Modificació de places de serveis prelaborals',target_population:'Persones amb malaltia mental',evidence_ordinals:[1],population_verified:true,social_service_verified:true,candidates:[]};
test('explicit codes prioritize the catalog but never remove other eligible services',()=>{
 const other={...service,service_code:'1.2.7.6',service_name:'Servei de tutela'};
 assert.deepEqual(prioritizeExplicitServices([other,service],[{service}]).map(s=>s.service_code),['1.2.7.5','1.2.7.6']);
 assert.deepEqual(prioritizeExplicitServices([other,service],[]).map(s=>s.service_code),['1.2.7.6','1.2.7.5']);
});
test('a named service is proposed only when description and official evidence agree',()=>{
 const result=addNamedCandidates(base,[service],[{content:'Resolució de places de serveis prelaborals per a persones amb malaltia mental.'}]);
 assert.deepEqual(result.candidates.map(candidate=>candidate.code),['1.2.7.5']);
 assert.equal(addNamedCandidates(base,[service],[{content:'Resolució de places residencials.'}]).candidates.length,0);
});
test('explicit official codes with matching descriptions replace unsupported alternatives',()=>{
 const services=[
  {...service,service_code:'1.2.3.3.2.1',service_name:'Servei de residència assistida per a gent gran amb risc social de caràcter temporal o permanent'},
  {...service,service_code:'1.2.3.3.2.2',service_name:'Servei de residència assistida per a gent gran de caràcter temporal o permanent. Grau II'},
  {...service,service_code:'1.2.3.3.2.3',service_name:'Servei de residència assistida per a gent gran de caràcter temporal o permanent. Grau III'},
 ];
 const value={...base,candidates:[
  {code:'1.2.3.3.2.1',score:.8,population_compatible:true,legal_reference:'legal',evidence_ordinals:[1],rationale:'Alternativa no citada al document oficial.',evidence_explanation:'Text genèric sense codi acreditat.'},
 ]};
 const evidence=[{content:'Annex: 1.2.3.3.2.2 Servei de residència assistida per a gent gran de caràcter temporal o permanent. Grau II. 1.2.3.3.2.3 Servei de residència assistida per a gent gran de caràcter temporal o permanent. Grau III.'}];
 const result=bindExplicitCodeCandidates(value,services,evidence);
 assert.deepEqual(result.candidates.map(candidate=>candidate.code),['1.2.3.3.2.2','1.2.3.3.2.3']);
 assert.deepEqual(result.candidates.map(candidate=>candidate.evidence_ordinals),[[1],[1]]);
 assert.deepEqual(result.evidence_ordinals,[1]);
 assert.match(result.explanation,/1\.2\.3\.3\.2\.2/);
 assert.match(result.explanation,/1\.2\.3\.3\.2\.3/);
 assert.deepEqual(findExplicitServiceEvidence(services,evidence).map(item=>item.service.service_code),['1.2.3.3.2.2','1.2.3.3.2.3']);
});
test('a literal code without a matching service description is not sufficient',()=>{
 const value={...base,candidates:[{code:service.service_code,score:.8,population_compatible:true,legal_reference:'legal',evidence_ordinals:[1],rationale:'Candidat inicial acreditat per altres fets.',evidence_explanation:'Descripció del servei acreditada.'}]};
 const result=bindExplicitCodeCandidates(value,[service],[{content:'Referència tècnica 1.2.7.5 sense descripció del servei ni destinataris.'}]);
 assert.deepEqual(result,value);
});
test('terminal punctuation after a code is allowed, but a longer child code is distinct',()=>{
 assert.equal(findExplicitServiceEvidence([service],[{content:'1.2.7.5. Servei prelaboral per a persones.'}]).length,1);
 assert.equal(findExplicitServiceEvidence([service],[{content:'1.2.7.5.1 Servei prelaboral per a persones.'}]).length,0);
});
test('a different candidate with its complete name in its own evidence is retained for audit',()=>{
 const other={...service,service_code:'1.2.7.6',service_name:'Servei de tutela per a persones amb malaltia mental'};
 const candidate={code:other.service_code,score:.8,population_compatible:true,legal_reference:'legal',evidence_ordinals:[2],rationale:'Proposta per revisar.',evidence_explanation:'Denominació documental.'};
 const evidence=[{content:'1.2.7.5 Servei prelaboral per a persones.'},{content:'Servei de tutela per a persones amb malaltia mental.'}];
 const result=bindExplicitCodeCandidates({...base,candidates:[candidate]},[service,other],evidence);
 assert.deepEqual(result.candidates.map(c=>c.code),['1.2.7.5','1.2.7.6']);
 assert.deepEqual(result.evidence_ordinals,[1,2]);
});

test('a Concert candidate whose official name is cited survives unaccredited individual conditions (S1-8)',async()=>{
 const {normalizeCandidates}=await import('../lib/cloud/normalize-candidates');
 const pil={...service,service_code:'1.2.1.7',service_name:"Servei de residència o pisos per a joves vinculats a programes d'inserció laboral"} as OfficialService;
 const chunks=[{content:'Resolució de provisió.'},{content:"RESOLC: Assignar a l’entitat el SERVEI DE RESIDÈNCIA O PISOS PER A JOVES VINCULATS A PROGRAMES D'INSERCIÓ LABORAL (PIL) en règim de concert social. Assignació de 4 places."}];
 const candidate={code:'1.2.1.7',score:.97,rationale:'Encaix.',legal_reference:'legal',evidence_ordinals:[2],evidence_explanation:'No consta la tutela de cada jove.',population_compatible:false};
 const value={...base,candidates:[candidate]} as AnalysisOutput;
 assert.equal(normalizeCandidates(value,[pil],2).classification,'insufficient_evidence');
 const kept=keepOfficiallyNamedCandidates(value,[pil],chunks);
 assert.equal(kept.candidates[0].population_compatible,true);assert.match(kept.candidates[0].evidence_explanation,/condicions individuals/);
 assert.equal(normalizeCandidates(kept,[pil],2).classification,'in_portfolio');
 for(const other of [{...candidate,evidence_ordinals:[1]},{...candidate,code:'9.9'}])assert.equal(keepOfficiallyNamedCandidates({...value,candidates:[other]} as AnalysisOutput,[pil],chunks).candidates[0].population_compatible,false);
 assert.equal(value.candidates[0].population_compatible,false);
});
