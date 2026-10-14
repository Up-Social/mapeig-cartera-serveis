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
