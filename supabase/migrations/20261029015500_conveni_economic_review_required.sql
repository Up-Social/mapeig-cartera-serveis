-- Temporary fail-closed guard: arithmetic balance and the social confirmation
-- do not establish that public funds are attributable to this recipient and
-- period. Keep other outcomes available. This guard must only be replaced by
-- an independently verified, versioned economic review contract.
do $$
declare original text;patched text;
begin
 original:=pg_get_functiondef('public.review_conveni_unit(uuid,uuid,uuid,uuid,uuid,text,text,text,boolean)'::regprocedure);
 patched:=replace(original,
  $old$chosen_classification:=case p_outcome when 'select' then 'in_portfolio'$old$,
  $new$if p_outcome='select' then
  raise exception 'Aprovació temporalment desactivada: cal una revisió documental de l’atribució econòmica al receptor i període.';
 end if;
 chosen_classification:=case p_outcome when 'select' then 'in_portfolio'$new$);
 if patched=original then raise exception 'Expected conveni decision point not found';end if;
 execute patched;
end $$;
