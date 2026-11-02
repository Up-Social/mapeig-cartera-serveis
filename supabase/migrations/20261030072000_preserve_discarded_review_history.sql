-- Preserve immutable review/evidence history until its retention and deletion
-- policy is explicitly defined. The existing RPC already locks all selected
-- source rows before this check and remains all-or-nothing.
do $$
declare original text; patched text;
 cleanup_anchor constant text := 'delete from source_documents where id=any(docs);';
 source_lock_anchor constant text := 'perform 1 from source_records where id=any(ids) order by id for update nowait;';
 anchor constant text := 'select coalesce(array_agg(id),''{}'') into docs from source_documents where source_record_id=any(ids);';
 guard constant text := $guard$
 history_selected_ids:=ids;
 lock table conveni_independent_experiment.global_export_receipts,conveni_independent_experiment.mixed_receipts in share mode nowait;
 if exists(select 1 from public.documented_corrections where source_record_id=any(history_selected_ids))
  or exists(select 1 from public.conveni_review_events where source_record_id=any(history_selected_ids))
  or exists(select 1 from public.conveni_concept_review_events where source_record_id=any(history_selected_ids))
  or exists(select 1 from public.conveni_group_preparation_events where source_record_id=any(history_selected_ids))
  or exists(select 1 from public.conveni_amount_operations where source_record_id=any(history_selected_ids))
  or exists(select 1 from public.conveni_scope_overrides where source_record_id=any(history_selected_ids))
  or exists(select 1 from public.concert_unit_links l join public.record_units u on u.id in(l.later_unit_id,l.earlier_unit_id,l.root_unit_id) where u.source_record_id=any(history_selected_ids))
  or exists(select 1 from public.conveni_receipt_bindings b join public.pipeline_jobs j on j.id=b.job_id where j.source_record_id=any(history_selected_ids))
  or exists(select 1 from public.conveni_unit_economic_draft_events where source_record_id=any(history_selected_ids))
  or exists(select 1 from public.conveni_visual_reads where record_id=any(history_selected_ids))
  or exists(select 1 from public.conveni_first_preparation_operations where record_id=any(history_selected_ids))
  or exists(select 1 from public.concert_economic_reviews e join public.record_units u on u.id=e.unit_id where u.source_record_id=any(history_selected_ids))
  or exists(select 1 from public.concert_review_audit e join public.record_units u on e.kind='economic' and e.subject_id=u.id where u.source_record_id=any(history_selected_ids))
  or exists(select 1 from public.concert_review_audit e join public.concert_unit_links l on e.kind='link' and e.subject_id=l.id join public.record_units u on u.id in(l.later_unit_id,l.earlier_unit_id) where u.source_record_id=any(history_selected_ids))
  or exists(select 1 from public.concert_line_mixed_items x where x.snapshot->>'source_record_id'=any(array(select id::text from unnest(history_selected_ids) id)))
  or exists(select 1 from public.concert_line_award_decisions where source_record_id=any(history_selected_ids))
  or exists(select 1 from public.concert_line_awards where source_record_id=any(history_selected_ids))
  or exists(select 1 from conveni_independent_experiment.revisions where source_record_id=any(history_selected_ids))
  or exists(select 1 from conveni_independent_experiment.preparation_operations where record_id=any(history_selected_ids))
  or exists(select 1 from conveni_independent_experiment.versioned_acknowledgements where record_id=any(history_selected_ids))
  or exists(select 1 from conveni_independent_experiment.export_receipts where source_record_id=any(history_selected_ids))
  or exists(select 1 from conveni_independent_experiment.record_export_receipts where record_id=any(history_selected_ids))
  or exists(select 1 from conveni_first_candidate.history_acknowledgements where record_id=any(history_selected_ids))
  or exists(select 1 from conveni_first_candidate.pdf_extractions x join public.source_documents d on d.id=x.document_id where d.source_record_id=any(history_selected_ids))
  or exists(select 1 from conveni_first_candidate.visual_source_reads x join public.source_documents d on d.id=x.document_id where d.source_record_id=any(history_selected_ids))
  or exists(select 1 from conveni_first_candidate.first_export_receipts x join public.service_provisions p on p.id=x.provision_id where p.source_record_id=any(history_selected_ids))
  or exists(select 1 from conveni_independent_experiment.global_export_receipts x cross join unnest(history_selected_ids) selected(id)
   where jsonb_path_exists(x.snapshot,'$.records[*] ? (@.record_id == $id)',jsonb_build_object('id',selected.id::text)))
  or exists(select 1 from conveni_independent_experiment.mixed_receipts x cross join unnest(history_selected_ids) selected(id)
   where jsonb_path_exists(x.snapshot,'$[*].snapshot ? (@.source_record_id == $id)',jsonb_build_object('id',selected.id::text)))
 then raise exception 'PRESERVED_HISTORY_EXISTS'; end if;
 $guard$;
begin
 original:=pg_get_functiondef('public.delete_discarded_records(jsonb,integer)'::regprocedure);
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'HISTORY_DELETE_ANCHOR_NOT_UNIQUE';end if;
 if (length(original)-length(replace(original,source_lock_anchor,'')))/length(source_lock_anchor)<>1 then raise exception 'HISTORY_SOURCE_LOCK_ANCHOR_NOT_UNIQUE';end if;
 if (length(original)-length(replace(original,'declare ids uuid[];','')))/length('declare ids uuid[];')<>1 then raise exception 'HISTORY_DECLARATION_ANCHOR_NOT_UNIQUE';end if;
 patched:=replace(original,'declare ids uuid[];','declare ids uuid[];history_selected_ids uuid[];');
 patched:=replace(patched,source_lock_anchor,'lock table public.source_records in row exclusive mode nowait;'||E'\n '||source_lock_anchor);
 patched:=replace(patched,anchor,guard||E'\n '||anchor);
 if (length(patched)-length(replace(patched,cleanup_anchor,'')))/length(cleanup_anchor)<>1 then raise exception 'HISTORY_CLEANUP_ANCHOR_NOT_UNIQUE';end if;
 patched:=replace(patched,cleanup_anchor,$cleanup$
 -- No reviewed history survives the guard above. Delete only automatic
 -- Conveni proposals/analyses and their unreviewed units before documents.
 delete from public.conveni_unit_proposals where job_id=any(jobs);
 delete from public.conveni_analyses where job_id=any(jobs);
 delete from public.record_units u using public.source_records r where u.source_record_id=r.id and r.id=any(ids) and r.financing_type='conveni';
 $cleanup$||E'\n '||cleanup_anchor);
 execute patched;
end $$;
