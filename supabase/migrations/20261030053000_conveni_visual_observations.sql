-- Preparation only: no economic approval or provenance claim. The feature is
-- disabled in application code unless explicitly configured. Service-role
-- writes must follow a server-side versioned physical read; SQL cannot prove it.
create table public.conveni_visual_reads (
 event_id uuid primary key, record_id uuid not null references public.source_records(id) on delete cascade,
 document_id uuid not null references public.source_documents(id) on delete cascade,
 snapshot jsonb not null, created_at timestamptz not null default now()
);
create table public.conveni_visual_observations (
 event_id uuid primary key, read_id uuid not null references public.conveni_visual_reads(event_id) on delete cascade,
 document_id uuid not null references public.source_documents(id) on delete cascade,
 page integer not null check(page between 1 and 10000),
 role text not null check(role in ('identity','economic','role_period','social')),
 quote text not null, declared_reviewer text not null, rationale text not null,
 created_at timestamptz not null default now()
);
alter table public.conveni_visual_reads enable row level security;
alter table public.conveni_visual_observations enable row level security;
revoke all on public.conveni_visual_reads,public.conveni_visual_observations from public,anon,authenticated,service_role;
create function public.guard_conveni_visual_immutable() returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin raise exception 'VISUAL_HISTORY_IMMUTABLE';end $$;
revoke all on function public.guard_conveni_visual_immutable() from public,anon,authenticated,service_role;
create trigger conveni_visual_reads_immutable before update on public.conveni_visual_reads for each row execute function public.guard_conveni_visual_immutable();
create trigger conveni_visual_observations_immutable before update on public.conveni_visual_observations for each row execute function public.guard_conveni_visual_immutable();

create function public.conveni_visual_source(p_record uuid,p_document uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,storage set lock_timeout='1000ms' as $$
declare d public.source_documents;o storage.objects;
begin
 perform 1 from public.source_records where id=p_record and financing_type='conveni' for share nowait;
 if not found then raise exception 'VISUAL_SCOPE';end if;
 select * into d from public.source_documents where id=p_document and source_record_id=p_record and document_type in ('agreement','annex') for share nowait;
 if not found or d.status is distinct from 'fetched' or d.mime_type is distinct from 'application/pdf' or d.storage_sha256 is null
  or d.storage_sha256 !~ '^[a-f0-9]{64}$' or d.storage_path is null
  or d.storage_path !~ ('^cases/'||p_record||'/documents/'||p_document||'/'||d.storage_sha256||'[.]pdf$') then raise exception 'VISUAL_SOURCE_UNAVAILABLE';end if;
 select * into o from storage.objects where bucket_id='cloud-documents' and name=d.storage_path and archived_at is null for share nowait;
 if not found or o.version is null or o.version !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' then raise exception 'VISUAL_SOURCE_VERSION_REQUIRED';end if;
 return jsonb_build_object('documentId',d.id,'recordId',p_record,'source',jsonb_build_object('path',o.name,'sha256',d.storage_sha256,'object_id',o.id,'version',o.version),
  'document_state',jsonb_build_object('id',d.id,'source_record_id',d.source_record_id,'status',d.status,'document_type',d.document_type,'mime_type',d.mime_type,'url',d.url,'storage_path',d.storage_path,'storage_sha256',d.storage_sha256));
end $$;
create function public.conveni_visual_save_read(p_event uuid,p_record uuid,p_document uuid,p_snapshot jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public set lock_timeout='1000ms' as $$
declare s jsonb;existing public.conveni_visual_reads;
begin
 if p_event is null then raise exception 'VISUAL_EVENT_REQUIRED';end if;
 s:=public.conveni_visual_source(p_record,p_document);
 if s is distinct from p_snapshot then raise exception 'VISUAL_SOURCE_STALE' using errcode='PT409';end if;
 select * into existing from public.conveni_visual_reads where event_id=p_event for update nowait;
 if found then
  if existing.record_id is distinct from p_record or existing.document_id is distinct from p_document or existing.snapshot is distinct from s then raise exception 'VISUAL_EVENT_REUSED';end if;
  return to_jsonb(existing);
 end if;
 insert into public.conveni_visual_reads(event_id,record_id,document_id,snapshot) values(p_event,p_record,p_document,s) returning * into existing;
 return to_jsonb(existing);
end $$;
create function public.conveni_visual_assert(p_event uuid,p_read uuid,p_record uuid,p_document uuid,p_page integer,p_role text,p_quote text,p_declared_reviewer text,p_rationale text,p_confirmed boolean) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public set lock_timeout='1000ms' as $$
declare r public.conveni_visual_reads;existing public.conveni_visual_observations;s jsonb;
begin
 if p_event is null or p_confirmed is distinct from true or p_page is null or p_page not between 1 and 10000
  or coalesce(p_role,'') not in ('identity','economic','role_period','social')
  or length(trim(coalesce(p_quote,''))) not between 12 and 4000 or length(trim(coalesce(p_declared_reviewer,''))) not between 3 and 120
  or length(trim(coalesce(p_rationale,''))) not between 10 and 2000 then raise exception 'VISUAL_CONFIRMATION_REQUIRED';end if;
 select * into r from public.conveni_visual_reads where event_id=p_read and record_id=p_record and document_id=p_document for share nowait;
 if not found then raise exception 'VISUAL_READ_NOT_FOUND';end if;
 s:=public.conveni_visual_source(p_record,p_document);
 if s is distinct from r.snapshot then raise exception 'VISUAL_SOURCE_STALE' using errcode='PT409';end if;
 select * into existing from public.conveni_visual_observations where event_id=p_event for update nowait;
 if found then
  if existing.read_id is distinct from p_read or existing.document_id is distinct from p_document or existing.page is distinct from p_page
   or existing.role is distinct from p_role or existing.quote is distinct from p_quote or existing.declared_reviewer is distinct from p_declared_reviewer or existing.rationale is distinct from p_rationale then raise exception 'VISUAL_EVENT_REUSED';end if;
  return to_jsonb(existing);
 end if;
 insert into public.conveni_visual_observations(event_id,read_id,document_id,page,role,quote,declared_reviewer,rationale)
 values(p_event,p_read,p_document,p_page,p_role,p_quote,p_declared_reviewer,p_rationale) returning * into existing;
 return to_jsonb(existing);
end $$;
revoke all on function public.conveni_visual_source(uuid,uuid),public.conveni_visual_save_read(uuid,uuid,uuid,jsonb),public.conveni_visual_assert(uuid,uuid,uuid,uuid,integer,text,text,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.conveni_visual_source(uuid,uuid),public.conveni_visual_save_read(uuid,uuid,uuid,jsonb),public.conveni_visual_assert(uuid,uuid,uuid,uuid,integer,text,text,text,text,boolean) to service_role;

-- Historical observations remain declarations; the saved object version may
-- no longer exist and is not proof that the declaration remains applicable.
create function public.conveni_visual_history(p_record uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
 if not exists(select 1 from public.source_records where id=p_record and financing_type='conveni') then raise exception 'VISUAL_SCOPE';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.event_id desc),'[]'::jsonb) into result from (
  select o.event_id,o.document_id,o.page,o.role,o.quote,o.declared_reviewer,o.rationale,o.created_at,
   r.snapshot->'source'->>'sha256' as source_sha256,r.snapshot->'source'->>'version' as source_version
  from public.conveni_visual_observations o join public.conveni_visual_reads r on r.event_id=o.read_id
  where r.record_id=p_record order by o.created_at desc,o.event_id desc limit 100
 ) x;
 return result;
end $$;
revoke all on function public.conveni_visual_history(uuid) from public,anon,authenticated,service_role;
grant execute on function public.conveni_visual_history(uuid) to service_role;
