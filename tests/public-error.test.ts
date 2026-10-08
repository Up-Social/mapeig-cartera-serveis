import assert from 'node:assert/strict';
import test from 'node:test';
import {publicErrorMessage} from '../lib/public-error';

test('an active task conflict tells the operator to wait rather than showing a generic failure',()=>{
 assert.equal(publicErrorMessage(new Error('ACTIVE_TASK')),'Ja hi ha un procés actiu per a aquest registre.');
});
