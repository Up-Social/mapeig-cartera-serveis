-- A record-level description cannot establish the population of every Concert
-- line. Preserve existing decisions and the record-level description; this
-- affects only newly inserted unit provisions. Per-line evidence remains a
-- separate, unresolved contract.
do $$
declare
 original text;
 patched text;
 anchor constant text := 'base.contracting_body,base.target_population,base.source_reference';
 replacement constant text := 'base.contracting_body,case when r.financing_type=''concert'' then null else base.target_population end,base.source_reference';
begin
 original := pg_get_functiondef('public.review_record_unit(uuid,uuid,boolean,text)'::regprocedure);
 if (length(original) - length(replace(original, anchor, ''))) / length(anchor) <> 1 then
  raise exception 'CONCERT_POPULATION_INSERT_ANCHOR_NOT_UNIQUE';
 end if;
 patched := replace(original, anchor, replacement);
 execute patched;
end $$;
