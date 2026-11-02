-- Prevent new proposals from using missing catalog fit as a scope exclusion.
-- Existing analyses and exact historical persistence replays remain unchanged.
create function public.conveni_catalog_discard_conflict(p_unit jsonb) returns boolean
language sql immutable security invoker set search_path=pg_catalog as $$
 select coalesce(p_unit->>'classification'='discarded' and lower(btrim(p_unit->>'reason',
  chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||
  chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||
  chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279)))='service_not_in_catalog',false)
$$;
revoke all on function public.conveni_catalog_discard_conflict(jsonb) from public,anon,authenticated;
grant execute on function public.conveni_catalog_discard_conflict(jsonb) to service_role;

do $$
declare original text;patched text;
begin
 original:=pg_get_functiondef('public.persist_conveni(uuid,text,jsonb,jsonb,text)'::regprocedure);
 patched:=replace(original,
  $old$for doc in select * from source_documents where source_record_id=r.id and document_type in ('agreement','annex') loop$old$,
  $new$-- The TypeScript contract admits at most 500 original concepts. Grouping
 -- creates one level of children only; reject malformed or nested payloads.
 if jsonb_array_length(p_payload->'units')>500
  or exists(select 1 from jsonb_array_elements(p_payload->'units') u
   where jsonb_typeof(u.value) is distinct from 'object'
    or (u.value ? 'concepts' and u.value->'concepts'<>'null'::jsonb and jsonb_typeof(u.value->'concepts') is distinct from 'array'))
  or (select sum(case when jsonb_typeof(u.value->'concepts')='array' and jsonb_array_length(case when jsonb_typeof(u.value->'concepts')='array' then u.value->'concepts' else '[]'::jsonb end)>0
      then jsonb_array_length(u.value->'concepts') else 1 end) from jsonb_array_elements(p_payload->'units') u)>500
  or exists(select 1 from jsonb_array_elements(p_payload->'units') u
      cross join lateral jsonb_array_elements(case when jsonb_typeof(u.value->'concepts')='array' then u.value->'concepts' else '[]'::jsonb end) child
      where jsonb_typeof(child.value) is distinct from 'object' or (child.value ? 'concepts' and child.value->'concepts'<>'null'::jsonb))
 then raise exception 'Estructura de conceptes invàlida';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'units') u where public.conveni_catalog_discard_conflict(u.value)
    or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(u.value->'concepts')='array' then u.value->'concepts' else '[]'::jsonb end) child where public.conveni_catalog_discard_conflict(child.value)))
 then raise exception using errcode='P0001',message='La manca d’encaix en la cartera no justifica per si sola un descart. Cal revisar la naturalesa social i el motiu documentat.',detail='CONVENI_DISCARD_REASON_CONFLICT';end if;
 for doc in select * from source_documents where source_record_id=r.id and document_type in ('agreement','annex') loop$new$);
 if patched=original then raise exception 'Expected conveni persistence guard point not found';end if;
 execute patched;
end $$;
