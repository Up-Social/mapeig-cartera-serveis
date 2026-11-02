-- Fence source/copy metadata and decision dependencies introduced by 540/560.
-- All acquisition is NOWAIT; mixed exports fail closed on conflicting writers.
do $$
declare original text;patched text;
 anchor constant text:=' perform 1 from public.service_provisions p where p.id=any(ids) order by p.id for share nowait;';
 replacement constant text:=$patch$
 perform 1 from public.service_provisions p where p.id=any(ids) order by p.id for update nowait;
 perform 1 from conveni_first_candidate.first_provision_receipts f where f.provision_id=any(ids) order by f.event_id for share nowait;
 perform 1 from public.conveni_unit_economic_draft_events d where d.id in(select f.draft_id from conveni_first_candidate.first_provision_receipts f where f.provision_id=any(ids)) order by d.id for update nowait;
 perform 1 from conveni_first_candidate.visual_economic_links l where l.event_id in(select f.visual_link from conveni_first_candidate.first_provision_receipts f where f.provision_id=any(ids)) order by l.event_id for share nowait;
 perform 1 from conveni_first_candidate.receipts rc where rc.event_id in(select l.receipt_id from conveni_first_candidate.first_provision_receipts f join conveni_first_candidate.visual_economic_links l on l.event_id=f.visual_link where f.provision_id=any(ids)) order by rc.event_id for share nowait;
 perform 1 from conveni_first_candidate.historical_draft_ack_links dl where dl.draft_id in(select f.draft_id from conveni_first_candidate.first_provision_receipts f where f.provision_id=any(ids)) order by dl.draft_id for share nowait;
 perform 1 from conveni_first_candidate.history_acknowledgements a where a.event_id in(select dl.acknowledgement_id from conveni_first_candidate.first_provision_receipts f join conveni_first_candidate.historical_draft_ack_links dl on dl.draft_id=f.draft_id where f.provision_id=any(ids)) order by a.event_id for share nowait;
 perform 1 from public.catalog_versions cv where cv.id in(select d.catalog_version_id from conveni_first_candidate.first_provision_receipts f join public.conveni_unit_economic_draft_events d on d.id=f.draft_id where f.provision_id=any(ids)) order by cv.id for update nowait;
 perform 1 from public.catalog_versions cv where cv.id in(select a.catalog_version_id from public.concert_line_awards a where a.id=any(ids)) order by cv.id for update nowait;
 perform 1 from public.official_services os where os.version_id in(select d.catalog_version_id from conveni_first_candidate.first_provision_receipts f join public.conveni_unit_economic_draft_events d on d.id=f.draft_id where f.provision_id=any(ids)) order by os.version_id,os.service_code for share nowait;
 perform 1 from storage.objects o where o.id in(
  select (a->'source'->>'object_id')::uuid from conveni_first_candidate.first_provision_receipts f join conveni_first_candidate.visual_economic_links l on l.event_id=f.visual_link join conveni_first_candidate.receipts rc on rc.event_id=l.receipt_id cross join lateral jsonb_array_elements(rc.snapshot->'archives') a where f.provision_id=any(ids)
  union select (a->'copy'->>'object_id')::uuid from conveni_first_candidate.first_provision_receipts f join conveni_first_candidate.visual_economic_links l on l.event_id=f.visual_link join conveni_first_candidate.receipts rc on rc.event_id=l.receipt_id cross join lateral jsonb_array_elements(rc.snapshot->'archives') a where f.provision_id=any(ids)
 ) order by o.id for share nowait;$patch$;
begin
 original:=pg_get_functiondef('public.concert_line_mixed_commit(uuid,text,jsonb,boolean)'::regprocedure);
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'CONVENI_MIXED_FENCE_ANCHOR';end if;
 patched:=replace(original,anchor,replacement);execute patched;
end $$;
-- Master fixes full membership: include the later Convenis validity dependencies.
do $$
declare original text;patched text;
 anchor constant text:='public.concert_population_events,storage.objects in share mode nowait;';
 replacement constant text:='public.concert_population_events,public.conveni_unit_economic_draft_events,conveni_first_candidate.first_provision_receipts,conveni_first_candidate.visual_economic_links,conveni_first_candidate.receipts,conveni_first_candidate.historical_draft_ack_links,conveni_first_candidate.history_acknowledgements,storage.objects in share mode nowait;';
begin
 original:=pg_get_functiondef('public.concert_line_master_snapshot_commit(uuid,text,text,jsonb)'::regprocedure);
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'CONVENI_MASTER_FENCE_ANCHOR';end if;
 patched:=replace(original,anchor,replacement);execute patched;
end $$;
