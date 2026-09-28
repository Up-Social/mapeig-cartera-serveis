do $$
declare before_runs bigint;before_jobs bigint;before_status text;
begin
 select count(*) into before_runs from pipeline_runs;
 select count(*) into before_jobs from pipeline_jobs;
 select processing_status::text into before_status from source_records where id='aaaaaaaa-0000-4000-8000-000000000001';
 update cloud_resources set blocked_kind='vercel_quota' where name='sandbox';
 begin
  perform begin_record_operation('aaaaaaaa-0000-4000-8000-000000000001','process','vercel_workflow');
  raise exception 'Blocked operation was accepted';
 exception when sqlstate '55000' then
  if sqlerrm<>'CLOUD_RESOURCE_BLOCKED:vercel_quota' then raise;end if;
 end;
 if (select count(*) from pipeline_runs)<>before_runs or (select count(*) from pipeline_jobs)<>before_jobs then raise exception 'Blocked operation left workflow rows';end if;
 if (select processing_status::text from source_records where id='aaaaaaaa-0000-4000-8000-000000000001')<>before_status then raise exception 'Blocked operation changed record state';end if;
 update cloud_resources set blocked_kind=null where name='sandbox';
end $$;
