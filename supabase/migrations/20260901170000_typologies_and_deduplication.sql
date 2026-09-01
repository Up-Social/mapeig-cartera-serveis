alter table public.source_records
  add column if not exists financing_type text,
  add column if not exists deduplication_key text;

create or replace function public.normalize_matching_identity(value text)
returns text
language sql
immutable
parallel safe
as $$
  select regexp_replace(
    translate(lower(coalesce(value, '')), 'àáäâèéëêìíïîòóöôùúüûçñ', 'aaaaeeeeiiiioooouuuucn'),
    '[^a-z0-9]+', '', 'g'
  );
$$;

create or replace function public.set_source_record_classification()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.financing_type := case
    when new.source_dataset = 'contractacions' then 'contractacio'
    when new.source_dataset = 'convenis' then 'conveni'
    when new.source_dataset in ('raisc_ccaa', 'raisc_local') then 'subvencio'
    when new.source_dataset = 'concerts' then 'concert'
    else 'altres'
  end;
  new.deduplication_key := md5(concat_ws('|',
    new.financing_type,
    public.normalize_matching_identity(new.title),
    public.normalize_matching_identity(new.provider_name),
    coalesce(round(new.amount, 2)::text, '')
  ));
  return new;
end;
$$;

drop trigger if exists source_records_classification_trigger on public.source_records;
create trigger source_records_classification_trigger
before insert or update of source_dataset, title, provider_name, amount
on public.source_records
for each row execute function public.set_source_record_classification();

update public.source_records set source_dataset = source_dataset;

create index if not exists source_records_financing_type_idx on public.source_records(financing_type);
create index if not exists source_records_deduplication_key_idx on public.source_records(deduplication_key);

create or replace function public.sample_financing_type_candidates(candidate_limit integer default 20, excluded_ids uuid[] default '{}')
returns table (
  id uuid, source_dataset text, financing_type text, source_record_id text, title text,
  provider_name text, amount numeric, mechanism text, deduplication_key text
)
language sql
security definer
set search_path = public
as $$
  with eligible as (
    select record.*,
      row_number() over (partition by record.deduplication_key order by random()) as duplicate_rank
    from source_records record
    where record.processing_status = 'pendent'
      and record.financing_type in ('contractacio', 'conveni', 'subvencio', 'concert')
      and not (record.id = any(excluded_ids))
      and not exists (
        select 1
        from pipeline_jobs job
        join source_records attempted on attempted.id = job.source_record_id
        where attempted.deduplication_key = record.deduplication_key
      )
  ), ranked as (
    select eligible.*,
      row_number() over (partition by eligible.financing_type order by random()) as type_rank
    from eligible
    where duplicate_rank = 1
  )
  select ranked.id, ranked.source_dataset, ranked.financing_type, ranked.source_record_id,
    ranked.title, ranked.provider_name, ranked.amount, ranked.mechanism, ranked.deduplication_key
  from ranked
  where type_rank <= greatest(candidate_limit, 1)
  order by financing_type, type_rank;
$$;

revoke all on function public.sample_financing_type_candidates(integer, uuid[]) from public;
grant execute on function public.sample_financing_type_candidates(integer, uuid[]) to service_role;

comment on column public.source_records.financing_type is 'Tipologia de finançament; agrupa una o més fonts o datasets.';
comment on column public.source_records.deduplication_key is 'Identitat normalitzada usada per evitar repetir el mateix cas o duplicats entre fitxers.';
comment on function public.sample_financing_type_candidates is 'Retorna candidats pendents únics, mai intentats, agrupats per tipologia de finançament.';
