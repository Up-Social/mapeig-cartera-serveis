-- Shared, fail-closed switch. Existing source data, tasks and checkpoints are unchanged.
alter table public.app_settings add column reason text;
alter table public.app_settings drop constraint app_settings_known_key;
alter table public.app_settings add constraint app_settings_known_key
  check (key in ('automatic_ocr', 'processing_enabled'));
insert into public.app_settings(key, enabled, reason)
values ('processing_enabled', false, 'vercel_storage_recovery');

-- The CAS token must advance even for two safety updates in the same millisecond.
create function public.touch_processing_setting() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
 if new.key='processing_enabled' then
  if tg_op='UPDATE' then new.updated_at:=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');
  else new.updated_at:=clock_timestamp();end if;
 end if;
 return new;
end $$;
create trigger touch_processing_setting before insert or update on public.app_settings
for each row execute function public.touch_processing_setting();

create function public.processing_is_enabled() returns boolean
language plpgsql security invoker set search_path=public as $$
declare allowed boolean;
begin
 -- Lock until the caller's transaction ends. Disabling cannot race past a new claim.
 select enabled into allowed from app_settings where key='processing_enabled' for share;
 return coalesce(allowed, false);
end $$;

create function public.assert_processing_enabled() returns void
language plpgsql security invoker set search_path=public as $$
begin
 if not processing_is_enabled() then
  raise exception 'PROCESSING_DISABLED' using errcode='55000';
 end if;
end $$;

-- Also fences legacy deployments and direct queue claims. Checkpoint/finish writes stay allowed.
create function public.guard_processing_task() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
 if tg_op='INSERT' then
  perform assert_processing_enabled();
 elsif (new.status='running' and new.status is distinct from old.status)
   or (new.status='queued' and old.status not in ('queued','running'))
   or (new.execution_state='running' and new.execution_state is distinct from old.execution_state)
   or (new.execution_state='pending' and old.execution_state not in ('pending','running'))
   or (new.lease_owner is not null and new.lease_owner is distinct from old.lease_owner)
   or new.lease_generation > old.lease_generation
   or (new.claimed_by is not null and new.claimed_by is distinct from old.claimed_by) then
  perform assert_processing_enabled();
 end if;
 return new;
end $$;
create trigger guard_processing_task before insert or update on public.worker_tasks
for each row execute function public.guard_processing_task();

-- Legacy provider calls are fenced too; saving an in-flight receipt remains allowed.
create function public.guard_processing_provider() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
 if new.state='sending' then
  if tg_op='INSERT' then perform assert_processing_enabled();
  elsif old.state is distinct from 'sending' then perform assert_processing_enabled();end if;
 end if;
 return new;
end $$;
create trigger guard_processing_provider before insert or update on public.provider_calls
for each row execute function public.guard_processing_provider();

create or replace function public.cloud_claim(p_task uuid,p_owner uuid,p_version text) returns bigint
language plpgsql security invoker set search_path=public as $$
declare t worker_tasks;
begin
 if not processing_is_enabled() then return null;end if;
 select * into strict t from worker_tasks where id=p_task for update;
 if t.executor<>'vercel_workflow' or t.execution_state in ('paused','completed') then return null;end if;
 if t.execution_version is not null and t.execution_version<>p_version then
  update worker_tasks set execution_state='paused',failure_kind='version_mismatch',error_message='Versió de procés incompatible' where id=p_task;return null;
 end if;
 if t.lease_until>now() then return null;end if;
 update worker_tasks set lease_owner=p_owner,lease_generation=lease_generation+1,lease_until=now()+interval '4 minutes',
 execution_state='running',status='running',execution_version=p_version,claimed_at=now(),last_progress_at=now(),attempts=attempts+1
 where id=p_task returning * into t;
 return t.lease_generation;
end $$;

create or replace function public.claim_worker_task(p_worker_id text) returns setof public.worker_tasks
language plpgsql security definer set search_path=public as $$
declare tid uuid;
begin
 if not processing_is_enabled() then return;end if;
 select id into tid from worker_tasks where executor='local'
 and (status='queued' or(status='running' and claimed_at<now()-interval '30 minutes')) and attempts<3
 order by created_at,id for update skip locked limit 1;
 if tid is null then return;end if;
 return query update worker_tasks set status='running',attempts=attempts+1,claimed_by=left(p_worker_id,200),
 claimed_at=now(),completed_at=null,error_message=null where id=tid returning *;
end $$;

create or replace function public.cloud_resource(p_name text,p_owner uuid,p_release boolean default false,p_block text default null) returns boolean
language plpgsql security invoker set search_path=public as $$
declare r cloud_resources;
begin
 if not p_release then perform assert_processing_enabled();end if;
 select * into strict r from cloud_resources where name=p_name for update;
 if p_release then
  if r.owner=p_owner then update cloud_resources set owner=null,lease_until=null,blocked_kind=coalesce(p_block,blocked_kind) where name=p_name;end if;
  return true;
 end if;
 if r.blocked_kind is not null or (r.lease_until>now() and r.owner<>p_owner) then return false;end if;
 update cloud_resources set owner=p_owner,lease_until=now()+case when p_name='sandbox' then interval '12 minutes' else interval '4 minutes' end where name=p_name;
 return true;
end $$;

create or replace function public.cloud_resume(p_run uuid) returns uuid
language plpgsql security invoker set search_path=public as $$
declare t worker_tasks;j pipeline_jobs;
begin
 perform assert_processing_enabled();
 if exists(select 1 from cloud_resources where blocked_kind is not null) then
  raise exception 'CLOUD_RESOURCE_BLOCKED:recovery_required' using errcode='55000';
 end if;
 select * into strict t from worker_tasks where run_id=p_run and executor='vercel_workflow' order by created_at desc,id desc limit 1 for update;
 if t.execution_state not in ('pending','paused','interrupted') and not(t.execution_state='running' and t.lease_until<now()) then raise exception 'No es pot reprendre';end if;
 if t.failure_kind='provider_unknown' or exists(select 1 from cloud_checkpoints where task_id=t.id and value->>'state'='sending') then raise exception 'PROVIDER_UNKNOWN';end if;
 for j in select * from pipeline_jobs x where run_id=p_run and not exists(select 1 from analysis_results where pipeline_job_id=x.id)
 and x.status not in ('approved','corrected','rejected','insufficient_evidence','needs_review') order by id for update loop
  perform capture_job_snapshot(j.id,'before_cloud_resume');
  update job_attempts set status=case when status='running' then 'interrupted' else status end,completed_at=coalesce(completed_at,now()) where pipeline_job_id=j.id;
  insert into job_attempts(pipeline_job_id,ordinal,operation) select j.id,coalesce(max(ordinal),0)+1,'cloud_resume' from job_attempts where pipeline_job_id=j.id;
 end loop;
 -- An individual task may never clear global provider or infrastructure blocks.
 update worker_tasks set execution_state='pending',status='queued',failure_kind=null,lease_until=null,lease_owner=null where id=t.id;
 return t.id;
end $$;

revoke all on function public.processing_is_enabled(),public.assert_processing_enabled(),public.guard_processing_task(),public.guard_processing_provider(),public.touch_processing_setting() from public,anon,authenticated;
grant execute on function public.processing_is_enabled(),public.assert_processing_enabled() to service_role;
revoke all on function public.cloud_claim(uuid,uuid,text),public.claim_worker_task(text),public.cloud_resource(text,uuid,boolean,text),public.cloud_resume(uuid) from public,anon,authenticated;
grant execute on function public.cloud_claim(uuid,uuid,text),public.claim_worker_task(text),public.cloud_resource(text,uuid,boolean,text),public.cloud_resume(uuid) to service_role;
