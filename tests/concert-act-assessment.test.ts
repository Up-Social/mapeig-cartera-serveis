import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessConcertAct} from '../lib/concerts/act-assessment';
import {SPRINT1_CONCERT_CASES} from './fixtures/sprint1-concert-cases';

for(const example of SPRINT1_CONCERT_CASES){
 test(`Sprint 1 PDF casuística ${example.caseNo}: ${example.example}`,()=>{
  const result=assessConcertAct(example.title,example.text);
  assert.equal(result.primaryCase,example.caseNo);
  assert.equal(result.effect,example.effect);
  assert.equal(result.source,'document');
  assert.equal(result.requiresReview,true);
 });
}
test('a generic title cannot create a financing proposal without document text',()=>{
 const result=assessConcertAct('Resolució de l’expedient: 26-000183-AP');
 assert.equal(result.primaryCase,8);
 assert.equal(result.effect,'none');
 assert.equal(result.source,'title');
});
test('renewal with spending authorisation is still a potential new period',()=>{
 const result=assessConcertAct('Pròrroga i autorització de la despesa','Resolc la pròrroga del programa 315 i l’autorització de la despesa del període nou.');
 assert.equal(result.primaryCase,12);
 assert.equal(result.effect,'possible_new_period');
});
test('the operative award prevails over a referenced call in the publication title',()=>{
 const result=assessConcertAct('Resolució de la convocatòria IFE/1632/2025_ Provisió de Serveis SIE Hospitalet 2025-2029',
  'Resolució de provisió. Identificació de la convocatòria IFE/1632/2025. Resolc: 1. Assignar el Servei d’Intervenció Especialitzada a l’entitat INTRESS, amb NIF G08973224.');
 assert.equal(result.primaryCase,16);
 assert.equal(result.effect,'possible_allocation');
 assert.equal(result.source,'document');
});
