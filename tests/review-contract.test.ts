import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewValidation,REVIEW_LABELS} from '../lib/review-contract';
test('four review decisions share exact labels and mandatory explanations',()=>{
 assert.equal(Object.keys(REVIEW_LABELS).length,4);
 for(const outcome of ['reject','outside','insufficient'] as const)assert.ok(reviewValidation(outcome,'',[]));
 assert.ok(reviewValidation('reject','Explained',[]));
 assert.ok(reviewValidation('reject','Explained',['made_up']));
 assert.equal(reviewValidation('reject','Explained',['individual_grant']),null);
 assert.ok(reviewValidation('select','',[],true));
 assert.equal(reviewValidation('select','',[]),null);
});
