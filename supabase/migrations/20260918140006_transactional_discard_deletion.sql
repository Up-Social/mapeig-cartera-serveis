create or replace view public.current_record_results with (security_invoker=true) as
select r.id,r.source_record_id,r.title,r.provider_name,r.financing_type,r.source_dataset,
 j.id as job_id,j.run_id,b.batch_number,j.status as execution_status,j.created_at as job_created_at,j.error_message,
 a.id as analysis_id,a.catalog_version_id,a.target_population,a.service_description,a.evidence,
 case when j.status in ('selected','queued','preparing','ready','matching') then null else coalesce(d.classification,a.reviewed_classification,a.classification) end as classification,
 case when d.id is not null then to_jsonb(d.reasons) when a.reviewed_classification is not null then to_jsonb(a.reviewed_reasons) else a.reasons end as reasons,
 coalesce(d.reason,a.review_notes,a.explanation) as explanation,
 d.decision as review_decision,coalesce(d.created_at,a.reviewed_at) as reviewed_at,
 (d.id is not null or a.reviewed_classification is not null) as human_reviewed,
 case
  when j.status='error' then 'issues'
  when j.status in ('selected','queued','preparing','ready','matching') then 'processing'
  when coalesce(d.classification,a.reviewed_classification,a.classification)='discarded' then 'discarded'
  when coalesce(d.classification,a.reviewed_classification,a.classification)='insufficient_evidence' then 'issues'
  when coalesce(d.classification,a.reviewed_classification,a.classification)='out_of_portfolio' then 'outside'
  when coalesce(d.classification,a.reviewed_classification,a.classification)='in_portfolio' and (d.id is not null or a.reviewed_classification is not null) then 'approved'
  when j.status='needs_review' then 'review'
  when j.id is null and (r.evidence_status in ('error','no_source','unsupported') or r.enrichment_status='error') then 'issues'
  else 'unprocessed' end as destination,
 md5(jsonb_build_array(j.id,a.id,coalesce(d.classification,a.reviewed_classification,a.classification),d.id,d.reasons,a.reviewed_reasons,a.explanation,a.review_notes)::text) as result_token
from public.source_records r
left join lateral(select * from public.pipeline_jobs where source_record_id=r.id order by created_at desc,id desc limit 1) j on true
left join public.pipeline_runs b on b.id=j.run_id
left join public.analysis_results a on a.pipeline_job_id=j.id
left join lateral(select * from public.review_decisions where pipeline_job_id=j.id order by created_at desc,id desc limit 1) d on true;
revoke all on public.current_record_results from public,anon,authenticated;
grant select on public.current_record_results to service_role;

create table public.storage_purge_batches(id uuid primary key default gen_random_uuid(),record_count integer not null,created_at timestamptz not null default now(),completed_at timestamptz);
create table public.storage_purge_items(id uuid primary key default gen_random_uuid(),batch_id uuid not null references public.storage_purge_batches(id),bucket text not null check(bucket='cloud-documents'),path text not null,status text not null default 'pending' check(status in ('pending','complete')),attempts integer not null default 0,last_error text,verified_at timestamptz,unique(batch_id,bucket,path));
alter table public.storage_purge_batches enable row level security;
alter table public.storage_purge_items enable row level security;
revoke all on public.storage_purge_batches,public.storage_purge_items from public,anon,authenticated;
grant select,update on public.storage_purge_batches,public.storage_purge_items to service_role;

create function public.delete_discarded_records(p_selection jsonb,p_confirmed_count integer) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare ids uuid[];jobs uuid[];runs uuid[];docs uuid[];tasks uuid[];exclusive_tasks uuid[];provisions uuid[];tokens text[];purge uuid; run uuid;
begin
 if p_selection is null or p_confirmed_count is null or jsonb_typeof(p_selection)<>'array' or p_confirmed_count<1 or p_confirmed_count>100 or jsonb_array_length(p_selection)<>p_confirmed_count then raise exception 'DELETE_SELECTION_INVALID';end if;
 select array_agg((x->>'id')::uuid order by x->>'id') into ids from jsonb_array_elements(p_selection) x;
 if cardinality(ids)<>(select count(distinct id) from unnest(ids) id) or array_position(ids,null) is not null then raise exception 'DELETE_SELECTION_INVALID';end if;
 perform 1 from source_records where id=any(ids) order by id for update nowait;
 if (select count(*) from source_records where id=any(ids))<>p_confirmed_count then raise exception 'DELETE_SELECTION_CHANGED';end if;
 select coalesce(array_agg(id),'{}'),coalesce(array_agg(distinct run_id),'{}') into jobs,runs from pipeline_jobs where source_record_id=any(ids);
 perform 1 from pipeline_runs where id=any(runs) order by id for update nowait;
 perform 1 from pipeline_jobs where id=any(jobs) order by id for update nowait;
 if exists(select 1 from jsonb_array_elements(p_selection) x left join current_record_results c on c.id=(x->>'id')::uuid where c.destination is distinct from 'discarded' or c.job_id is distinct from (x->>'job_id')::uuid or c.result_token is distinct from x->>'result_token') then raise exception 'DELETE_SELECTION_CHANGED';end if;
 if exists(select 1 from pipeline_jobs where id=any(jobs) and status in ('selected','queued','preparing','ready','matching')) then raise exception 'DELETE_ACTIVE_JOB';end if;
 select coalesce(array_agg(id),'{}') into docs from source_documents where source_record_id=any(ids);
 select coalesce(array_agg(id),'{}') into provisions from service_provisions where source_record_id=any(ids);
 select coalesce(array_agg(id),'{}') into tasks from worker_tasks where source_record_id=any(ids) or run_id=any(runs);
 perform 1 from worker_tasks where id=any(tasks) order by id for update nowait;
 if exists(select 1 from worker_tasks where id=any(tasks) and (status in ('queued','running') or lease_until>now() or (executor='vercel_workflow' and execution_state<>'completed'))) then raise exception 'DELETE_ACTIVE_TASK';end if;
 select coalesce(array_agg(id),'{}') into exclusive_tasks from worker_tasks t where id=any(tasks) and (source_record_id=any(ids) or not exists(select 1 from pipeline_jobs j where j.run_id=t.run_id and not j.source_record_id=any(ids)));
 tokens:=array(select u::text from unnest(ids||jobs||docs) u);
 if exists(select 1 from cloud_checkpoints c where c.task_id=any(tasks) and (c.task_id=any(exclusive_tasks) or exists(select 1 from unnest(tokens) t where position(t in c.item_key)>0)) and c.value->>'state' in ('sending','unknown')) then raise exception 'DELETE_PROVIDER_UNRESOLVED';end if;
 if exists(select 1 from cloud_budget_reservations c where c.task_id=any(tasks) and c.actual_usd is null and (c.task_id=any(exclusive_tasks) or exists(select 1 from unnest(tokens) t where position(t in c.item_key)>0))) then raise exception 'DELETE_PROVIDER_UNRESOLVED';end if;
 -- Shared checkpoints with unknown mixed payloads cannot be safely pruned.
 if exists(select 1 from cloud_checkpoints c where c.task_id=any(tasks) and not c.task_id=any(exclusive_tasks) and not exists(select 1 from unnest(tokens) t where position(t in c.item_key)>0) and exists(select 1 from unnest(tokens) t where position(t in c.value::text)>0)) then raise exception 'DELETE_UNEXPECTED_SHARED_REFERENCE';end if;
 if exists(select 1 from matching_candidate_evidence e join evidence_chunks c on c.id=e.evidence_chunk_id join matching_candidates m on m.id=e.candidate_id where c.source_document_id=any(docs) and not m.pipeline_job_id=any(jobs)) then raise exception 'DELETE_SHARED_EVIDENCE';end if;
 if exists(select 1 from record_enrichment_evidence e join evidence_chunks c on c.id=e.evidence_chunk_id join record_enrichments r on r.id=e.enrichment_id where c.source_document_id=any(docs) and not r.source_record_id=any(ids)) then raise exception 'DELETE_SHARED_EVIDENCE';end if;
 insert into storage_purge_batches(record_count) values(p_confirmed_count) returning id into purge;
 if exists(select 1 from cloud_checkpoints c where c.task_id=any(tasks) and c.item_key like 'original:%' and substring(c.item_key from 10)=any(array(select d::text from unnest(docs)d)) and c.value->>'path' is not null and (split_part(c.value->>'path','/',2)<>substring(c.item_key from 10) or split_part(c.value->>'path','/',1)<>c.task_id::text)) then raise exception 'DELETE_UNEXPECTED_STORAGE_PATH';end if;
 insert into storage_purge_items(batch_id,bucket,path)
 select purge,'cloud-documents',name from storage.objects where bucket_id='cloud-documents' and split_part(name,'/',2)=any(array(select d::text from unnest(docs)d))
 union select purge,'cloud-documents',c.value->>'path' from cloud_checkpoints c where c.task_id=any(tasks) and c.item_key like 'original:%' and substring(c.item_key from 10)=any(array(select d::text from unnest(docs)d)) and c.value->>'path' is not null
 on conflict do nothing;
 -- Only the per-record/per-job keys are removed from shared tasks.
 delete from cloud_budget_reservations c where c.task_id=any(tasks) and (c.task_id=any(exclusive_tasks) or exists(select 1 from unnest(tokens)t where position(t in c.item_key)>0));
 delete from cloud_checkpoints c where c.task_id=any(tasks) and (c.task_id=any(exclusive_tasks) or exists(select 1 from unnest(tokens)t where position(t in c.item_key)>0)
  or (c.item_key like 'ocr:%' and exists(select 1 from source_documents d where d.id=any(docs) and split_part(c.item_key,':',2)=d.content_hash) and not exists(select 1 from source_documents d where not d.id=any(docs) and split_part(c.item_key,':',2)=d.content_hash)));
 delete from worker_tasks where id=any(exclusive_tasks);
 delete from entity_catalog_relations where source_type='provision' and source_reference=any(array(select p::text from unnest(provisions)p));
 delete from excel_export_items where provision_id=any(provisions);
 delete from service_provisions where id=any(provisions);
 delete from matching_evaluations where pipeline_job_id=any(jobs);
 delete from matching_candidate_evidence where candidate_id in(select id from matching_candidates where pipeline_job_id=any(jobs));
 delete from matching_candidates where pipeline_job_id=any(jobs);
 delete from review_decisions where source_record_id=any(ids);
 delete from analysis_results where source_record_id=any(ids);
 delete from job_document_versions where snapshot_id in(select id from job_snapshots where pipeline_job_id=any(jobs));
 delete from job_snapshots where pipeline_job_id=any(jobs);
 delete from job_attempts where pipeline_job_id=any(jobs);
 delete from document_versions where source_document_id=any(docs);
 delete from record_enrichment_evidence where enrichment_id in(select id from record_enrichments where source_record_id=any(ids));
 delete from record_enrichments where source_record_id=any(ids);
 delete from source_documents where id=any(docs);
 delete from source_records where id=any(ids);
 foreach run in array runs loop perform refresh_pipeline_run(run);end loop;
 if not exists(select 1 from storage_purge_items where batch_id=purge) then update storage_purge_batches set completed_at=now() where id=purge;end if;
 return purge;
end $$;
revoke all on function public.delete_discarded_records(jsonb,integer) from public,anon,authenticated;
grant execute on function public.delete_discarded_records(jsonb,integer) to service_role;
