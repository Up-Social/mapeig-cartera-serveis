import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isKnownDiscardRejection} from '../lib/discard-rejection';

test('retained evidence is a confirmed rejection, while transport errors remain uncertain',()=>{
 assert.equal(isKnownDiscardRejection(409,'concert_evidence_retained'),true);
 assert.equal(isKnownDiscardRejection(409,'population_history'),true);
 assert.equal(isKnownDiscardRejection(400,'invalid_selection'),true);
 assert.equal(isKnownDiscardRejection(503,'concert_evidence_retained'),false);
 assert.equal(isKnownDiscardRejection(409,'unrecognised'),false);
});
