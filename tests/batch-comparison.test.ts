import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareSnapshots,summarizeSnapshot} from '../lib/batch-comparison';
test('comparison distinguishes automatic classifications from human decisions and missing cost',()=>{const r=compareSnapshots({analysis:{classification:'discarded'},review:{classification:'out_of_portfolio'}},{analysis:{classification:'in_portfolio'},candidates:[{target_code:'1.2.7.5',score:0.8}]});assert.equal(r.origin.humanClassification,'out_of_portfolio');assert.equal(r.classificationChanged,true);assert.equal(r.humanReviewPending,true);assert.equal(r.current.cost,null);assert.equal(r.current.durationSeconds,null);});

test('comparison treats a non-positive elapsed time as unavailable',()=>{
 const snapshot={job:{created_at:'2026-09-19T08:00:00.000Z',completed_at:'2026-09-19T08:00:00.000Z'}};
 assert.equal(compareSnapshots(snapshot,snapshot).current.durationSeconds,null);
});
test('missing historical data is not reconstructed as a result',()=>{const r=summarizeSnapshot({provenance:{mode:'unrecoverable'}});assert.equal(r.classification,null);assert.deepEqual(r.codes,[]);assert.equal(r.cost,null);});
test('comparison preserves the explicit human reason',()=>{assert.equal(summarizeSnapshot({review:{reason:'Explicació humana'},analysis:{review_notes:'Anterior'}}).humanNotes,'Explicació humana');});
