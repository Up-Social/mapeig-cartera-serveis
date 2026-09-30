alter table public.source_documents add column extraction_version text, add column extraction_coverage jsonb;
alter function public.cloud_commit(uuid,uuid,bigint,uuid,text,jsonb) rename to cloud_commit_before_readability;
create function public.cloud_commit(p_task uuid,p_owner uuid,p_generation bigint,p_job uuid,p_operation text,p_data jsonb) returns void
language plpgsql security invoker set search_path=public as $$ begin
 perform cloud_assert_lease(p_task,p_owner,p_generation);
 if not exists(select 1 from pipeline_jobs j join worker_tasks t on t.id=p_task where j.id=p_job and (t.run_id=j.run_id or t.source_record_id=j.source_record_id)) then raise exception 'CLOUD_SCOPE';end if;
 if p_operation='document_failure' then
  update source_documents set status='error',error_message='Document incomplet o no processable; revisa les pàgines i recupera la font.',quality_score=0,quality_flags=array['incomplete_extraction'],extraction_partial=true,extraction_coverage=coalesce(p_data->'coverage',extraction_coverage),updated_at=now()
  where id=(p_data->>'id')::uuid and source_record_id=(select source_record_id from pipeline_jobs where id=p_job);
  if not found then raise exception 'CLOUD_SCOPE';end if;
  return;
 end if;
 perform cloud_commit_before_readability(p_task,p_owner,p_generation,p_job,p_operation,p_data);
 if p_operation='document' then
  update source_documents set extraction_version=p_data->>'extraction_version',extraction_coverage=p_data->'coverage'
  where id=(p_data->>'id')::uuid and source_record_id=(select source_record_id from pipeline_jobs where id=p_job);
 end if;
end $$;
revoke all on function public.cloud_commit(uuid,uuid,bigint,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.cloud_commit(uuid,uuid,bigint,uuid,text,jsonb) to service_role;
do $$ declare definition text; updated text; begin
 definition:=pg_get_functiondef('public.persist_analysis(uuid,text,jsonb,jsonb,jsonb)'::regprocedure);
 updated:=replace(definition,'''duplicate_text'',''javascript_shell'',''generic_portal''','''duplicate_text'',''javascript_shell'',''generic_portal'',''corrupt_text'',''incomplete_extraction''');
 if definition=updated then raise exception 'Evidence guard patch failed';end if;
 execute updated;
end $$;
