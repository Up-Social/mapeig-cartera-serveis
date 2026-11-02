-- LOCAL CANDIDATE ONLY. No grants. Review required before use.
create schema conveni_preparation_guard_candidate;
revoke all on schema conveni_preparation_guard_candidate from public,anon,authenticated,service_role;
create table conveni_preparation_guard_candidate.config(singleton boolean primary key default true check(singleton),enabled boolean not null default false);
insert into conveni_preparation_guard_candidate.config values(true,false);
create table conveni_preparation_guard_candidate.attempts(
 id uuid primary key,
 record_id uuid not null references public.source_records(id) on delete restrict,
 job_id uuid not null references public.pipeline_jobs(id) on delete restrict,
 unit_id uuid not null references public.record_units(id) on delete restrict,
 mode text not null check(mode in ('first','versioned')),
 first_operation_id uuid references public.conveni_first_preparation_operations(id) on delete restrict,
 versioned_operation_id uuid references conveni_independent_experiment.preparation_operations(id) on delete restrict,
 check((mode='first' and first_operation_id is not null and versioned_operation_id is null) or (mode='versioned' and first_operation_id is null and versioned_operation_id is not null)),
 state text not null check(state in ('active','complete'))
);
create unique index execution_first_one_active on conveni_preparation_guard_candidate.attempts(unit_id) where state='active';
create table conveni_preparation_guard_candidate.permits(pid int not null,tx bigint not null,unit_id uuid not null,primary key(pid,tx,unit_id));
revoke all on all tables in schema conveni_preparation_guard_candidate from public,anon,authenticated,service_role;
create function conveni_preparation_guard_candidate.require_read_committed() returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'FIRST_ATTEMPT_ISOLATION' using errcode='25001';end if;
end $$;
create function conveni_preparation_guard_candidate.guard_config() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform conveni_preparation_guard_candidate.require_read_committed();
 if (tg_op='DELETE' or not new.enabled) and exists(select 1 from conveni_preparation_guard_candidate.attempts where state='active') then raise exception 'FIRST_ATTEMPT_CONFIG_LOCKED';end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
create trigger first_attempt_config before update or delete on conveni_preparation_guard_candidate.config for each row execute function conveni_preparation_guard_candidate.guard_config();
create function conveni_preparation_guard_candidate.permitted(p_unit uuid) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare enabled_ boolean;
begin
 select enabled into enabled_ from conveni_preparation_guard_candidate.config where singleton for share;
 if coalesce(enabled_,true) then perform conveni_preparation_guard_candidate.require_read_committed();end if;
 return not coalesce(enabled_,true) or exists(select 1 from conveni_preparation_guard_candidate.permits where pid=pg_backend_pid() and tx=txid_current() and unit_id=p_unit);
end $$;
create function conveni_preparation_guard_candidate.check_stage() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare v jsonb;u uuid;enabled_ boolean;
begin
 select enabled into enabled_ from conveni_preparation_guard_candidate.config where singleton for share;
 if not coalesce(enabled_,true) then if tg_op='DELETE' then return old;else return new;end if;end if;
 perform conveni_preparation_guard_candidate.require_read_committed();
 v:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 if tg_table_name in ('conveni_first_preparation_operations','preparation_operations','history_acknowledgements','versioned_acknowledgements','conveni_unit_economic_draft_events') then u:=(v->>'unit_id')::uuid;
 else select unit_id into u from public.conveni_unit_economic_draft_events where id=(v->>'draft_id')::uuid;end if;
 if u is null then raise exception 'FIRST_ATTEMPT_SCOPE';end if;
 if not conveni_preparation_guard_candidate.permitted(u) then raise exception 'FIRST_ATTEMPT_PERMIT_REQUIRED';end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
create trigger first_attempt_operation before insert or update or delete on public.conveni_first_preparation_operations for each row execute function conveni_preparation_guard_candidate.check_stage();
create trigger first_attempt_ack before insert or update or delete on conveni_first_candidate.history_acknowledgements for each row execute function conveni_preparation_guard_candidate.check_stage();
create trigger first_attempt_draft before insert or update or delete on public.conveni_unit_economic_draft_events for each row execute function conveni_preparation_guard_candidate.check_stage();
create trigger first_attempt_ack_link before insert or update or delete on conveni_first_candidate.historical_draft_ack_links for each row execute function conveni_preparation_guard_candidate.check_stage();
create trigger first_attempt_receipt before insert or update or delete on conveni_first_candidate.receipts for each row execute function conveni_preparation_guard_candidate.check_stage();
create trigger first_attempt_link before insert or update or delete on conveni_first_candidate.visual_economic_links for each row execute function conveni_preparation_guard_candidate.check_stage();
create trigger first_attempt_coverage before insert or update or delete on conveni_first_candidate.coverage_draft_bindings for each row execute function conveni_preparation_guard_candidate.check_stage();
create trigger reservation_versioned_operation before insert or update or delete on conveni_independent_experiment.preparation_operations for each row execute function conveni_preparation_guard_candidate.check_stage();
create trigger reservation_versioned_ack before insert or update or delete on conveni_independent_experiment.versioned_acknowledgements for each row execute function conveni_preparation_guard_candidate.check_stage();
create trigger reservation_versioned_link before insert or update or delete on conveni_independent_experiment.versioned_ack_links for each row execute function conveni_preparation_guard_candidate.check_stage();
create or replace function public.conveni_first_copy_plan(p_record uuid,p_draft uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare u uuid;begin
 select unit_id into u from public.conveni_unit_economic_draft_events where id=p_draft and source_record_id=p_record;
 if u is null then raise exception 'PREPARATION_SCOPE';end if;
 if not conveni_preparation_guard_candidate.permitted(u) then raise exception 'FIRST_ATTEMPT_PERMIT_REQUIRED';end if;
 return conveni_first_candidate.historical_copy_plan(p_draft);
end $$;
create or replace function public.conveni_first_copy_finish(p_record uuid,p_draft uuid,p_plan jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare u uuid;begin
 select unit_id into u from public.conveni_unit_economic_draft_events where id=p_draft and source_record_id=p_record;
 if u is null then raise exception 'PREPARATION_SCOPE';end if;
 if not conveni_preparation_guard_candidate.permitted(u) then raise exception 'FIRST_ATTEMPT_PERMIT_REQUIRED';end if;
 return conveni_first_candidate.historical_snapshot_for_copy_plan(p_draft,p_plan);
end $$;
create function conveni_preparation_guard_candidate.step(p_attempt uuid,p_action text,p_value jsonb default null) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare a conveni_preparation_guard_candidate.attempts;o jsonb;r jsonb;enabled_ boolean;operation_ uuid;
begin
 select enabled into enabled_ from conveni_preparation_guard_candidate.config where singleton for share;
 if not coalesce(enabled_,false) then raise exception 'FIRST_ATTEMPT_CONFIGURATION_MISMATCH';end if;
 perform conveni_preparation_guard_candidate.require_read_committed();
 select * into a from conveni_preparation_guard_candidate.attempts where id=p_attempt;
 if not found or a.state<>'active' then raise exception 'FIRST_ATTEMPT_NOT_ACTIVE';end if;
 perform 1 from public.source_records where id=a.record_id for update;
 perform 1 from public.record_units where id=a.unit_id and source_record_id=a.record_id for update;
 if not found then raise exception 'FIRST_ATTEMPT_SCOPE';end if;
 select * into a from conveni_preparation_guard_candidate.attempts where id=p_attempt for update;
 if not found or a.state<>'active' then raise exception 'FIRST_ATTEMPT_NOT_ACTIVE';end if;
 if a.mode='first' then
  operation_:=a.first_operation_id;
  select to_jsonb(x) into o from public.conveni_first_preparation_operations x where x.id=operation_ and x.record_id=a.record_id and x.job_id=a.job_id and x.unit_id=a.unit_id for update;
  if exists(select 1 from conveni_independent_experiment.revisions where source_record_id=a.record_id and unit_id=a.unit_id) then raise exception 'VERSIONED_OPERATION_SUPERSEDED';end if;
 else
  operation_:=a.versioned_operation_id;
  select to_jsonb(x) into o from conveni_independent_experiment.preparation_operations x where x.id=operation_ and x.record_id=a.record_id and x.job_id=a.job_id and x.unit_id=a.unit_id for update;
  if o->>'previous_id' is distinct from (select id::text from conveni_independent_experiment.revisions where source_record_id=a.record_id and unit_id=a.unit_id order by sequence desc limit 1) then raise exception 'VERSIONED_OPERATION_SUPERSEDED';end if;
 end if;
 if o is null or o->>'state'<>'pending' then raise exception 'FIRST_ATTEMPT_OPERATION';end if;
 insert into conveni_preparation_guard_candidate.permits values(pg_backend_pid(),txid_current(),a.unit_id);
 case p_action
  when 'ack' then if a.mode='first' then r:=public.conveni_first_guarded_ack(a.record_id,a.job_id,a.unit_id,operation_);else r:=public.conveni_independent_guarded_ack(a.record_id,a.job_id,a.unit_id,operation_);end if;
  when 'native_ack' then if a.mode<>'versioned' then raise exception 'FIRST_ATTEMPT_ACTION';end if;r:=public.conveni_independent_guarded_native_ack(a.record_id,a.job_id,a.unit_id,operation_);
  when 'prepare' then if a.mode='first' then r:=public.conveni_first_guarded_prepare(a.record_id,a.job_id,a.unit_id,operation_);else r:=public.conveni_independent_guarded_prepare(a.record_id,a.job_id,a.unit_id,operation_);end if;
  when 'bind' then if a.mode<>'versioned' then raise exception 'FIRST_ATTEMPT_ACTION';end if;perform public.conveni_independent_guarded_bind_ack(a.record_id,a.job_id,a.unit_id,operation_);r:='null'::jsonb;
  when 'copy_plan' then r:=public.conveni_first_copy_plan(a.record_id,(o->'ids'->>'draftId')::uuid);
  when 'copy_finish' then r:=public.conveni_first_copy_finish(a.record_id,(o->'ids'->>'draftId')::uuid,p_value);
  when 'find_receipt' then r:=public.conveni_first_receipt_find(a.record_id,(o->'ids'->>'receiptId')::uuid,(o->'ids'->>'draftId')::uuid);if r is not null then raise exception 'FIRST_ATTEMPT_RECEIPT_RECONCILIATION_REQUIRED';end if;
  when 'save_receipt' then r:=public.conveni_first_receipt_save(a.record_id,(o->'ids'->>'receiptId')::uuid,(o->'ids'->>'draftId')::uuid,p_value);
  when 'link' then r:=public.conveni_first_link_draft(a.record_id,(o->'ids'->>'linkId')::uuid,(o->'ids'->>'draftId')::uuid,(o->'ids'->>'receiptId')::uuid,(o->'payload'->>'monetaryId')::uuid,(o->'payload'->>'identityId')::uuid,(o->'payload'->>'rolePeriodId')::uuid,o->'payload'->>'reviewer',o->'payload'->>'note',true,true,true);
  when 'ready' then if a.mode='first' then r:=public.conveni_first_operation_ready(a.record_id,a.job_id,a.unit_id,operation_);else r:=public.conveni_independent_preparation_ready(a.record_id,a.job_id,a.unit_id,operation_);end if;update conveni_preparation_guard_candidate.attempts set state='complete' where id=p_attempt and state='active';if not found then raise exception 'FIRST_ATTEMPT_CAS';end if;
  else raise exception 'FIRST_ATTEMPT_ACTION';
 end case;
 delete from conveni_preparation_guard_candidate.permits where pid=pg_backend_pid() and tx=txid_current() and unit_id=a.unit_id;
 return r;
end $$;
revoke all on all functions in schema conveni_preparation_guard_candidate from public,anon,authenticated,service_role;

-- Both modes share a single per-unit durable reservation.
create function conveni_preparation_guard_candidate.begin_attempt(p_attempt uuid,p_record uuid,p_job uuid,p_unit uuid,p_operation uuid,p_mode text,p_previous uuid,p_payload jsonb,p_ids jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r jsonb;enabled_ boolean;begin
 select enabled into enabled_ from conveni_preparation_guard_candidate.config where singleton for share;
 if not coalesce(enabled_,false) then raise exception 'FIRST_ATTEMPT_CONFIGURATION_MISMATCH';end if;
 perform conveni_preparation_guard_candidate.require_read_committed();
 if p_attempt is null or p_mode not in ('first','versioned') then raise exception 'FIRST_ATTEMPT_INVALID';end if;
 perform 1 from public.source_records where id=p_record for update;
 perform 1 from public.record_units where id=p_unit and source_record_id=p_record for update;
 if not found then raise exception 'FIRST_ATTEMPT_SCOPE';end if;
 if p_mode='first' and (p_previous is not null or exists(select 1 from conveni_independent_experiment.revisions where source_record_id=p_record and unit_id=p_unit)) then raise exception 'VERSIONED_OPERATION_SUPERSEDED';end if;
 if p_mode='versioned' and p_previous is null then raise exception 'VERSIONED_OPERATION_STALE';end if;
 if exists(select 1 from conveni_preparation_guard_candidate.attempts where unit_id=p_unit and state='active') then raise exception 'FIRST_ATTEMPT_OUTCOME_UNCERTAIN';end if;
 insert into conveni_preparation_guard_candidate.permits values(pg_backend_pid(),txid_current(),p_unit);
 if p_mode='first' then r:=public.conveni_first_operation_begin(p_record,p_job,p_unit,p_operation,p_payload,p_ids);else r:=public.conveni_independent_preparation_begin(p_record,p_job,p_unit,p_previous,p_operation,p_payload,p_ids);end if;
 if r is null or r->>'id' is null or r->>'state' not in ('pending','ready') then raise exception 'FIRST_ATTEMPT_OPERATION_INVALID';end if;
 insert into conveni_preparation_guard_candidate.attempts(id,record_id,job_id,unit_id,mode,first_operation_id,versioned_operation_id,state)
 values(p_attempt,p_record,p_job,p_unit,p_mode,case when p_mode='first' then (r->>'id')::uuid end,case when p_mode='versioned' then (r->>'id')::uuid end,case when r->>'state'='ready' then 'complete' else 'active' end);
 delete from conveni_preparation_guard_candidate.permits where pid=pg_backend_pid() and tx=txid_current() and unit_id=p_unit;
 return r;
end $$;
revoke all on function conveni_preparation_guard_candidate.begin_attempt(uuid,uuid,uuid,uuid,uuid,text,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;

-- Closed application surface. These signatures are intentionally not granted.
create function public.conveni_first_guard_status(p_record uuid,p_job uuid,p_unit uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare enabled_ boolean;active_ boolean;
begin
 select enabled into enabled_ from conveni_preparation_guard_candidate.config where singleton for share;
 if not coalesce(enabled_,false) then raise exception 'FIRST_ATTEMPT_CONFIGURATION_MISMATCH';end if;
 perform conveni_preparation_guard_candidate.require_read_committed();
 if not exists(select 1 from public.source_records where id=p_record and financing_type='conveni')
 or not exists(select 1 from public.record_units where id=p_unit and source_record_id=p_record)
 or not exists(select 1 from public.pipeline_jobs where id=p_job and source_record_id=p_record)
 or not exists(select 1 from public.conveni_unit_proposals where job_id=p_job and unit_id=p_unit)
 then raise exception 'FIRST_ATTEMPT_SCOPE';end if;
 select exists(select 1 from conveni_preparation_guard_candidate.attempts where unit_id=p_unit and state='active') into active_;
 return jsonb_build_object('blocked',active_);
end $$;
create function public.conveni_first_guard_begin(p_attempt uuid,p_record uuid,p_job uuid,p_unit uuid,p_operation uuid,p_mode text,p_previous uuid,p_payload jsonb,p_ids jsonb) returns jsonb
language sql volatile security definer set search_path=pg_catalog as $$select conveni_preparation_guard_candidate.begin_attempt(p_attempt,p_record,p_job,p_unit,p_operation,p_mode,p_previous,p_payload,p_ids)$$;
create function public.conveni_first_guard_step(p_attempt uuid,p_action text,p_value jsonb default null) returns jsonb
language sql volatile security definer set search_path=pg_catalog as $$select conveni_preparation_guard_candidate.step(p_attempt,p_action,p_value)$$;
revoke all on function public.conveni_first_guard_status(uuid,uuid,uuid),public.conveni_first_guard_begin(uuid,uuid,uuid,uuid,uuid,text,uuid,jsonb,jsonb),public.conveni_first_guard_step(uuid,text,jsonb) from public,anon,authenticated,service_role;
