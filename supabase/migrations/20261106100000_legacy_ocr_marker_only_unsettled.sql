-- A legacy OCR key (ocr:<digest>:...) predates the OCR journal, so a task that
-- stopped while holding one may have left an OCR outcome nobody can verify. The
-- legacy-ocr-pending marker stops a new operation from reusing or repeating it.
-- A completed task has no such uncertainty: its OCR finished and produced the
-- document's final extraction. Marking every record whose related runs ever
-- held a legacy key (even completed ones) blocked any re-reading of documents
-- extracted before the journal existed, including an explicit full reprocess
-- after the extraction version changed.
--
-- 1. Mark only when a related task holding legacy keys did not complete.
-- 2. Never copy an old marker into the new task: it is recomputed each time,
--    so a marker left by an earlier attempt cannot outlive its cause.
-- Everything else in begin_record_operation is unchanged.
do $migration$
declare definition text;patched text;
 copy_anchor constant text:='item_key not like ''document_failed:%''';
 legacy_anchor constant text:='c.item_key like ''ocr:%'' and (';
begin
 definition:=pg_get_functiondef('public.begin_record_operation(uuid,text,text)'::regprocedure);
 if (length(definition)-length(replace(definition,copy_anchor,'')))/length(copy_anchor)<>1
  or (length(definition)-length(replace(definition,legacy_anchor,'')))/length(legacy_anchor)<>1
 then raise exception 'Legacy OCR marker patch failed: expected one anchor of each kind';end if;
 patched:=replace(definition,copy_anchor,copy_anchor||E'\n  and item_key not like ''legacy-ocr-pending:%''');
 patched:=replace(patched,legacy_anchor,'c.item_key like ''ocr:%'' and prior_task.status<>''completed'' and (');
 if patched=definition then raise exception 'Legacy OCR marker patch failed';end if;
 execute patched;
end $migration$;
