-- Additive cloud execution ledger; the legacy local queue remains available.
alter table public.worker_tasks add column executor text not null default 'local' check(executor in ('local','vercel_workflow'));
alter table public.worker_tasks add column workflow_id text, add column execution_version text,
 add column execution_state text not null default 'pending' check(execution_state in ('pending','running','paused','interrupted','completed')),
 add column lease_owner uuid, add column lease_generation bigint not null default 0,
 add column lease_until timestamptz, add column last_progress_at timestamptz,
 add column failure_kind text, add column dispatch_at timestamptz;
create table public.cloud_checkpoints (
 task_id uuid not null references public.worker_tasks(id), item_key text not null,
 value jsonb not null, updated_at timestamptz not null default now(), primary key(task_id,item_key)
);
create table public.cloud_resources (
 name text primary key check(name in ('ai','sandbox')), owner uuid, lease_until timestamptz, blocked_kind text
);
insert into public.cloud_resources(name) values('ai'),('sandbox');
alter table public.cloud_checkpoints enable row level security;
alter table public.cloud_resources enable row level security;
grant select,insert,update on public.cloud_checkpoints,public.cloud_resources to service_role;

create function public.cloud_assert_lease(p_task uuid,p_owner uuid,p_generation bigint) returns void
language plpgsql security invoker set search_path=public as $$
begin
 perform 1 from worker_tasks where id=p_task and executor='vercel_workflow' and lease_owner=p_owner
 and lease_generation=p_generation and lease_until>now() and execution_state='running' for update;
 if not found then raise exception 'CLOUD_LEASE_LOST'; end if;
end $$;
create function public.cloud_claim(p_task uuid,p_owner uuid,p_version text) returns bigint
language plpgsql security invoker set search_path=public as $$
declare t worker_tasks;
begin
 select * into strict t from worker_tasks where id=p_task for update;
 if t.executor<>'vercel_workflow' or t.execution_state in ('paused','completed') then return null; end if;
 if t.execution_version is not null and t.execution_version<>p_version then
 update worker_tasks set execution_state='paused',failure_kind='version_mismatch',error_message='Versió de procés incompatible' where id=p_task; return null; end if;
 if t.lease_until>now() then return null; end if;
 update worker_tasks set lease_owner=p_owner,lease_generation=lease_generation+1,lease_until=now()+interval '4 minutes',
 execution_state='running',status='running',execution_version=p_version,claimed_at=now(),last_progress_at=now(),attempts=attempts+1 where id=p_task returning * into t;
 return t.lease_generation;
end $$;
create function public.cloud_checkpoint(p_task uuid,p_owner uuid,p_generation bigint,p_key text,p_value jsonb) returns void
language plpgsql security invoker set search_path=public as $$
begin
 perform cloud_assert_lease(p_task,p_owner,p_generation);
 insert into cloud_checkpoints(task_id,item_key,value) values(p_task,p_key,p_value)
 on conflict(task_id,item_key) do update set value=excluded.value,updated_at=now();
 update worker_tasks set lease_until=now()+interval '4 minutes',last_progress_at=now() where id=p_task;
end $$;
create function public.cloud_finish(p_task uuid,p_owner uuid,p_generation bigint,p_state text,p_kind text default null) returns void
language plpgsql security invoker set search_path=public as $$
begin
 perform cloud_assert_lease(p_task,p_owner,p_generation);
 if p_state not in ('pending','paused','interrupted','completed') then raise exception 'Invalid state'; end if;
 update worker_tasks set execution_state=p_state,failure_kind=p_kind,
 status=case when p_state='completed' then 'completed' when p_state in ('paused','interrupted') then 'failed' else 'queued' end,
 lease_until=null,lease_owner=null,last_progress_at=now(),completed_at=case when p_state='completed' then now() else null end where id=p_task;
end $$;
create function public.cloud_resource(p_name text,p_owner uuid,p_release boolean default false,p_block text default null) returns boolean
language plpgsql security invoker set search_path=public as $$
declare r cloud_resources;
begin
 select * into strict r from cloud_resources where name=p_name for update;
 if p_release then
  if r.owner=p_owner then update cloud_resources set owner=null,lease_until=null,blocked_kind=coalesce(p_block,blocked_kind) where name=p_name; end if;
  return true;
 end if;
 if r.blocked_kind is not null or (r.lease_until>now() and r.owner<>p_owner) then return false; end if;
 update cloud_resources set owner=p_owner,lease_until=now()+interval '4 minutes' where name=p_name; return true;
end $$;

-- All cloud domain writes pass through this fenced, task-scoped transaction.
create function public.cloud_commit(p_task uuid,p_owner uuid,p_generation bigint,p_job uuid,p_operation text,p_data jsonb) returns void
language plpgsql security invoker set search_path=public as $$
declare t worker_tasks;j pipeline_jobs;d jsonb;e jsonb;eid uuid;doc_id uuid;result_exists boolean;
begin
 perform cloud_assert_lease(p_task,p_owner,p_generation);
 select * into strict t from worker_tasks where id=p_task;
 select * into strict j from pipeline_jobs where id=p_job for update;
 if not ((t.run_id is not null and j.run_id=t.run_id) or (t.source_record_id=j.source_record_id)) then raise exception 'CLOUD_SCOPE'; end if;
 select exists(select 1 from analysis_results where pipeline_job_id=j.id) into result_exists;
 if result_exists then return; end if;
 if p_operation='discover' then
  for d in select value from jsonb_array_elements(p_data) loop
   if (d->>'source_record_id')::uuid<>j.source_record_id then raise exception 'CLOUD_SCOPE';end if;
   insert into source_documents(source_record_id,url,url_hash,document_type,source_fields,status)
   values(j.source_record_id,d->>'url',d->>'url_hash',d->>'document_type',array(select jsonb_array_elements_text(d->'source_fields')),'discovered')
   on conflict(source_record_id,url_hash) do nothing;
  end loop;
 elsif p_operation='document' then
  doc_id:=(p_data->>'id')::uuid;
  perform 1 from source_documents where id=doc_id and source_record_id=j.source_record_id for update;
  if not found then raise exception 'CLOUD_SCOPE';end if;
  -- Existing evidence is immutable once linked to a proposal or enrichment.
  if exists(select 1 from evidence_chunks c join matching_candidate_evidence ev on ev.evidence_chunk_id=c.id where c.source_document_id=doc_id)
   or exists(select 1 from evidence_chunks c join record_enrichment_evidence ev on ev.evidence_chunk_id=c.id where c.source_document_id=doc_id) then return;end if;
  update source_documents set status='fetched',extracted_text=p_data->>'text',text_length=length(p_data->>'text'),text_preview=left(p_data->>'text',600),
   extraction_method=p_data->>'method',content_hash=p_data->>'hash',extracted_text_hash=p_data->>'text_hash',mime_type=p_data->>'mime',
   fetched_at=now(),updated_at=now(),error_message=null,chunk_count=jsonb_array_length(p_data->'chunks') where id=doc_id;
  delete from evidence_chunks where source_document_id=doc_id;
  for d in select value from jsonb_array_elements(p_data->'chunks') loop
   insert into evidence_chunks(source_document_id,ordinal,content,content_hash,character_count)
   values(doc_id,(d->>'ordinal')::integer,d->>'content',d->>'hash',length(d->>'content'));
  end loop;
 elsif p_operation='ready' then
  update pipeline_jobs set preparation_status='ready',status='ready',error_message=null where id=j.id;
  update source_records set processing_status='preparat',evidence_status='ready',updated_at=now() where id=j.source_record_id;
 elsif p_operation='enrichment' then
  e:=p_data->'enrichment';
  insert into record_enrichments(source_record_id,extracted_title,provider_name,provider_nif,mechanism,award_date,amount,contracting_body,target_population,scope_facts,summary,confidence,engine,engine_version)
  values(j.source_record_id,e->>'title',e->>'provider_name',e->>'provider_nif',e->>'mechanism',nullif(e->>'award_date','')::date,(e->>'amount')::numeric,e->>'contracting_body',e->>'target_population',e->'scope_facts',e->>'summary',(e->>'confidence')::numeric,'openai-responses-enrichment',p_data->>'model')
  on conflict(source_record_id) do update set extracted_title=excluded.extracted_title,provider_name=excluded.provider_name,provider_nif=excluded.provider_nif,mechanism=excluded.mechanism,award_date=excluded.award_date,amount=excluded.amount,contracting_body=excluded.contracting_body,target_population=excluded.target_population,scope_facts=excluded.scope_facts,summary=excluded.summary,confidence=excluded.confidence,engine_version=excluded.engine_version
  returning id into eid;
  delete from record_enrichment_evidence where enrichment_id=eid;
  for d in select value from jsonb_array_elements(p_data->'evidence') loop
   if not exists(select 1 from evidence_chunks c join source_documents s on s.id=c.source_document_id where c.id=(d->>'id')::uuid and s.source_record_id=j.source_record_id) then raise exception 'CLOUD_EVIDENCE_SCOPE';end if;
   insert into record_enrichment_evidence(enrichment_id,evidence_chunk_id) values(eid,(d->>'id')::uuid);
  end loop;
  update source_records set enrichment_status='completed',enrichment_error=null,updated_at=now() where id=j.source_record_id;
 elsif p_operation='analysis' then
  perform persist_analysis(j.id,p_data->>'version',p_data->'result',p_data->'candidates',p_data->'evidence');
 elsif p_operation='error' then
  update pipeline_jobs set status='error',error_kind=p_data->>'kind',error_message=p_data->>'message',completed_at=now() where id=j.id;
  update source_records set processing_status='error',updated_at=now() where id=j.source_record_id;
 else raise exception 'CLOUD_OPERATION';end if;
 update worker_tasks set last_progress_at=now(),lease_until=now()+interval '4 minutes' where id=p_task;
end $$;

create function public.cloud_create_run(p_records uuid[],p_ocr boolean default false) returns uuid
language plpgsql security invoker set search_path=public as $$
declare rid uuid;n integer;
begin
 if cardinality(p_records)<1 or cardinality(p_records)>500 then raise exception 'Invalid selection';end if;
 perform 1 from source_records where id=any(p_records) order by id for update;
 select count(*) into n from source_records where id=any(p_records);
 if n<>cardinality(p_records) then raise exception 'Invalid selection';end if;
 if exists(select 1 from pipeline_jobs j left join analysis_results a on a.pipeline_job_id=j.id where j.source_record_id=any(p_records) and (a.id is not null or j.status in ('selected','preparing','ready','matching','queued'))) then raise exception 'Registre ja seleccionat o analitzat';end if;
 insert into pipeline_runs(status,stage,selected_count,parameters,started_at) values('queued','preparation',n,jsonb_build_object('auto_process',true,'ocr_recovery',p_ocr,'purpose','automated_cloud'),now()) returning id into rid;
 insert into pipeline_jobs(run_id,source_record_id,status,preparation_status) select rid,id,'selected','pending' from source_records where id=any(p_records);
 update source_records set processing_status='preparant',updated_at=now() where id=any(p_records);
 insert into worker_tasks(task_type,run_id,executor) values('process_run',rid,'vercel_workflow');
 return rid;
end $$;

-- A legacy Mac worker must never claim a cloud-owned task.
create or replace function public.claim_worker_task(p_worker_id text) returns setof public.worker_tasks
language plpgsql security definer set search_path=public as $$
declare tid uuid;
begin
 select id into tid from worker_tasks where executor='local' and (status='queued' or(status='running' and claimed_at<now()-interval '30 minutes')) and attempts<3 order by created_at,id for update skip locked limit 1;
 if tid is null then return;end if;
 return query update worker_tasks set status='running',attempts=attempts+1,claimed_by=left(p_worker_id,200),claimed_at=now(),completed_at=null,error_message=null where id=tid returning *;
end $$;

-- No public/anonymous RPC access.
do $$ declare r record;begin
 for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'cloud_%' loop
 execute format('revoke all on function %s from public, anon, authenticated',r.signature);
 execute format('grant execute on function %s to service_role',r.signature);
 end loop;
end $$;
