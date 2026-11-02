-- Durable reconciliation for a preparation, not an economic decision.
-- All application grants remain revoked until the feature is reviewed.
create table public.conveni_first_preparation_operations(
 id uuid primary key,record_id uuid not null references public.source_records(id) on delete cascade,
 job_id uuid not null references public.pipeline_jobs(id) on delete cascade,unit_id uuid not null references public.record_units(id) on delete cascade,
 payload jsonb not null,ids jsonb not null,state text not null default 'pending' check(state in ('pending','ready')),
 created_at timestamptz not null default now(),ready_at timestamptz,unique(job_id,unit_id)
);
alter table public.conveni_first_preparation_operations enable row level security;
revoke all on public.conveni_first_preparation_operations from public,anon,authenticated,service_role;
create function public.guard_conveni_preparation_operation() returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if (to_jsonb(new)-'state'-'ready_at') is distinct from (to_jsonb(old)-'state'-'ready_at') or old.state<>'pending' or new.state<>'ready' or new.ready_at is null then raise exception 'PREPARATION_OPERATION_IMMUTABLE';end if;
 return new;
end $$;
revoke all on function public.guard_conveni_preparation_operation() from public,anon,authenticated,service_role;
create trigger conveni_preparation_operation_guard before update on public.conveni_first_preparation_operations for each row execute function public.guard_conveni_preparation_operation();
create function public.conveni_first_operation_get(p_record uuid,p_job uuid,p_unit uuid) returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
 select to_jsonb(o) from public.conveni_first_preparation_operations o where o.record_id=p_record and o.job_id=p_job and o.unit_id=p_unit
$$;
create function public.conveni_first_operation_begin(p_record uuid,p_job uuid,p_unit uuid,p_operation uuid,p_payload jsonb,p_ids jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public set lock_timeout='1000ms' as $$
declare existing public.conveni_first_preparation_operations;
begin
 if p_operation is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>2100000 or jsonb_typeof(p_ids) is distinct from 'object' or octet_length(p_ids::text)>1000 then raise exception 'PREPARATION_OPERATION_INVALID';end if;
 perform 1 from public.source_records where id=p_record and financing_type='conveni' for update nowait;
 if not found or not exists(select 1 from public.record_units where id=p_unit and source_record_id=p_record) or not exists(select 1 from public.pipeline_jobs where id=p_job and source_record_id=p_record) then raise exception 'PREPARATION_SCOPE';end if;
 select * into existing from public.conveni_first_preparation_operations where job_id=p_job and unit_id=p_unit for update nowait;
 if found then
  if existing.record_id is distinct from p_record or existing.payload is distinct from p_payload then raise exception 'PREPARATION_RECONCILIATION_REQUIRED' using errcode='PT409';end if;
  return to_jsonb(existing);
 end if;
 insert into public.conveni_first_preparation_operations(id,record_id,job_id,unit_id,payload,ids) values(p_operation,p_record,p_job,p_unit,p_payload,p_ids) returning * into existing;
 return to_jsonb(existing);
end $$;
create function public.conveni_first_operation_ready(p_record uuid,p_job uuid,p_unit uuid,p_operation uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,conveni_first_candidate set lock_timeout='1000ms' as $$
declare o public.conveni_first_preparation_operations;l conveni_first_candidate.visual_economic_links;
begin
 select * into strict o from public.conveni_first_preparation_operations where id=p_operation and record_id=p_record and job_id=p_job and unit_id=p_unit for update nowait;
 select v.* into l from conveni_first_candidate.visual_economic_links v join public.conveni_unit_economic_draft_events d on d.id=v.draft_id where v.event_id::text=o.ids->>'linkId' and v.draft_id::text=o.ids->>'draftId' and v.receipt_id::text=o.ids->>'receiptId' and d.source_record_id=p_record and d.job_id=p_job and d.unit_id=p_unit;
 if not found then raise exception 'PREPARATION_LINK_MISSING';end if;
 if o.state='pending' then update public.conveni_first_preparation_operations set state='ready',ready_at=now() where id=o.id returning * into o;end if;
 return to_jsonb(o);
end $$;
revoke all on function public.conveni_first_operation_get(uuid,uuid,uuid),public.conveni_first_operation_begin(uuid,uuid,uuid,uuid,jsonb,jsonb),public.conveni_first_operation_ready(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
