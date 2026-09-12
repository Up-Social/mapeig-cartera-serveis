-- Preserve historical Master links while supporting official entity relations.
alter table public.entity_catalog_relations add column catalog_version_id text references public.catalog_versions(id),add column historical_master_code text references public.master_services(service_code);
update public.entity_catalog_relations set historical_master_code=service_code;
alter table public.entity_catalog_relations drop constraint entity_catalog_relations_service_code_fkey;
alter table public.entity_catalog_relations add foreign key(catalog_version_id,service_code) references public.official_services(version_id,service_code);
create function public.sync_official_provision_entity() returns trigger language plpgsql set search_path=public as $$
declare entity uuid;
begin
 if new.catalog_version_id is null then return new; end if;
 select id into entity from entities where nif=regexp_replace(upper(new.provider_nif),'[^A-Z0-9]','','g');
 delete from entity_catalog_relations where source_type='provision' and source_reference=new.id::text and relation_type='confirmed';
 if entity is not null then
  insert into entity_catalog_relations(entity_id,service_code,catalog_version_id,relation_type,source_type,source_reference,evidence) values(entity,new.service_code,new.catalog_version_id,'confirmed','provision',new.id::text,'Provisió revisada; NIF exacte');
 end if;
 return new;
end $$;
create trigger sync_official_entity after insert or update on service_provisions for each row execute function sync_official_provision_entity();
create function public.guard_source_assignment() returns trigger language plpgsql set search_path=public as $$
begin
 if new.cartera_code is not null and (tg_op='INSERT' or new.cartera_code is distinct from old.cartera_code) then
  if not exists(select 1 from eligible_official_services where service_code=new.cartera_code) then raise exception 'Cal un servei final elegible'; end if;
 end if;
 return new;
end $$;
create trigger source_leaf before insert or update of cartera_code on source_records for each row execute function guard_source_assignment();
