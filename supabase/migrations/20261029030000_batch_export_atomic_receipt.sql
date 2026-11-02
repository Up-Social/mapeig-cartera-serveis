-- An export receipt and its item references are one operation. This does not
-- make the paginated data read or Excel generation a transaction snapshot.
create function public.record_batch_export(
 p_run uuid,p_filename text,p_content_hash text,p_provisions uuid[]
) returns uuid language plpgsql security invoker set search_path=pg_catalog,public as $$
declare export_id uuid;
begin
 if p_run is null or p_filename is null or btrim(p_filename)='' or p_content_hash !~ '^[0-9a-f]{64}$'
  or p_content_hash is null or p_provisions is null or cardinality(p_provisions)=0
  or array_position(p_provisions,null) is not null
  or (select count(distinct item) from unnest(p_provisions) item)<>cardinality(p_provisions)
 then raise exception 'Dades d’exportació invàlides';end if;
 -- Lock the selected provision rows while checking membership and current
 -- visibility. This does not freeze documents, jobs or the earlier Excel read.
 perform 1 from public.service_provisions p where p.id=any(p_provisions) order by p.id for share nowait;
 if (select count(*) from public.conveni_reviewed_provisions p where p.id=any(p_provisions)
      and p.superseded_at is null and exists(select 1 from public.pipeline_jobs j where j.run_id=p_run and j.source_record_id=p.source_record_id))
    <>cardinality(p_provisions)
 then raise exception 'Les dades del lot han canviat; torna a generar l’exportació' using errcode='40001';end if;
 insert into public.excel_exports(pipeline_run_id,filename,provision_count,content_hash)
 values(p_run,p_filename,cardinality(p_provisions),p_content_hash) returning id into export_id;
 insert into public.excel_export_items(export_id,provision_id)
 select export_id,provision_id from unnest(p_provisions) provision_id;
 return export_id;
end $$;
revoke all on function public.record_batch_export(uuid,text,text,uuid[]) from public,anon,authenticated;
grant execute on function public.record_batch_export(uuid,text,text,uuid[]) to service_role;
