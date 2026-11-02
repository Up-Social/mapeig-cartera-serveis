import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseEconomicPreview} from '../lib/convenis/economic-preview';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const candidate={jobId:id(1),unitId:id(2),receiptId:id(3),linkId:id(4),reviewer:'Revisora'};
const recovery={provisionId:id(5),reviewer:'Revisora',note:'Nota',exports:[{eventId:id(6),createdAt:'2026-01-01T00:00:00Z',sha256:'a'.repeat(64)}]};
test('accepts current legacy and independent endpoint shapes',()=>{
 assert.equal(parseEconomicPreview({candidate,recovery:null},id(1),id(2)).candidate?.linkId,id(4));
 assert.equal(parseEconomicPreview({candidate:null,recovery},id(1),id(2)).recovery?.provisionId,id(5));
 assert.equal(parseEconomicPreview({candidate:{...candidate,previousId:null},recovery:{...recovery,current:false},independent:true,pendingReason:null},id(1),id(2)).independent,true);
 assert.equal(parseEconomicPreview({candidate:null,recovery:null,independent:true,pendingReason:'SIBLING_IDENTITY_UNRESOLVED'},id(1),id(2)).pendingReason,'SIBLING_IDENTITY_UNRESOLVED');
});
test('rejects incomplete, out-of-scope or malformed candidates and recoveries',()=>{
 for(const value of [{},{candidate:null},{candidate:{...candidate,unitId:id(9)},recovery:null},{candidate:{...candidate,jobId:id(9)},recovery:null},{candidate:{...candidate,receiptId:'invalid'},recovery:null},{candidate:{...candidate,previousId:'invalid'},recovery:null,independent:true,pendingReason:null},{candidate:null,recovery:{...recovery,exports:[{...recovery.exports[0],sha256:'bad'}]}},{candidate,recovery},{candidate:null,recovery:{...recovery},independent:true,pendingReason:null}])assert.throws(()=>parseEconomicPreview(value,id(1),id(2)),/No es pot verificar/);
});
