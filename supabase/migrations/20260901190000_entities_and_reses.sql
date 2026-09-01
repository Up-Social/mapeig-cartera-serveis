create table public.external_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  source_url text not null,
  retrieved_at timestamptz not null default now(),
  rows_read integer not null default 0,
  rows_written integer not null default 0,
  entities_written integer not null default 0,
  response_hash text,
  error_message text,
  completed_at timestamptz
);

create table public.entities (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  normalized_name text not null,
  nif text,
  qualification text,
  validation_status text not null default 'unverified'
    check (validation_status in ('unverified', 'reses_verified', 'source_verified', 'manually_verified')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index entities_nif_unique_idx on public.entities(nif) where nif is not null;
create index entities_normalized_name_idx on public.entities(normalized_name);

create table public.entity_aliases (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  source text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique(entity_id, normalized_alias, source)
);
create index entity_aliases_normalized_idx on public.entity_aliases(normalized_alias);

create table public.reses_services (
  registry_number text primary key,
  entity_id uuid not null references public.entities(id) on delete restrict,
  service_name text not null,
  service_type text not null,
  registration_date date,
  capacity integer,
  address text,
  municipality text,
  postal_code text,
  county text,
  active boolean not null default true,
  source_payload jsonb not null,
  source_payload_hash text not null,
  retrieved_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index reses_services_entity_idx on public.reses_services(entity_id);
create index reses_services_type_idx on public.reses_services(service_type);
create index reses_services_municipality_idx on public.reses_services(municipality);

create table public.entity_mentions (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid not null references public.source_records(id) on delete cascade,
  raw_name text not null,
  normalized_name text not null,
  nif text,
  role text not null default 'provider',
  source text not null,
  entity_id uuid references public.entities(id) on delete set null,
  resolution_status text not null default 'unresolved'
    check (resolution_status in ('unresolved', 'linked_by_nif', 'manually_linked', 'rejected')),
  evidence text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_record_id, normalized_name, role, source)
);
create index entity_mentions_entity_idx on public.entity_mentions(entity_id);
create index entity_mentions_nif_idx on public.entity_mentions(nif);

create table public.source_record_entities (
  source_record_id uuid not null references public.source_records(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete restrict,
  role text not null check (role in ('provider', 'beneficiary', 'contractor', 'signatory', 'holder', 'funder')),
  origin text not null check (origin in ('source', 'enrichment', 'review')),
  evidence text,
  created_at timestamptz not null default now(),
  primary key(source_record_id, entity_id, role, origin)
);
create index source_record_entities_entity_idx on public.source_record_entities(entity_id);

alter table public.service_provisions
  add column entity_id uuid references public.entities(id) on delete restrict;
create index service_provisions_entity_idx on public.service_provisions(entity_id);

create table public.reses_typology_catalog_mappings (
  service_type text not null,
  service_code text not null references public.master_services(service_code) on update cascade on delete restrict,
  method text not null check (method in ('exact_name', 'manual')),
  review_status text not null default 'auxiliary' check (review_status in ('auxiliary', 'confirmed', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(service_type, service_code)
);

create table public.entity_catalog_relations (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete cascade,
  service_code text not null references public.master_services(service_code) on update cascade on delete restrict,
  relation_type text not null check (relation_type in ('confirmed', 'auxiliary')),
  source_type text not null check (source_type in ('provision', 'reses')),
  source_reference text not null,
  evidence text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(entity_id, service_code, relation_type, source_type, source_reference)
);
create index entity_catalog_relations_service_idx on public.entity_catalog_relations(service_code, relation_type);
create index entity_catalog_relations_entity_idx on public.entity_catalog_relations(entity_id, relation_type);

alter table public.external_sync_runs enable row level security;
alter table public.entities enable row level security;
alter table public.entity_aliases enable row level security;
alter table public.reses_services enable row level security;
alter table public.entity_mentions enable row level security;
alter table public.source_record_entities enable row level security;
alter table public.reses_typology_catalog_mappings enable row level security;
alter table public.entity_catalog_relations enable row level security;

grant select, insert, update on public.external_sync_runs to service_role;
grant select, insert, update on public.entities to service_role;
grant select, insert, update, delete on public.entity_aliases to service_role;
grant select, insert, update on public.reses_services to service_role;
grant select, insert, update, delete on public.entity_mentions to service_role;
grant select, insert, update, delete on public.source_record_entities to service_role;
grant select, insert, update, delete on public.reses_typology_catalog_mappings to service_role;
grant select, insert, update, delete on public.entity_catalog_relations to service_role;

comment on table public.entities is 'Entitats canòniques; el NIF exacte és l’única identitat automàtica autoritzada.';
comment on table public.reses_services is 'Serveis i establiments del RESES vinculats a la seva entitat titular.';
comment on table public.entity_mentions is 'Noms d’entitat detectats que no es fusionen sense NIF exacte o revisió humana.';
comment on table public.entity_catalog_relations is 'Relacions confirmades per provisions o auxiliars procedents de RESES, sempre separades.';
