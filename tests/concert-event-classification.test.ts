import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyConcertEvent} from '../lib/concerts/event-classification';

test('a titled correction of an earlier renewal remains an amendment without new financing',()=>{
 for(const title of [
  'Resolució d’esmena de la resolució de pròrroga i autorització de la despesa',
  'Resolució de rectificació de la modificació del concert social',
  'Esmena de la resolució de provisió de serveis de concert social',
 ])assert.deepEqual(classifyConcertEvent(title,'La resolució anterior inclou la pròrroga.'),{eventType:'esmena',countsAsNewFinancing:false});
});

test('an incidental correction reference does not reclassify a titled renewal',()=>{
 assert.deepEqual(classifyConcertEvent('Pròrroga del concert social','Inclou una referència a una esmena anterior.'),{eventType:'prorroga',countsAsNewFinancing:false});
});

test('a rectification within a longer title does not become new financing',()=>{
 assert.deepEqual(classifyConcertEvent('Resolució per la qual es fa una rectificació de la provisió de places de concert social',''),{eventType:'esmena',countsAsNewFinancing:false});
});
