alter table public.source_documents add column resolution jsonb,add column active_extraction_id uuid not null default gen_random_uuid();
alter table public.evidence_chunks add column extraction_id uuid;
update public.evidence_chunks c set extraction_id=d.active_extraction_id from public.source_documents d where d.id=c.source_document_id;
alter table public.evidence_chunks alter column extraction_id set not null;
alter table public.evidence_chunks drop constraint evidence_chunks_source_document_id_ordinal_key;
alter table public.evidence_chunks add unique(source_document_id,extraction_id,ordinal);
create view public.current_evidence_chunks with(security_invoker=true) as select c.* from public.evidence_chunks c join public.source_documents d on d.id=c.source_document_id and d.active_extraction_id=c.extraction_id;
grant select on public.current_evidence_chunks to service_role;
revoke update on public.evidence_chunks from service_role;
create function public.assign_chunk_extraction() returns trigger language plpgsql set search_path=public as $$begin
 if new.extraction_id is null then select active_extraction_id into new.extraction_id from source_documents where id=new.source_document_id;end if;return new;
end $$;
create trigger assign_chunk_extraction before insert on public.evidence_chunks for each row execute function public.assign_chunk_extraction();

create function public.replace_document_chunks(p_document uuid,p_chunks jsonb,p_metadata jsonb) returns void language plpgsql security invoker set search_path=public as $$
declare extraction uuid:=gen_random_uuid(); chunk jsonb;
begin
 perform 1 from source_documents where id=p_document for update;if not found then raise exception 'Document missing';end if;
 update source_documents set active_extraction_id=extraction,text_preview=p_metadata->>'text_preview',extracted_text_hash=p_metadata->>'extracted_text_hash',quality_score=(p_metadata->>'quality_score')::numeric,quality_flags=array(select jsonb_array_elements_text(p_metadata->'quality_flags')),chunk_count=jsonb_array_length(p_chunks),updated_at=now() where id=p_document;
 for chunk in select value from jsonb_array_elements(p_chunks) loop
  insert into evidence_chunks(source_document_id,extraction_id,ordinal,content,content_hash,character_count) values(p_document,extraction,(chunk->>'ordinal')::integer,chunk->>'content',chunk->>'content_hash',length(chunk->>'content'));
 end loop;
end $$;
revoke all on function public.replace_document_chunks(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.replace_document_chunks(uuid,jsonb,jsonb) to service_role;

create or replace function public.capture_job_snapshot(p_job uuid,p_kind text) returns uuid
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
  docbody:=jsonb_build_object('document',to_jsonb(doc),'chunks',coalesce((select jsonb_agg(to_jsonb(c) order by c.ordinal,c.id) from evidence_chunks c where source_document_id=doc.id and extraction_id=doc.active_extraction_id),'[]'));
  fingerprint:=encode(extensions.digest(docbody::text,'sha256'),'hex');
  insert into document_versions(source_document_id,content_hash,payload) values(doc.id,fingerprint,docbody) on conflict(source_document_id,content_hash) do nothing;
  select id into strict version from document_versions where source_document_id=doc.id and content_hash=fingerprint;
  insert into job_document_versions values(snapshot,version);
 end loop;
 return snapshot;
end $$;

create or replace function public.cloud_commit_v1(p_task uuid,p_owner uuid,p_generation bigint,p_job uuid,p_operation text,p_data jsonb) returns void
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
   insert into source_documents(source_record_id,url,url_hash,document_type,source_fields,status,resolution)
   values(j.source_record_id,d->>'url',d->>'url_hash',d->>'document_type',array(select jsonb_array_elements_text(d->'source_fields')),'discovered',d->'resolution')
   on conflict(source_record_id,url_hash) do update set resolution=coalesce(excluded.resolution,source_documents.resolution);
  end loop;
 elsif p_operation='document' then
  doc_id:=(p_data->>'id')::uuid;
  perform 1 from source_documents where id=doc_id and source_record_id=j.source_record_id for update;
  if not found then raise exception 'CLOUD_SCOPE';end if;
  update source_documents set active_extraction_id=gen_random_uuid(),status='fetched',extracted_text=p_data->>'text',text_length=length(p_data->>'text'),text_preview=left(p_data->>'text',600),
   extraction_method=p_data->>'method',content_hash=p_data->>'hash',extracted_text_hash=p_data->>'text_hash',mime_type=p_data->>'mime',
   fetched_at=now(),updated_at=now(),error_message=null,chunk_count=jsonb_array_length(p_data->'chunks') where id=doc_id;
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
