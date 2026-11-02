-- Local enrichment writes shared record state. A superseded job may neither
-- persist a result nor mark the current record as failed.
create table public.local_enrichment_commits (
 job_id uuid primary key references public.pipeline_jobs(id) on delete cascade,
 request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
 result_hash text not null check(result_hash ~ '^[0-9a-f]{64}$'),
 action text not null check(action in ('error','complete','complete_no_evidence')),
 committed_at timestamptz not null default clock_timestamp()
);
alter table public.local_enrichment_commits enable row level security;
revoke all on public.local_enrichment_commits from public,anon,authenticated,service_role;
grant select on public.local_enrichment_commits to service_role;
create table public.local_enrichment_attempts (
 job_id uuid primary key references public.pipeline_jobs(id) on delete cascade,
 snapshot_hash text not null check(snapshot_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.local_enrichment_attempts enable row level security;
revoke all on public.local_enrichment_attempts from public,anon,authenticated,service_role;
grant select on public.local_enrichment_attempts to service_role;

-- Shared validation retains all locks in the caller's transaction.
create function public.local_enrichment_snapshot_current(p_job uuid,p_record uuid,p_snapshot jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
declare latest uuid; target_run uuid; current_source jsonb; current_documents jsonb; current_chunks jsonb;
begin
 if p_job is null or p_record is null then return false;end if;
 perform 1 from source_records where id=p_record for update nowait;
 if not found then return false;end if;
 perform 1 from pipeline_jobs where source_record_id=p_record for update nowait;
 select id into latest from pipeline_jobs where source_record_id=p_record order by created_at desc,id desc limit 1;
 if latest is distinct from p_job then return false;end if;
 select run_id into target_run from pipeline_jobs where id=p_job and source_record_id=p_record;
 perform 1 from pipeline_runs where id=target_run and status<>'paused' for share nowait;
 if not found then return false;end if;
 -- Preserve the exact source and complete document set used to prepare input.
 -- Source lock prevents new FK documents/jobs; NOWAIT avoids lock-order cycles.
 perform 1 from source_documents where source_record_id=p_record order by id for update nowait;
 perform e.id from evidence_chunks e join source_documents d on d.id=e.source_document_id
  where d.source_record_id=p_record and d.status='fetched' and e.extraction_id=d.active_extraction_id order by d.id,e.ordinal,e.id for share of e nowait;
 select jsonb_build_object('id',r.id,'financing_type',r.financing_type,'source_dataset',r.source_dataset,'source_record_id',r.source_record_id,
  'mechanism',r.mechanism,'title',r.title,'provider_name',r.provider_name,'amount',r.amount,'source_payload',r.source_payload)
 into current_source from source_records r where r.id=p_record;
 if coalesce(current_source->>'financing_type','') not in ('conveni','contractacio','subvencio') then return false;end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'url',d.url,'status',d.status,'mime_type',d.mime_type,'text_length',d.text_length,
  'extraction_method',d.extraction_method,'extraction_coverage',d.extraction_coverage,'quality_flags',d.quality_flags,'extraction_partial',d.extraction_partial,
  'active_extraction_id',d.active_extraction_id,'storage_path',d.storage_path,'storage_sha256',d.storage_sha256,'extracted_text_hash',d.extracted_text_hash) order by d.id),'[]'::jsonb)
 into current_documents from source_documents d where d.source_record_id=p_record;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'source_document_id',e.source_document_id,'ordinal',e.ordinal,
  'content_sha256',encode(extensions.digest(e.content,'sha256'),'hex')) order by d.id,e.ordinal,e.id),'[]'::jsonb)
 into current_chunks from evidence_chunks e join source_documents d on d.id=e.source_document_id
 where d.source_record_id=p_record and d.status='fetched' and e.extraction_id=d.active_extraction_id;
 if jsonb_typeof(p_snapshot) is distinct from 'object' or p_snapshot->'source' is distinct from current_source
  or p_snapshot->'documents' is distinct from current_documents or p_snapshot->'chunks' is distinct from current_chunks
  or jsonb_array_length(current_documents)=0 then return false;end if;
 return true;
exception when lock_not_available then return false;
end $$;
revoke all on function public.local_enrichment_snapshot_current(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function public.local_enrichment_outcome_hash(p_record uuid) returns text
language sql stable security definer set search_path=public as $$
 select encode(extensions.digest(jsonb_build_object(
  'status',r.enrichment_status,'error',r.enrichment_error,'processing_status',r.processing_status,
  'enrichment',(select to_jsonb(e) from record_enrichments e where e.source_record_id=r.id),
  'evidence',(select coalesce(jsonb_agg(ev.evidence_chunk_id order by ev.evidence_chunk_id),'[]'::jsonb)
   from record_enrichment_evidence ev join record_enrichments e on e.id=ev.enrichment_id where e.source_record_id=r.id)
 )::text,'sha256'),'hex') from source_records r where r.id=p_record
$$;
revoke all on function public.local_enrichment_outcome_hash(uuid) from public,anon,authenticated,service_role;

-- A receipt or result without this durable pre-call intent has ambiguous
-- provenance. It requires review rather than an automatic provider call.
create function public.local_begin_enrichment(p_job uuid,p_record uuid,p_snapshot jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
declare expected text; found_hash text;
begin
 if not public.local_enrichment_snapshot_current(p_job,p_record,p_snapshot) then return false;end if;
 if exists(select 1 from local_enrichment_commits where job_id=p_job) then return false;end if;
 if exists(select 1 from record_enrichments where source_record_id=p_record) then return false;end if;
 if exists(select 1 from provider_calls where pipeline_job_id=p_job and state='sending') then return false;end if;
 expected:=encode(extensions.digest(p_snapshot::text,'sha256'),'hex');
 select snapshot_hash into found_hash from local_enrichment_attempts where job_id=p_job for update nowait;
 if found then return found_hash=expected;end if;
 if exists(select 1 from provider_calls where pipeline_job_id=p_job) then return false;end if;
 insert into local_enrichment_attempts(job_id,snapshot_hash) values(p_job,expected);
 return true;
exception when lock_not_available then return false;
end $$;
revoke all on function public.local_begin_enrichment(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.local_begin_enrichment(uuid,uuid,jsonb) to service_role;

create function public.local_commit_enrichment(
 p_job uuid,p_record uuid,p_action text,p_data jsonb default null,p_evidence uuid[] default null,p_error text default null,p_snapshot jsonb default null,
 p_wire_hash text default null,p_provider_response jsonb default null
) returns boolean language plpgsql security definer set search_path=public as $$
declare eid uuid; chunk uuid; request_hash_ text; saved_hash text; saved_result_hash text; receipt_response jsonb;
begin
 if p_job is null or p_record is null or p_action not in ('error','complete','complete_no_evidence') or p_action is null then
  raise exception 'LOCAL_ENRICHMENT_INVALID';
 end if;
 if not public.local_enrichment_snapshot_current(p_job,p_record,p_snapshot) then return false;end if;
 if not exists(select 1 from local_enrichment_attempts where job_id=p_job and snapshot_hash=encode(extensions.digest(p_snapshot::text,'sha256'),'hex')) then return false;end if;
 perform 1 from provider_calls where pipeline_job_id=p_job for update nowait;
 if exists(select 1 from provider_calls where pipeline_job_id=p_job and state='sending') then return false;end if;
 if p_action='complete' then
  if coalesce(p_wire_hash,'') !~ '^prepared-json-v1:[0-9a-f]{64}$' or jsonb_typeof(p_provider_response) is distinct from 'object' then return false;end if;
  select response into receipt_response from provider_calls where pipeline_job_id=p_job and phase='enrichment' and request_hash=p_wire_hash and state='received';
  if not found or receipt_response is distinct from p_provider_response then return false;end if;
 elsif p_wire_hash is not null or p_provider_response is not null then return false;
 end if;
 select id into eid from record_enrichments where source_record_id=p_record for update nowait;
 if eid is not null then perform 1 from record_enrichment_evidence where enrichment_id=eid for update nowait;end if;
 request_hash_:=encode(extensions.digest(jsonb_build_object('job',p_job,'record',p_record,'action',p_action,
  'data',p_data,'evidence',p_evidence,'error',p_error,'snapshot',p_snapshot,'wire_hash',p_wire_hash,
  'receipt_response_sha256',case when receipt_response is null then null else encode(extensions.digest(receipt_response::text,'sha256'),'hex') end)::text,'sha256'),'hex');
 select request_hash,result_hash into saved_hash,saved_result_hash from local_enrichment_commits where job_id=p_job for update nowait;
 if found then return saved_hash=request_hash_ and saved_result_hash=public.local_enrichment_outcome_hash(p_record);end if;
 -- An unattributed result appearing after the intent belongs to no verified
 -- attempt; never replace it merely because this job is currently latest.
 if eid is not null then return false;end if;
 if p_action='error' then
  update source_records set enrichment_status='error',enrichment_error=left(coalesce(p_error,'Error de contrast'),1000),processing_status='error',updated_at=now() where id=p_record;
  insert into local_enrichment_commits(job_id,request_hash,result_hash,action) values(p_job,request_hash_,public.local_enrichment_outcome_hash(p_record),p_action);
  return true;
 end if;
 if jsonb_typeof(p_data) is distinct from 'object' or coalesce(p_data->>'engine','') not in ('deterministic-evidence-policy','openai-responses-enrichment') then raise exception 'LOCAL_ENRICHMENT_INVALID';end if;
 if (p_action='complete_no_evidence' and p_data->>'engine'<>'deterministic-evidence-policy') or (p_action='complete' and p_data->>'engine'<>'openai-responses-enrichment') then raise exception 'LOCAL_ENRICHMENT_INVALID';end if;
 if p_action='complete' and cardinality(coalesce(p_evidence,'{}'::uuid[]))=0 then raise exception 'LOCAL_ENRICHMENT_EVIDENCE_REQUIRED';end if;
 if p_action='complete_no_evidence' and cardinality(coalesce(p_evidence,'{}'::uuid[]))>0 then raise exception 'LOCAL_ENRICHMENT_INVALID';end if;
 foreach chunk in array coalesce(p_evidence,'{}'::uuid[]) loop
  if not exists(select 1 from evidence_chunks e join source_documents d on d.id=e.source_document_id where e.id=chunk and d.source_record_id=p_record and d.status='fetched' and e.extraction_id=d.active_extraction_id) then raise exception 'LOCAL_ENRICHMENT_EVIDENCE_SCOPE';end if;
 end loop;
 insert into record_enrichments(source_record_id,extracted_title,provider_name,provider_nif,mechanism,award_date,amount,contracting_body,target_population,scope_facts,summary,confidence,engine,engine_version,updated_at)
 values(p_record,p_data->>'extracted_title',p_data->>'provider_name',p_data->>'provider_nif',p_data->>'mechanism',nullif(p_data->>'award_date','')::date,
  (p_data->>'amount')::numeric,p_data->>'contracting_body',p_data->>'target_population',nullif(p_data->'scope_facts','null'::jsonb),p_data->>'summary',
  (p_data->>'confidence')::numeric,p_data->>'engine',p_data->>'engine_version',now())
 on conflict(source_record_id) do update set extracted_title=excluded.extracted_title,provider_name=excluded.provider_name,provider_nif=excluded.provider_nif,
  mechanism=excluded.mechanism,award_date=excluded.award_date,amount=excluded.amount,contracting_body=excluded.contracting_body,
  target_population=excluded.target_population,scope_facts=excluded.scope_facts,summary=excluded.summary,confidence=excluded.confidence,
  engine=excluded.engine,engine_version=excluded.engine_version,updated_at=excluded.updated_at returning id into eid;
 delete from record_enrichment_evidence where enrichment_id=eid;
 insert into record_enrichment_evidence(enrichment_id,evidence_chunk_id) select eid,c from unnest(coalesce(p_evidence,'{}'::uuid[])) c group by c;
 if p_action='complete_no_evidence' then
  update source_records set enrichment_status='completed',enrichment_error=null where id=p_record;
 else
  update source_records set enrichment_status='completed',enrichment_error=null,processing_status='preparat',updated_at=now() where id=p_record;
 end if;
 insert into local_enrichment_commits(job_id,request_hash,result_hash,action) values(p_job,request_hash_,public.local_enrichment_outcome_hash(p_record),p_action);
 return true;
exception when lock_not_available then
 return false;
end $$;
revoke all on function public.local_commit_enrichment(uuid,uuid,text,jsonb,uuid[],text,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.local_commit_enrichment(uuid,uuid,text,jsonb,uuid[],text,jsonb,text,jsonb) to service_role;
