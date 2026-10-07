-- The private bucket stores immutable source bytes and one copy per reviewed item.
-- Existing fetched documents remain readable; they are archived on the next use.
alter table public.source_documents
 add column storage_path text,
 add column storage_sha256 text,
 add column storage_captured_at timestamptz;
alter table public.record_units
 add column storage_path text,
 add column storage_sha256 text;
alter table public.import_runs add column storage_manifest jsonb not null default '{}'::jsonb;
alter table public.source_records add column import_run_id uuid references public.import_runs(id);
create index source_records_import_run_idx on public.source_records(import_run_id);

create function public.check_unit_storage_scope() returns trigger
language plpgsql security invoker set search_path=public,storage as $$
declare d public.source_documents;
begin
 if new.unit_key='legacy' then return new; end if;
 if new.storage_path is null and new.status='draft' then return new;end if;
 select * into d from public.source_documents where id=new.document_id and source_record_id=new.source_record_id;
 if not found then raise exception 'UNIT_DOCUMENT_SCOPE';end if;
 if d.storage_path is null or d.storage_sha256 is null
    or new.storage_sha256 is distinct from d.storage_sha256
    or new.storage_path is distinct from
      ('cases/'||new.source_record_id||'/items/'||new.id||'/documents/'||d.id||'/'||split_part(d.storage_path,'/',5))
    or not exists(select 1 from storage.objects where bucket_id='cloud-documents' and name=d.storage_path)
    or not exists(select 1 from storage.objects where bucket_id='cloud-documents' and name=new.storage_path)
 then raise exception 'UNIT_SOURCE_NOT_ARCHIVED';end if;
 return new;
end $$;
create constraint trigger check_unit_storage_scope
 after insert or update of storage_path,storage_sha256,document_id on public.record_units
 deferrable initially deferred for each row execute function public.check_unit_storage_scope();

-- Approval cannot publish an Excel line whose original source copy has disappeared.
create function public.check_provision_source_storage() returns trigger
language plpgsql security invoker set search_path=public,storage as $$
declare u public.record_units;
begin
 select * into strict u from public.record_units where id=new.unit_id;
 if u.unit_key<>'legacy' and (u.storage_path is null or
   not exists(select 1 from storage.objects where bucket_id='cloud-documents' and name=u.storage_path))
 then raise exception 'UNIT_SOURCE_NOT_ARCHIVED';end if;
 return new;
end $$;
create trigger check_provision_source_storage before insert or update of unit_id on public.service_provisions
 for each row execute function public.check_provision_source_storage();

-- Discard deletion must also purge the new case-scoped objects, including item copies.
do $$ declare definition text; changed text;begin
 definition:=pg_get_functiondef('public.delete_discarded_records(jsonb,integer)'::regprocedure);
 changed:=replace(definition,
 'on conflict do nothing;',
 E'UNION SELECT purge,\'cloud-documents\',name FROM storage.objects WHERE bucket_id=\'cloud-documents\' AND split_part(name,\'/\',1)=\'cases\' AND split_part(name,\'/\',2)=ANY(array(select id::text from unnest(ids) id))\n on conflict do nothing;');
 if changed=definition then raise exception 'Storage purge patch target missing';end if;
 execute changed;
end $$;
revoke all on function public.check_unit_storage_scope(),public.check_provision_source_storage() from public,anon,authenticated;
