import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parsePreparationPreview} from '../lib/convenis/preparation-preview';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const base={independent:false,versionedHistory:null,history:{hasHistory:false},observations:[],operation:null,historyUnavailable:false,reconciliationAvailable:false,operationHistory:[]};

test('accepts a complete empty preview and rejects incomplete responses',()=>{
 assert.deepEqual(parsePreparationPreview(base,id(4),id(1),id(2)),base);
 assert.throws(()=>parsePreparationPreview({},id(4),id(1),id(2)),/No es pot verificar/);
 assert.throws(()=>parsePreparationPreview({...base,observations:[{}]},id(4),id(1),id(2)),/No es pot verificar/);
 assert.throws(()=>parsePreparationPreview({...base,history:{hasHistory:true}},id(4),id(1),id(2)),/No es pot verificar/);
});

test('a recoverable operation must belong to this job and unit',()=>{
 const operation={id:id(3),record_id:id(4),job_id:id(1),unit_id:id(2),state:'pending',ids:{ackId:id(5),draftId:id(6),receiptId:id(7),linkId:id(8)},payload:{jobId:id(1),unitId:id(2),reviewer:'Persona',note:'Nota de revisió',literal:'10,00',monetaryId:id(9),identityId:id(10),rolePeriodId:id(11),historySnapshot:null}};
 assert.equal(parsePreparationPreview({...base,operation},id(4),id(1),id(2)).operation?.id,id(3));
 assert.throws(()=>parsePreparationPreview({...base,operation},id(4),id(1),id(12)),/No es pot verificar/);
 assert.throws(()=>parsePreparationPreview({...base,operation},id(12),id(1),id(2)),/No es pot verificar/);
 assert.throws(()=>parsePreparationPreview({...base,operation:{...operation,ids:{...operation.ids,receiptId:'incorrecte'}}},id(4),id(1),id(2)),/No es pot verificar/);
});

test('both legacy and versioned history must belong to the requested scope',()=>{
 const event={id:id(15),job_id:id(14),outcome:'select',reason:'Revisió anterior',created_at:'2026-11-01T10:00:00Z',declared_actor:'Revisora',previous:null};
 const snapshot={record_id:id(4),job_id:id(1),unit_id:id(2),previous_id:id(15),events:[event]};
 const versioned={record_id:id(4),unit_id:id(2),previous_id:id(16),events:[{...event,id:id(16),amount_cents:1000,service_code:'1.2.3'}]};
 assert.equal(parsePreparationPreview({...base,history:{hasHistory:true,snapshot}},id(4),id(1),id(2)).history.snapshot?.previous_id,id(15));
 assert.equal(parsePreparationPreview({...base,independent:true,versionedHistory:versioned},id(4),id(1),id(2)).versionedHistory?.previous_id,id(16));
 for(const bad of [{...snapshot,record_id:id(9)},{...snapshot,job_id:id(9)},{...snapshot,unit_id:id(9)}])assert.throws(()=>parsePreparationPreview({...base,history:{hasHistory:true,snapshot:bad}},id(4),id(1),id(2)),/No es pot verificar/);
 for(const bad of [{...snapshot,events:[]},{...snapshot,previous_id:id(9)},{...snapshot,events:[event,event]}])assert.throws(()=>parsePreparationPreview({...base,history:{hasHistory:true,snapshot:bad}},id(4),id(1),id(2)),/No es pot verificar/);
 assert.throws(()=>parsePreparationPreview({...base,history:{hasHistory:false,snapshot}},id(4),id(1),id(2)),/No es pot verificar/);
 for(const bad of [{...versioned,record_id:id(9)},{...versioned,unit_id:id(9)}])assert.throws(()=>parsePreparationPreview({...base,independent:true,versionedHistory:bad},id(4),id(1),id(2)),/No es pot verificar/);
 for(const bad of [{...versioned,events:[]},{...versioned,previous_id:null},{...versioned,previous_id:id(9)}])assert.throws(()=>parsePreparationPreview({...base,independent:true,versionedHistory:bad},id(4),id(1),id(2)),/No es pot verificar/);
 const operation={id:id(3),record_id:id(4),job_id:id(1),unit_id:id(2),state:'pending',ids:{ackId:id(5),draftId:id(6),receiptId:id(7),linkId:id(8)},payload:{jobId:id(1),unitId:id(2),reviewer:'Persona',note:'Nota de revisió',literal:'10,00',monetaryId:id(9),identityId:id(10),rolePeriodId:id(11),historySnapshot:snapshot,versionedHistorySnapshot:versioned}};
 assert.equal(parsePreparationPreview({...base,independent:true,versionedHistory:versioned,operation},id(4),id(1),id(2)).operation?.id,id(3));
 const legacyPayload:Record<string,unknown>={...operation.payload};delete legacyPayload.versionedHistorySnapshot;
 assert.equal(parsePreparationPreview({...base,independent:true,versionedHistory:versioned,operation:{...operation,payload:legacyPayload}},id(4),id(1),id(2)).operation?.id,id(3),'legacy preparation remains readable');
 assert.throws(()=>parsePreparationPreview({...base,operation:{...operation,payload:{...operation.payload,historySnapshot:{...snapshot,unit_id:id(9)}}}},id(4),id(1),id(2)),/No es pot verificar/);
 assert.throws(()=>parsePreparationPreview({...base,independent:true,operation:{...operation,payload:{...operation.payload,versionedHistorySnapshot:{...versioned,record_id:id(9)}}}},id(4),id(1),id(2)),/No es pot verificar/);
});

test('guard state is accepted only when its blocked field is a boolean',()=>{
 assert.deepEqual(parsePreparationPreview({...base,preparationGuard:{blocked:true}},id(4),id(1),id(2)).preparationGuard,{blocked:true});
 for(const preparationGuard of [null,{}, {blocked:'yes'}, {blocked:1}])assert.throws(()=>parsePreparationPreview({...base,preparationGuard},id(4),id(1),id(2)),/No es pot verificar/);
 assert.equal(parsePreparationPreview(base,id(4),id(1),id(2)).preparationGuard,undefined,'flag-off responses remain compatible');
});
