-- The matching input fence must not accept a stale deduplication key for its
-- own source. The classification trigger currently ignores updates limited
-- to source_payload even though the key includes an administrative date.
-- This is a conservative check only: it neither repairs historical keys nor
-- detects another record with a stale key, nor closes group phantoms.
do $$
declare original text; patched text;
begin
 original:=pg_get_functiondef('public.local_verify_matching_input_state(uuid,jsonb,text)'::regprocedure);
 patched:=replace(original,
  $old$if not found or coalesce(r.financing_type,'') not in ('contractacio','subvencio') then return null;end if;$old$,
  $new$if not found or coalesce(r.financing_type,'') not in ('contractacio','subvencio') then return null;end if;
 -- Keep this expression aligned with set_source_record_classification. A
 -- null, legacy, or inconsistent key must be reconciled before a local claim
 -- or commit; this does not change the source or authorize any reprocessing.
 if (r.source_dataset='contractacions' and r.financing_type is distinct from 'contractacio')
  or (r.source_dataset in ('raisc_ccaa','raisc_local') and r.financing_type is distinct from 'subvencio')
  or r.source_dataset is null or r.source_dataset not in ('contractacions','raisc_ccaa','raisc_local')
  or r.deduplication_key is distinct from md5(concat_ws('|',r.financing_type,
   public.normalize_matching_identity(r.title),public.normalize_matching_identity(r.provider_name),
   coalesce(round(r.amount,2)::text,''),public.normalize_matching_identity(coalesce(
    r.source_payload->>'Data concessió',r.source_payload->>'Data signatura',
    r.source_payload->>'Fecha de la última publicación',r.source_payload->>'Fecha de publicación del anuncio de licitación',''))))
 then return null;end if;$new$);
 if patched=original then raise exception 'Expected local matching source lock point not found';end if;
 execute patched;
end $$;
