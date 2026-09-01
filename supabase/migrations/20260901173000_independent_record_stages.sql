alter table public.source_records
  add column if not exists evidence_status text not null default 'pending'
    check (evidence_status in ('pending','preparing','ready','no_source','unsupported','error')),
  add column if not exists evidence_error text,
  add column if not exists enrichment_status text not null default 'pending'
    check (enrichment_status in ('pending','processing','completed','error')),
  add column if not exists enrichment_error text;

update public.source_records record set
  evidence_status = case
    when exists (select 1 from public.source_documents document where document.source_record_id = record.id and document.status = 'fetched' and document.chunk_count > 0) then 'ready'
    when exists (select 1 from public.source_documents document where document.source_record_id = record.id) then 'error'
    else 'pending'
  end,
  enrichment_status = case when exists (select 1 from public.record_enrichments enrichment where enrichment.source_record_id = record.id) then 'completed' else 'pending' end;

create index if not exists source_records_evidence_status_idx on public.source_records(evidence_status);
create index if not exists source_records_enrichment_status_idx on public.source_records(enrichment_status);

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
    where record.processing_status in ('pendent', 'preparat')
      and record.financing_type in ('contractacio', 'conveni', 'subvencio', 'concert')
      and not (record.id = any(excluded_ids))
      and not exists (
        select 1
        from pipeline_jobs job
        join pipeline_runs run on run.id = job.run_id
        join source_records attempted on attempted.id = job.source_record_id
        where attempted.deduplication_key = record.deduplication_key
          and coalesce(run.parameters->>'purpose', '') <> 'inspection'
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

comment on column public.source_records.evidence_status is 'Estat independent de descobriment, descàrrega i fragmentació documental.';
comment on column public.source_records.enrichment_status is 'Estat independent del contrast estructurat amb fonts oficials, sense matching.';
