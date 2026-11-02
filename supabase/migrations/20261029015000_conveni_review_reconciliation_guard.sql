-- A positive review may not rely on SUM ignoring unresolved sibling amounts.
-- This is only an arithmetic prerequisite; it does not establish recipient,
-- period, economic attribution, or approve grouped concepts.
create function public.conveni_review_amounts_reconcile(p_payload jsonb,p_total numeric) returns boolean
language plpgsql immutable security invoker set search_path=pg_catalog as $$
declare item jsonb; amount_ numeric; allocated numeric:=0; remainder_ numeric;
begin
 if p_total is null or p_total<0 or p_total>9007199254740991 or trunc(p_total)<>p_total
  or jsonb_typeof(p_payload->'units') is distinct from 'array'
  or jsonb_typeof(p_payload->'coverage_complete') is distinct from 'boolean'
  or p_payload->'coverage_complete' is distinct from 'true'::jsonb
  or jsonb_typeof(p_payload->'unallocated_cents') is distinct from 'number'
  or coalesce(p_payload->>'unallocated_cents','') !~ '^[0-9]+$'
 then return false;end if;
 if jsonb_array_length(p_payload->'units') not between 1 and 500 then return false;end if;
 remainder_:=(p_payload->>'unallocated_cents')::numeric;
 if remainder_>9007199254740991 then return false;end if;
 for item in select value from jsonb_array_elements(p_payload->'units') loop
  if jsonb_typeof(item) is distinct from 'object'
   or jsonb_typeof(item->'amount_cents') is distinct from 'number'
   or coalesce(item->>'amount_cents','') !~ '^[0-9]+$'
   or (item ? 'concepts' and item->'concepts' <> 'null'::jsonb and
       (jsonb_typeof(item->'concepts') is distinct from 'array' or
        jsonb_array_length(case when jsonb_typeof(item->'concepts')='array' then item->'concepts' else '[]'::jsonb end)>0))
  then return false;end if;
  amount_:=(item->>'amount_cents')::numeric;
  if amount_>9007199254740991 then return false;end if;
  allocated:=allocated+amount_;
  if allocated>9007199254740991 then return false;end if;
 end loop;
 return allocated+remainder_<=9007199254740991 and allocated+remainder_=p_total;
end $$;
revoke all on function public.conveni_review_amounts_reconcile(jsonb,numeric) from public,anon,authenticated;
grant execute on function public.conveni_review_amounts_reconcile(jsonb,numeric) to service_role;

do $$
declare original text; patched text;
begin
 original:=pg_get_functiondef('public.review_conveni_unit(uuid,uuid,uuid,uuid,uuid,text,text,text,boolean)'::regprocedure);
 -- Lock the parent before its proposal rows. The FK takes KEY SHARE when a
 -- proposal is inserted; FOR UPDATE blocks such phantoms until review ends.
 patched:=replace(original,
  $old$select * into strict a from conveni_analyses where job_id=p_job and source_record_id=r.id;$old$,
  $new$select * into strict a from conveni_analyses where job_id=p_job and source_record_id=r.id for update;$new$);
 if patched=original then raise exception 'Expected conveni analysis lock point not found';end if;
 original:=patched;
 -- A unit's parent and key are part of the reconciliation identity. Lock
 -- every sibling in deterministic order. NOWAIT avoids waiting behind a
 -- source publisher which takes document locks before unit locks.
 patched:=replace(original,
  $old$select * into strict u from record_units where id=p_unit and source_record_id=r.id for update;$old$,
  $new$perform 1 from record_units ru where ru.source_record_id=r.id order by ru.id for update nowait;
 select * into strict u from record_units where id=p_unit and source_record_id=r.id for update;$new$);
 if patched=original then raise exception 'Expected conveni unit lock point not found';end if;
 original:=patched;
 -- A publisher may already hold a document and be waiting for a unit. Never
 -- wait for it while holding unit locks; abort the complete review instead.
 patched:=replace(original,
  $old$perform 1 from source_documents sd where sd.source_record_id=r.id order by sd.id for share;$old$,
  $new$perform 1 from source_documents sd where sd.source_record_id=r.id order by sd.id for share nowait;$new$);
 if patched=original then raise exception 'Expected conveni document lock point not found';end if;
 original:=patched;
 patched:=replace(original,
  $old$select data into strict d from conveni_unit_proposals where job_id=p_job and unit_id=u.id;$old$,
  $new$perform 1 from conveni_unit_proposals cp where cp.job_id=p_job order by cp.unit_id for share;
 select data into strict d from conveni_unit_proposals where job_id=p_job and unit_id=u.id;
 -- SQL NULL in boolean expressions is not a rejection. A positive decision
 -- requires explicit, typed facts and cannot infer that an unknown flag is false.
 if p_outcome='select' and (d->>'recipient_nature' is distinct from 'private'
  or d->'joint' is distinct from 'false'::jsonb or d->'mixed' is distinct from 'false'::jsonb
  or coalesce(d->>'classification','') not in ('in_portfolio','out_of_portfolio')
  or jsonb_typeof(d->'blockers') is distinct from 'array'
  or jsonb_array_length(case when jsonb_typeof(d->'blockers')='array' then d->'blockers' else '[]'::jsonb end)<>0)
 then raise exception 'Import o receptor pendent de resoldre';end if;$new$);
 if patched=original then raise exception 'Expected conveni proposal lock point not found';end if;
 original:=patched;
 patched:=replace(original,
  $old$select sum((value->>'amount_cents')::numeric) into parts from jsonb_array_elements(a.payload->'units');
  if total is null or parts+coalesce((a.payload->>'unallocated_cents')::numeric,-1)<>total or not (a.payload->>'coverage_complete')::boolean then raise exception 'Imports no conciliats';end if;$old$,
  $new$-- The analysis and proposal set are locked before their contents are
  -- read. Compare economic identities and amounts while allowing independently
  -- reviewed citations to differ from the analysis.
  if not public.conveni_review_amounts_reconcile(a.payload,total)
   or exists(select 1 from conveni_unit_proposals cp left join record_units ru on ru.id=cp.unit_id
     where cp.job_id=p_job and (coalesce(cp.data->>'key','')='' or ru.source_record_id is distinct from r.id
      or ru.unit_key is distinct from 'conveni:'||(cp.data->>'key') or public.conveni_identity_words(cp.data->>'recipient')=''
      or (cp.data->>'year' is not null and case when jsonb_typeof(cp.data->'year')='number' and (cp.data->>'year') ~ '^[0-9]{4}$' then (cp.data->>'year')::integer not between 1900 and 2200 else true end)))
   or exists(select 1 from conveni_unit_proposals x join conveni_unit_proposals y on y.job_id=x.job_id and y.unit_id>x.unit_id
     where x.job_id=p_job and ((coalesce(x.data->>'recipient_nif','')<>'' and regexp_replace(upper(x.data->>'recipient_nif'),'[[:space:]-]','','g')=regexp_replace(upper(coalesce(y.data->>'recipient_nif','')),'[[:space:]-]','','g'))
      or public.conveni_identity_words(x.data->>'recipient')=public.conveni_identity_words(y.data->>'recipient'))
      and (x.data->>'year' is null or y.data->>'year' is null or x.data->>'year'=y.data->>'year'
       or coalesce(trim(x.data->>'period'),'')<>x.data->>'year' or coalesce(trim(y.data->>'period'),'')<>y.data->>'year'))
   or (select jsonb_agg(jsonb_build_object('key',cp.data->'key','recipient',cp.data->'recipient','recipient_nif',cp.data->'recipient_nif','recipient_nature',cp.data->'recipient_nature','joint',cp.data->'joint','mixed',cp.data->'mixed','period',cp.data->'period','year',cp.data->'year','amount_cents',cp.data->'amount_cents','amount_state',cp.data->'amount_state','classification',cp.data->'classification','concepts',coalesce(cp.data->'concepts','null'::jsonb)) order by (cp.data->>'key'),cp.data::text)
       from conveni_unit_proposals cp where cp.job_id=p_job)
      is distinct from (select jsonb_agg(jsonb_build_object('key',value->'key','recipient',value->'recipient','recipient_nif',value->'recipient_nif','recipient_nature',value->'recipient_nature','joint',value->'joint','mixed',value->'mixed','period',value->'period','year',value->'year','amount_cents',value->'amount_cents','amount_state',value->'amount_state','classification',value->'classification','concepts',coalesce(value->'concepts','null'::jsonb)) order by (value->>'key'),value::text) from jsonb_array_elements(a.payload->'units'))
  then raise exception 'Imports no conciliats';end if;$new$);
 if patched=original then raise exception 'Expected conveni reconciliation guard not found';end if;
 execute patched;
end $$;
