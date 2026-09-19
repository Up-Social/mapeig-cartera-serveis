-- Keep the previously deployed application safe during the coordinated schema/code rollout.
-- The legacy UI cannot supply structured discard reasons, so that one outcome fails closed.
create function public.review_analysis(
  p_record uuid,
  p_outcome text,
  p_candidate uuid default null,
  p_code text default null,
  p_notes text default null
) returns void
language plpgsql
security invoker
set search_path=public
as $$
declare
  expected_job uuid;
begin
  if p_outcome='reject' then
    raise exception 'Actualitza l’aplicació per seleccionar els motius estructurats del descart';
  end if;

  select id into strict expected_job
  from public.pipeline_jobs
  where source_record_id=p_record
  order by created_at desc,id desc
  limit 1;

  perform public.review_analysis(
    p_record,
    p_outcome,
    expected_job,
    '{}'::text[],
    p_candidate,
    p_code,
    p_notes
  );
end
$$;

revoke all on function public.review_analysis(uuid,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.review_analysis(uuid,text,uuid,text,text) to service_role;
