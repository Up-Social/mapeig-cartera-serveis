import test from 'node:test';import assert from 'node:assert/strict';
import {addNamedCandidates} from '../lib/named-candidate';import type {AnalysisOutput} from '../lib/analysis-contract';import type {OfficialService} from '../lib/official-catalog';
const service={service_code:'1.2.7.5',service_name:'Servei prelaboral',benefit_type:'service',legal_reference:'legal',description:'Preparació laboral',target_population:'Persones amb malaltia mental',conditions:'Acreditació',normative_fields:{}} as OfficialService;
const base:AnalysisOutput={classification:'in_portfolio',reasons:[],explanation:'El document acredita un servei social específic.',service_description:'Modificació de places de serveis prelaborals',target_population:'Persones amb malaltia mental',evidence_ordinals:[1],population_verified:true,social_service_verified:true,candidates:[]};
test('a named service is proposed only when description and official evidence agree',()=>{
 const result=addNamedCandidates(base,[service],[{content:'Resolució de places de serveis prelaborals per a persones amb malaltia mental.'}]);
 assert.deepEqual(result.candidates.map(candidate=>candidate.code),['1.2.7.5']);
 assert.equal(addNamedCandidates(base,[service],[{content:'Resolució de places residencials.'}]).candidates.length,0);
});
