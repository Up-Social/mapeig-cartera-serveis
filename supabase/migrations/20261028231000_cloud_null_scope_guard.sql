-- NULL is not authorization: a run-scoped task has no source_record_id, so
-- NOT (false OR NULL) was NULL and PL/pgSQL did not enter the rejection branch.
do $migration$
declare definition text;patched text;
begin
 definition:=pg_get_functiondef('public.cloud_commit_v1(uuid,uuid,bigint,uuid,text,jsonb)'::regprocedure);
 patched:=replace(definition,
  $old$if not ((t.run_id is not null and j.run_id=t.run_id) or (t.source_record_id=j.source_record_id)) then raise exception 'CLOUD_SCOPE'; end if;$old$,
  $new$if (((t.run_id is not null and j.run_id=t.run_id) or (t.source_record_id=j.source_record_id)) is not true) then raise exception 'CLOUD_SCOPE'; end if;$new$);
 if patched=definition then raise exception 'Cloud commit scope patch failed';end if;
 execute patched;
 definition:=pg_get_functiondef('public.verify_targeted_ocr_checkpoint(uuid,uuid,bigint,uuid,uuid,jsonb)'::regprocedure);
 patched:=replace(definition,
  $old$if not ((t.run_id is not null and j.run_id=t.run_id) or t.source_record_id=j.source_record_id) then raise exception 'CLOUD_SCOPE';end if;$old$,
  $new$if (((t.run_id is not null and j.run_id=t.run_id) or t.source_record_id=j.source_record_id) is not true) then raise exception 'CLOUD_SCOPE';end if;$new$);
 if patched=definition then raise exception 'Targeted OCR scope patch failed';end if;
 execute patched;
end $migration$;
