import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildHistoricalConcertImportPlan} from '../lib/concerts/historical-import-plan';
import {HISTORICAL_CONCERT_TERMS,type HistoricalQuery} from '../lib/concerts/historical-discovery';
const query:HistoricalQuery[]=[
 {term:HISTORICAL_CONCERT_TERMS[0],pages:[{currentPage:0,totalPages:1,totalEdictes:2,edictes:[
  {id_edicte:'12',titol:'Pròrroga de concert social',descripcio:'',data_publicacio:'2022-01-01',tags:[]},
  {id_edicte:'13',titol:'Concert social actual',descripcio:'',data_publicacio:'2024-01-01',tags:[]},
 ]}]},
 {term:HISTORICAL_CONCERT_TERMS[1],pages:[{currentPage:0,totalPages:0,totalEdictes:0,edictes:[]}]},
];
test('builds the existing e-Tauler record shape for the historical window without writes',()=>{
 const plan=buildHistoricalConcertImportPlan(query,'2026-10-29T12:00:00.000Z');
 assert.equal(plan.rows.length,1);assert.equal(plan.coverage,'pages_validated_not_source_exhaustive');
 const row=plan.rows[0];assert.equal(row.source_dataset,'concerts');assert.equal(row.source_record_id,'etauler:1:12');
 assert.equal(row.source_payload.event_type,'prorroga');assert.equal(row.source_payload.counts_as_new_financing,false);
 assert.equal(row.source_payload.record_url,'https://tauler.seu-e.cat/detall?idEns=1&idEdicte=12');
 assert.equal(row.source_payload.period_to,'2023-12-31');assert.match(row.source_payload_hash,/^[a-f0-9]{64}$/);
 assert.deepEqual(plan,buildHistoricalConcertImportPlan(query,'2026-10-29T12:00:00.000Z'));
});
test('invalid timestamps and incomplete scans cannot produce an import plan',()=>{
 assert.throws(()=>buildHistoricalConcertImportPlan(query,'2026-02-31T12:00:00.000Z'));
 assert.throws(()=>buildHistoricalConcertImportPlan(query.slice(0,1),'2026-10-29T12:00:00.000Z'));
});
