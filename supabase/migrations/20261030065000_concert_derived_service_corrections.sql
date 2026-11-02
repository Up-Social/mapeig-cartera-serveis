-- Corrections must go through the existing locked, validated CAS function.
-- Existing rows and SELECT access remain intact. The owner is the trusted
-- migration owner, and the already restricted function grant remains unchanged.
revoke insert on public.documented_corrections from service_role;
-- Fully qualify application objects in both the definer and its helper; an
-- untrusted CREATE privilege on public must not influence name resolution.
do $$
declare sig text;name text;definition text;
begin
 foreach sig in array array['public.assert_human_resolution(uuid,uuid)','public.save_documented_correction(uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,integer,text,boolean,text,text)'] loop
  definition:=pg_get_functiondef(sig::regprocedure);
  foreach name in array array['assert_human_resolution','source_documents','source_records','record_units','pipeline_jobs','worker_tasks','documented_corrections','current_documented_corrections','official_services','catalog_versions','eligible_official_services','service_provisions','record_enrichments'] loop
   definition:=regexp_replace(definition,'(^|[^[:alnum:]_.])'||name||'([^[:alnum:]_]|$)',E'\\1public.'||name||E'\\2','g');
  end loop;
  execute definition;
 end loop;
end $$;
alter function public.assert_human_resolution(uuid,uuid) set search_path=pg_catalog;
alter function public.save_documented_correction(uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,integer,text,boolean,text,text) set search_path=pg_catalog;
alter function public.save_documented_correction(uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,integer,text,boolean,text,text) security definer;

-- Keep the identity of the reviewed correction with the immutable decision.
-- Historical decisions remain untouched; NULL means no identity was recorded.
alter table public.concert_line_award_decisions add column service_correction_id uuid references public.documented_corrections(id);

do $$
declare original text;patched text;
 signature constant text:='public.concert_line_award_decide(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb,uuid,text,uuid,text,uuid)';
 old_code constant text:='p_code is distinct from coalesce(u.service_code,u.observed_service_code)';
 new_code constant text:=$s$p_code is distinct from coalesce((select c.value from public.current_documented_corrections c where c.unit_id=u.id and c.source_record_id=r.id and c.field='service_code' and c.valid and c.document_id=u.document_id and (c.visual_check or public.concert_population_on_page(d.extracted_text,c.page,c.evidence))),u.service_code,u.observed_service_code)$s$;
 old_quote constant text:='position(p_code in p_quote)=0';
 new_quote constant text:=$s$(position(p_code in p_quote)=0 and not exists(select 1 from public.current_documented_corrections c where c.unit_id=u.id and c.source_record_id=r.id and c.field='service_code' and c.valid and c.document_id=u.document_id and (c.visual_check or public.concert_population_on_page(d.extracted_text,c.page,c.evidence)) and c.value=p_code))$s$;
 old_cols constant text:='unit_fingerprint,document_fingerprint,amount,service_code,source_object_id';
 new_cols constant text:='unit_fingerprint,document_fingerprint,amount,service_code,service_correction_id,source_object_id';
 old_vals constant text:='public.concert_population_document_hash(d),u.amount,p_code,src.id';
 new_vals constant text:=$s$public.concert_population_document_hash(d),u.amount,p_code,(select c.id from public.current_documented_corrections c where c.unit_id=u.id and c.source_record_id=r.id and c.field='service_code' and c.valid and c.document_id=u.document_id and (c.visual_check or public.concert_population_on_page(d.extracted_text,c.page,c.evidence)) and c.value=p_code),src.id$s$;
 guard constant text:=$s$
 if exists(select 1 from public.documented_corrections c where c.unit_id=u.id and c.source_record_id is distinct from r.id) then raise exception 'LINE_CORRECTION_SCOPE';end if;
 if u.service_code is not null and u.service_code is distinct from p_code then raise exception 'LINE_PREPARED_CODE_CONFLICT';end if;
$s$;
 guard_anchor constant text:=' select * into strict u from public.record_units where id=p_unit and source_record_id=r.id for update;';
begin
 original:=pg_get_functiondef(signature::regprocedure);patched:=original;
 if (length(original)-length(replace(original,old_code,'')))/length(old_code)<>1
 or (length(original)-length(replace(original,old_quote,'')))/length(old_quote)<>1
 or (length(original)-length(replace(original,old_cols,'')))/length(old_cols)<>1
 or (length(original)-length(replace(original,old_vals,'')))/length(old_vals)<>1
 or (length(original)-length(replace(original,guard_anchor,'')))/length(guard_anchor)<>1 then raise exception 'DERIVED_LINE_WRITER_ANCHOR';end if;
 patched:=replace(patched,old_code,new_code);patched:=replace(patched,old_quote,new_quote);
 patched:=replace(patched,old_cols,new_cols);patched:=replace(patched,old_vals,new_vals);
 patched:=replace(patched,guard_anchor,guard_anchor||guard);
 execute patched;
end $$;

-- A derived code must remain linked to the exact current correction. Legacy
-- decisions without a correction id retain their original projection rules.
do $$
declare original text;patched text;
 anchor constant text:='x.service_code = COALESCE(u.service_code, u.observed_service_code)';
 replacement constant text:=$s$(x.service_code = COALESCE((select c.value from public.current_documented_corrections c where c.unit_id=u.id and c.source_record_id=x.source_record_id and c.field='service_code' and c.valid and c.document_id=u.document_id and (c.visual_check or public.concert_population_on_page(d.extracted_text,c.page,c.evidence))),u.service_code,u.observed_service_code) and (u.service_code is null or u.service_code=x.service_code) and not exists(select 1 from public.documented_corrections bad where bad.unit_id=u.id and bad.source_record_id is distinct from x.source_record_id) and (x.service_correction_id is null or exists(select 1 from public.current_documented_corrections c where c.id=x.service_correction_id and c.unit_id=u.id and c.source_record_id=x.source_record_id and c.document_id=u.document_id and c.field='service_code' and c.valid and (c.visual_check or public.concert_population_on_page(d.extracted_text,c.page,c.evidence)) and c.value=x.service_code)))$s$;
begin
 original:=pg_get_viewdef('public.concert_line_financing_projection'::regclass,true);
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'DERIVED_PROJECTION_ANCHOR: %',original;end if;
 patched:=replace(original,anchor,replacement);
 execute 'create or replace view public.concert_line_financing_projection as '||patched;
end $$;

-- Carry the correction identity into new export receipts; previously committed
-- snapshots are immutable and retain their original shape.
do $$
declare sig text;original text;patched text;
 anchor constant text:=$s$jsonb_build_object('target_population',v.target_population)$s$;
 replacement constant text:=$s$jsonb_build_object('target_population',v.target_population,'service_correction_id',x.service_correction_id)$s$;
begin
 foreach sig in array array['public.concert_line_export_snapshot(uuid[])','public.concert_line_export_commit(uuid,text,jsonb)'] loop
  original:=pg_get_functiondef(sig::regprocedure);
  if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'DERIVED_EXPORT_ANCHOR %',sig;end if;
  patched:=replace(original,anchor,replacement);execute patched;
 end loop;
end $$;
do $$
declare original text;patched text;
 anchor constant text:=$s$jsonb_build_object('service_name',coalesce(o.service_name,p.service_code)$s$;
 replacement constant text:=$s$jsonb_build_object('service_correction_id',(select x.service_correction_id from public.concert_line_award_decisions x where x.provision_id=p.id),'service_name',coalesce(o.service_name,p.service_code)$s$;
begin
 original:=pg_get_functiondef('public.concert_line_mixed_snapshot(uuid[],boolean)'::regprocedure);
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'DERIVED_MIXED_EXPORT_ANCHOR';end if;
 patched:=replace(original,anchor,replacement);execute patched;
end $$;

-- Old data inserted outside the validated RPC may link a correction to a
-- different record. Preserve it, but never approve a new Concert line from it.
do $$
declare original text;patched text;
 anchor constant text := ' if r.financing_type=''concert'' and exists(select 1 from documented_corrections where unit_id=u.id and field=''service_code'') then';
 guard constant text := $s$
 if r.financing_type='concert' and exists(select 1 from documented_corrections c where c.unit_id=u.id and c.source_record_id is distinct from r.id) then
  raise exception 'La correcció documental pertany a un altre expedient; cal revisar la línia';
 end if;
$s$;
begin
 original:=pg_get_functiondef('public.review_record_unit(uuid,uuid,boolean,text)'::regprocedure);
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'DERIVED_LEGACY_SCOPE_ANCHOR';end if;
 patched:=replace(original,anchor,guard||anchor);execute patched;
end $$;
