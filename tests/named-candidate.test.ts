import test from 'node:test';import assert from 'node:assert/strict';
import {addNamedCandidates,bindExplicitCodeCandidates} from '../lib/named-candidate';import type {AnalysisOutput} from '../lib/analysis-contract';import type {OfficialService} from '../lib/official-catalog';
const service={service_code:'1.2.7.5',service_name:'Servei prelaboral',benefit_type:'service',legal_reference:'legal',description:'Preparació laboral',target_population:'Persones amb malaltia mental',conditions:'Acreditació',normative_fields:{}} as OfficialService;
const base:AnalysisOutput={classification:'in_portfolio',reasons:[],explanation:'El document acredita un servei social específic.',service_description:'Modificació de places de serveis prelaborals',target_population:'Persones amb malaltia mental',evidence_ordinals:[1],population_verified:true,social_service_verified:true,candidates:[]};
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
});
test('a literal code without a matching service description is not sufficient',()=>{
 const value={...base,candidates:[{code:service.service_code,score:.8,population_compatible:true,legal_reference:'legal',evidence_ordinals:[1],rationale:'Candidat inicial acreditat per altres fets.',evidence_explanation:'Descripció del servei acreditada.'}]};
 const result=bindExplicitCodeCandidates(value,[service],[{content:'Referència tècnica 1.2.7.5 sense descripció del servei ni destinataris.'}]);
 assert.deepEqual(result,value);
});
