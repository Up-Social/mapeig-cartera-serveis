import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eligibleServices,assertEligible,type OfficialService} from '../lib/official-catalog';
const all=['1','1.1','1.1.2','1.1.2.1','1.1.2.2','2','2.1','3','3.1'].map(service_code=>({service_code,benefit_type:service_code[0]==='1'?'service':service_code[0]==='2'?'economic':'technological'} as OfficialService));
test('only service leaves; complete hierarchy excludes every parent',()=>assert.deepEqual(eligibleServices(all).map(s=>s.service_code),['1.1.2.1','1.1.2.2']));
test('manual and model codes cannot select parents, unknown or excluded benefits',()=>{for(const c of ['1.1.2','2.1','3.1','1.9'])assert.throws(()=>assertEligible(c,all));assert.equal(assertEligible('1.1.2.1',all).service_code,'1.1.2.1');});
