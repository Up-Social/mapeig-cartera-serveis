-- A Concerts-only new attempt, preserving every prior job and receipt. This
-- installs a separate entrypoint from the guarded operation body; the existing
-- begin_record_operation and its callers are not modified.
-- Prerequisites include 20260929164500, 20261026203000, 20261028232000 and
-- 20261029036000. Any unmatched installation anchor aborts this migration.
-- A later change to begin_record_operation must also review this entrypoint.
-- Refresh re-fetches sources in the application. A changed archived document
-- must remain pending for review: this RPC never overwrites document bytes,
-- units, reviewed decisions or financing.
do $migration$
declare
 definition text;
 patched text;
 anchor text;
 anchor_count integer;
 replacement text;
begin
 select p.prosrc into strict definition from pg_proc p
 where p.oid='public.begin_record_operation(uuid,text,text)'::regprocedure;
 if position('PROVIDER_RECONCILIATION_REQUIRED' in definition)=0
   or position('PROVIDER_UNKNOWN' in definition)=0
   or position('PROVIDER_SCOPE_ISOLATION_UNSUPPORTED' in definition)=0
   or position('ACTIVE_TASK' in definition)=0
   or position('legacy-ocr-pending:' in definition)=0 then
  raise exception 'CONCERT_REPROCESS_REQUIRED_GUARDS_MISSING';
 end if;
 patched:=regexp_replace(definition,'^([[:space:]]*declare)([[:space:]])',
  E'\\1\n  p_operation constant text := ''process'';\n  ocr_enabled boolean;\n\\2','i');
 if patched=definition then raise exception 'CONCERT_REPROCESS_DECLARATION_ANCHOR';end if;

 -- Accept formatting differences only; identifiers, operators and key literals
 -- remain exact. Use the unique matched source slice for replacement.
 select count(*),min(m[1]) into anchor_count,anchor from regexp_matches(patched,
  $re$(select[[:space:]]+\*[[:space:]]+into[[:space:]]+strict[[:space:]]+source[[:space:]]+from[[:space:]]+source_records[[:space:]]+where[[:space:]]+id[[:space:]]*=[[:space:]]*p_record[[:space:]]+for[[:space:]]+update[[:space:]]*;)$re$,'g') m;
 if anchor_count<>1 then
  raise exception 'CONCERT_REPROCESS_SOURCE_ANCHOR';
 end if;
 replacement:=anchor||E'\n  if p_executor is distinct from ''vercel_workflow'' then raise exception ''CONCERT_REPROCESS_EXECUTOR'';end if;\n  if source.financing_type is distinct from ''concert'' then raise exception ''CONCERT_REPROCESS_SCOPE'';end if;\n  perform public.assert_processing_enabled();';
 patched:=replace(patched,anchor,replacement);

 select count(*),min(m[1]) into anchor_count,anchor from regexp_matches(patched,
  $re$(select[[:space:]]+\*[[:space:]]+into[[:space:]]+j[[:space:]]+from[[:space:]]+pipeline_jobs[[:space:]]+where[[:space:]]+source_record_id[[:space:]]*=[[:space:]]*p_record[[:space:]]+order[[:space:]]+by[[:space:]]+created_at[[:space:]]+desc[[:space:]]*,[[:space:]]*id[[:space:]]+desc[[:space:]]+limit[[:space:]]+1[[:space:]]+for[[:space:]]+update[[:space:]]*;)$re$,'g') m;
 if anchor_count<>1 then
  raise exception 'CONCERT_REPROCESS_JOB_ANCHOR';
 end if;
 patched:=replace(patched,anchor,anchor||E'\n  if j.id is distinct from p_expected_job then raise exception ''CONCERT_REPROCESS_STALE_JOB'';end if;');

 select count(*),min(m[1]) into anchor_count,anchor from regexp_matches(patched,
  $re$(prior[[:space:]]*:=[[:space:]]*j\.id[[:space:]]*;)$re$,'g') m;
 if anchor_count<>1 then
  raise exception 'CONCERT_REPROCESS_SNAPSHOT_ANCHOR';
 end if;
 patched:=replace(patched,anchor,
  E'if j.id is not null then perform public.capture_job_snapshot(j.id,''before_concert_reprocess'');end if;\n  '||anchor);
 -- Keep the original branches and their guards; always select the new-job
 -- branch. No prior task checkpoints or provider budget receipts are copied.
 select count(*),min(m[1]) into anchor_count,anchor from regexp_matches(patched,
  $re$(if[[:space:]]+j\.id[[:space:]]+is[[:space:]]+null)(?=[[:space:]]|$)$re$,'g') m;
 if anchor_count<>1 then
  raise exception 'CONCERT_REPROCESS_NEW_JOB_ANCHOR';
 end if;
 patched:=replace(patched,anchor,'if true');

 select count(*),min(m[1]) into anchor_count,anchor from regexp_matches(patched,
  $re$(return[[:space:]]+jsonb_build_object[[:space:]]*\([[:space:]]*'runId'[[:space:]]*,[[:space:]]*run[[:space:]]*,[[:space:]]*'jobId'[[:space:]]*,[[:space:]]*j\.id[[:space:]]*,[[:space:]]*'taskId'[[:space:]]*,[[:space:]]*task[[:space:]]*,[[:space:]]*'attemptId'[[:space:]]*,[[:space:]]*attempt[[:space:]]*,[[:space:]]*'newJob'[[:space:]]*,[[:space:]]*new_job[[:space:]]*\)[[:space:]]*;)$re$,'g') m;
 if anchor_count<>1 then
  raise exception 'CONCERT_REPROCESS_RETURN_ANCHOR';
 end if;
 replacement:=$body$
  select enabled into ocr_enabled from public.app_settings
    where key='automatic_ocr' for share;
  update public.pipeline_runs
  set parameters=parameters||jsonb_build_object(
    'purpose','concert_reprocess',
    'operation','process',
    'auto_process',true,
    'concert_refresh_sources',true,
    'ocr_recovery',coalesce(ocr_enabled,true),
    'ocr_setting','automatic_ocr'
  ) where id=run;
  if not found then raise exception 'CONCERT_REPROCESS_RUN_MISSING';end if;
$body$||anchor;
 patched:=replace(patched,anchor,replacement);
 execute format(
  'create function public.begin_concert_reprocess(p_record uuid,p_expected_job uuid default null,p_executor text default ''vercel_workflow'') returns jsonb language plpgsql security invoker set search_path=public as %L',
  patched
 );
end $migration$;

revoke all on function public.begin_concert_reprocess(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.begin_concert_reprocess(uuid,uuid,text) to service_role;
comment on function public.begin_concert_reprocess(uuid,uuid,text) is
 'Concerts: nou treball amb expectativa de revisió, historial conservat, comprovacions de proveïdor i captura OCR atòmica. No aprova ni substitueix finançament.';
