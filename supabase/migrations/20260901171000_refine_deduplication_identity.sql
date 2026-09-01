create or replace function public.set_source_record_classification()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  administrative_date text;
begin
  new.financing_type := case
    when new.source_dataset = 'contractacions' then 'contractacio'
    when new.source_dataset = 'convenis' then 'conveni'
    when new.source_dataset in ('raisc_ccaa', 'raisc_local') then 'subvencio'
    when new.source_dataset = 'concerts' then 'concert'
    else 'altres'
  end;
  administrative_date := coalesce(
    new.source_payload->>'Data concessió',
    new.source_payload->>'Data signatura',
    new.source_payload->>'Fecha de la última publicación',
    new.source_payload->>'Fecha de publicación del anuncio de licitación',
    ''
  );
  new.deduplication_key := md5(concat_ws('|',
    new.financing_type,
    public.normalize_matching_identity(new.title),
    public.normalize_matching_identity(new.provider_name),
    coalesce(round(new.amount, 2)::text, ''),
    public.normalize_matching_identity(administrative_date)
  ));
  return new;
end;
$$;

update public.source_records set source_dataset = source_dataset;

comment on column public.source_records.deduplication_key is
  'Identitat conservadora: tipologia, títol, entitat, import i data administrativa normalitzats.';
