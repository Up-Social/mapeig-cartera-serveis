-- Write-ahead OCR journal. A started page is uncertain until the text and the
-- confirmed marker commit together. No OCR payload is stored in this table.
create table public.cloud_ocr_page_journal(
 task_id uuid not null references public.worker_tasks(id),
 document_id uuid not null references public.source_documents(id),
 source_sha256 text not null,source_path text not null,source_url text not null,
 snapshot_hash text not null,page integer not null,dpi integer not null,extraction_version text not null,
 state text not null check(state in ('started','confirmed')),text_hash text,
 started_at timestamptz not null default clock_timestamp(),confirmed_at timestamptz,
 primary key(task_id,document_id,source_sha256,snapshot_hash,page,dpi,extraction_version)
);
create index cloud_ocr_page_identity_idx on public.cloud_ocr_page_journal(document_id,source_sha256,snapshot_hash,page,dpi,extraction_version,state);
alter table public.cloud_ocr_page_journal enable row level security;
revoke all on public.cloud_ocr_page_journal from public,anon,authenticated;
grant select,insert,update on public.cloud_ocr_page_journal to service_role;

create function public.cloud_ocr_page_journal_step(
 p_task uuid,p_owner uuid,p_generation bigint,p_job uuid,p_document uuid,
 p_source_sha256 text,p_source_path text,p_source_url text,p_snapshot_hash text,
 p_page integer,p_dpi integer,p_extraction_version text,p_action text,p_value jsonb default null
) returns text language plpgsql security invoker set search_path=public as $$
declare t public.worker_tasks;j public.pipeline_jobs;d public.source_documents;entry public.cloud_ocr_page_journal;input jsonb;cached_page jsonb;page_key text;input_key text;
begin
 perform public.cloud_assert_lease(p_task,p_owner,p_generation);
 select * into strict t from public.worker_tasks where id=p_task;
 select * into strict j from public.pipeline_jobs where id=p_job;
 if (((t.run_id is not null and j.run_id=t.run_id) or t.source_record_id=j.source_record_id) is not true) then raise exception 'CLOUD_SCOPE';end if;
 select * into strict d from public.source_documents where id=p_document and source_record_id=j.source_record_id for update;
 if coalesce(p_source_sha256,'') !~ '^[0-9a-f]{64}$' or coalesce(p_snapshot_hash,'') !~ '^[0-9a-f]{64}$'
  or p_source_path is null or p_source_url is null or p_page is null
  or (p_action='document_status' and p_page<>0) or (p_action<>'document_status' and p_page not between 1 and 2000)
  or p_dpi is null or p_dpi not in (300,400) or coalesce(p_extraction_version,'') !~ '^[a-zA-Z0-9._-]{1,80}$'
  or p_action is null or p_action not in ('document_status','status','begin','confirm','verify')
  or d.storage_sha256 is distinct from p_source_sha256 or d.storage_path is distinct from p_source_path or d.url is distinct from p_source_url
 then raise exception 'OCR_JOURNAL_IDENTITY_INVALID';end if;
 input_key:='pdf-input:'||d.id::text||':'||p_extraction_version;
 select value into input from public.cloud_checkpoints where task_id=p_task and item_key=input_key;
 if input->>'sourceSha256' is distinct from p_source_sha256 or input->>'sourcePath' is distinct from p_source_path
  or input->>'sourceUrl' is distinct from p_source_url or input->>'snapshotHash' is distinct from p_snapshot_hash
 then raise exception 'OCR_JOURNAL_IDENTITY_INVALID';end if;
 if p_action='document_status' then
  if exists(select 1 from public.cloud_ocr_page_journal where document_id=d.id and source_sha256=p_source_sha256
   and state='started')
  then return 'uncertain';end if;
  -- A confirmed or pre-journal page from the same source cannot safely be
  -- repeated just because this task lacks its preflight checkpoint.
  if exists(select 1 from public.cloud_ocr_page_journal where document_id=d.id and source_sha256=p_source_sha256
   and snapshot_hash=p_snapshot_hash and dpi=p_dpi and extraction_version=p_extraction_version and state='confirmed')
   or exists(select 1 from public.cloud_checkpoints c join public.worker_tasks wt on wt.id=c.task_id
    where c.item_key like 'ocr-v2:'||d.id::text||':'||p_source_sha256||':%:dpi'||p_dpi::text||':'||p_extraction_version
     and (wt.source_record_id=j.source_record_id or wt.run_id in (select pj.run_id from public.pipeline_jobs pj where pj.source_record_id=j.source_record_id)))
  then return 'existing';end if;
  return 'new';
 end if;
 page_key:='ocr-v2:'||d.id::text||':'||p_source_sha256||':'||p_page::text||':dpi'||p_dpi::text||':'||p_extraction_version;
 if p_action='verify' then
  -- A copied page is usable only when an immutable input identity has a
  -- corresponding confirmed journal entry. Pre-journal pages are ambiguous.
  select value into cached_page from public.cloud_checkpoints where task_id=p_task and item_key=page_key;
  if not found or jsonb_typeof(cached_page) is distinct from 'object' or octet_length(cached_page::text)>16100000
   or jsonb_typeof(cached_page->'text') is distinct from 'string' or octet_length(cached_page->>'text')>8000000
   or cached_page->>'version' is distinct from 'ocr-page-v2' or cached_page->>'documentId' is distinct from d.id::text
   or cached_page->>'sourceSha256' is distinct from p_source_sha256 or cached_page->>'sourcePath' is distinct from p_source_path
   or cached_page->>'sourceUrl' is distinct from p_source_url or cached_page->'page' is distinct from to_jsonb(p_page)
   or cached_page->'dpi' is distinct from to_jsonb(p_dpi)
   or cached_page->>'textHash' is distinct from p_value->>'textHash'
   or cached_page->>'textHash' is distinct from encode(extensions.digest(cached_page->>'text','sha256'),'hex')
   or not exists(select 1 from public.cloud_ocr_page_journal confirmed where confirmed.document_id=d.id
     and confirmed.source_sha256=p_source_sha256 and confirmed.source_path=p_source_path and confirmed.source_url=p_source_url
     and confirmed.snapshot_hash=p_snapshot_hash and confirmed.page=p_page and confirmed.dpi=p_dpi
     and confirmed.extraction_version=p_extraction_version and confirmed.state='confirmed' and confirmed.text_hash=cached_page->>'textHash')
  then raise exception 'OCR_JOURNAL_UNVERIFIED';end if;
  if exists(select 1 from public.cloud_ocr_page_journal uncertain where uncertain.document_id=d.id and uncertain.source_sha256=p_source_sha256
   and uncertain.page=p_page and uncertain.state='started')
  then raise exception 'OCR_JOURNAL_UNCERTAIN';end if;
  return 'verified';
 end if;
 if p_action='confirm' then
  select * into entry from public.cloud_ocr_page_journal where task_id=p_task and document_id=d.id and source_sha256=p_source_sha256
   and snapshot_hash=p_snapshot_hash and page=p_page and dpi=p_dpi and extraction_version=p_extraction_version for update;
  if not found or entry.state<>'started' or entry.source_path is distinct from p_source_path or entry.source_url is distinct from p_source_url then raise exception 'OCR_JOURNAL_UNCERTAIN';end if;
  if jsonb_typeof(p_value) is distinct from 'object' or octet_length(p_value::text)>16100000 or octet_length(p_value->>'text')>8000000
   or p_value->>'version' is distinct from 'ocr-page-v2' or p_value->>'documentId' is distinct from d.id::text
   or p_value->>'sourceSha256' is distinct from p_source_sha256 or p_value->>'sourcePath' is distinct from p_source_path
   or p_value->>'sourceUrl' is distinct from p_source_url or p_value->'page' is distinct from to_jsonb(p_page)
   or p_value->'dpi' is distinct from to_jsonb(p_dpi) or jsonb_typeof(p_value->'text') is distinct from 'string'
   or p_value->>'textHash' is distinct from encode(extensions.digest(p_value->>'text','sha256'),'hex')
  then raise exception 'OCR_JOURNAL_INVALID_RESULT';end if;
  perform public.cloud_checkpoint(p_task,p_owner,p_generation,page_key,p_value);
  update public.cloud_ocr_page_journal set state='confirmed',text_hash=p_value->>'textHash',confirmed_at=clock_timestamp()
   where task_id=p_task and document_id=d.id and source_sha256=p_source_sha256 and snapshot_hash=p_snapshot_hash
    and page=p_page and dpi=p_dpi and extraction_version=p_extraction_version;
  return 'confirmed';
 end if;
 if exists(select 1 from public.cloud_ocr_page_journal where document_id=d.id and source_sha256=p_source_sha256
  and page=p_page and state='started')
 then return 'uncertain';end if;
 -- If the page exists here or in another task, it must be reused/verified, not repeated.
 if exists(select 1 from public.cloud_checkpoints c join public.worker_tasks wt on wt.id=c.task_id
  where c.item_key=page_key and (wt.source_record_id=j.source_record_id or wt.run_id in
   (select pj.run_id from public.pipeline_jobs pj where pj.source_record_id=j.source_record_id)))
  or exists(select 1 from public.cloud_ocr_page_journal where document_id=d.id and source_sha256=p_source_sha256
   and snapshot_hash=p_snapshot_hash and page=p_page and dpi=p_dpi and extraction_version=p_extraction_version and state='confirmed')
 then return 'existing';end if;
 if p_action='status' then return 'new';end if;
 insert into public.cloud_ocr_page_journal(task_id,document_id,source_sha256,source_path,source_url,snapshot_hash,page,dpi,extraction_version,state)
 values(p_task,d.id,p_source_sha256,p_source_path,p_source_url,p_snapshot_hash,p_page,p_dpi,p_extraction_version,'started');
 return 'started';
end $$;
revoke all on function public.cloud_ocr_page_journal_step(uuid,uuid,bigint,uuid,uuid,text,text,text,text,integer,integer,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.cloud_ocr_page_journal_step(uuid,uuid,bigint,uuid,uuid,text,text,text,text,integer,integer,text,text,jsonb) to service_role;
