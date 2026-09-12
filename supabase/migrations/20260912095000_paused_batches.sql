alter table public.pipeline_jobs add column error_kind text;
alter table public.pipeline_runs drop constraint pipeline_runs_status_check;
alter table public.pipeline_runs add constraint pipeline_runs_status_check check(status in ('draft','queued','preparing','ready','enriching','matching','needs_review','completed','preparation_error','matching_error','processing_error','paused'));
alter table public.pipeline_runs add column pause_reason text,add column pause_kind text;
create function public.resume_analysis_run(p_run uuid) returns void language plpgsql security invoker set search_path=public as $$
declare r pipeline_runs;
begin
 select * into strict r from pipeline_runs where id=p_run for update;
 if r.status<>'paused' then raise exception 'El lot no està pausat'; end if;
 update pipeline_jobs j set status='ready',error_message=null where run_id=p_run and status='error' and error_kind in ('quota','credentials') and preparation_status='ready' and not exists(select 1 from analysis_results a where a.pipeline_job_id=j.id);
 update pipeline_runs set status='queued',pause_reason=null,pause_kind=null where id=p_run;
 insert into worker_tasks(task_type,run_id) values('process_run',p_run);
end $$;
revoke all on function public.resume_analysis_run(uuid) from public;
grant execute on function public.resume_analysis_run(uuid) to service_role;
