alter table public.pipeline_runs add column comparison_of uuid references public.pipeline_runs(id);
alter table public.pipeline_runs add column idempotency_key uuid unique;
create table public.comparison_members(
 run_id uuid not null references public.pipeline_runs(id),
 source_record_id uuid not null references public.source_records(id) on delete cascade,
 origin_job_id uuid not null references public.pipeline_jobs(id) on delete cascade,
 baseline_snapshot_id uuid references public.job_snapshots(id) on delete cascade,
 baseline jsonb not null,
 primary key(run_id,source_record_id)
);
alter table public.comparison_members enable row level security;
revoke all on public.comparison_members from public,anon,authenticated;
grant select,insert on public.comparison_members to service_role;

create function public.preflight_batch_rerun(p_origin uuid,p_provider text,p_model text) returns jsonb
language plpgsql stable security invoker set search_path=public as $$
declare result jsonb; members jsonb; origin pipeline_runs;
begin
 select * into strict origin from pipeline_runs where id=p_origin;
 select coalesce(jsonb_agg(jsonb_build_object(
  'recordId',j.source_record_id,'externalId',r.source_record_id,'jobId',j.id,'status',j.status,
  'snapshotId',s.id,'snapshotHash',s.content_hash,
  'reviewId',(select id from review_decisions where pipeline_job_id=j.id order by created_at desc,id desc limit 1),
  'reusableDocuments',(select count(*) from source_documents d where d.source_record_id=r.id and d.status='fetched' and d.chunk_count>0),
  'rediscover',not exists(select 1 from source_documents d where d.source_record_id=r.id and d.status='fetched' and d.chunk_count>0 and d.resolution->>'result'='resolved'),
  'active',exists(select 1 from pipeline_jobs a where a.source_record_id=r.id and a.status in ('queued','selected','preparing','ready','matching'))
    or exists(select 1 from worker_tasks t where (t.source_record_id=r.id or t.run_id in(select run_id from pipeline_jobs where source_record_id=r.id)) and (t.status in ('queued','running') or t.lease_until>now()))
    or exists(select 1 from provider_calls c join pipeline_jobs a on a.id=c.pipeline_job_id where a.source_record_id=r.id and c.state='sending')
    or exists(select 1 from cloud_checkpoints c join worker_tasks t on t.id=c.task_id where c.value->>'state'='sending' and (t.source_record_id=r.id or exists(select 1 from pipeline_jobs a where a.source_record_id=r.id and position(a.id::text in c.item_key)>0)))
 ) order by j.source_record_id),'[]') into members
 from pipeline_jobs j join source_records r on r.id=j.source_record_id
 left join lateral(select id,content_hash from job_snapshots where pipeline_job_id=j.id order by captured_at desc,id desc limit 1)s on true
 where j.run_id=p_origin;
 result:=jsonb_build_object('originId',p_origin,'batchNumber',origin.batch_number,'provider',p_provider,'model',p_model,'members',members,'count',jsonb_array_length(members),'estimatedCost',null,'estimatedSeconds',null);
 return result||jsonb_build_object('token',encode(extensions.digest(result::text,'sha256'),'hex'));
end $$;

create function public.create_batch_rerun(p_origin uuid,p_token text,p_idempotency uuid,p_provider text,p_model text,p_executor text default 'local') returns jsonb
language plpgsql security invoker set search_path=public as $$
declare existing pipeline_runs; preflight jsonb; member jsonb;run uuid;task uuid;j uuid;baseline jsonb;
begin
 if p_idempotency is null or p_provider not in ('mock','openai') or nullif(p_model,'') is null or p_executor not in ('local','vercel_workflow') then raise exception 'INVALID_RERUN';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_idempotency::text,0));
 select * into existing from pipeline_runs where idempotency_key=p_idempotency;
 if found then
  if existing.comparison_of<>p_origin or existing.parameters->>'confirmation_token'<>p_token then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return jsonb_build_object('runId',existing.id,'taskId',(select id from worker_tasks where run_id=existing.id order by created_at,id limit 1),'reused',true);
 end if;
 perform 1 from source_records where id in(select source_record_id from pipeline_jobs where run_id=p_origin) order by id for update nowait;
 perform 1 from pipeline_runs where id=p_origin for update nowait;
 preflight:=preflight_batch_rerun(p_origin,p_provider,p_model);
 if preflight->>'token' is distinct from p_token then raise exception 'PREFLIGHT_CHANGED';end if;
 if (preflight->>'count')::int=0 then raise exception 'EMPTY_ORIGIN';end if;
 if exists(select 1 from jsonb_array_elements(preflight->'members')m where (m->>'active')::boolean) then raise exception 'RECORD_ACTIVE_OR_UNKNOWN_PROVIDER';end if;
 insert into pipeline_runs(comparison_of,idempotency_key,status,stage,selected_count,parameters)
 values(p_origin,p_idempotency,'queued','preparation',(preflight->>'count')::int,jsonb_build_object('auto_process',true,'purpose','comparison','provider',p_provider,'model',p_model,'confirmation_token',p_token,'document_policy','reuse_valid_discover_incomplete')) returning id into run;
 for member in select value from jsonb_array_elements(preflight->'members')loop
  select payload into baseline from job_snapshots where id=(member->>'snapshotId')::uuid;
  baseline:=coalesce(baseline,jsonb_build_object('provenance',jsonb_build_object('mode','unrecoverable','missing','Historical snapshot unavailable')));
  baseline:=baseline||jsonb_build_object('review',(select to_jsonb(d) from review_decisions d where id=(member->>'reviewId')::uuid),'phases',(select to_jsonb(p) from job_phase_states p where id=(member->>'jobId')::uuid),'documents',coalesce((select jsonb_agg(v.payload) from job_document_versions l join document_versions v on v.id=l.document_version_id where l.snapshot_id=(member->>'snapshotId')::uuid),'[]'));
  insert into comparison_members values(run,(member->>'recordId')::uuid,(member->>'jobId')::uuid,(member->>'snapshotId')::uuid,baseline);
  insert into pipeline_jobs(run_id,source_record_id,previous_job_id,status,preparation_status,enrichment_status)
  values(run,(member->>'recordId')::uuid,(member->>'jobId')::uuid,'selected','pending','pending') returning id into j;
  update source_records set enrichment_status='pending',enrichment_error=null,processing_status='pendent',updated_at=now() where id=(member->>'recordId')::uuid;
 end loop;
 insert into worker_tasks(task_type,run_id,executor) values('process_run',run,p_executor) returning id into task;
 return jsonb_build_object('runId',run,'taskId',task,'reused',false);
end $$;
revoke all on function public.preflight_batch_rerun(uuid,text,text),public.create_batch_rerun(uuid,text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.preflight_batch_rerun(uuid,text,text),public.create_batch_rerun(uuid,text,uuid,text,text,text) to service_role;
