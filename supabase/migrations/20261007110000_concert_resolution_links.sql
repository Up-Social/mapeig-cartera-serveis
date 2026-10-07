-- A publication, a financial line and its legal predecessor have separate identities.
-- Historical units remain untouched. Inferred links start as candidates.
alter table public.record_units
 add column if not exists reses_code text,
 add column if not exists observed_service_code text,
 add column if not exists territory text,
 add column if not exists effective_start date,
 add column if not exists effective_end date,
 add column if not exists quantity integer check (quantity > 0),
 add column if not exists disposition_number text,
 add column if not exists extraction_origin text;

create table public.concert_record_links (
 id uuid primary key default gen_random_uuid(),
 later_record_id uuid not null references public.source_records(id) on delete cascade,
 earlier_record_id uuid not null references public.source_records(id) on delete cascade,
 link_kind text not null check(link_kind in ('amendment','renewal','modification','termination','cession','appeal','validation','other')),
 matching_method text not null check(matching_method in ('explicit_resolution','reses_nif','expedient_territory')),
 status text not null default 'candidate' check(status in ('candidate','confirmed','rejected','out_of_horizon')),
 evidence text not null,
 review_note text,
 reviewed_at timestamptz,
 created_at timestamptz not null default now(),
 check(later_record_id<>earlier_record_id),
 unique(later_record_id,earlier_record_id)
);
create index concert_record_links_earlier_idx on public.concert_record_links(earlier_record_id);
alter table public.concert_record_links enable row level security;
grant select,insert,update,delete on public.concert_record_links to service_role;

create table public.concert_unit_links (
 id uuid primary key default gen_random_uuid(),
 later_unit_id uuid not null references public.record_units(id) on delete cascade,
 earlier_unit_id uuid not null references public.record_units(id) on delete cascade,
 root_unit_id uuid not null references public.record_units(id) on delete cascade,
 relation_kind text not null check(relation_kind in ('amendment','renewal','delta','replacement','termination','cession','appeal','validation')),
 matching_method text not null check(matching_method in ('explicit_resolution','reses_nif')),
 status text not null default 'candidate' check(status in ('candidate','confirmed','rejected','out_of_horizon')),
 evidence text not null,
 review_note text,
 reviewed_at timestamptz,
 created_at timestamptz not null default now(),
 check(later_unit_id<>earlier_unit_id),
 unique(later_unit_id,earlier_unit_id)
);
create index concert_unit_links_root_idx on public.concert_unit_links(root_unit_id);
alter table public.concert_unit_links enable row level security;
grant select,insert,update,delete on public.concert_unit_links to service_role;

create function public.validate_concert_unit_link() returns trigger language plpgsql security invoker set search_path=public as $$
declare later_row record_units; earlier_row record_units; root_row record_units;
begin
 select * into strict later_row from record_units where id=new.later_unit_id;
 select * into strict earlier_row from record_units where id=new.earlier_unit_id;
 select * into strict root_row from record_units where id=new.root_unit_id;
 if later_row.source_record_id=earlier_row.source_record_id then raise exception 'La relació ha de creuar resolucions diferents'; end if;
 if later_row.unit_key='legacy' or earlier_row.unit_key='legacy' or root_row.unit_key='legacy' then raise exception 'Una línia històrica global no pot ser origen acreditat'; end if;
 if new.status='confirmed' then
  if later_row.status<>'approved' or earlier_row.status<>'approved' or root_row.status<>'approved' then raise exception 'Cal validar totes les línies abans de confirmar el vincle'; end if;
  if length(trim(coalesce(new.review_note,'')))<10 or new.reviewed_at is null then raise exception 'Cal justificació i revisió humana'; end if;
 end if;
 return new;
end $$;
create trigger validate_concert_unit_link before insert or update on public.concert_unit_links
 for each row execute function public.validate_concert_unit_link();
revoke all on function public.validate_concert_unit_link() from public,anon,authenticated;
grant execute on function public.validate_concert_unit_link() to service_role;
