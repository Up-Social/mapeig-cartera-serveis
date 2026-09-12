create or replace function public.cloud_finish(p_task uuid,p_owner uuid,p_generation bigint,p_state text,p_kind text default null) returns void
language plpgsql security invoker set search_path=public as $$
declare t worker_tasks; v_review_count integer;v_pending_count integer;
begin
 perform cloud_assert_lease(p_task,p_owner,p_generation);
 if p_state not in ('pending','paused','interrupted','completed') then raise exception 'Invalid state'; end if;
 update worker_tasks set execution_state=p_state,failure_kind=p_kind,
 status=case when p_state='completed' then 'completed' when p_state in ('paused','interrupted') then 'failed' else 'queued' end,
 lease_until=null,lease_owner=null,last_progress_at=now(),completed_at=case when p_state='completed' then now() else null end where id=p_task returning * into t;
 if t.run_id is null then return;end if;
 perform refresh_pipeline_run(t.run_id);
 select count(*) filter(where status='needs_review'),count(*) filter(where status not in ('needs_review','approved','corrected','rejected','insufficient_evidence','error')) into v_review_count,v_pending_count from pipeline_jobs where run_id=t.run_id;
 update pipeline_runs set processed_count=(select count(*) from analysis_results a join pipeline_jobs j on j.id=a.pipeline_job_id where j.run_id=t.run_id),
 status=case when p_state in ('paused','interrupted') then 'paused' when p_state='completed' and t.task_type='prepare_run' then 'ready' when p_state='completed' and v_pending_count=0 then case when v_review_count>0 then 'needs_review' else 'completed' end else 'preparing' end,
 stage=case when p_state='completed' and v_pending_count=0 then case when v_review_count>0 then 'review' else 'completed' end else stage end,
 pause_kind=p_kind,pause_reason=case when p_state in ('paused','interrupted') then 'Execució pausada: '||coalesce(p_kind,'internal') else null end where id=t.run_id;
end $$;
-- Wrapper preserves the existing checked transaction and updates progress/usage once.
alter function public.cloud_commit(uuid,uuid,bigint,uuid,text,jsonb) rename to cloud_commit_v1;
create function public.cloud_commit(p_task uuid,p_owner uuid,p_generation bigint,p_job uuid,p_operation text,p_data jsonb) returns void
language plpgsql security invoker set search_path=public as $$
declare rid uuid;already boolean;usage jsonb;
begin
 perform cloud_assert_lease(p_task,p_owner,p_generation);
 select run_id into strict rid from pipeline_jobs where id=p_job for update;
 select exists(select 1 from analysis_results where pipeline_job_id=p_job) into already;
 perform cloud_commit_v1(p_task,p_owner,p_generation,p_job,p_operation,p_data);
 if not already and p_operation in ('analysis','enrichment') and not exists(select 1 from cloud_checkpoints where task_id=p_task and item_key='usage:'||p_job||':'||p_operation) then
  usage:=coalesce(p_data->'usage','{}');
  update pipeline_runs set actual_input_tokens=coalesce(actual_input_tokens,0)+coalesce((usage->>'input_tokens')::int,0),actual_output_tokens=coalesce(actual_output_tokens,0)+coalesce((usage->>'output_tokens')::int,0) where id=rid;
  perform cloud_checkpoint(p_task,p_owner,p_generation,'usage:'||p_job||':'||p_operation,usage);
 end if;
 if p_operation='document' then update source_documents set extraction_partial=coalesce((p_data->>'partial')::boolean,false) where id=(p_data->>'id')::uuid;end if;
 update pipeline_runs set stage=case when p_operation='enrichment' then 'enrichment' when p_operation='analysis' then 'matching' else stage end where id=rid;
end $$;
revoke all on function public.cloud_commit(uuid,uuid,bigint,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.cloud_commit(uuid,uuid,bigint,uuid,text,jsonb) to service_role;
