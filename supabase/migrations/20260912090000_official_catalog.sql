create table public.catalog_versions (
 id text primary key, source_url text not null, publication_url text not null,
 retrieved_at timestamptz not null, version_date date not null, content_hash text not null,
 legal_notice text not null, general_context text not null, provenance jsonb not null,
 entry_count integer not null check(entry_count > 0), validated boolean not null default false,
 active boolean not null default false, check(not active or validated)
);
create unique index one_active_catalog on public.catalog_versions(active) where active;
create table public.official_services (
 version_id text not null references public.catalog_versions(id), service_code text not null,
 service_name text not null, parent_code text, benefit_type text not null check(benefit_type in ('service','economic','technological')),
 description text not null, target_population text not null, conditions text not null,
 legal_reference text not null, normative_fields jsonb not null,
 primary key(version_id,service_code), foreign key(version_id,parent_code) references public.official_services(version_id,service_code) deferrable initially deferred
);
alter table public.catalog_versions enable row level security;
alter table public.official_services enable row level security;
grant select,insert,update on public.catalog_versions,public.official_services to service_role;
create view public.eligible_official_services with (security_invoker=true) as
 select s.* from public.official_services s join public.catalog_versions v on v.id=s.version_id
 where v.active and v.validated and s.benefit_type='service'
 and not exists(select 1 from public.official_services child where child.version_id=s.version_id and starts_with(child.service_code,s.service_code||'.'));
grant select on public.eligible_official_services to service_role;
create function public.install_official_catalog(p_version jsonb,p_services jsonb) returns void language plpgsql security invoker set search_path=public as $$
begin
 if not coalesce((p_version->>'validated')::boolean,false) or jsonb_array_length(p_services)<>(p_version->>'entry_count')::int then raise exception 'Catàleg no validat o incomplet'; end if;
 update catalog_versions set active=false where active;
 insert into catalog_versions select * from jsonb_populate_record(null::catalog_versions,p_version);
 insert into official_services select * from jsonb_populate_recordset(null::official_services,p_services);
end $$;
revoke all on function public.install_official_catalog(jsonb,jsonb) from public;
grant execute on function public.install_official_catalog(jsonb,jsonb) to service_role;
