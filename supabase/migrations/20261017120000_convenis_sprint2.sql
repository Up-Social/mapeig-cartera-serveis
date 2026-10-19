-- Additive Sprint 2 schema. No historical rows are reimported or reprocessed here.
create table public.conveni_analyses (
 job_id uuid primary key references public.pipeline_jobs(id),
 source_record_id uuid not null references public.source_records(id),
 version text not null default 'convenis-sprint2-v1',
 source_hash text not null, catalog_version_id text references public.catalog_versions(id),
 payload jsonb not null, document_revisions jsonb not null default '{}',
 exclusion_reason text, automatic boolean not null default false,
 created_at timestamptz not null default now()
);
create table public.conveni_unit_proposals (
 job_id uuid not null references public.conveni_analyses(job_id),
 unit_id uuid not null references public.record_units(id),
 data jsonb not null, primary key(job_id,unit_id)
);
create table public.conveni_review_events (
 id uuid primary key, source_record_id uuid not null references public.source_records(id),
 job_id uuid not null references public.conveni_analyses(job_id),
 unit_id uuid references public.record_units(id),
 outcome text not null check(outcome in ('select','reject','outside','insufficient','reopen')),
 service_code text, reason text not null, actor text not null,
 snapshot jsonb not null, created_at timestamptz not null default clock_timestamp()
);
create index conveni_review_unit_idx on public.conveni_review_events(unit_id,created_at desc,id desc);
create table public.conveni_scope_overrides (
 source_record_id uuid primary key references public.source_records(id),source_hash text not null,
 reason text not null,created_at timestamptz not null default now()
);
create table public.conveni_amount_operations (
 id uuid primary key, source_record_id uuid not null references public.source_records(id),
 source_hash text not null, before_amount numeric, after_amount numeric, reverted_at timestamptz,
 created_at timestamptz not null default now()
);
-- Verified directory entries are deliberately separate from codes observed in Excel.
create table public.conveni_territories (
 aoc_code text primary key, name text not null, level text not null check(level in ('municipality','county','province','other')),
 evidence_url text not null check(evidence_url ~ '^https://'),verified_at timestamptz not null
);
do $$ declare t text;begin
 foreach t in array array['conveni_analyses','conveni_unit_proposals','conveni_review_events','conveni_scope_overrides','conveni_amount_operations','conveni_territories'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('grant select,insert,update on public.%I to service_role',t);
 end loop;
end $$;

create function public.conveni_public_amount(p_payload jsonb) returns numeric
language plpgsql immutable set search_path=public as $$
declare a text:=p_payload->>'Total aportacions previstes Generalitat';b text:=p_payload->>'Total aportacions previstes ens locals';values_ text[];v text;i integer;begin
 values_:=array[a,b];
 for i in 1..2 loop
  v:=regexp_replace(values_[i],'[[:space:]€]','','g');
  if position(',' in v)>0 then
   if v !~ '^(?:[0-9]{1,3}(?:\.[0-9]{3})*|[0-9]+),[0-9]{1,2}$' then return null;end if;
   v:=replace(replace(v,'.',''),',','.');
  end if;
  if v is null or v !~ '^[0-9]+(?:\.[0-9]{1,2})?$' or v::numeric*100>9007199254740991 then return null;end if;
  values_[i]:=v;
 end loop;
 if (values_[1]::numeric+values_[2]::numeric)*100>9007199254740991 then return null;end if;
 return values_[1]::numeric+values_[2]::numeric;
end $$;
create function public.conveni_source_hash(p_record uuid) returns text
language sql stable set search_path=public as $$ select md5(title||source_payload::text) from source_records where id=p_record $$;
create function public.conveni_scope_reason(p_title text,p_payload jsonb) returns text
language plpgsql immutable set search_path=public as $$
declare t text:=trim(regexp_replace(translate(lower(coalesce(p_title,'')), 'àáäâèéëêìíïîòóöôùúüûçñ', 'aaaaeeeeiiiioooouuuucn'),'[^a-z0-9]+',' ','g'));begin
 if t ~ '^(?:(?:primera|segona|tercera|quarta|cinquena|sisena|setena|vuitena|novena|desena|[0-9]+(?:a|na|n|r)?) )?(?:addenda|adenda|prorroga|modificacio)\y' or t ~ '^conveni (?:de )?(?:prorroga|modificacio)\y' or t ~ '^adhesio a la (?:(?:primera|segona|tercera) )?addenda\y' then return 'excluded_amendment';end if;
 if t ~ '^(?:[ivxlcdm]+ )?conveni (?:marc )?(?:(?:de )?col laboracio )?interadministratiu\y' or t ~ '^(?:[ivxlcdm]+ )?conveni (?:marc )?de (?:col laboracio(?: i cooperacio)?|cooperacio) interadministrativa\y' then return 'interadministrative_agreement';end if;
 if conveni_public_amount(p_payload)=0 then return 'no_public_funding';end if;
 return null;
end $$;
create function public.screen_conveni(p_job uuid) returns boolean
language plpgsql security invoker set search_path=public as $$
declare j pipeline_jobs;r source_records;why text;v text;auto boolean;ev jsonb;explanation text;
begin
 select * into strict j from pipeline_jobs where id=p_job;
 select * into strict r from source_records where id=j.source_record_id for update;
 if r.financing_type<>'conveni' then return false;end if;
 if j.id is distinct from (select id from pipeline_jobs where source_record_id=r.id and not verification_only order by created_at desc,id desc limit 1) then raise exception 'Revisió obsoleta' using errcode='40001';end if;
 if exists(select 1 from conveni_analyses where job_id=j.id) then return true;end if;
 why:=conveni_scope_reason(r.title,r.source_payload);
 if why is null or exists(select 1 from conveni_scope_overrides where source_record_id=r.id and source_hash=conveni_source_hash(r.id)) then return false;end if;
 select id into strict v from catalog_versions where active and validated;
 auto:=not exists(select 1 from review_decisions where source_record_id=r.id and reviewer<>'system:convenis-sprint2-v1')
  and not exists(select 1 from service_provisions where source_record_id=r.id and superseded_at is null);
 explanation:=case why when 'excluded_amendment' then 'Fora de l’abast del Sprint 2: addenda, pròrroga o modificació. No implica que no sigui un servei social.' when 'interadministrative_agreement' then 'El títol identifica inequívocament un conveni interadministratiu.' else 'La suma de les aportacions previstes de Generalitat i ens locals és zero. No s’infereix la direcció del flux.' end;
 ev:=jsonb_build_array(jsonb_build_object('kind','source_row','content',explanation,'title',r.title,'file',r.source_file,'sheet',r.source_sheet,'row',r.source_row,'payload',r.source_payload));
 insert into conveni_analyses(job_id,source_record_id,source_hash,catalog_version_id,payload,exclusion_reason,automatic)
 values(j.id,r.id,conveni_source_hash(r.id),v,jsonb_build_object('summary',explanation,'units','[]'::jsonb,'actors','[]'::jsonb),why,auto);
 insert into analysis_results(pipeline_job_id,source_record_id,catalog_version_id,rules_version,classification,reasons,explanation,service_description,target_population,evidence,rule_audit,reviewed_classification,reviewed_reasons,reviewed_at)
 values(j.id,r.id,v,'convenis-sprint2-v1','discarded',jsonb_build_array(why),explanation,'','',ev,jsonb_build_object('version','convenis-sprint2-v1','actor',case when auto then 'system' else 'proposal' end,'rule',why),case when auto then 'discarded' end,case when auto then array[why] else '{}' end,case when auto then now() end);
 if auto then
 insert into review_decisions(source_record_id,pipeline_job_id,classification,reasons,decision,reason,reviewer)
 values(r.id,j.id,'discarded',array[why],'rejected',explanation,'system:convenis-sprint2-v1');
 end if;
 update pipeline_jobs set status=case when auto then 'rejected' else 'needs_review' end,completed_at=now() where id=j.id;
 update source_records set processing_status=(case when auto then 'rebutjat' else 'revisio' end)::processing_status,updated_at=now() where id=r.id;
 perform refresh_pipeline_run(j.run_id);
 return true;
end $$;

create function public.persist_conveni(p_job uuid,p_version text,p_payload jsonb,p_revisions jsonb,p_source_hash text) returns void
language plpgsql security invoker set search_path=public as $$
declare j pipeline_jobs;r source_records;item jsonb;uid uuid;doc source_documents;citation jsonb;
begin
 select * into strict j from pipeline_jobs where id=p_job;
 select * into strict r from source_records where id=j.source_record_id for update;
 if r.financing_type<>'conveni' or p_source_hash is distinct from conveni_source_hash(r.id) or j.id is distinct from (select id from pipeline_jobs where source_record_id=r.id and not verification_only order by created_at desc,id desc limit 1) then raise exception 'Anàlisi obsoleta' using errcode='40001';end if;
 if exists(select 1 from conveni_analyses where job_id=j.id) then
  if exists(select 1 from conveni_analyses where job_id=j.id and payload=p_payload and document_revisions=p_revisions) then return;end if;
  raise exception 'Anàlisi ja desada amb altres valors';end if;
 if exists(select 1 from review_decisions where pipeline_job_id=j.id) then raise exception 'El treball ja té una decisió humana; inicia una nova anàlisi' using errcode='40001';end if;
 if not exists(select 1 from catalog_versions where id=p_version and active and validated) or coalesce(jsonb_typeof(p_payload->'units'),'')<>'array' or coalesce(jsonb_array_length(p_payload->'units'),0)<1 then raise exception 'Anàlisi incompleta';end if;
 for doc in select * from source_documents where source_record_id=r.id and document_type in ('agreement','annex') loop
  if doc.status<>'fetched' or doc.extraction_partial or doc.storage_sha256 is null or doc.storage_path is null or (coalesce(doc.quality_flags,'{}') && array['corrupt_text','incomplete_extraction']) or p_revisions->>doc.id::text is distinct from doc.storage_sha256||':'||coalesce(doc.active_extraction_id::text,'') then raise exception 'Cobertura documental incompleta o canviada';end if;
 end loop;
 insert into conveni_analyses(job_id,source_record_id,source_hash,catalog_version_id,payload,document_revisions) values(j.id,r.id,p_source_hash,p_version,p_payload,p_revisions);
 for item in select value from jsonb_array_elements(p_payload->'units') loop
  if coalesce(item->>'key','')='' or jsonb_array_length(item->'evidence')<1 or (item->>'amount_cents')::numeric<0 then raise exception 'Unitat invàlida';end if;
  for citation in select value from jsonb_array_elements(item->'evidence') loop
   select * into strict doc from source_documents where id=(citation->>'document_id')::uuid and source_record_id=r.id and status='fetched';
   if length(citation->>'quote')<12 or position(regexp_replace(citation->>'quote','\s+',' ','g') in regexp_replace(doc.extracted_text,'\s+',' ','g'))=0 then raise exception 'Cita no verificable';end if;
  end loop;
  citation:=item->'evidence'->0;
  insert into record_units(source_record_id,pipeline_job_id,unit_key,provider_name,provider_nif,period,amount,document_id,page,evidence_quote,act_type)
  values(r.id,j.id,'conveni:'||(item->>'key'),item->>'recipient',item->>'recipient_nif',item->>'period',(item->>'amount_cents')::numeric/100,(citation->>'document_id')::uuid,(citation->>'page')::integer,citation->>'quote','award')
  on conflict(source_record_id,unit_key) do nothing;
  select id into strict uid from record_units where source_record_id=r.id and unit_key='conveni:'||(item->>'key');
  insert into conveni_unit_proposals(job_id,unit_id,data) values(j.id,uid,item);
 end loop;
 insert into analysis_results(pipeline_job_id,source_record_id,catalog_version_id,rules_version,classification,reasons,explanation,service_description,target_population,evidence,rule_audit)
 values(j.id,r.id,p_version,'convenis-sprint2-v1','insufficient_evidence','[]',p_payload->>'summary','','',(select jsonb_agg(e||jsonb_build_object('content',e->>'quote','source_document_id',e->>'document_id')) from jsonb_array_elements(p_payload->'units'->0->'evidence') e),jsonb_build_object('version','convenis-sprint2-v1','rule','review_by_recipient'));
 update source_records set enrichment_status='completed',enrichment_error=null,processing_status='revisio',updated_at=now() where id=r.id;
 update pipeline_jobs set status='needs_review',completed_at=now() where id=j.id;
 perform refresh_pipeline_run(j.run_id);
end $$;

create function public.review_conveni_unit(p_record uuid,p_job uuid,p_unit uuid,p_event uuid,p_previous uuid,p_outcome text,p_code text,p_note text) returns void
language plpgsql security invoker set search_path=public,storage as $$
declare r source_records;a conveni_analyses;u record_units;d jsonb;citation jsonb;doc source_documents;s official_services;rid uuid;chosen_classification text;latest uuid;total numeric;parts numeric;
begin
 select * into strict r from source_records where id=p_record for update;
 select * into strict a from conveni_analyses where job_id=p_job and source_record_id=r.id;
 if exists(select 1 from conveni_review_events where id=p_event and source_record_id=r.id and job_id=p_job and unit_id=p_unit and outcome=p_outcome and service_code is not distinct from p_code and reason=p_note) then return;end if;
 if p_job is distinct from (select id from pipeline_jobs where source_record_id=r.id and not verification_only order by created_at desc,id desc limit 1) or a.source_hash is distinct from conveni_source_hash(r.id) then raise exception 'Revisió obsoleta' using errcode='40001';end if;
 if p_outcome not in ('select','reject','outside','insufficient') or length(trim(coalesce(p_note,'')))<10 then raise exception 'Cal justificar la decisió';end if;
 select * into strict u from record_units where id=p_unit and source_record_id=r.id for update;
 select id into latest from conveni_review_events where unit_id=u.id order by created_at desc,id desc limit 1;
 if latest is distinct from p_previous then raise exception 'Revisió concurrent' using errcode='40001';end if;
 select data into strict d from conveni_unit_proposals where job_id=p_job and unit_id=u.id;
 if p_outcome in ('select','outside') then
  if d->>'classification' not in ('in_portfolio','out_of_portfolio') or coalesce(d->>'population','')='' or coalesce(d->>'description','')='' then raise exception 'Servei i població no acreditats';end if;
  for citation in select value from jsonb_array_elements(d->'evidence') loop
   select * into strict doc from source_documents where id=(citation->>'document_id')::uuid and source_record_id=r.id;
   if doc.status<>'fetched' or doc.extraction_partial or a.document_revisions->>doc.id::text is distinct from doc.storage_sha256||':'||coalesce(doc.active_extraction_id::text,'') or position(regexp_replace(citation->>'quote','\s+',' ','g') in regexp_replace(doc.extracted_text,'\s+',' ','g'))=0 then raise exception 'Evidència canviada';end if;
  end loop;
 end if;
 if p_outcome='select' then
  if exists(select 1 from jsonb_each_text(a.document_revisions) rev left join source_documents d on d.id::text=rev.key where d.id is null or d.status<>'fetched' or d.extraction_partial or rev.value is distinct from d.storage_sha256||':'||coalesce(d.active_extraction_id::text,'')) then raise exception 'Cobertura documental canviada';end if;
  if coalesce(jsonb_array_length(d->'blockers'),1)>0 or d->>'recipient_nature'<>'private' or (d->>'joint')::boolean or (d->>'mixed')::boolean or d->>'recipient_nif' is null or (d->>'amount_cents')::numeric is null then raise exception 'Import o receptor pendent de resoldre';end if;
  total:=conveni_public_amount(r.source_payload)*100;
  select sum((value->>'amount_cents')::numeric) into parts from jsonb_array_elements(a.payload->'units');
  if total is null or parts+coalesce((a.payload->>'unallocated_cents')::numeric,-1)<>total or not (a.payload->>'coverage_complete')::boolean then raise exception 'Imports no conciliats';end if;
  select os.* into strict s from eligible_official_services os where os.version_id=a.catalog_version_id and os.service_code=p_code;
  if exists(select 1 from record_units other join service_provisions p on p.unit_id=other.id and p.superseded_at is null join conveni_current_units c on c.unit_id=other.id and c.job_id=p_job and c.reviewed_job=p_job and c.outcome='select' where other.source_record_id=r.id and other.id<>u.id and public.normalize_matching_identity(other.provider_name)=public.normalize_matching_identity(d->>'recipient') and p.service_code<>s.service_code) then raise exception 'Un únic servei principal per entitat';end if;
 end if;
 chosen_classification:=case p_outcome when 'select' then 'in_portfolio' when 'reject' then 'discarded' when 'outside' then 'out_of_portfolio' else 'insufficient_evidence' end;
 insert into conveni_review_events(id,source_record_id,job_id,unit_id,outcome,service_code,reason,actor,snapshot)
 values(p_event,r.id,p_job,u.id,p_outcome,p_code,p_note,'local_user',jsonb_build_object('proposal',d,'previous_unit',to_jsonb(u)));
 insert into review_decisions(source_record_id,pipeline_job_id,classification,reasons,decision,reason,reviewer,final_code)
 values(r.id,p_job,chosen_classification,case when p_outcome='reject' then array[coalesce(d->>'reason','manual_scope')] else '{}' end,case when p_outcome='select' then 'approved' when p_outcome='insufficient' then 'insufficient_evidence' else 'rejected' end,p_note,'local_user',s.service_code) returning id into rid;
 -- Supersede the aggregate and the previous revision, never delete historical provisions.
 update service_provisions set superseded_at=coalesce(superseded_at,now()) where source_record_id=r.id and (unit_id=u.id or unit_id in(select id from record_units where source_record_id=r.id and unit_key='legacy'));
 if p_outcome='select' then
  citation:=d->'evidence'->0;
  -- The API archives the new source for this item before calling the atomic review.
  select * into strict doc from source_documents where id=(citation->>'document_id')::uuid and source_record_id=r.id;
  update record_units set document_id=doc.id,storage_sha256=doc.storage_sha256,storage_path='cases/'||r.id||'/items/'||u.id||'/documents/'||doc.id||'/'||split_part(doc.storage_path,'/',5),pipeline_job_id=p_job,provider_name=d->>'recipient',provider_nif=d->>'recipient_nif',period=d->>'period',amount=(d->>'amount_cents')::numeric/100,service_code=s.service_code,catalog_version_id=s.version_id,page=(citation->>'page')::integer,evidence_quote=citation->>'quote',status='approved',review_note=p_note,reviewed_at=now() where id=u.id;
  insert into service_provisions(unit_id,source_record_id,source_id,provider_name,provider_nif,mechanism,award_date,amount,contracting_body,target_population,source_reference,service_code,catalog_version_id,review_decision_id,approved_at,call_url,regulatory_basis_url,period,act_type,annex_reference)
  values(u.id,r.id,r.source_record_id,d->>'recipient',d->>'recipient_nif','Conveni',imported_priority_value('convenis',r.source_payload,'date')::date,(d->>'amount_cents')::numeric/100,(select string_agg(value, '; ') from jsonb_array_elements_text(d->'financiers')),d->>'population','Registre de Convenis de Col·laboració i Cooperació',s.service_code,s.version_id,rid,now(),r.source_payload->>'Document conveni',null,d->>'period','award',(citation->>'document_id')||' · p. '||(citation->>'page'))
  on conflict(unit_id) do update set provider_name=excluded.provider_name,provider_nif=excluded.provider_nif,amount=excluded.amount,service_code=excluded.service_code,catalog_version_id=excluded.catalog_version_id,review_decision_id=excluded.review_decision_id,period=excluded.period,contracting_body=excluded.contracting_body,target_population=excluded.target_population,superseded_at=null,approved_at=now(),updated_at=now();
 else
  update record_units set status=case when p_outcome='insufficient' then 'draft' else 'rejected' end,review_note=p_note,reviewed_at=now() where id=u.id;
 end if;
 -- Keep mixed cases in review until every current unit has a decision for this job.
 if exists(select 1 from conveni_unit_proposals cp where cp.job_id=p_job and not exists(select 1 from (select e.job_id,e.outcome from conveni_review_events e where e.unit_id=cp.unit_id order by e.created_at desc,e.id desc limit 1) latest where latest.job_id=p_job and latest.outcome<>'insufficient')) then
  update pipeline_jobs set status='needs_review' where id=p_job;
  update source_records set processing_status='revisio' where id=r.id;
 else
  update pipeline_jobs set status=case when exists(select 1 from service_provisions p join conveni_current_units c on c.unit_id=p.unit_id where c.source_record_id=r.id and c.job_id=p_job and c.reviewed_job=p_job and c.outcome='select' and p.superseded_at is null) then 'approved' when chosen_classification='insufficient_evidence' then 'insufficient_evidence' else 'rejected' end where id=p_job;
  update source_records set processing_status=case when exists(select 1 from service_provisions p join conveni_current_units c on c.unit_id=p.unit_id where c.source_record_id=r.id and c.job_id=p_job and c.reviewed_job=p_job and c.outcome='select' and p.superseded_at is null) then 'completat'::processing_status when chosen_classification='out_of_portfolio' then 'completat'::processing_status when chosen_classification='insufficient_evidence' then 'sense_evidencia'::processing_status else 'rebutjat'::processing_status end where id=r.id;
 end if;
 update analysis_results set reviewed_classification=case when exists(select 1 from service_provisions p join conveni_current_units c on c.unit_id=p.unit_id where c.source_record_id=r.id and c.job_id=p_job and c.reviewed_job=p_job and c.outcome='select' and p.superseded_at is null) then 'in_portfolio' else chosen_classification end,review_notes='Decisions individuals a les unitats del conveni',reviewed_at=now() where pipeline_job_id=p_job;
 perform refresh_pipeline_run((select run_id from pipeline_jobs where id=p_job));
end $$;

create function public.reopen_conveni(p_record uuid,p_job uuid,p_event uuid,p_note text) returns void
language plpgsql security invoker set search_path=public as $$
declare a conveni_analyses;begin
 perform 1 from source_records where id=p_record for update;
 select * into strict a from conveni_analyses where source_record_id=p_record and job_id=p_job and exclusion_reason is not null;
 if exists(select 1 from conveni_review_events where id=p_event and job_id=p_job and outcome='reopen' and reason=p_note) then return;end if;
 if length(trim(p_note))<10 or p_job is distinct from (select id from pipeline_jobs where source_record_id=p_record and not verification_only order by created_at desc,id desc limit 1) then raise exception 'Reobertura invàlida o obsoleta' using errcode='40001';end if;
 insert into conveni_scope_overrides(source_record_id,source_hash,reason) values(p_record,conveni_source_hash(p_record),p_note) on conflict(source_record_id) do update set source_hash=excluded.source_hash,reason=excluded.reason,created_at=now();
 insert into conveni_review_events(id,source_record_id,job_id,outcome,reason,actor,snapshot) values(p_event,p_record,p_job,'reopen',p_note,'local_user',to_jsonb(a));
 insert into review_decisions(source_record_id,pipeline_job_id,classification,decision,reason,reviewer) values(p_record,p_job,'insufficient_evidence','insufficient_evidence',p_note,'local_user');
 update analysis_results set reviewed_classification='insufficient_evidence',reviewed_reasons='{}',review_notes=p_note,reviewed_at=now() where pipeline_job_id=p_job;
 update pipeline_jobs set status='insufficient_evidence' where id=p_job;
 update source_records set processing_status='sense_evidencia' where id=p_record;
end $$;

-- General record review must not create an aggregate above recipient/year units.
do $$ declare def text;begin
 def:=pg_get_functiondef('public.review_analysis(uuid,text,uuid,text[],uuid,text,text)'::regprocedure);
 def:=regexp_replace(def,'begin',E'begin\n if exists(select 1 from conveni_analyses where source_record_id=p_record and job_id=p_expected_job) then raise exception ''Revisa les unitats del conveni o reobre el descart específic.'';end if;');
 execute def;
end $$;
-- Official IDs preserve independent annual renewals even when content coincides.
create function public.set_conveni_identity() returns trigger language plpgsql set search_path=public as $$ begin
 if new.source_dataset='convenis' then new.deduplication_key:=md5('convenis|'||new.source_record_id);end if;return new;end $$;
create trigger zz_conveni_identity before insert or update on public.source_records for each row execute function public.set_conveni_identity();

create view public.conveni_current_units with (security_invoker=true) as
 select cp.unit_id,cp.job_id,a.source_record_id,cp.data,a.payload,a.exclusion_reason,a.source_hash,a.document_revisions,
 e.id as review_id,e.outcome,e.service_code as reviewed_code,e.reason as review_note,e.job_id as reviewed_job,
 e.created_at as reviewed_at
 from conveni_unit_proposals cp join conveni_analyses a on a.job_id=cp.job_id
 join lateral(select id from pipeline_jobs where source_record_id=a.source_record_id and not verification_only order by created_at desc,id desc limit 1) j on j.id=a.job_id
 left join lateral(select * from conveni_review_events where unit_id=cp.unit_id order by created_at desc,id desc limit 1) e on true;
create view public.conveni_reviewed_provisions with (security_invoker=true) as
 select p.* from service_provisions p
 where (not exists(select 1 from conveni_analyses where source_record_id=p.source_record_id)
  and (p.mechanism<>'Conveni' or exists(select 1 from source_records r where r.id=p.source_record_id and r.processing_status='completat' and (select decision from review_decisions where source_record_id=r.id order by created_at desc,id desc limit 1) in ('approved','corrected'))))
 or exists(select 1 from conveni_current_units c where c.unit_id=p.unit_id and c.reviewed_job=c.job_id and c.outcome='select'
  and c.source_hash=conveni_source_hash(c.source_record_id)
  and not exists(select 1 from jsonb_each_text(c.document_revisions) rev left join source_documents d on d.id::text=rev.key where d.id is null or d.status<>'fetched' or d.extraction_partial or rev.value is distinct from d.storage_sha256||':'||coalesce(d.active_extraction_id::text,'')));
grant select on public.conveni_current_units,public.conveni_reviewed_provisions to service_role;
-- Only service-role server routes/workers may mutate the new workflow.
do $$ declare f record;begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('conveni_public_amount','conveni_source_hash','conveni_scope_reason','screen_conveni','persist_conveni','review_conveni_unit','reopen_conveni','set_conveni_identity') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;

create view public.conveni_amount_preview with (security_invoker=true) as
 select r.id,r.source_record_id,r.amount as before_amount,conveni_public_amount(r.source_payload) as after_amount,
 conveni_source_hash(r.id) as source_hash,r.processing_status,
 exists(select 1 from review_decisions where source_record_id=r.id and reviewer<>'system:convenis-sprint2-v1') as has_human_review,
 exists(select 1 from service_provisions where source_record_id=r.id and superseded_at is null) as has_active_provision
 from source_records r where r.financing_type='conveni';
grant select on public.conveni_amount_preview to service_role;
create function public.migrate_conveni_amount(p_record uuid,p_operation uuid,p_hash text,p_before numeric) returns void
language plpgsql security invoker set search_path=public as $$
declare r source_records;new_amount numeric;begin
 select * into strict r from source_records where id=p_record and financing_type='conveni' for update;
 if exists(select 1 from conveni_amount_operations where id=p_operation and source_record_id=r.id and source_hash=p_hash and before_amount is not distinct from p_before and reverted_at is null) then return;end if;
 if conveni_source_hash(r.id) is distinct from p_hash or r.amount is distinct from p_before then raise exception 'Simulació obsoleta' using errcode='40001';end if;
 if exists(select 1 from review_decisions where source_record_id=r.id and reviewer<>'system:convenis-sprint2-v1') or exists(select 1 from service_provisions where source_record_id=r.id and superseded_at is null) then raise exception 'El resultat revisat requereix revisió humana específica';end if;
 new_amount:=conveni_public_amount(r.source_payload);if new_amount is null then raise exception 'Aportacions d’origen incompletes';end if;
 insert into conveni_amount_operations(id,source_record_id,source_hash,before_amount,after_amount) values(p_operation,r.id,p_hash,r.amount,new_amount);
 update source_records set amount=new_amount where id=r.id;
end $$;
create function public.revert_conveni_amount(p_operation uuid) returns void
language plpgsql security invoker set search_path=public as $$
declare op conveni_amount_operations;r source_records;begin
 select * into strict op from conveni_amount_operations where id=p_operation for update;
 if op.reverted_at is not null then return;end if;
 select * into strict r from source_records where id=op.source_record_id for update;
 if r.amount is distinct from op.after_amount or conveni_source_hash(r.id) is distinct from op.source_hash or exists(select 1 from review_decisions where source_record_id=r.id and created_at>=op.created_at) or exists(select 1 from conveni_amount_operations where source_record_id=r.id and created_at>op.created_at and reverted_at is null) then raise exception 'El registre té canvis posteriors';end if;
 update source_records set amount=op.before_amount where id=r.id;
 update conveni_amount_operations set reverted_at=clock_timestamp() where id=op.id;
end $$;
revoke all on function public.migrate_conveni_amount(uuid,uuid,text,numeric),public.revert_conveni_amount(uuid) from public,anon,authenticated;
grant execute on function public.migrate_conveni_amount(uuid,uuid,text,numeric),public.revert_conveni_amount(uuid) to service_role;
-- Old unit APIs cannot bypass recipient-level review.
do $$ declare name text;signature text;def text;begin
 foreach signature in array array['public.review_record_unit(uuid,uuid,boolean,text)','public.save_record_unit(uuid,uuid,jsonb)'] loop
 def:=pg_get_functiondef(signature::regprocedure);
 if signature like '%review_record_unit%' then
  def:=regexp_replace(def,'begin',E'begin\n if exists(select 1 from conveni_unit_proposals where unit_id=p_unit) then raise exception ''Utilitza la revisió específica de convenis.'';end if;');
 else
  def:=regexp_replace(def,'begin',E'begin\n if exists(select 1 from conveni_analyses where source_record_id=p_record) then raise exception ''Utilitza les unitats del conveni.'';end if;');
 end if;
 execute def;
 end loop;
end $$;

-- A deterministic proposal never overwrites a prior human result without this explicit review.
create function public.confirm_conveni_exclusion(p_record uuid,p_job uuid,p_event uuid,p_previous uuid,p_note text) returns void
language plpgsql security invoker set search_path=public as $$
declare a conveni_analyses;latest uuid;begin
 perform 1 from source_records where id=p_record for update;
 select * into strict a from conveni_analyses where source_record_id=p_record and job_id=p_job and exclusion_reason is not null;
 if exists(select 1 from conveni_review_events where id=p_event and source_record_id=p_record and job_id=p_job and unit_id is null and outcome='reject' and reason=p_note) then return;end if;
 select id into latest from review_decisions where source_record_id=p_record order by created_at desc,id desc limit 1;
 if latest is distinct from p_previous or a.source_hash is distinct from conveni_source_hash(p_record) or p_job is distinct from (select id from pipeline_jobs where source_record_id=p_record and not verification_only order by created_at desc,id desc limit 1) then raise exception 'Revisió obsoleta' using errcode='40001';end if;
 if length(trim(coalesce(p_note,'')))<10 then raise exception 'Cal justificar el descart';end if;
 insert into conveni_review_events(id,source_record_id,job_id,outcome,reason,actor,snapshot) values(p_event,p_record,p_job,'reject',p_note,'local_user',to_jsonb(a));
 insert into review_decisions(source_record_id,pipeline_job_id,classification,reasons,decision,reason,reviewer) values(p_record,p_job,'discarded',array[a.exclusion_reason],'rejected',p_note,'local_user');
 update service_provisions set superseded_at=now() where source_record_id=p_record and superseded_at is null;
 update analysis_results set reviewed_classification='discarded',reviewed_reasons=array[a.exclusion_reason],review_notes=p_note,reviewed_at=now() where pipeline_job_id=p_job;
 update pipeline_jobs set status='rejected' where id=p_job;
 update source_records set processing_status='rebutjat' where id=p_record;
 perform refresh_pipeline_run((select run_id from pipeline_jobs where id=p_job));
end $$;
revoke all on function public.confirm_conveni_exclusion(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.confirm_conveni_exclusion(uuid,uuid,uuid,uuid,text) to service_role;

create view public.conveni_current_analyses with (security_invoker=true) as
 select a.* from conveni_analyses a
 join lateral(select id from pipeline_jobs where source_record_id=a.source_record_id and not verification_only order by created_at desc,id desc limit 1) j on j.id=a.job_id;
grant select on public.conveni_current_analyses to service_role;

-- Verified AOC/MUNICAT directory subset for the 303 codes observed in the Sprint 2 source.
-- Dataset updated 2026-10-15; retrieved 2026-10-17T15:53:29.591567+00:00. CC0.
-- CSV SHA256: 1e7fb0332f4a31ff23b4a7cf09220c8495f6127f8f5d87458c0861ed055d2402
-- 302 verified matches; 991510500 has no matching official code and remains unresolved.
insert into public.conveni_territories(aoc_code,name,level,evidence_url,verified_at) values
('0800180001','Ajuntament d''Abrera','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0800440003','Ajuntament d''Alpens','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0800570005','Ajuntament de l''Ametlla del Vallès','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0800600000','Ajuntament d''Arenys de Mar','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0801160009','Ajuntament d''Avià','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0801550006','Ajuntament de Badalona','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0801555060','Badalona Serveis Assistencials, SA','other','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0801680001','Ajuntament de Bagà','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0801930008','Ajuntament de Barcelona','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0801933103','Institut Municipal de Serveis Socials de Barcelona','other','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0802400000','Ajuntament de Borredà','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0803330008','Ajuntament de Caldes de Montbui','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0804030008','Ajuntament de Canet de Mar','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0804310007','Ajuntament de Canyelles','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0804590004','Ajuntament de Capolat','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0804620002','Ajuntament de Cardedeu','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0804970005','Ajuntament de Casserres','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0805000000','Ajuntament de Castellar del Riu','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0805170005','Ajuntament de Castellar del Vallès','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0805220002','Ajuntament de Castellar de n''Hug','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0805430008','Ajuntament de Castellbisbal','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0805750006','Ajuntament de Castell de l''Areny','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0806150006','Ajuntament de Castellgalí','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0807340003','Ajuntament de Cornellà de Llobregat','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0807490004','Ajuntament de Cubelles','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0807650006','Ajuntament d''Esparreguera','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0807870005','Ajuntament de l''Espunyola','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0808040003','Ajuntament de Fígols','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0808500000','Ajuntament de Font-rubí','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0808630008','Ajuntament de les Franqueses del Vallès','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0808980001','Ajuntament de Gavà','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0809240003','Ajuntament de Gironella','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0809300000','Ajuntament de Gisclareny','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0809610007','Ajuntament de Granollers','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0809830008','Ajuntament de Sant Salvador de Guardiola','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0809960009','Ajuntament de Guardiola de Berguedà','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0810170005','Ajuntament de l''Hospitalet de Llobregat','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0810220002','Ajuntament d''Igualada','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0810560009','Ajuntament de la Llagosta','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0810690004','Ajuntament de Llinars del Vallès','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0810750006','Ajuntament de Lliçà d''Amunt','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0811200000','Ajuntament de Manlleu','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0811360009','Ajuntament de Manresa','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0811540003','Ajuntament de Martorelles','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0811920002','Ajuntament de Masquefa','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0812060009','Ajuntament de Matadepera','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0812490004','Ajuntament de Mollet del Vallès','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0812493018','Institut Municipal de Serveis als Discapacitats de Mollet del Vallès','other','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0812520002','Ajuntament de Montcada i Reixac','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0812650006','Ajuntament de Montgat','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0813040003','Ajuntament de Montclar','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0813110007','Ajuntament de Montesquiu','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0813260009','Ajuntament de Montmajor','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0813500000','Ajuntament de Montmeló','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0813630008','Ajuntament de Montornès del Vallès','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0814020002','Ajuntament de Navarcles','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0814240003','Ajuntament de la Nou de Berguedà','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0814450006','Ajuntament d''Olvan','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0814580001','Ajuntament d''Olèrdola','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0814770005','Ajuntament d''Olesa de Montserrat','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0814830008','Ajuntament d''Olivella','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0814960009','Ajuntament d''Olost','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0815550006','Ajuntament de Palafolls','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0815680001','Ajuntament de Palau-solità i Plegamans','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0815930008','Ajuntament de Parets del Vallès','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0816140003','Ajuntament de Piera','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0816350006','Ajuntament de Pineda de Mar','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0816660009','Ajuntament de la Pobla de Lillet','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0816720002','Ajuntament de Polinyà','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0817510007','Ajuntament de Puig-reig','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0817700000','Ajuntament de la Quar','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0817990004','Ajuntament de Rellinars','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0818030008','Ajuntament de Ripollet','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0818100000','Ajuntament de la Roca del Vallès','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0818250006','Ajuntament del Pont de Vilomara i Rocafort','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0818310007','Ajuntament de Roda de Ter','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0818460009','Ajuntament de Rubí','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0818840003','Ajuntament de Sagàs','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0819010007','Ajuntament de Saldes','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0819180001','Ajuntament de Sallent','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0819230008','Ajuntament de Santpedor','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0819440003','Ajuntament de Sant Adrià de Besòs','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0819570005','Ajuntament de Sant Agustí de Lluçanès','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0819820002','Ajuntament de Sant Antoni de Vilamajor','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0820210007','Ajuntament de Sant Celoni','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0820550006','Ajuntament de Sant Cugat del Vallès','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0820800000','Ajuntament de Sant Esteve Sesrovires','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0820930008','Ajuntament de Sant Fost de Campsentelles','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0821070005','Ajuntament de Sant Feliu de Codines','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0821140003','Ajuntament de Sant Feliu de Llobregat','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0821350006','Ajuntament de Sant Fruitós de Bages','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0821880001','Ajuntament de Sant Joan de Vilatorrada','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0822120002','Ajuntament de Sant Just Desvern','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0822330008','Ajuntament de Sant Llorenç Savall','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0823460009','Ajuntament de Sant Pere de Vilamajor','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0823840003','Ajuntament de Sant Quirze del Vallès','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0824570005','Ajuntament de Santa Coloma de Gramenet','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0824820002','Ajuntament de Santa Eulàlia de Ronçana','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0825150006','Ajuntament de Santa Margarida i els Monjos','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0825200000','Ajuntament de Barberà del Vallès','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0825540003','Ajuntament de Santa Maria de Merlès','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0825920002','Ajuntament de Santa Maria de Palautordera','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0826060009','Ajuntament de Santa Perpètua de Mogoda','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0826340003','Ajuntament de Sant Vicenç dels Horts','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0826650006','Ajuntament de Cerdanyola del Vallès','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0826710007','Ajuntament de Sentmenat','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0826870005','Ajuntament de Cercs','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0827040003','Ajuntament de Sitges','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0827470005','Ajuntament de Súria','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0828300000','Ajuntament de Tona','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0828450006','Ajuntament de Tordera','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0828580001','Ajuntament de Torelló','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0829000000','Ajuntament d''Ullastrell','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0829170005','Ajuntament de Vacarisses','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0829380001','Ajuntament de Vallcebre','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0829810007','Ajuntament de Vic','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0829940003','Ajuntament de Vilada','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0830080001','Ajuntament de Viladecavalls','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0830360009','Ajuntament de Vilanova de Sau','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0830730008','Ajuntament de Vilanova i la Geltrú','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0830890004','Ajuntament de Viver i Serrateix','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0890300000','Ajuntament de Sant Julià de Cerdanyola','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('0890450006','Ajuntament de Badia del Vallès','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('1700100000','Ajuntament d''Agullana','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('1702740003','Ajuntament de Breda','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('1703910007','Ajuntament de Camprodon','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('1704700000','Ajuntament de Castelló d''Empúries','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('1704990004','Ajuntament de Celrà','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('1705450006','Ajuntament de Colera','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('1706690004','Ajuntament de Figueres','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('1707920002','Ajuntament de Girona','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('1708650006','Ajuntament de la Jonquera','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('1709260009','Ajuntament de Llançà','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('1709630008','Ajuntament de les Llosses','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('1710190004','Ajuntament de Massanes','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('1710770005','Ajuntament de Molló','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('1711000000','Ajuntament de Mont-ras','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('1711690004','Ajuntament d''Osor','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('1711750006','Ajuntament de Palafrugell','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('1712540003','Ajuntament de Pardines','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('1713710007','Ajuntament de Porqueres','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('1713870005','Ajuntament de Portbou','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('1713900000','Ajuntament de les Preses','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('1715010007','Ajuntament de Riudellots de la Selva','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('1716090004','Ajuntament de Sant Feliu de Guíxols','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('1716740003','Ajuntament de Sant Joan de les Abadesses','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('1717070005','Ajuntament de Vallfogona de Ripollès','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('1717880001','Ajuntament de Sant Pere Pescador','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('1718120002','Ajuntament de Santa Cristina d''Aro','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('1718700000','Ajuntament de Saus, Camallera i Llampaies','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('1718990004','Ajuntament de la Cellera de Ter','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('1719310007','Ajuntament de Sils','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('1720010007','Ajuntament de Tortellà','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('1721210007','Ajuntament de Vidrà','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('1722140003','Ajuntament de Vilafant','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('1722400000','Ajuntament de Vilallonga de Ter','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('1723330008','Ajuntament de Vilobí d''Onyar','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2500300000','Ajuntament d''Agramunt','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2500580001','Ajuntament d''Alàs i Cerc','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2502730008','Ajuntament d''Anglesola','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2503060009','Ajuntament del Pont de Bar','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2503280001','Ajuntament d''Arsèguel','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2503870005','Ajuntament d''Aitona','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2504110007','Ajuntament de Barbens','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2504470005','Ajuntament de Bassella','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2504630008','Ajuntament de Belianes','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2504850006','Ajuntament de Bell-lloc d''Urgell','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2505010007','Ajuntament de Bellpuig','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2505230008','Ajuntament de Bellvís','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2506160009','Ajuntament de Cabó','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2507070005','Ajuntament de Castellserà','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2507140003','Ajuntament de Cava','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2507400000','Ajuntament de Ciutadilla','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2507720002','Ajuntament de Coll de Nargó','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2508860009','Ajuntament d''Estamariu','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2509310007','Ajuntament de Fondarella','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2509620002','Ajuntament de la Fuliola','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2509970005','Ajuntament de Golmés','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2511370005','Ajuntament d''Ivars d''Urgell','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2512070005','Ajuntament de Lleida','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2512073058','Institut Municipal d''Ocupació Salvador Seguí','other','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2512290004','Ajuntament de Linyola','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2513050006','Ajuntament de Maldà','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2513510007','Ajuntament de Miralcamp','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2513700000','Ajuntament de Mollerussa','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2514030008','Ajuntament de Montferrer i Castellbò','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2514590004','Ajuntament de Nalec','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2514970005','Ajuntament d''Oliana','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2515560009','Ajuntament d''Organyà','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2515810007','Ajuntament del Palau d''Anglesola','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2516540003','Ajuntament de Peramola','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2516890004','Ajuntament del Poal','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2517650006','Ajuntament de Preixana','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2518500000','Ajuntament de Ribera d''Urgellet','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2520380001','Ajuntament de la Seu d''Urgell','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2520560009','Ajuntament de Sidamon','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2521730008','Ajuntament de Tàrrega','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2522520002','Ajuntament de Tornabous','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2523040003','Ajuntament de Torregrossa','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2523470005','Ajuntament de Tremp','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2523850006','Ajuntament de Vallbona de les Monges','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2523980001','Ajuntament de les Valls de Valira','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2524240003','Ajuntament de Verdú','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2524300000','Ajuntament de Vielha e Mijaran','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2524450006','Ajuntament de Vilagrassa','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2524830008','Ajuntament de Vilanova de Bellpuig','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2525210007','Ajuntament de Vila-sana','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2590250006','Ajuntament de Sant Martí de Riucorb','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2590620002','Ajuntament de les Valls d''Aguilar','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('2590840003','Ajuntament de Fígols i Alinyà','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4300170005','Ajuntament d''Aiguamúrcia','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4300560009','Ajuntament d''Alcover','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4300690004','Ajuntament d''Aldover','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4301080001','Ajuntament d''Alió','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4302520002','Ajuntament de Benifallet','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4302650006','Ajuntament de Benissanet','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4302900000','Ajuntament de Blancafort','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4303260009','Ajuntament de Bot','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4303470005','Ajuntament de Bràfim','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4303630008','Ajuntament de Cabra del Camp','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4304240003','Ajuntament de Castellvell del Camp','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4304830008','Ajuntament de Corbera d''Ebre','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4305210007','Ajuntament de Xerta','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4305680001','Ajuntament de la Fatarella','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4306660009','Ajuntament dels Garidells','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4307120002','Ajuntament d''Horta de Sant Joan','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4307860009','Ajuntament de Masdenverge','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4308030008','Ajuntament de la Masó','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4308590004','Ajuntament del Molar','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4309230008','Ajuntament de Mont-roig del Camp','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4309570005','Ajuntament del Morell','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4310680001','Ajuntament del Pinell de Brai','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4310800000','Ajuntament del Pla de Santa Maria','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4311880001','Ajuntament de Pratdip','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4311910007','Ajuntament de Puigpelat','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4312050006','Ajuntament de Querol','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4312120002','Ajuntament de Rasquera','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4312330008','Ajuntament de Reus','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4312480001','Ajuntament de la Riba','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4313100000','Ajuntament de Roda de Berà','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4313250006','Ajuntament de Rodonyà','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4313460009','Ajuntament del Rourell','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4313840003','Ajuntament de Santa Bàrbara','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4314440003','Ajuntament de la Secuita','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4314570005','Ajuntament de la Selva del Camp','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4315080001','Ajuntament de Tivissa','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4315200000','Ajuntament de la Torre de l''Espanyol','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4315540003','Ajuntament de Tortosa','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4315545015','Gestió Sanitària i Assistencial de Tortosa, SAM','other','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4315670005','Ajuntament d''Ulldecona','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4316060009','Ajuntament de Vallmoll','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4316340003','Ajuntament del Vendrell','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4316343043','Patronat Municipal de l''Hospital-Asil del Santíssim Salvador del Vendrell','other','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4316520002','Ajuntament de Vilabella','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4317040003','Ajuntament de Vila-rodona','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4317790004','Ajuntament de Vinebre','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4390230008','Ajuntament de Sant Jaume d''Enveja','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4390440003','Ajuntament de l''Aldea','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('4390600000','Ajuntament de l''Ampolla','municipality','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8000840003','Diputació de Barcelona','province','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8001760009','Diputació de Girona','province','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8001763034','Organisme Autònom de Salut Pública de la Diputació de Girona (Dipsalut)','other','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8002550006','Diputació de Lleida','province','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8100170005','Consell Comarcal de l''Alt Camp','county','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8100220002','Consell Comarcal de l''Alt Empordà','county','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8100380001','Consell Comarcal de l''Alt Penedès','county','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8100430008','Consell Comarcal de l''Alt Urgell','county','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8100690004','Consell Comarcal de l''Anoia','county','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8100750006','Consell Comarcal del Bages','county','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8100810007','Consell Comarcal del Baix Camp','county','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8100940003','Consell Comarcal del Baix Ebre','county','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8101080001','Consell Comarcal del Baix Empordà','county','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8101150006','Consell Comarcal del Baix Llobregat','county','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8101200000','Consell Comarcal del Baix Penedès','county','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8101410007','Consell Comarcal del Berguedà','county','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8101540003','Consell Comarcal de la Cerdanya','county','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8101670005','Consell Comarcal de la Conca de Barberà','county','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8101730008','Consell Comarcal del Garraf','county','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8102060009','Consell Comarcal del Gironès','county','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8102130008','Consell Comarcal del Maresme','county','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8102490004','Consell Comarcal d''Osona','county','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8102520002','Consell Comarcal del Pallars Jussà','county','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8102710007','Consell Comarcal del Pla d''Urgell','county','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8102870005','Consell Comarcal del Pla de l''Estany','county','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8102900000','Consell Comarcal del Priorat','county','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8103040003','Consell Comarcal de la Ribera d''Ebre','county','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8103110007','Consell Comarcal del Ripollès','county','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8103320002','Consell Comarcal del Segrià','county','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8103470005','Consell Comarcal de la Selva','county','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8103630008','Consell Comarcal del Tarragonès','county','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8103850006','Consell Comarcal de l''Urgell','county','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8104020002','Consell Comarcal del Vallès Occidental','county','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8104190004','Consell Comarcal del Vallès Oriental','county','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('8200330008','Àrea Metropolitana de Barcelona','other','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('9002350006','Mancomunitat Intermunicipal Voluntària La Plana','other','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('9011150006','Mancomunitat Intermunicipal de la Conca d''Òdena','other','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('9801810007','Consorci d''Acció Social de la Garrotxa','other','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('9819240003','Consorci del Lluçanès','other','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('9822340003','Consorci d''Osona de Serveis Socials','other','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('9825160009','Consorci de Benestar Social Gironès-Salt','other','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('9827330008','Consorci Sociosanitari de Santa Coloma de Queralt','other','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00'),
('9832860009','Consorci de Benestar Social del Ripollès','other','https://dadesobertes.seu-e.cat/dataset/iio-ii-dades-generals-ens','2026-10-17T15:53:29.591567+00:00');
