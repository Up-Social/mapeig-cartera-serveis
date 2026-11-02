-- Permit current independent awards to enter economic review.
-- Preserve legacy gates and fail closed for stale or missing evidence.

-- REVIEW ONLY. Do not apply to production without separate authorization.
-- An independently approved, current line can satisfy its own review gate;
-- it must never fall back to a global job approval when its evidence is stale.
do $patch$
declare original text;patched text;
 unit_lock constant text := 'select * into strict u from record_units where id=p_unit for update;';
 job_lock constant text := 'select * into strict latest_job from pipeline_jobs where source_record_id=u.source_record_id order by created_at desc,id desc limit 1 for update;';
 anchor constant text := $old$  if u.status<>'approved' or latest_job.status not in ('approved','corrected') then raise exception 'Valida primer el resultat i les línies';end if;$old$;
 replacement constant text := $new$  if u.status<>'approved' then raise exception 'Valida primer el resultat i les línies';end if;
  if exists(select 1 from public.concert_line_award_decisions x where x.unit_id=u.id) then
   -- Existing routine locks the unit/job first; NOWAIT avoids inverse-order
   -- waits when a writer holds the record before trying to lock those rows.
   perform 1 from public.source_records r where r.id=u.source_record_id for update nowait;
   perform 1 from public.pipeline_jobs j where j.source_record_id=u.source_record_id order by j.id for share nowait;
   perform 1 from public.record_units other where other.source_record_id=u.source_record_id order by other.id for share nowait;
   perform 1 from public.source_documents doc where doc.source_record_id=u.source_record_id order by doc.id for share nowait;
   perform 1 from public.documented_corrections c where c.source_record_id=u.source_record_id order by c.id for share nowait;
   -- Eligibility also depends on active catalog/version and absence of child
   -- services. A table SHARE lock covers inserts of new child services too.
   lock table public.catalog_versions,public.official_services in share mode nowait;
   perform 1 from storage.objects so where so.id in (
    select x.source_object_id from public.concert_line_award_decisions x where x.unit_id=u.id
    union select x.item_object_id from public.concert_line_award_decisions x where x.unit_id=u.id
   ) order by so.id for share nowait;
   if not exists(select 1 from public.concert_line_award_decisions x
    join public.concert_line_financing_projection p on p.finance_id=x.provision_id and p.unit_id=x.unit_id
     and p.source_record_id=x.source_record_id and p.provenance='line_experiment'
    where x.unit_id=u.id and x.source_record_id=u.source_record_id and x.job_id=latest_job.id) then
     raise exception 'CONCERT_INDIVIDUAL_AWARD_STALE';
   end if;
  elsif latest_job.status not in ('approved','corrected') then
   raise exception 'Valida primer el resultat i les línies';
  end if;$new$;
begin
 original:=pg_get_functiondef('public.review_concert_economics(uuid,integer,text,uuid,jsonb)'::regprocedure);
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1
  or (length(original)-length(replace(original,unit_lock,'')))/length(unit_lock)<>1
  or (length(original)-length(replace(original,job_lock,'')))/length(job_lock)<>1 then raise exception 'CONCERT_ECONOMIC_GATE_ANCHOR';end if;
 patched:=replace(replace(replace(original,anchor,replacement),unit_lock,replace(unit_lock,'for update;','for update nowait;')),job_lock,replace(job_lock,'for update;','for update nowait;'));execute patched;
end $patch$;

-- REVIEW ONLY. Emit exactly one row per distinct non-null requested ID.
-- Unknown/non-concert units and malformed decision links fail closed as stale.
do $patch$
declare original text;
begin
 original:=pg_get_functiondef('public.concert_line_evolution_states(uuid[])'::regprocedure);
 if md5(original)<>'7e2e86e770231a45f173d2363c8a01a3' then raise exception 'CONCERT_EVOLUTION_STATE_CHANGED';end if;
 execute $ddl$
 create or replace function public.concert_line_evolution_states(p_units uuid[])
 returns jsonb language sql stable security definer set search_path=pg_catalog,public as $body$
  with requested as materialized (
   select distinct id from unnest(coalesce(p_units,'{}'::uuid[])) id where id is not null
  ), scope as materialized (
   select requested.id,u.id as existing_id from requested
   left join public.record_units u on u.id=requested.id and u.unit_key<>'legacy'
    and exists(select 1 from public.source_records r where r.id=u.source_record_id and r.financing_type='concert')
  ), any_decision as materialized (
   select distinct x.unit_id from public.concert_line_award_decisions x join requested q on q.id=x.unit_id
  ), bad_link as materialized (
   select distinct x.unit_id from public.concert_line_award_decisions x join requested q on q.id=x.unit_id
   left join public.pipeline_jobs j on j.id=x.job_id where j.id is null
  ), latest as materialized (
   select distinct on(x.unit_id) x.id,x.unit_id,x.provision_id
   from public.concert_line_award_decisions x join requested q on q.id=x.unit_id
   join public.pipeline_jobs j on j.id=x.job_id
   order by x.unit_id,j.created_at desc,j.id desc,x.sequence desc
  ), raw_valid as materialized (
   select v.decision_id,v.finance_id,v.service_code
   from concert_scoped_projection_v1.lines(array(select id from latest)) v
  ), verified as materialized (
   select decision_id,finance_id,min(service_code) as service_code from raw_valid
   group by decision_id,finance_id
   having count(*)=1 and min(service_code) is not null and length(trim(min(service_code)))>0
  )
  select coalesce(jsonb_agg(jsonb_build_object('unit_id',scope.id,
   'state',case when scope.existing_id is null or bad_link.unit_id is not null then 'stale'
    when any_decision.unit_id is null then 'legacy'
    when verified.decision_id is not null then 'current' else 'stale' end,
   'service_code',case when scope.existing_id is not null and bad_link.unit_id is null then verified.service_code else null end)
   order by scope.id),'[]'::jsonb)
  from scope left join any_decision on any_decision.unit_id=scope.id
   left join bad_link on bad_link.unit_id=scope.id
   left join latest on latest.unit_id=scope.id
   left join verified on verified.decision_id=latest.id and verified.finance_id=latest.provision_id
 $body$
 $ddl$;
end $patch$;
