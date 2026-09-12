import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eligibleServices,assertEligible,type OfficialService} from '../lib/official-catalog';
const all=['1','1.1','1.1.2','1.1.2.1','1.1.2.2','2','2.1','3','3.1'].map(service_code=>({service_code,benefit_type:service_code[0]==='1'?'service':service_code[0]==='2'?'economic':'technological'} as OfficialService));
test('only service leaves; complete hierarchy excludes every parent',()=>assert.deepEqual(eligibleServices(all).map(s=>s.service_code),['1.1.2.1','1.1.2.2']));
test('manual and model codes cannot select parents, unknown or excluded benefits',()=>{for(const c of ['1.1.2','2.1','3.1','1.9'])assert.throws(()=>assertEligible(c,all));assert.equal(assertEligible('1.1.2.1',all).service_code,'1.1.2.1');});
import snapshot from '../data/legal/cartera.json';
import {validateCatalog,normativeContext} from '../lib/official-catalog';
test('official snapshot has validated complete hierarchy and excludes the documented repeal',()=>{const services=snapshot.services as OfficialService[];validateCatalog(services);assert.equal(snapshot.version.validated,true);assert.equal(services.length,190);assert.equal(services.some(s=>s.service_code==='1.2.4'||s.service_code.startsWith('1.2.4.')),false);const leaf=services.find(s=>s.service_code==='1.1.2.1')!;assert.deepEqual(normativeContext(leaf,services).map(s=>s.code),['1','1.1','1.1.2','1.1.2.1']);});
