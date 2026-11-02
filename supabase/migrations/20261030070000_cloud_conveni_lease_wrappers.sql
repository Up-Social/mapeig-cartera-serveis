-- Cloud mutations must validate the task lease in the same transaction.
-- Drain older cloud workers before deploying callers of these wrappers.
create function public.cloud_screen_conveni(p_task uuid,p_owner uuid,p_generation bigint,p_job uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform public.cloud_assert_lease(p_task,p_owner,p_generation);
 if not exists(select 1 from public.worker_tasks t join public.pipeline_jobs j on j.id=p_job
  where t.id=p_task and ((t.run_id is not null and j.run_id=t.run_id) or (t.source_record_id is not null and j.source_record_id=t.source_record_id))
  and (t.pipeline_job_id is null or t.pipeline_job_id=j.id)) then raise exception 'CLOUD_SCOPE';end if;
 return public.screen_conveni(p_job);
end $$;
create function public.cloud_persist_conveni(p_task uuid,p_owner uuid,p_generation bigint,p_job uuid,p_version text,p_payload jsonb,p_revisions jsonb,p_source_hash text)
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform public.cloud_assert_lease(p_task,p_owner,p_generation);
 if not exists(select 1 from public.worker_tasks t join public.pipeline_jobs j on j.id=p_job
  where t.id=p_task and ((t.run_id is not null and j.run_id=t.run_id) or (t.source_record_id is not null and j.source_record_id=t.source_record_id))
  and (t.pipeline_job_id is null or t.pipeline_job_id=j.id)) then raise exception 'CLOUD_SCOPE';end if;
 perform public.persist_conveni(p_job,p_version,p_payload,p_revisions,p_source_hash);
end $$;
revoke all on function public.cloud_screen_conveni(uuid,uuid,bigint,uuid),public.cloud_persist_conveni(uuid,uuid,bigint,uuid,text,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.cloud_screen_conveni(uuid,uuid,bigint,uuid),public.cloud_persist_conveni(uuid,uuid,bigint,uuid,text,jsonb,jsonb,text) to service_role;
