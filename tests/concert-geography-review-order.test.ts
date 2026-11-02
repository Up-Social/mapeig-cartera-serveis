import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const migration=readFileSync('supabase/migrations/20261102193000_concert_supplemental_geography_review.sql','utf8');
const route=readFileSync('app/api/records/[id]/concert-geography/route.ts','utf8');
test('latest geography decision and paginated history use a unique monotonic database order, never timestamp/UUID ties',()=>{
 assert.match(migration,/review_sequence bigint generated always as identity unique/);
 assert.match(migration,/\(proposal_id,review_sequence desc\)/);
 assert.match(migration,/order by x\.review_sequence desc limit 1/);
 assert.doesNotMatch(migration,/order by x\.created_at/);
 assert.match(route,/from\('concert_supplemental_geography_reviews'\)[\s\S]*?\.order\('review_sequence',\{ascending:false\}\)\.range\(from,to\)/);
});
test('the per-unit lock and idempotent replay precede insertion and the sequence is allocated by the database only for a new event',()=>{
 const lock=migration.indexOf("perform pg_advisory_xact_lock(hashtextextended('supplemental-geography:'");
 const replay=migration.indexOf('then return p_event;end if;');
 const insert=migration.indexOf('insert into public.concert_supplemental_geography_reviews(');
 assert.ok(lock>=0&&replay>lock&&insert>replay);
 assert.match(migration,/if previous_ is distinct from p_previous then raise exception 'GEOGRAPHY_REVIEW_CHANGED'/);
 const columns=migration.slice(insert,migration.indexOf('values(',insert));
 assert.doesNotMatch(columns,/review_sequence/);
});
