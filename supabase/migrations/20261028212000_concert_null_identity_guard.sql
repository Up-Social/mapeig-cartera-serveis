-- Preserve an unresolved identity as a draft without treating SQL NULL as an
-- equal NIF on a retry. Approval still requires an identified provider.
do $$ declare original text;patched text;begin
 original:=pg_get_functiondef('public.cloud_stage_concert_annex_line(uuid,uuid,bigint,uuid,uuid,jsonb)'::regprocedure);
 patched:=replace(original,
  $old$or p_line->>'nif' !~ '^[A-Z][0-9]{7}[0-9A-Z]$'$old$,
  $new$or (p_line->>'nif' is not null and p_line->>'nif' !~ '^[A-Z][0-9]{7}[0-9A-Z]$')$new$);
 patched:=replace(patched,
  $old$existing.provider_nif<>p_line->>'nif'$old$,
  $new$existing.provider_nif is distinct from p_line->>'nif'$new$);
 if patched=original or position('existing.provider_nif is distinct from' in patched)=0 or position('p_line->>''nif'' is not null' in patched)=0 then raise exception 'Expected concert identity guards not found';end if;
 execute patched;
end $$;
