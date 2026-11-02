-- Private experiment: revalidate the single-statement snapshot immediately
-- before recording a receipt, without holding locks during Excel or network.
-- These broad SHARE locks block every writer of these tables until transaction
-- end and may be operationally unacceptable.  Only READ COMMITTED is safe:
-- a repeatable-read snapshot can predate acquisition of the locks.  This does
-- not verify the Excel bytes or prevent changes after this transaction commits.
create function public.record_batch_export_snapshot_prototype(
 p_run uuid,p_expected_fingerprint text,p_filename text,p_content_hash text
) returns uuid language plpgsql volatile security invoker
set search_path=pg_catalog,public as $$
declare snapshot_ jsonb; ids_ uuid[];
begin
 if current_setting('transaction_isolation') <> 'read committed' then
  raise exception 'La verificació requereix READ COMMITTED' using errcode='40001';
 end if;
 if p_run is null or p_expected_fingerprint is null
   or p_expected_fingerprint !~ '^batch-export-v1:[0-9a-f]{64}$'
 then raise exception 'Identitat de la captura invàlida';end if;
 -- Alphabetical, explicit order; no caller may enter holding an incompatible
 -- lock.  NOWAIT fails closed if a writer is already active, and no lock is
 -- held across Excel creation or HTTP delivery.
 lock table public.conveni_analyses, public.conveni_review_events,
  public.conveni_unit_proposals, public.master_services, public.official_services,
  public.pipeline_jobs, public.pipeline_runs, public.record_units, public.review_decisions,
  public.service_provisions, public.source_documents, public.source_records
  in share mode nowait;
 -- This is a new PL/pgSQL statement after locks are acquired. At READ
 -- COMMITTED it obtains a fresh snapshot, including earlier committed writes.
 snapshot_:=public.batch_export_snapshot_prototype(p_run);
 if snapshot_->>'fingerprint' is distinct from p_expected_fingerprint
    or snapshot_#>'{body,run}'='null'::jsonb
 then raise exception 'Les dades del lot han canviat; torna a generar l’exportació' using errcode='40001';end if;
 select array_agg((p->>'id')::uuid order by (p->>'id')::uuid) into ids_
  from jsonb_array_elements(snapshot_#>'{body,provisions}') p;
 if ids_ is null then raise exception 'No hi ha cap provisió revisada' using errcode='40001';end if;
 return public.record_batch_export(p_run,p_filename,p_content_hash,ids_);
end $$;
revoke all on function public.record_batch_export_snapshot_prototype(uuid,text,text,text)
 from public,anon,authenticated,service_role;
