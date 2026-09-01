create or replace function public.delete_unprocessed_concert_records(record_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  if coalesce(array_length(record_ids, 1), 0) > 1000 then
    raise exception 'No es poden retirar més de 1000 registres en una operació';
  end if;

  if exists (
    select 1
    from public.source_records record
    where record.id = any(record_ids)
      and (
        record.source_dataset <> 'concerts'
        or record.processing_status <> 'pendent'
        or exists (
          select 1 from public.pipeline_jobs job
          where job.source_record_id = record.id
        )
      )
  ) then
    raise exception 'La selecció conté registres no eliminables';
  end if;

  delete from public.source_records record
  where record.id = any(record_ids)
    and record.source_dataset = 'concerts'
    and record.processing_status = 'pendent'
    and not exists (
      select 1 from public.pipeline_jobs job
      where job.source_record_id = record.id
    );

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.delete_unprocessed_concert_records(uuid[]) from public;
grant execute on function public.delete_unprocessed_concert_records(uuid[]) to service_role;

comment on function public.delete_unprocessed_concert_records is
  'Retira exclusivament concerts pendents que mai han format part de cap lot.';
