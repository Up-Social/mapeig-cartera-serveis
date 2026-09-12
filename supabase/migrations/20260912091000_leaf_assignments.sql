alter table public.matching_candidates add column catalog_version_id text references public.catalog_versions(id);
alter table public.service_provisions add column catalog_version_id text references public.catalog_versions(id), add column historical_master_code text references public.master_services(service_code);
update public.service_provisions set historical_master_code=service_code;
alter table public.service_provisions drop constraint service_provisions_service_code_fkey;
alter table public.service_provisions add foreign key(catalog_version_id,service_code) references public.official_services(version_id,service_code);
create function public.guard_leaf_assignment() returns trigger language plpgsql set search_path=public as $$
declare code text; version text;
begin
 if tg_table_name='matching_candidates' then code:=new.target_code; else code:=new.service_code; end if;
 version:=new.catalog_version_id;
 if not exists(select 1 from eligible_official_services where service_code=code and version_id=version) then raise exception 'Cal un servei oficial validat sense fills: %',code; end if;
 if tg_table_name='matching_candidates' and new.target_catalog<>'official' then raise exception 'Cal el catàleg oficial'; end if;
 return new;
end $$;
create trigger candidate_leaf before insert or update of target_code,catalog_version_id on public.matching_candidates for each row execute function public.guard_leaf_assignment();
create trigger provision_leaf before insert or update of service_code,catalog_version_id on public.service_provisions for each row execute function public.guard_leaf_assignment();
