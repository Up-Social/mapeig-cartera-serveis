-- Human geography decisions are append-only and never mutate awarded rows.
create table public.concert_supplemental_geography_reviews (
 id uuid primary key,
 -- Allocated only after the per-unit advisory lock; gaps are harmless.
 review_sequence bigint generated always as identity unique,
 proposal_id bigint not null references public.concert_supplemental_geography(id),
 review_fingerprint text not null check(review_fingerprint ~ '^[a-f0-9]{32}$'),
 previous_id uuid references public.concert_supplemental_geography_reviews(id),
 decision text not null check(decision in ('confirmed','rejected','revoked')),
 reviewer text not null check(length(btrim(reviewer)) between 2 and 200),
 rationale text not null check(length(btrim(rationale)) between 20 and 4000),
 checked_source_and_period boolean not null check(checked_source_and_period),
 created_at timestamptz not null default clock_timestamp()
);
create index concert_supplemental_geography_reviews_proposal_idx on public.concert_supplemental_geography_reviews(proposal_id,review_sequence desc);
alter table public.concert_supplemental_geography_reviews enable row level security;
revoke all on public.concert_supplemental_geography_reviews from public,anon,authenticated,service_role;
grant select on public.concert_supplemental_geography_reviews to service_role;

create function public.concert_supplemental_geography_economic_context(p_unit uuid)
 returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_array(r.period_start,r.period_end,r.effective_at)
 from public.concert_economic_reviews r where r.unit_id=p_unit
$$;
revoke all on function public.concert_supplemental_geography_economic_context(uuid) from public,anon,authenticated;
grant execute on function public.concert_supplemental_geography_economic_context(uuid) to service_role;

create function public.concert_supplemental_geography_review_hash(u public.record_units,g public.concert_supplemental_geography)
 returns text language sql stable set search_path=pg_catalog,public as $$
 select md5(jsonb_build_array((u).period,(u).effective_start,(u).effective_end,(u).observed_service_name,(u).observed_service_code,
  (g).unit_fingerprint,(g).document_sha256,(g).source_sha256,(g).source_text_sha256,(g).source_quote,(g).scope_marker,(g).service_marker,
  (g).municipality,(g).county,(g).province,(g).reference,public.concert_supplemental_geography_economic_context((u).id))::text)
$$;
revoke all on function public.concert_supplemental_geography_review_hash(public.record_units,public.concert_supplemental_geography) from public,anon,authenticated;
grant execute on function public.concert_supplemental_geography_review_hash(public.record_units,public.concert_supplemental_geography) to service_role;

-- Latest current proposal plus its explicit decision. A newer proposal never
-- inherits a decision made for another captured source. Conflicts fail closed.
create view public.current_concert_supplemental_geography_review with(security_invoker=true) as
 select g.*,public.concert_supplemental_geography_economic_context(u.id) as economic_review_context,public.concert_supplemental_geography_review_hash(u,e) as review_fingerprint,
  r.id as review_id,case when r.review_fingerprint=public.concert_supplemental_geography_review_hash(u,e) then r.decision else null end as decision,
  coalesce(r.review_fingerprint=public.concert_supplemental_geography_review_hash(u,e),false) as review_valid,
  r.reviewer,r.rationale,r.created_at as reviewed_at,
  (nullif(btrim(u.territory),'') is not null and lower(btrim(u.territory))<>lower(btrim(g.municipality)))
  or (nullif(btrim(u.municipality),'') is not null and lower(btrim(u.municipality))<>lower(btrim(g.municipality)))
  or exists(select 1 from public.current_concert_unit_geography dg where dg.unit_id=g.unit_id
    and (lower(btrim(dg.municipality))<>lower(btrim(g.municipality))
      or (dg.county is not null and g.county is not null and dg.county<>g.county)
      or (dg.province is not null and g.province is not null and dg.province<>g.province))) as conflict
 from public.current_concert_supplemental_geography g
 join public.record_units u on u.id=g.unit_id
 join public.concert_supplemental_geography e on e.id=g.id
 left join lateral (select x.* from public.concert_supplemental_geography_reviews x where x.proposal_id=g.id order by x.review_sequence desc limit 1) r on true;
revoke all on public.current_concert_supplemental_geography_review from public,anon,authenticated;
grant select on public.current_concert_supplemental_geography_review to service_role;

create function public.review_concert_supplemental_geography(
 p_record uuid,p_unit uuid,p_proposal bigint,p_event uuid,p_previous uuid,
 p_decision text,p_reviewer text,p_rationale text,p_checked boolean,p_review_fingerprint text
) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare current_ record;previous_ uuid;existing_ public.concert_supplemental_geography_reviews;
begin
 -- Same lock order as source deletion; proposal writers hold the unit before
 -- their advisory lock, so take these locks in that same order.
 perform 1 from public.source_records where id=p_record for share nowait;
 perform 1 from public.record_units where id=p_unit and source_record_id=p_record for share nowait;
 if not found then raise exception 'GEOGRAPHY_UNIT_NOT_FOUND';end if;
 perform 1 from public.source_documents d join public.concert_supplemental_geography g on g.document_id=d.id
  where g.id=p_proposal and g.unit_id=p_unit and g.source_record_id=p_record for share of d nowait;
 if not found then raise exception 'GEOGRAPHY_PROPOSAL_NOT_FOUND';end if;
 perform pg_advisory_xact_lock(hashtextextended('supplemental-geography:'||p_unit::text,0));
 select * into existing_ from public.concert_supplemental_geography_reviews where id=p_event;
 if found then
  if existing_.proposal_id=p_proposal and existing_.previous_id is not distinct from p_previous
   and existing_.review_fingerprint=p_review_fingerprint and existing_.decision=p_decision and existing_.reviewer=p_reviewer and existing_.rationale=p_rationale
   and existing_.checked_source_and_period is not distinct from p_checked then return p_event;end if;
  raise exception 'GEOGRAPHY_EVENT_CONFLICT';
 end if;
 select * into current_ from public.current_concert_supplemental_geography_review
  where id=p_proposal and unit_id=p_unit and source_record_id=p_record;
 if not found then raise exception 'GEOGRAPHY_PROPOSAL_STALE';end if;
 if current_.review_fingerprint is distinct from p_review_fingerprint then raise exception 'GEOGRAPHY_REVIEW_SOURCE_CHANGED';end if;
 previous_:=current_.review_id;
 if previous_ is distinct from p_previous then raise exception 'GEOGRAPHY_REVIEW_CHANGED';end if;
 if p_decision='confirmed' and current_.conflict then raise exception 'GEOGRAPHY_DOCUMENTARY_CONFLICT';end if;
 if p_decision='revoked' and current_.decision is distinct from 'confirmed' then raise exception 'GEOGRAPHY_NOT_CONFIRMED';end if;
 if p_checked is distinct from true or p_decision is null or p_decision not in ('confirmed','rejected','revoked') then raise exception 'GEOGRAPHY_REVIEW_REQUIRED';end if;
 insert into public.concert_supplemental_geography_reviews(id,proposal_id,previous_id,decision,reviewer,rationale,checked_source_and_period,review_fingerprint)
 values(p_event,p_proposal,p_previous,p_decision,p_reviewer,p_rationale,p_checked,p_review_fingerprint);
 return p_event;
end $$;
revoke all on function public.review_concert_supplemental_geography(uuid,uuid,bigint,uuid,uuid,text,text,text,boolean,text) from public,anon,authenticated;
grant execute on function public.review_concert_supplemental_geography(uuid,uuid,bigint,uuid,uuid,text,text,text,boolean,text) to service_role;
-- NO ACTION FKs preserve decisions: existing proposal retention also prevents
-- source deletion; a proposal cannot be purged while decisions reference it.
