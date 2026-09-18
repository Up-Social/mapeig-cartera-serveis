create table public.job_attempts (
 id uuid primary key default gen_random_uuid(),
 pipeline_job_id uuid not null references public.pipeline_jobs(id),
 ordinal integer not null check(ordinal>0), operation text not null,
 started_at timestamptz not null default now(), completed_at timestamptz,
 status text not null default 'running', diagnostic text,
 unique(pipeline_job_id,ordinal)
);
create table public.document_versions (
 id uuid primary key default gen_random_uuid(),
 source_document_id uuid not null references public.source_documents(id),
 content_hash text not null, payload jsonb not null,
 captured_at timestamptz not null default now(),
 unique(source_document_id,content_hash)
);
create table public.job_snapshots (
 id uuid primary key default gen_random_uuid(),
 pipeline_job_id uuid not null references public.pipeline_jobs(id),
 attempt_id uuid references public.job_attempts(id),
 kind text not null, schema_version integer not null default 1,
 payload jsonb not null, content_hash text not null,
 captured_at timestamptz not null default now()
);
create table public.job_document_versions (
 snapshot_id uuid not null references public.job_snapshots(id) on delete cascade,
 document_version_id uuid not null references public.document_versions(id),
 primary key(snapshot_id,document_version_id)
);
create index job_snapshots_job_idx on public.job_snapshots(pipeline_job_id,captured_at desc,id desc);
alter table public.job_attempts enable row level security;
alter table public.document_versions enable row level security;
alter table public.job_snapshots enable row level security;
alter table public.job_document_versions enable row level security;
revoke all on public.job_attempts,public.document_versions,public.job_snapshots,public.job_document_versions from public,anon,authenticated;
grant select,insert on public.job_attempts,public.document_versions,public.job_snapshots,public.job_document_versions to service_role;
grant update on public.job_attempts to service_role;

create function public.capture_job_snapshot(p_job uuid,p_kind text) returns uuid
language plpgsql security invoker set search_path=public as $$
declare j pipeline_jobs; attempt uuid; snapshot uuid; doc record; version uuid; body jsonb; docbody jsonb; fingerprint text;
begin
 select * into strict j from pipeline_jobs where id=p_job for update;
 select id into attempt from job_attempts where pipeline_job_id=p_job order by ordinal desc limit 1;
 if attempt is null then
  insert into job_attempts(pipeline_job_id,ordinal,operation) values(p_job,1,'initial') returning id into attempt;
 end if;
 body:=jsonb_build_object(
  'job',to_jsonb(j),
  'source',(select to_jsonb(r) from source_records r where id=j.source_record_id),
  'enrichment',(select to_jsonb(e) from record_enrichments e where source_record_id=j.source_record_id),
  'enrichment_evidence',coalesce((select jsonb_agg(to_jsonb(ec) order by ec.ordinal,ec.id) from record_enrichment_evidence ee join record_enrichments e on e.id=ee.enrichment_id join evidence_chunks ec on ec.id=ee.evidence_chunk_id where e.source_record_id=j.source_record_id),'[]'),
  'analysis',(select to_jsonb(a) from analysis_results a where pipeline_job_id=p_job),
  'candidates',coalesce((select jsonb_agg(to_jsonb(c) order by c.rank) from matching_candidates c where pipeline_job_id=p_job),'[]'),
  'run_parameters',(select parameters from pipeline_runs where id=j.run_id),
  'provider_checkpoints',coalesce((select jsonb_agg(to_jsonb(c)) from cloud_checkpoints c join worker_tasks t on t.id=c.task_id where (t.run_id=j.run_id or t.source_record_id=j.source_record_id) and (t.source_record_id=j.source_record_id or c.item_key like '%'||p_job::text||'%')),'[]'),
  'provenance',jsonb_build_object('mode','live_capture','kind',p_kind,'missing_provider_usage','not available when not recorded by provider')
 );
 insert into job_snapshots(pipeline_job_id,attempt_id,kind,payload,content_hash)
 values(p_job,attempt,p_kind,body,encode(extensions.digest(body::text,'sha256'),'hex')) returning id into snapshot;
 for doc in select * from source_documents where source_record_id=j.source_record_id order by id loop
  docbody:=jsonb_build_object('document',to_jsonb(doc),'chunks',coalesce((select jsonb_agg(to_jsonb(c) order by c.ordinal,c.id) from evidence_chunks c where source_document_id=doc.id),'[]'));
  fingerprint:=encode(extensions.digest(docbody::text,'sha256'),'hex');
  insert into document_versions(source_document_id,content_hash,payload) values(doc.id,fingerprint,docbody) on conflict(source_document_id,content_hash) do nothing;
  select id into strict version from document_versions where source_document_id=doc.id and content_hash=fingerprint;
  insert into job_document_versions values(snapshot,version);
 end loop;
 return snapshot;
end $$;
revoke all on function public.capture_job_snapshot(uuid,text) from public;
grant execute on function public.capture_job_snapshot(uuid,text) to service_role;

create function public.snapshot_job_transition() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 perform capture_job_snapshot(new.id,case when tg_op='INSERT' then 'job_created' else 'job_transition' end);
 if new.status in ('needs_review','approved','corrected','rejected','insufficient_evidence','error') then
  update job_attempts set completed_at=now(),status=new.status,diagnostic=new.error_message where pipeline_job_id=new.id and ordinal=(select max(ordinal) from job_attempts where pipeline_job_id=new.id);
 end if;
 return new;
end $$;
create trigger job_snapshot_transition after insert or update of status,error_message on public.pipeline_jobs for each row execute function public.snapshot_job_transition();

-- Preserve the old projection before a worker replaces enrichment or a document.
create function public.snapshot_before_projection_change() returns trigger language plpgsql security invoker set search_path=public as $$
declare job uuid;
begin
 select id into job from pipeline_jobs where source_record_id=old.source_record_id order by created_at desc,id desc limit 1;
 if job is not null then perform capture_job_snapshot(job,'before_'||tg_table_name||'_change');end if;
 return new;
end $$;
create trigger preserve_enrichment_projection before update on public.record_enrichments for each row execute function public.snapshot_before_projection_change();
create trigger preserve_document_projection before update on public.source_documents for each row execute function public.snapshot_before_projection_change();

-- Only immutable, job-owned data can be reconstructed for old jobs.
insert into job_snapshots(pipeline_job_id,kind,payload,content_hash)
select j.id,'historical_partial',b.body,encode(extensions.digest(b.body::text,'sha256'),'hex')
from pipeline_jobs j cross join lateral (select jsonb_build_object('job',to_jsonb(j),'analysis',(select to_jsonb(a) from analysis_results a where pipeline_job_id=j.id),'candidates',coalesce((select jsonb_agg(to_jsonb(c)) from matching_candidates c where pipeline_job_id=j.id),'[]'),'provenance',jsonb_build_object('mode','historical_partial','unrecoverable',jsonb_build_array('original_source_at_execution','enrichment_at_execution','documents_at_execution','provider_usage_if_not_recorded'))) as body) b;
