\set ON_ERROR_STOP on
-- Only for a fresh disposable database. This fixture creates its own minimal
-- baseline; it must never target an application or production database.
create role anon;
create role authenticated;
create role service_role;
create table public.source_records(id uuid primary key);
create table public.source_documents(id uuid primary key);
create table public.record_units(id uuid primary key,source_record_id uuid,period text,effective_start date,effective_end date,observed_service_name text,observed_service_code text,territory text,municipality text);
create table public.concert_economic_reviews(unit_id uuid primary key,period_start date,period_end date,effective_at date);
create table public.concert_supplemental_geography(id bigint primary key,unit_id uuid,source_record_id uuid,document_id uuid,municipality text,county text,province text,unit_fingerprint text,document_sha256 text,source_sha256 text,source_text_sha256 text,source_quote text,scope_marker text,service_marker text,reference jsonb);
create view public.current_concert_supplemental_geography as select * from public.concert_supplemental_geography;
create table public.concert_unit_geography(unit_id uuid,municipality text,county text,province text);
create view public.current_concert_unit_geography as select * from public.concert_unit_geography;
\ir ../../../supabase/migrations/20261102193000_concert_supplemental_geography_review.sql
insert into public.source_records values('11111111-1111-4111-8111-111111111111');
insert into public.source_documents values('22222222-2222-4222-8222-222222222222');
insert into public.record_units(id,source_record_id,period,observed_service_name) values('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','2025','EVAMI');
insert into public.concert_supplemental_geography(id,unit_id,source_record_id,document_id,municipality) values(1,'33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','Barcelona');
do $$
declare fp text;current_ uuid;count_ integer;sequence_ bigint;
begin
 select review_fingerprint into strict fp from public.current_concert_supplemental_geography_review where id=1;
 perform public.review_concert_supplemental_geography('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333',1,'ffffffff-ffff-4fff-8fff-ffffffffffff',null,'confirmed','Revisor','Contrast del servei i del període verificat.',true,fp);
 perform public.review_concert_supplemental_geography('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333',1,'00000000-0000-4000-8000-000000000001','ffffffff-ffff-4fff-8fff-ffffffffffff','revoked','Revisor','Revocació després de nou contrast de la font.',true,fp);
 -- Force a timestamp tie with UUIDs deliberately opposed to insertion order.
 update public.concert_supplemental_geography_reviews set created_at='2025-01-01T00:00:00Z';
 select review_id into strict current_ from public.current_concert_supplemental_geography_review where id=1;
 if current_<>'00000000-0000-4000-8000-000000000001' or (select decision from public.current_concert_supplemental_geography_review where id=1)<>'revoked' then raise exception 'TIMESTAMP_TIE_RESTORED_OLD_CONFIRMATION';end if;
 -- Replay is idempotent and does not allocate another event or sequence.
 select max(review_sequence),count(*) into sequence_,count_ from public.concert_supplemental_geography_reviews;
 perform public.review_concert_supplemental_geography('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333',1,'00000000-0000-4000-8000-000000000001','ffffffff-ffff-4fff-8fff-ffffffffffff','revoked','Revisor','Revocació després de nou contrast de la font.',true,fp);
 if (select count(*) from public.concert_supplemental_geography_reviews)<>count_ or (select max(review_sequence) from public.concert_supplemental_geography_reviews)<>sequence_ then raise exception 'IDEMPOTENT_REPLAY_CREATED_EVENT';end if;
 -- Optimistic previous_id follows the actual last event, even after the tie.
 perform public.review_concert_supplemental_geography('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333',1,'00000000-0000-4000-8000-000000000002',current_,'confirmed','Revisor','Nova confirmació amb contrast del període.',true,fp);
 if (select review_id from public.current_concert_supplemental_geography_review where id=1)<>'00000000-0000-4000-8000-000000000002' then raise exception 'FOLLOWUP_DID_NOT_ADVANCE';end if;
 if (select array_agg(decision order by review_sequence desc) from public.concert_supplemental_geography_reviews)<>array['confirmed','revoked','confirmed'] then raise exception 'HISTORY_ORDER_WRONG';end if;
end $$;
