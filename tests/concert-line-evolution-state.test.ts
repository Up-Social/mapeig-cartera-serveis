import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyVerifiedLineStates} from '../lib/concerts/line-evolution-state';

test('uses the code of the current verified decision without changing source fingerprint',()=>{
 const unit={id:'one',service_code:null,source_fingerprint:'original',observed_service_code:'untrusted'};
 assert.deepEqual(applyVerifiedLineStates([unit],[{unit_id:'one',state:'current',service_code:'1.2.1.15'}])[0],{...unit,service_code:'1.2.1.15',line_award_state:'current'});
});
test('an omitted or malformed current code fails closed, never substituting the observed code',()=>{
 const unit={id:'one',service_code:'old',source_fingerprint:'original',observed_service_code:'untrusted'};
 for(const code of [undefined,null,'',42])assert.deepEqual(applyVerifiedLineStates([unit],[{unit_id:'one',state:'current',service_code:code}])[0],{...unit,service_code:null,line_award_state:'stale'});
 assert.deepEqual(applyVerifiedLineStates([unit],[{unit_id:'one',state:'stale',service_code:null}])[0],{...unit,line_award_state:'stale'});
 assert.deepEqual(applyVerifiedLineStates([unit],[{unit_id:'one',state:'legacy',service_code:null}])[0],unit);
 for(const rows of [[],[{unit_id:'one',state:'unexpected'}],[{unit_id:'other',state:'legacy'}],[{unit_id:'one',state:'stale',service_code:'1.2.1.15'}]])assert.throws(()=>applyVerifiedLineStates([unit],rows));
 assert.throws(()=>applyVerifiedLineStates([unit,{...unit,id:'two'}],[{unit_id:'one',state:'current',service_code:'1.2.1.15'},{unit_id:'one',state:'legacy'}]));
});
