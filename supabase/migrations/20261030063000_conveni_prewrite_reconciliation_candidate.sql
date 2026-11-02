-- Closed candidate. Requires draining all writers of 590 and
-- revoking their RPC grants before any guarded caller is enabled.
alter table public.conveni_first_preparation_operations drop constraint conveni_first_preparation_operations_state_check;
alter table public.conveni_first_preparation_operations add constraint conveni_first_preparation_operations_state_check check(state in ('pending','ready','superseded'));
alter table public.conveni_first_preparation_operations add column superseded_at timestamptz, add column supersession_reason text;
alter table public.conveni_first_preparation_operations drop constraint conveni_first_preparation_operations_job_id_unit_id_key;
create unique index conveni_preparation_one_live on public.conveni_first_preparation_operations(job_id,unit_id) where state in ('pending','ready');
create or replace function public.guard_conveni_preparation_operation() returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if (to_jsonb(new)-'state'-'ready_at'-'superseded_at'-'supersession_reason') is distinct from (to_jsonb(old)-'state'-'ready_at'-'superseded_at'-'supersession_reason') or old.state<>'pending'
  or not ((new.state='ready' and new.ready_at is not null and new.superseded_at is null and new.supersession_reason is null)
       or (new.state='superseded' and new.ready_at is null and new.superseded_at is not null and length(trim(coalesce(new.supersession_reason,''))) between 10 and 2000))
 then raise exception 'PREPARATION_OPERATION_IMMUTABLE';end if;
 return new;
end $$;
do $$
declare body_ text;anchor text;
begin
 body_:=pg_get_functiondef('public.conveni_first_operation_begin(uuid,uuid,uuid,uuid,jsonb,jsonb)'::regprocedure);
 anchor:='where job_id=p_job and unit_id=p_unit for update nowait;';
 if (length(body_)-length(replace(body_,anchor,'')))/length(anchor)<>1 then raise exception 'RECONCILE_BEGIN_ANCHOR';end if;
 body_:=replace(body_,anchor,'where job_id=p_job and unit_id=p_unit and state in (''pending'',''ready'') for update nowait;');
 anchor:='then raise exception ''PREPARATION_SCOPE'';end if;';
 if (length(body_)-length(replace(body_,anchor,'')))/length(anchor)<>1 then raise exception 'RECONCILE_SCOPE_ANCHOR';end if;
 execute replace(body_,anchor,'or not exists(select 1 from public.conveni_unit_proposals where job_id=p_job and unit_id=p_unit) then raise exception ''PREPARATION_SCOPE'';end if;');
 body_:=pg_get_functiondef('public.conveni_first_operation_get(uuid,uuid,uuid)'::regprocedure);
 anchor:='and o.unit_id=p_unit';
 if (length(body_)-length(replace(body_,anchor,'')))/length(anchor)<>1 then raise exception 'RECONCILE_GET_ANCHOR';end if;
 execute replace(body_,anchor,'and o.unit_id=p_unit and o.state in (''pending'',''ready'')');
end $$;
create function public.conveni_first_guard_operation(p_record uuid,p_job uuid,p_unit uuid,p_operation uuid) returns public.conveni_first_preparation_operations
language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.conveni_first_preparation_operations;
begin
 perform 1 from public.source_records where id=p_record for update nowait;
 select * into o from public.conveni_first_preparation_operations where id=p_operation and record_id=p_record and job_id=p_job and unit_id=p_unit for share nowait;
 if not found or o.state<>'pending' then raise exception 'OPERATION_SUPERSEDED';end if;
 return o;
end $$;
create function public.conveni_first_guarded_ack(p_record uuid,p_job uuid,p_unit uuid,p_operation uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.conveni_first_preparation_operations;
begin
 o:=public.conveni_first_guard_operation(p_record,p_job,p_unit,p_operation);
 if o.payload->'historySnapshot'='null'::jsonb or o.payload->'historyConfirmed' is distinct from 'true'::jsonb then raise exception 'HISTORY_CONFIRMATION_REQUIRED';end if;
 return public.conveni_first_ack_history((o.ids->>'ackId')::uuid,p_record,p_job,p_unit,o.payload->'historySnapshot',(o.payload->'historySnapshot'->>'previous_id')::uuid,o.payload->>'reviewer',o.payload->>'note',true);
end $$;
create function public.conveni_first_guarded_prepare(p_record uuid,p_job uuid,p_unit uuid,p_operation uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.conveni_first_preparation_operations;coverage uuid[];
begin
 o:=public.conveni_first_guard_operation(p_record,p_job,p_unit,p_operation);
 if o.payload->'social' is distinct from 'true'::jsonb or o.payload->'economic' is distinct from 'true'::jsonb or o.payload->'manifest' is distinct from 'true'::jsonb then raise exception 'PREPARATION_CONFIRMATION_REQUIRED';end if;
 select coalesce(array_agg(v::uuid order by ord),'{}'::uuid[]) into coverage from jsonb_array_elements_text(coalesce(o.payload->'coverageIds','[]'::jsonb)) with ordinality x(v,ord);
 return public.conveni_first_prepare_draft_coverage(p_record,p_job,p_unit,(o.ids->>'draftId')::uuid,case when o.payload->'historySnapshot'='null'::jsonb then null else (o.ids->>'ackId')::uuid end,(o.payload->>'monetaryId')::uuid,(o.payload->>'identityId')::uuid,(o.payload->>'rolePeriodId')::uuid,o.payload->>'literal',o.payload->>'reviewer',o.payload->>'note',true,true,true,coverage);
end $$;
create function public.conveni_first_supersede_prewrite(p_record uuid,p_job uuid,p_unit uuid,p_operation uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,conveni_first_candidate as $$
declare o public.conveni_first_preparation_operations;revisions jsonb;ids uuid[];missing boolean:=false;
begin
 if length(trim(coalesce(p_reason,''))) not between 10 and 2000 then raise exception 'RECONCILIATION_REASON_REQUIRED';end if;
 perform 1 from public.source_records where id=p_record for update nowait;
 select * into o from public.conveni_first_preparation_operations where id=p_operation and record_id=p_record and job_id=p_job and unit_id=p_unit for update nowait;
 if not found or o.state<>'pending' then raise exception 'RECONCILIATION_UNAVAILABLE';end if;
 if exists(select 1 from public.conveni_unit_economic_draft_events where id=(o.ids->>'draftId')::uuid) or exists(select 1 from conveni_first_candidate.history_acknowledgements where event_id=(o.ids->>'ackId')::uuid) then raise exception 'RECONCILIATION_HAS_EFFECTS';end if;
 select document_revisions into strict revisions from public.conveni_analyses where job_id=p_job and source_record_id=p_record for share nowait;
 ids:=array[(o.payload->>'monetaryId')::uuid,(o.payload->>'identityId')::uuid,(o.payload->>'rolePeriodId')::uuid]||coalesce((select array_agg(v::uuid order by ord) from jsonb_array_elements_text(coalesce(o.payload->'coverageIds','[]'::jsonb)) with ordinality x(v,ord)),'{}'::uuid[]);
 begin perform conveni_first_candidate.coverage_check_manifest(p_record,revisions,ids,o.payload->>'reviewer');
 exception when others then if sqlerrm='MANIFEST_NEEDS_FULL_REVIEW' then missing:=true;else raise;end if;end;
 if not missing then raise exception 'RECONCILIATION_NOT_DETERMINISTIC';end if;
 update public.conveni_first_preparation_operations set state='superseded',superseded_at=now(),supersession_reason=p_reason where id=o.id returning * into o;
 return to_jsonb(o);
end $$;
revoke all on function public.conveni_first_guard_operation(uuid,uuid,uuid,uuid),public.conveni_first_guarded_ack(uuid,uuid,uuid,uuid),public.conveni_first_guarded_prepare(uuid,uuid,uuid,uuid),public.conveni_first_supersede_prewrite(uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
create function public.conveni_first_operation_history(p_record uuid,p_job uuid,p_unit uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]'::jsonb) from (
  select id,state,created_at,ready_at,superseded_at,supersession_reason from public.conveni_first_preparation_operations
  where record_id=p_record and job_id=p_job and unit_id=p_unit order by created_at desc,id desc limit 100
 ) x
$$;
revoke all on function public.conveni_first_operation_history(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- No legacy preparation entrypoint may remain available to application roles
-- when this protocol is enabled. Drain in-flight calls before activation.
revoke all on function public.conveni_first_ack_history(uuid,uuid,uuid,uuid,jsonb,uuid,text,text,boolean),public.conveni_first_prepare_draft(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,boolean,boolean,boolean),public.conveni_first_prepare_draft_coverage(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,boolean,boolean,boolean,uuid[]) from public,anon,authenticated,service_role;
