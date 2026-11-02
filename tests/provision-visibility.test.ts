import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleEntityRelation,visibleProvision,visibleProvisions} from '../lib/provision-visibility';

test('current data keeps only the database-verified provisions, not stale Convenis or superseded rows',()=>{
 const rows=[
  {id:'current',provision_is_current:true},
  {id:'stale-conveni',provision_is_current:false},
  {id:'superseded',provision_is_current:false},
 ];
 assert.deepEqual(rows.filter(row=>visibleProvision(row,false)).map(row=>row.id),['current']);
 for(const row of [{id:'missing'},{provision_is_current:null},{provision_is_current:'true'},null]){
  assert.throws(()=>visibleProvision(row,false),/falta el camp provision_is_current/);
 }
});

test('relations derived from stale provisions are hidden while independently current RESES survives',()=>{
 const rows=[
  {source_type:'provision',entity_relation_is_current:false},
  {source_type:'reses',entity_relation_is_current:true},
  {source_type:'reses',entity_relation_is_current:false},
 ];
 assert.deepEqual(rows.filter(row=>visibleEntityRelation(row,false)),[rows[1]]);
 for(const row of [{source_type:'reses'},{entity_relation_is_current:null},{entity_relation_is_current:1},null]){
  assert.throws(()=>visibleEntityRelation(row,false),/falta el camp entity_relation_is_current/);
 }
});

test('legacy selection is explicit and preserves existing superseded and retired filtering',()=>{
 assert.equal(visibleProvision({id:'legacy'},true),true);
 assert.equal(visibleProvision({superseded_at:'2026-01-01'},true),false);
 assert.equal(visibleEntityRelation({source_type:'reses'},true),true);
 assert.equal(visibleEntityRelation({retired_at:'2026-01-01'},true),false);
 assert.throws(()=>visibleProvision({id:'legacy'},false));
 assert.throws(()=>visibleEntityRelation({source_type:'reses'},false));
});


test('batch record count follows the export scope even when the current review belongs to a later job',()=>{
 const selectedRecordProvisions=[
  {id:'later-review',provision_is_current:true,review_job_id:'another-job'},
  {id:'old-review',provision_is_current:false,review_job_id:'original-job'},
  {id:'another-unit',provision_is_current:true,review_job_id:'original-job'},
 ];
 const included=visibleProvisions(selectedRecordProvisions,false);
 assert.deepEqual(included.map(item=>item.id),['later-review','another-unit']);
 assert.equal(included.length,2);
 assert.throws(()=>visibleProvisions([{id:'missing-capability'}],false));
});
