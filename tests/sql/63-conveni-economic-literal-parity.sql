-- Same adversarial corpus as tests/conveni-economic-citation.test.ts. This is
-- literal matching only, never proof of economic attribution or authorization.
do $$
declare quote_ text;
begin
 foreach quote_ in array array['X14000 euros','114000 euros','14000,50 euros','14000%','−14000 euros','+ 14000 euros','14 000 euros','(14000)','1 × 14000 euros','14000 / 2 euros'] loop
  if public.conveni_quote_has_amount_literal(quote_,'14000') then raise exception 'TEST: invalid literal accepted: %',quote_;end if;
 end loop;
 if not public.conveni_quote_has_amount_literal('Aportació de 14000 euros','14000') then raise exception 'TEST: valid literal rejected';end if;
 if public.conveni_quote_has_amount_literal('1.234 euros','1.234') then raise exception 'TEST: ambiguous number accepted';end if;
 if not public.conveni_quote_has_amount_literal('Aportació de 0 euros','0') then raise exception 'TEST: zero rejected';end if;
 if public.conveni_group_literal_cents('14.000,00')<>1400000 or public.conveni_group_literal_cents('4.000,00')<>400000 then raise exception 'TEST: captured amount conversion mismatch';end if;
end $$;
