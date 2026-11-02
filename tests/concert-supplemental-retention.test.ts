import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const migration=readFileSync('supabase/migrations/20261102192000_preserve_concert_supplemental_history.sql','utf8');
const base=readFileSync('supabase/migrations/20261030072000_preserve_discarded_review_history.sql','utf8');
const lockAnchor='perform 1 from source_records where id=any(ids) order by id for update nowait;';
const guardAnchor="select coalesce(array_agg(id),'{}') into docs from source_documents where source_record_id=any(ids);";
const original=readFileSync('supabase/migrations/20260918140006_transactional_discard_deletion.sql','utf8');

test('retention patch fails closed if either existing RPC anchor changes',()=>{
 for(const body of [base.replaceAll("''", "'"),original]) {
  for(const anchor of [lockAnchor,guardAnchor]) assert.equal(body.split(anchor).length-1,1);

 }
 assert.ok(original.indexOf(lockAnchor)<original.indexOf(guardAnchor));
 assert.match(migration,/replace\(body_,lock_anchor_,''\)\)\)\/length\(lock_anchor_\)<>1/);
 assert.match(migration,/replace\(body_,guard_anchor_,''\)\)\)\/length\(guard_anchor_\)<>1/);
 assert.match(migration,/pg_get_functiondef\('public.delete_discarded_records\(jsonb,integer\)'::regprocedure\)/);
});

test('all supplemental history is checked under write-conflicting locks before cleanup',()=>{
 const locks='lock table public.concert_supplemental_geography,public.concert_signature_observations in share mode nowait;';
 assert.ok(migration.includes(locks));
 assert.match(migration,/replace\(body_,guard_anchor_,guard_\|\|E'\\n '\|\|guard_anchor_\)/);
 assert.match(migration,/position\(lock_anchor_ in body_\)>=position\(guard_anchor_ in body_\)/);
 // This guard supplies the known rejection even when migration 720 is absent.
 // No current-only view can hide stale evidence.
 assert.match(migration,/then raise exception 'PRESERVED_HISTORY_EXISTS'; end if;/);
 assert.ok(migration.indexOf(locks)<migration.indexOf('if exists(select 1'));
 assert.doesNotMatch(migration,/history_selected_ids|documented_corrections/);
 assert.match(migration,/g\.source_record_id=any\(ids\)/);
 assert.match(migration,/d\.id=g\.document_id and d\.source_record_id=any\(ids\)/);
 assert.match(migration,/u\.id=g\.unit_id and u\.source_record_id=any\(ids\)/);
 assert.match(migration,/s\.source_record_id=any\(ids\)/);
 assert.match(migration,/d\.id=s\.document_id and d\.source_record_id=any\(ids\)/);
 assert.doesNotMatch(migration,/current_concert_|delete from|on delete cascade/i);
});
