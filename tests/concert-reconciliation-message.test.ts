import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CloudFailure,failureMessage} from '../lib/cloud/errors';

test('concert reconciliation explains the precise accounting failure without exposing provider details',()=>{
 const reasons=['receipt_not_received','unsupported_receipt_phase','invalid_receipt_usage','usage_missing','usage_mismatch','reservation_missing','settlement_pending','unsupported_pricing','settlement_mismatch','orphan_reservation','orphan_usage'];
 const messages=reasons.map(reason=>failureMessage(new CloudFailure('provider_reconciliation',5,{operation:'concert_discard_review',code:'EXISTING_PROVIDER_RECEIPT_REVIEW_REQUIRED',message:'PRIVATE RESPONSE',details:{reason,raw:'SECRET'}})));
 assert.equal(new Set(messages).size,reasons.length);
 for(const message of messages){assert.doesNotMatch(message,/PRIVATE|SECRET/);assert.match(message,/Cal/);}
 assert.match(messages[3],/falta registrar-ne el consum/);
 assert.match(messages[6],/pendent de liquidar/);
});

test('unknown or unrelated diagnostic reasons preserve the safe generic message',()=>{
 for(const [operation,reason] of [['concert_discard_review','PRIVATE'],['conveni_analysis','usage_missing']]){
  const message=failureMessage(new CloudFailure('provider_reconciliation',5,{operation,code:'EXISTING_PROVIDER_RECEIPT_REVIEW_REQUIRED',details:{reason}}));
  assert.match(message,/pendents de conciliació/);assert.doesNotMatch(message,/PRIVATE/);
 }
});
