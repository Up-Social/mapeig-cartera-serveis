-- Contract imports may use a tender budget or estimated contract value when
-- no awarded amount is present. Neither figure proves the awarded funding.
-- This does not change imported rows or previously reviewed provisions.
create function public.contract_imported_award(p_payload jsonb,p_amount numeric)
returns numeric language plpgsql immutable security invoker set search_path=public as $$
declare raw text; parsed numeric;
begin
 if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity')
   or abs(p_amount)>=70368744177664 then return null;end if;
 if jsonb_typeof(p_payload->'Importe de adjudicación') not in ('number','string') then return null;end if;
 raw:=trim(p_payload->>'Importe de adjudicación');
 if length(raw)>32 or raw !~ '^[+-]?([0-9]+([.,][0-9]+)?|[.,][0-9]+)$' then return null;end if;
 parsed:=replace(raw,',','.')::numeric;
 if parsed is distinct from p_amount then return null;end if;
 return p_amount;
end $$;
revoke all on function public.contract_imported_award(jsonb,numeric) from public,anon,authenticated;
grant execute on function public.contract_imported_award(jsonb,numeric) to service_role;

-- Keep the existing review transaction, lineage and other financing types.
-- Abort on unexpected function text rather than replacing an unknown contract.
do $migration$
declare definition text; patched text;
 anchor text:=$old$case when r.financing_type='concert' then coalesce(e.amount,r.amount) else coalesce(r.amount,e.amount) end$old$;
 replacement text:=$new$case when r.financing_type='contractacio' or r.source_dataset='contractacions' then case when r.financing_type='contractacio' and r.source_dataset='contractacions' then public.contract_imported_award(r.source_payload,r.amount) else null end when r.financing_type='concert' then coalesce(e.amount,r.amount) else coalesce(r.amount,e.amount) end$new$;
begin
 definition:=pg_get_functiondef('public.review_analysis(uuid,text,uuid,text[],uuid,text,text)'::regprocedure);
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
  raise exception 'CONTRACT_AWARD_REVIEW_ANCHOR_NOT_UNIQUE';
 end if;
 patched:=replace(definition,anchor,replacement);
 execute patched;
end $migration$;
