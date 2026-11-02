-- A previously prepared Concert line must not be newly approved using a
-- correction whose documentary revision has changed. Keep replay and rejection
-- behavior, historical records and other financing types untouched.
do $$
declare original text; patched text;
 anchor constant text := ' if not p_approve then update record_units set status=''rejected'',review_note=p_note,reviewed_at=now() where id=u.id;return null;end if;';
 guard constant text := $guard$
 if r.financing_type='concert' and exists(select 1 from documented_corrections where unit_id=u.id and field='service_code') then
  -- Lock before checking validity: otherwise a concurrent source revision can
  -- change the correction after the check and before the approval commits.
  if current_setting('transaction_isolation')<>'read committed' then raise exception 'CONCERT_CORRECTION_ISOLATION';end if;
  perform 1 from source_documents d where d.id in
   (select document_id from current_documented_corrections where unit_id=u.id and field='service_code')
   order by d.id for share nowait;
  if exists(select 1 from current_documented_corrections where unit_id=u.id and field='service_code'
    and (valid is not true or value is distinct from u.service_code)) then
   raise exception 'La correcció del servei ha canviat o la seva font ja no és vigent; cal tornar-la a revisar';
  end if;
 end if;$guard$;
begin
 original:=pg_get_functiondef('public.review_record_unit(uuid,uuid,boolean,text)'::regprocedure);
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'CONCERT_CORRECTION_GUARD_ANCHOR';end if;
 patched:=replace(original,anchor,anchor||guard);execute patched;
end $$;

-- The separate individual-award writer already locks the record and documents;
-- add the same test only for new decisions, after its existing replay path.
do $$
declare original text; patched text;
 anchor constant text := ' select * into prior from public.concert_line_award_decisions where unit_id=u.id and job_id=j.id order by sequence desc limit 1;';
 guard constant text := $guard$
 if exists(select 1 from public.current_documented_corrections where unit_id=u.id and field='service_code'
    and (valid is not true or value is distinct from p_code)) then
  raise exception 'LINE_SERVICE_CORRECTION_STALE';
 end if;
$guard$;
begin
 original:=pg_get_functiondef('public.concert_line_award_decide(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb,uuid,text,uuid,text,uuid)'::regprocedure);
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'LINE_CORRECTION_GUARD_ANCHOR';end if;
 patched:=replace(original,anchor,guard||anchor);execute patched;
end $$;
