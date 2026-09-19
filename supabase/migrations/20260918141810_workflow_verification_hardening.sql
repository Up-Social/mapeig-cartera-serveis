-- Explicit grants are required in a fresh database without permissive default ACLs.
grant delete on public.matching_candidates to service_role;
alter function public.normalize_matching_identity(text) set search_path=pg_catalog;

-- Bind confirmation to the actual document identities and hashes, not just a count.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.preflight_batch_rerun(uuid,text,text)'::regprocedure);
 if position('''documents''' in definition)=0 then
  definition:=replace(definition,$old$'reusableDocuments',$old$,$new$'documents',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'url',d.url,'hash',d.content_hash,'status',d.status,'chunks',d.chunk_count) order by d.id),'[]') from source_documents d where d.source_record_id=r.id),'reusableDocuments',$new$);
  execute definition;
 end if;
end $$;

create or replace view public.job_result_labels with(security_invoker=true) as
select j.id,coalesce(s.payload->'source'->>'title','Dades originals històriques no recuperables') as title,
 s.payload->'source'->>'source_record_id' as external_id,
 j.id=(select latest.id from pipeline_jobs latest where latest.source_record_id=j.source_record_id order by created_at desc,id desc limit 1) as is_current
from public.pipeline_jobs j
left join lateral(select payload from job_snapshots where pipeline_job_id=j.id order by captured_at desc,id desc limit 1)s on true;
revoke all on public.job_result_labels from public,anon,authenticated;
grant select on public.job_result_labels to service_role;

create or replace view public.current_issue_results with(security_invoker=true) as
select c.*,case
 when c.execution_status='error' and p.preparation='error' then 'source'
 when c.job_id is null and r.evidence_status in ('error','no_source','unsupported') then 'source'
 when c.execution_status is distinct from 'error' and c.classification='insufficient_evidence' then 'insufficient'
 else 'technical' end as issue_group
from public.current_record_results c left join public.job_phase_states p on p.id=c.job_id
join public.source_records r on r.id=c.id where c.destination='issues';
revoke all on public.current_issue_results from public,anon,authenticated;
grant select on public.current_issue_results to service_role;

-- An old enrichment projection cannot complete a phase blocked by preparation.
create or replace view public.job_phase_states with(security_invoker=true) as
with facts as (
 select j.*,exists(select 1 from analysis_results a where a.pipeline_job_id=j.id) as analyzed,
 exists(select 1 from matching_candidates c where c.pipeline_job_id=j.id) as legacy_matched from public.pipeline_jobs j
),prepared as (
 select f.*,case when analyzed or legacy_matched or preparation_status='ready' then 'completed'
 when preparation_status in ('no_source','unsupported','error') or (status='error' and preparation_status in ('pending','discovering','fetching','chunking')) then 'error'
 when status='preparing' or preparation_status in ('discovering','fetching','chunking') then 'running' else 'pending' end as preparation from facts f
),enriched as (
 select p.*,case when analyzed or legacy_matched then 'completed' when preparation='error' then 'blocked'
 when enrichment_status='completed' then 'completed'
 when enrichment_status='error' or (status='error' and preparation='completed') then 'error'
 when enrichment_status='processing' then 'running' else 'pending' end as enrichment from prepared p
)
select id,run_id,source_record_id,preparation,enrichment,
 case when analyzed or legacy_matched then 'completed' when preparation='error' or enrichment in ('error','blocked') then 'blocked'
 when status='error' then 'error' when status='matching' and enrichment='completed' then 'running' else 'pending' end as matching,
 analyzed or legacy_matched as analyzed,status in ('needs_review','approved','corrected','rejected','insufficient_evidence','error') or analyzed as automatic_terminal from enriched;

-- Recovery must never reinterpret an unknown provider outcome as an explicit rejection.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.cloud_retry_validation(uuid,text)'::regprocedure);
 definition:=replace(definition,'join worker_tasks t on t.id=c.task_id where t.run_id=p_run','join worker_tasks recovery_task on recovery_task.id=c.task_id where recovery_task.run_id=p_run');
 if position('PROVIDER_UNKNOWN' in definition)=0 then
 definition:=replace(definition,'if p_revision !~',
 'if exists(select 1 from cloud_checkpoints c join worker_tasks recovery_task on recovery_task.id=c.task_id where recovery_task.run_id=p_run and c.value->>''state''=''sending'') then raise exception ''PROVIDER_UNKNOWN'';end if; if p_revision !~');
 end if;
 execute definition;
end $$;

create or replace function public.trace_technical_recovery() returns trigger language plpgsql security invoker set search_path=public as $$
declare attempt job_attempts;
begin
 if old.status='error' and new.status in ('ready','selected','queued','preparing') then
  if exists(select 1 from analysis_results where pipeline_job_id=old.id) then raise exception 'FINAL_RESULT_REQUIRES_NEW_JOB';end if;
  if exists(select 1 from provider_calls where pipeline_job_id=old.id and state='sending') or exists(select 1 from cloud_checkpoints where position(old.id::text in item_key)>0 and value->>'state'='sending') then raise exception 'PROVIDER_UNKNOWN';end if;
  select * into attempt from job_attempts where pipeline_job_id=old.id order by ordinal desc limit 1;
  if attempt.status is distinct from 'running' then
   perform capture_job_snapshot(old.id,'before_technical_recovery');
   insert into job_attempts(pipeline_job_id,ordinal,operation) select old.id,coalesce(max(ordinal),0)+1,'technical_recovery' from job_attempts where pipeline_job_id=old.id;
  end if;
 end if;
 return new;
end $$;
drop trigger if exists trace_technical_recovery on public.pipeline_jobs;
create trigger trace_technical_recovery before update of status on public.pipeline_jobs for each row execute function public.trace_technical_recovery();

create or replace function public.retry_job_operation(p_record uuid,p_expected_job uuid,p_operation text,p_executor text default 'local') returns jsonb
language plpgsql security invoker set search_path=public as $$
declare latest uuid;
begin
 perform 1 from source_records where id=p_record for update;
 select id into latest from pipeline_jobs where source_record_id=p_record order by created_at desc,id desc limit 1;
 if latest is distinct from p_expected_job then raise exception 'STALE_JOB' using errcode='40001';end if;
 return begin_record_operation(p_record,p_operation,p_executor);
end $$;
revoke all on function public.retry_job_operation(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.retry_job_operation(uuid,uuid,text,text) to service_role;

create or replace function public.cloud_resume(p_run uuid) returns uuid language plpgsql security invoker set search_path=public as $$
declare t worker_tasks;j pipeline_jobs;
begin
 select * into strict t from worker_tasks where run_id=p_run and executor='vercel_workflow' order by created_at desc,id desc limit 1 for update;
 if t.execution_state not in ('pending','paused','interrupted') and not(t.execution_state='running' and t.lease_until<now()) then raise exception 'No es pot reprendre';end if;
 if t.failure_kind='provider_unknown' or exists(select 1 from cloud_checkpoints where task_id=t.id and value->>'state'='sending') then raise exception 'PROVIDER_UNKNOWN';end if;
 for j in select * from pipeline_jobs x where run_id=p_run and not exists(select 1 from analysis_results where pipeline_job_id=x.id) and x.status not in ('approved','corrected','rejected','insufficient_evidence','needs_review') order by id for update loop
  perform capture_job_snapshot(j.id,'before_cloud_resume');
  update job_attempts set status=case when status='running' then 'interrupted' else status end,completed_at=coalesce(completed_at,now()) where pipeline_job_id=j.id;
  insert into job_attempts(pipeline_job_id,ordinal,operation) select j.id,coalesce(max(ordinal),0)+1,'cloud_resume' from job_attempts where pipeline_job_id=j.id;
 end loop;
 update cloud_resources set blocked_kind=null where blocked_kind=t.failure_kind;
 update worker_tasks set execution_state='pending',status='queued',failure_kind=null,lease_until=null,lease_owner=null where id=t.id;
 return t.id;
end $$;
