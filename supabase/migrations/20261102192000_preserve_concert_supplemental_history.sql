-- Supplemental observations remain evidence even when they are no longer current.
-- Follow migration 20261030072000's all-or-nothing retention policy; do not purge
-- observations or weaken their NO ACTION foreign keys.
do $$
declare
 body_ text;
 lock_anchor_ constant text := 'perform 1 from source_records where id=any(ids) order by id for update nowait;';
 guard_anchor_ constant text := 'select coalesce(array_agg(id),''{}'') into docs from source_documents where source_record_id=any(ids);';
 guard_ constant text := $guard$
 lock table public.concert_supplemental_geography,public.concert_signature_observations in share mode nowait;
 if exists(select 1 from public.concert_supplemental_geography g
  where g.source_record_id=any(ids)
   or exists(select 1 from public.source_documents d where d.id=g.document_id and d.source_record_id=any(ids))
   or exists(select 1 from public.record_units u where u.id=g.unit_id and u.source_record_id=any(ids)))
 or exists(select 1 from public.concert_signature_observations s
  where s.source_record_id=any(ids)
   or exists(select 1 from public.source_documents d where d.id=s.document_id and d.source_record_id=any(ids)))
 then raise exception 'PRESERVED_HISTORY_EXISTS'; end if;
 $guard$;
begin
 body_:=pg_get_functiondef('public.delete_discarded_records(jsonb,integer)'::regprocedure);
 if (length(body_)-length(replace(body_,lock_anchor_,'')))/length(lock_anchor_)<>1 then
  raise exception 'CONCERT_SUPPLEMENTAL_DELETE_LOCK_ANCHOR_INVALID';
 end if;
 if (length(body_)-length(replace(body_,guard_anchor_,'')))/length(guard_anchor_)<>1 then
  raise exception 'CONCERT_SUPPLEMENTAL_DELETE_GUARD_ANCHOR_INVALID';
 end if;
 -- The source lock and document-selection anchors exist in both the original
 -- production RPC and migration 720's version. Do not assume 720 was applied.
 if position(lock_anchor_ in body_)>=position(guard_anchor_ in body_) then
  raise exception 'CONCERT_SUPPLEMENTAL_DELETE_ANCHOR_ORDER_INVALID';
 end if;
 -- Held until transaction end: INSERT/UPDATE/DELETE require ROW EXCLUSIVE,
 -- which conflicts with SHARE. NOWAIT preserves the RPC's contention policy
 -- and avoids waiting on writers already holding document/unit locks.
 body_:=replace(body_,guard_anchor_,guard_||E'\n '||guard_anchor_);
 execute body_;
end $$;
