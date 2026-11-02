-- Automatic title exclusion and reopening remain separate from economic approval.
do $$
declare sid uuid:=gen_random_uuid();run_ uuid;job_ uuid;next_job uuid;before_ integer;
begin
 insert into public.source_records(id,source_dataset,source_record_id,mechanism,title,source_payload)
 values(sid,'convenis',sid::text,'Conveni','Segona Addenda al Conveni','{}');
 insert into public.pipeline_runs default values returning id into run_;
 insert into public.pipeline_jobs(run_id,source_record_id,status) values(run_,sid,'ready') returning id into job_;
 if not public.screen_conveni(job_) or not public.screen_conveni(job_) then raise exception 'exclusion not idempotent';end if;
 select count(*) into before_ from public.conveni_analyses where source_record_id=sid;
 if (select processing_status from public.source_records where id=sid)<>'rebutjat' then raise exception 'exclusion not visible';end if;
 perform public.reopen_conveni(sid,job_,gen_random_uuid(),'El títol requereix revisar el contingut');
 if (select processing_status from public.source_records where id=sid)<>'sense_evidencia' then raise exception 'reopening not visible';end if;
 if (select count(*) from public.conveni_analyses where source_record_id=sid)<>before_ then raise exception 'exclusion history changed';end if;
 insert into public.pipeline_runs default values returning id into run_;
 insert into public.pipeline_jobs(run_id,source_record_id,status,created_at) values(run_,sid,'ready',clock_timestamp()+interval '1 second') returning id into next_job;
 if public.screen_conveni(next_job) then raise exception 'reopened record automatically excluded again';end if;
end $$;
