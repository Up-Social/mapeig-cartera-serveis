-- Normalize words without merging adjacent words, so prefixes cannot identify a recipient.
create or replace function public.conveni_identity_words(p_text text) returns text
language sql immutable set search_path=pg_catalog as $$
 select trim(regexp_replace(translate(lower(coalesce(p_text,'')), 'àáäâèéëêìíïîòóöôùúüûçñ', 'aaaaeeeeiiiioooouuuucn'), '[^a-z0-9]+', ' ', 'g'))
$$;

create or replace function public.conveni_identity_quote_matches(p_name text,p_nif text,p_quote text) returns boolean
language plpgsql immutable set search_path=pg_catalog as $$
declare name_words text:=public.conveni_identity_words(p_name); pattern text:=''; i integer;
begin
 if name_words='' or coalesce(p_nif,'') !~ '^[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J]$' then return false; end if;
 for i in 1..length(p_nif) loop
  if i>1 then pattern:=pattern||'[[:space:]-]*'; end if;
  pattern:=pattern||substr(p_nif,i,1);
 end loop;
 return position(' '||name_words||' ' in ' '||public.conveni_identity_words(p_quote)||' ')>0
  and upper(coalesce(p_quote,'')) ~ ('(^|[^[:alnum:]])'||pattern||'([^[:alnum:]]|$)');
end $$;

-- The quote must occur on its claimed page, not merely elsewhere in the PDF.
create or replace function public.conveni_citation_on_page(p_text text,p_page integer,p_quote text) returns boolean
language plpgsql immutable set search_path=pg_catalog as $$
declare source text:=replace(coalesce(p_text,''),E'\r\n',E'\n'); header text; start_pos integer; next_pos integer; body text;
begin
 if coalesce(p_page,0)<1 or length(trim(coalesce(p_quote,'')))<12 then return false; end if;
 if source ~ E'(?n)^## Pàgina [0-9]+[[:blank:]]*$' then
  header:=E'(?n)^## Pàgina '||p_page::text||E'[[:blank:]]*\n';
  if regexp_count(source,header)<>1 then return false; end if;
  start_pos:=regexp_instr(source,header,1,1,1);
  next_pos:=regexp_instr(source,E'(?n)^## Pàgina [0-9]+[[:blank:]]*$',start_pos);
  body:=case when next_pos=0 then substr(source,start_pos) else substr(source,start_pos,next_pos-start_pos) end;
 else
  if p_page<>1 then return false; end if;
  body:=source;
 end if;
 return position(regexp_replace(trim(p_quote),'\s+',' ','g') in regexp_replace(body,'\s+',' ','g'))>0;
end $$;

revoke all on function public.conveni_identity_words(text) from public,anon,authenticated;
revoke all on function public.conveni_identity_quote_matches(text,text,text) from public,anon,authenticated;
revoke all on function public.conveni_citation_on_page(text,integer,text) from public,anon,authenticated;
grant execute on function public.conveni_identity_words(text) to service_role;
grant execute on function public.conveni_identity_quote_matches(text,text,text) to service_role;
grant execute on function public.conveni_citation_on_page(text,integer,text) to service_role;

-- An explicitly attested and cited human review may correct an insufficient
-- proposal to outside the portfolio. Economic approval remains unchanged.
do $$
declare original text;patched text;
begin
 original:=pg_get_functiondef('public.review_conveni_unit(uuid,uuid,uuid,uuid,uuid,text,text,text,boolean)'::regprocedure);
 patched:=replace(original,
  $old$if d->>'classification' not in ('in_portfolio','out_of_portfolio') or coalesce(d->>'population','')='' or coalesce(d->>'description','')='' then raise exception 'Servei i població no acreditats';end if;$old$,
  $new$if (p_outcome='select' and d->>'classification' not in ('in_portfolio','out_of_portfolio'))
    or (p_outcome='outside' and d->>'classification' not in ('in_portfolio','out_of_portfolio','insufficient_evidence'))
    or coalesce(d->>'population','')='' or coalesce(d->>'description','')=''
    or coalesce(jsonb_array_length(d->'concepts'),0)>0
   then raise exception 'Servei i població no acreditats o conceptes pendents';end if;$new$);
 if patched=original then raise exception 'Expected semantic review guard not found';end if;
 original:=patched;
 patched:=replace(original,
  $old$select data into strict d from conveni_unit_proposals where job_id=p_job and unit_id=u.id;$old$,
  $new$select data into strict d from conveni_unit_proposals where job_id=p_job and unit_id=u.id;
 -- Lock the currently known sources, then compare the complete current set to
 -- the snapshot. The source record is already locked FOR UPDATE above.
 if p_outcome in ('select','outside') then
  perform 1 from source_documents sd where sd.source_record_id=r.id order by sd.id for share;
  if jsonb_typeof(a.document_revisions) is distinct from 'object'
   or exists(select 1 from source_documents sd where sd.source_record_id=r.id and sd.document_type in ('agreement','annex')
    and (sd.status<>'fetched' or sd.extraction_partial is not false or sd.storage_sha256 is null or sd.storage_path is null
      or coalesce(sd.quality_flags,'{}') && array['corrupt_text','incomplete_extraction']
      or a.document_revisions->>sd.id::text is distinct from sd.storage_sha256||':'||coalesce(sd.active_extraction_id::text,'')))
   or exists(select 1 from jsonb_each_text(case when jsonb_typeof(a.document_revisions)='object' then a.document_revisions else '{}'::jsonb end) rev
    left join source_documents sd on sd.id::text=rev.key
    where sd.id is null or sd.source_record_id<>r.id or coalesce(sd.document_type,'') not in ('agreement','annex')
      or sd.status<>'fetched' or sd.extraction_partial is not false or sd.storage_sha256 is null or sd.storage_path is null
      or coalesce(sd.quality_flags,'{}') && array['corrupt_text','incomplete_extraction']
      or rev.value is distinct from sd.storage_sha256||':'||coalesce(sd.active_extraction_id::text,''))
  then raise exception 'Cobertura documental canviada';end if;
 end if;
 if p_outcome='select' and (coalesce(d->>'recipient_nif','') !~ '^[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J]$' or public.conveni_identity_words(d->>'recipient')='' or not (
  exists(select 1 from jsonb_array_elements(case when jsonb_typeof(d->'evidence')='array' then d->'evidence' else '[]'::jsonb end) ev
   join source_documents sd on sd.id::text=ev.value->>'document_id' and sd.source_record_id=r.id and sd.document_type in ('agreement','annex')
   where a.document_revisions->>sd.id::text=sd.storage_sha256||':'||coalesce(sd.active_extraction_id::text,'')
    and (ev.value->>'page') ~ '^[1-9][0-9]{0,5}$' and public.conveni_citation_on_page(sd.extracted_text,(ev.value->>'page')::integer,ev.value->>'quote')
    and public.conveni_identity_quote_matches(d->>'recipient',d->>'recipient_nif',ev.value->>'quote'))
  or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(a.payload->'actors')='array' then a.payload->'actors' else '[]'::jsonb end) actor
   cross join lateral jsonb_array_elements(case when jsonb_typeof(actor.value->'evidence')='array' then actor.value->'evidence' else '[]'::jsonb end) ev
   join source_documents sd on sd.id::text=ev.value->>'document_id' and sd.source_record_id=r.id and sd.document_type in ('agreement','annex')
   where actor.value->>'nature'='private' and actor.value->'roles' ? 'recipient'
    and public.conveni_identity_words(actor.value->>'name')=public.conveni_identity_words(d->>'recipient')
    and regexp_replace(upper(coalesce(actor.value->>'nif','')),'[[:space:]-]','','g')=d->>'recipient_nif'
    and a.document_revisions->>sd.id::text=sd.storage_sha256||':'||coalesce(sd.active_extraction_id::text,'')
    and (ev.value->>'page') ~ '^[1-9][0-9]{0,5}$' and public.conveni_citation_on_page(sd.extracted_text,(ev.value->>'page')::integer,ev.value->>'quote')
    and public.conveni_identity_quote_matches(d->>'recipient',d->>'recipient_nif',ev.value->>'quote'))
 )) then raise exception 'Cal una cita que contingui nom i NIF del receptor; la seva atribució requereix comprovació humana';end if;
 if coalesce(jsonb_array_length(d->'concepts'),0)>0 and p_outcome<>'insufficient' then raise exception 'Els conceptes agrupats requereixen una revisió individual abans d’una decisió final';end if;
 if p_outcome='outside' and (not coalesce((a.payload->>'coverage_complete')::boolean,false) or coalesce(d->'blockers','[]'::jsonb) ? 'incomplete') then raise exception 'Cal completar la cobertura documental abans de decidir fora de cartera';end if;
 if p_outcome='outside' and exists(select 1 from jsonb_each_text(a.document_revisions) rev left join source_documents current_doc on current_doc.id::text=rev.key where current_doc.id is null or current_doc.status<>'fetched' or coalesce(current_doc.extraction_partial,true) or rev.value is distinct from current_doc.storage_sha256||':'||coalesce(current_doc.active_extraction_id::text,'')) then raise exception 'Cobertura documental canviada';end if;$new$);
 if patched=original then raise exception 'Expected concept and coverage guards not found';end if;
 execute patched;
end $$;
