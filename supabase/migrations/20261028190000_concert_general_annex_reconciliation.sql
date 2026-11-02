-- Reconcile a source-backed, unnumbered award annex without assuming that
-- missing amounts are zero. Reconciliation remains distinct from review.
create or replace function public.cloud_finalize_concert_annex(
 p_task uuid,p_owner uuid,p_generation bigint,p_job uuid,p_document uuid,
 p_annex integer,p_rows integer,p_sum_cents bigint,p_declared_cents bigint
) returns boolean language plpgsql security invoker set search_path=public as $$
declare j public.pipeline_jobs;d public.source_documents;actual_rows integer;missing_amounts integer;missing_quantities integer;actual_quantity bigint;actual_sum bigint;footer_count integer;footer_quantity_count integer;footer_quantity bigint;footer_mismatch integer;complete boolean;
begin
 perform public.cloud_assert_lease(p_task,p_owner,p_generation);
 select * into strict j from public.pipeline_jobs where id=p_job;
 if not exists(select 1 from public.worker_tasks t where t.id=p_task and
   (t.run_id=j.run_id or t.source_record_id=j.source_record_id)) then raise exception 'CLOUD_SCOPE';end if;
 select * into strict d from public.source_documents where id=p_document and source_record_id=j.source_record_id
  and status='fetched' and not coalesce(extraction_partial,false) and storage_sha256 is not null;
 select count(*)::integer,count(*) filter(where u.amount is null)::integer,count(*) filter(where u.quantity is null)::integer,coalesce(sum(u.quantity),0),coalesce(sum((u.amount*100)::bigint),0)
 into actual_rows,missing_amounts,missing_quantities,actual_quantity,actual_sum
 from public.record_units u where u.source_record_id=j.source_record_id and u.document_id=d.id
  and u.unit_key like 'official-annex:'||d.storage_sha256||':'||p_annex||':%'
  and u.storage_path is not null and u.storage_sha256=d.storage_sha256;
 if actual_rows<>p_rows then raise exception 'CONCERT_ARCHIVE_INCOMPLETE';end if;
 if p_annex=0 then
  select count(*)::integer,count(distinct (m.value[1])::bigint)::integer,min((m.value[1])::bigint),
   count(*) filter(where (replace(replace(m.value[2],'.',''),',','.')::numeric*100)::bigint is distinct from p_declared_cents)::integer
  into footer_count,footer_quantity_count,footer_quantity,footer_mismatch
  from regexp_matches(regexp_replace(d.extracted_text,'\s+',' ','g'),'total general\s+([0-9]+)\s+([0-9.]+,[0-9]{2})\s*€','gi') as m(value);
 end if;
 complete:=p_annex in (0,6,7) and missing_amounts=0 and p_declared_cents is not null
  and p_declared_cents=p_sum_cents and actual_sum=p_sum_cents
  and (p_annex<>0 or (missing_quantities=0 and footer_count>0 and footer_quantity_count=1 and footer_mismatch=0 and footer_quantity=actual_quantity));
 insert into public.concert_annex_reconciliations(source_record_id,document_id,document_sha256,extraction_version,
  annex,row_count,sum_cents,declared_cents,reconciled,coverage)
 values(j.source_record_id,d.id,d.storage_sha256,d.extraction_version,p_annex,p_rows,p_sum_cents,p_declared_cents,complete,
  case when p_annex=0 and p_declared_cents is not null then jsonb_build_object('declared_amount_kind','maximum') else null end)
 on conflict(document_id,annex,extraction_version) do update
 set row_count=excluded.row_count,sum_cents=excluded.sum_cents,declared_cents=excluded.declared_cents,
     reconciled=excluded.reconciled,coverage=coalesce(excluded.coverage,concert_annex_reconciliations.coverage),checked_at=now();
 return complete;
end $$;
