import test from 'node:test';
import assert from 'node:assert/strict';
import {independentPendingMessage} from '../lib/convenis/independent-pending-message';

test('explains missing NIF and possible duplication without discarding the units',()=>{
 const missing=independentPendingMessage('SIBLING_IDENTITY_UNRESOLVED');
 assert.match(missing,/NIF/);
 assert.match(missing,/pendents/);
 const overlap=independentPendingMessage('POSSIBLE_PERIOD_OVERLAP');
 assert.match(overlap,/mateixa entitat i període/);
 assert.match(overlap,/evitar duplicitats/);
});

test('explains missing and excessive public totals separately',()=>{
 assert.match(independentPendingMessage('PUBLIC_TOTAL_UNRESOLVED'),/No s’ha pogut determinar el total públic/);
 assert.match(independentPendingMessage('PUBLIC_TOTAL_EXCEEDED'),/superen el total públic/);
 assert.match(independentPendingMessage('UNKNOWN_REASON'),/pendents de revisió/);
});
