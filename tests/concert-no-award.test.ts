import {test} from 'node:test';
import assert from 'node:assert/strict';
import {concertNoAwardTitle} from '../lib/concerts/no-award';

test('unambiguous denial and nonfinal proposal do not become financing',()=>{
 assert.equal(concertNoAwardTitle('RESOLUCIÓ de denegació de la sol·licitud de TALMA')?.kind,'denial');
 assert.equal(concertNoAwardTitle('Acord proposta del Comitè de Provisió de Serveis Socials')?.kind,'proposal');
});
test('a mixed renewal with spending and an award mentioning denial require PDF analysis',()=>{
 assert.equal(concertNoAwardTitle('Pròrroga i autorització de la despesa'),null);
 assert.equal(concertNoAwardTitle('Resolució d’adjudicació de places i denegació de les restants'),null);
});
test('a call cited in the title does not discard the later final award',()=>{
 const title='Resolució de la convocatòria IFE/1632/2025_ Provisió de Serveis SIE Hospitalet 2025-2029';
 const official='Resolució de provisió dels serveis socials. Identificació de la convocatòria IFE/1632/2025. Resolc: 1. Assignar el Servei d’Intervenció Especialitzada a l’entitat INTRESS.';
 assert.equal(concertNoAwardTitle(title),null);
 assert.equal(concertNoAwardTitle(title,official),null);
 assert.equal(concertNoAwardTitle('Resolució DSI/3434/2024 de convocatòria anticipada per a la provisió de places')?.kind,'call');
 assert.equal(concertNoAwardTitle('Proposta de resolució per a la provisió de places','Resolc: 1. Assignar el servei a una entitat.')?.kind,'proposal');
});

test('operative clauses win over mixed title wording without relying on a case name',()=>{
 for(const title of ['Resolució de places denegades i assignades','Resolució de convocatòria de serveis','Resolució de places desertes']){
  for(const text of ['RESOLC\n1. Assignar els serveis a les entitats de l’annex.',
   'Resolc: 1. Denegar les peticions de l’annex 1. 2. Adjudicar les places de l’annex 2.']){
   assert.equal(concertNoAwardTitle(title,text),null);
  }
 }
});
test('negated or proposed awards cannot defeat a no-award decision',()=>{
 for(const text of ['Resolc: 1. No adjudicar les places.','Resolc: 1. Proposar adjudicar les places.'])
  assert.equal(concertNoAwardTitle('Resolució de places denegades',text)?.kind,'denial');
});
