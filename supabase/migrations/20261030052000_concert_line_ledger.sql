-- Concerts line ledger; RPC execution remains disabled until integrated review.
-- same predicate as migration 20261028220000.
-- A later annex, changed source type or degraded extraction invalidates the
-- current export without rewriting prior human decisions or provisions.
create or replace view public.concert_line_legacy_projection_base with (security_invoker=true) as
 select p.* from service_provisions p
 where (not exists(select 1 from conveni_analyses where source_record_id=p.source_record_id)
  and (p.mechanism<>'Conveni' or exists(select 1 from source_records r where r.id=p.source_record_id and r.processing_status='completat' and (select decision from review_decisions where source_record_id=r.id order by created_at desc,id desc limit 1) in ('approved','corrected'))))
 or exists(select 1 from conveni_current_units c where c.unit_id=p.unit_id and c.reviewed_job=c.job_id and c.outcome='select'
  and c.source_hash=conveni_source_hash(c.source_record_id)
  and jsonb_typeof(c.document_revisions)='object'
  and not exists(select 1 from source_documents d where d.source_record_id=c.source_record_id and d.document_type in ('agreement','annex')
   and (d.status<>'fetched' or d.extraction_partial is not false or d.storage_sha256 is null or d.storage_path is null
    or coalesce(d.quality_flags,'{}') && array['corrupt_text','incomplete_extraction']
    or c.document_revisions->>d.id::text is distinct from d.storage_sha256||':'||coalesce(d.active_extraction_id::text,'')))
  and not exists(select 1 from jsonb_each_text(case when jsonb_typeof(c.document_revisions)='object' then c.document_revisions else '{}'::jsonb end) rev
   left join source_documents d on d.id::text=rev.key
   where d.id is null or d.source_record_id<>c.source_record_id or d.document_type not in ('agreement','annex')
    or d.status<>'fetched' or d.extraction_partial is not false or d.storage_sha256 is null or d.storage_path is null
    or coalesce(d.quality_flags,'{}') && array['corrupt_text','incomplete_extraction']
    or rev.value is distinct from d.storage_sha256||':'||coalesce(d.active_extraction_id::text,'')));

grant select on public.concert_line_legacy_projection_base to service_role;

-- Private line ledger: no modification to service_provisions.
create table public.concert_line_awards (like public.service_provisions including defaults including constraints);
alter table public.concert_line_awards add primary key(id);
revoke all on public.concert_line_awards from public,anon,authenticated,service_role;
-- Own line ledger: do not write shared service_provisions.
-- This is only a candidate exposure contract, NOT an approval writer.
create table public.concert_line_award_decisions (
 id uuid primary key, source_record_id uuid not null references public.source_records(id),
 job_id uuid not null references public.pipeline_jobs(id),unit_id uuid not null references public.record_units(id),
 provision_id uuid not null unique references public.concert_line_awards(id),
 population_event_id uuid not null references public.concert_population_events(id),
 unit_fingerprint text not null,document_fingerprint text not null,
 amount numeric(16,2) not null check(amount>=0),service_code text not null,
 source_object_id uuid not null,source_version text not null,item_object_id uuid not null,item_version text not null,
 amount_literal text not null,evidence_quote text not null,reviewer text not null,confirmations jsonb not null,
 note text not null,created_at timestamptz not null default now(),sequence integer not null default 1,previous_id uuid references public.concert_line_award_decisions(id),unique(unit_id,job_id,sequence),check((sequence=1 and previous_id is null) or (sequence>1 and previous_id is not null))
);
revoke all on public.concert_line_award_decisions from public,anon,authenticated,service_role;

-- A human must explicitly attest the award and
-- attribution in the note. Literal co-occurrence does not prove semantics,
-- and database object metadata does not prove the physical Storage bytes.
create function public.concert_line_award_decide(p_record uuid,p_job uuid,p_unit uuid,p_decision uuid,p_population uuid,p_code text,p_amount_literal text,p_quote text,p_note text,p_reviewer text,p_confirmations jsonb,p_source_object uuid,p_source_version text,p_item_object uuid,p_item_version text,p_previous uuid default null) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare r public.source_records;j public.pipeline_jobs;u public.record_units;d public.source_documents;e public.concert_population_events;existing public.concert_line_award_decisions;prior public.concert_line_award_decisions;src storage.objects;item storage.objects;service public.official_services;pid uuid;population text;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'LINE_ISOLATION';end if;
 select * into strict r from public.source_records where id=p_record and financing_type='concert' for update;
 select * into strict j from public.pipeline_jobs where id=p_job and source_record_id=p_record and not verification_only for update;
 if j.status not in ('needs_review','insufficient_evidence','approved','corrected') or j.id is distinct from (select id from public.pipeline_jobs where source_record_id=r.id and not verification_only order by created_at desc,id desc limit 1) then raise exception 'LINE_JOB';end if;
 select * into strict u from public.record_units where id=p_unit and source_record_id=r.id for update;
 perform 1 from public.record_units where source_record_id=r.id order by id for share nowait;
 perform 1 from public.source_documents where source_record_id=r.id order by id for share nowait;
 if u.unit_key='legacy' or u.act_type<>'award' or u.amount is null or u.amount<0 or u.status not in ('draft','approved')
  or length(trim(coalesce(p_note,'')))<10 or length(trim(coalesce(p_reviewer,'')))<3
  or jsonb_typeof(p_confirmations) is distinct from 'object'
  or p_confirmations is distinct from '{"award":true,"recipient":true,"allocation":true}'::jsonb then raise exception 'LINE_INVALID';end if;
 select * into strict d from public.source_documents where id=u.document_id and source_record_id=r.id and status='fetched' and extraction_partial=false;
 select * into src from storage.objects where id=p_source_object and bucket_id='cloud-documents' and name=d.storage_path and archived_at is null for share nowait;
 select * into item from storage.objects where id=p_item_object and bucket_id='cloud-documents' and name=u.storage_path and archived_at is null for share nowait;
 if src.id is null or item.id is null or src.id=item.id or src.version is distinct from p_source_version or item.version is distinct from p_item_version
  or u.storage_sha256 is distinct from d.storage_sha256 or u.storage_path is distinct from ('cases/'||r.id||'/items/'||u.id||'/documents/'||d.id||'/'||split_part(d.storage_path,'/',5)) then raise exception 'LINE_STORAGE_STALE';end if;
 if d.storage_path is null or d.storage_sha256 is null or d.storage_sha256 !~ '^[a-f0-9]{64}$'
  or d.storage_path !~ ('^cases/'||r.id::text||'/documents/'||d.id::text||'/'||d.storage_sha256||'\.[a-z0-9]+$')
  or coalesce(d.quality_flags,'{}') && array['corrupt_text','incomplete_extraction']
  or u.amount*100>9007199254740991 or u.page is null or not public.concert_population_on_page(d.extracted_text,u.page,p_quote)
  or u.evidence_quote is null or position(u.evidence_quote in p_quote)=0
  or public.conveni_group_literal_cents(p_amount_literal) is distinct from u.amount*100
  or not public.conveni_quote_has_amount_literal(p_quote,p_amount_literal)
  or nullif(trim(coalesce(u.provider_name,u.observed_provider_name,'')),'') is null
  or position(coalesce(u.provider_name,u.observed_provider_name) in p_quote)=0
  or p_code is distinct from coalesce(u.service_code,u.observed_service_code)
  or not exists(select 1 from public.eligible_official_services where service_code=p_code and (u.catalog_version_id is null or version_id=u.catalog_version_id))
  or position(p_code in p_quote)=0
 then raise exception 'LINE_EVIDENCE';end if;
 select * into strict e from public.concert_population_events where id=p_population and unit_id=u.id and job_id=j.id and source_record_id=r.id;
 if e.id is distinct from (select id from public.concert_population_events where unit_id=u.id and job_id=j.id order by sequence desc limit 1) then raise exception 'LINE_POPULATION_STALE';end if;
 population:=public.concert_population_for_review(u.id,j.id);
 select * into existing from public.concert_line_award_decisions where id=p_decision;
 if found then
  if existing.source_record_id is distinct from r.id or existing.job_id is distinct from j.id or existing.unit_id is distinct from u.id
   or existing.previous_id is distinct from p_previous or existing.population_event_id is distinct from e.id or existing.amount is distinct from u.amount or existing.service_code is distinct from p_code
   or existing.amount_literal is distinct from p_amount_literal or existing.evidence_quote is distinct from p_quote
   or existing.note is distinct from p_note or existing.reviewer is distinct from p_reviewer or existing.confirmations is distinct from p_confirmations
   or existing.source_object_id is distinct from p_source_object or existing.source_version is distinct from p_source_version
   or existing.item_object_id is distinct from p_item_object or existing.item_version is distinct from p_item_version
   or existing.unit_fingerprint is distinct from public.concert_population_unit_hash(u)
   or existing.document_fingerprint is distinct from public.concert_population_document_hash(d) then raise exception 'LINE_REPLAY_CONFLICT';end if;
  if u.status<>'approved' or not exists(select 1 from public.concert_line_awards p where p.id=existing.provision_id and p.unit_id=u.id and p.amount=existing.amount and p.superseded_at is null) then raise exception 'LINE_REPLAY_CONFLICT';end if;
  return existing.id;
 end if;
 select * into prior from public.concert_line_award_decisions where unit_id=u.id and job_id=j.id order by sequence desc limit 1;
 if (prior.id is null and (p_previous is not null or u.status<>'draft')) or (prior.id is not null and (p_previous is distinct from prior.id or u.status<>'approved')) then raise exception 'LINE_PREVIOUS';end if;
 if exists(select 1 from public.service_provisions p join public.record_units prior_unit on prior_unit.id=p.unit_id where p.source_record_id=r.id and p.superseded_at is null and (prior_unit.unit_key='legacy' or prior_unit.id=u.id)) then raise exception 'LINE_EXISTING_PROVISION';end if;
 select * into strict service from public.eligible_official_services where service_code=p_code and (u.catalog_version_id is null or version_id=u.catalog_version_id);
 insert into public.concert_line_awards(unit_id,source_record_id,source_id,provider_name,provider_nif,mechanism,amount,target_population,source_reference,service_code,catalog_version_id,approved_at,centre,period,act_type,annex_reference)
 values(u.id,r.id,r.source_record_id,coalesce(u.provider_name,u.observed_provider_name),u.provider_nif,coalesce(r.mechanism,'Concert'),u.amount,population,r.source_dataset||'/'||r.source_record_id,service.service_code,service.version_id,now(),u.centre,u.period,u.act_type,d.url||' · p. '||u.page) returning id into pid;
 insert into public.concert_line_award_decisions(id,source_record_id,job_id,unit_id,provision_id,population_event_id,unit_fingerprint,document_fingerprint,amount,service_code,source_object_id,source_version,item_object_id,item_version,amount_literal,evidence_quote,reviewer,confirmations,note,sequence,previous_id)
 values(p_decision,r.id,j.id,u.id,pid,e.id,public.concert_population_unit_hash(u),public.concert_population_document_hash(d),u.amount,p_code,src.id,src.version,item.id,item.version,p_amount_literal,p_quote,p_reviewer,p_confirmations,p_note,coalesce(prior.sequence,0)+1,prior.id);
 update public.record_units set status='approved',review_note=p_note,reviewed_at=now() where id=u.id;
 return p_decision;
end $$;
revoke all on function public.concert_line_award_decide(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb,uuid,text,uuid,text,uuid) from public,anon,authenticated,service_role;

-- One row per funding identity. A legacy approved provision prevents exposure
-- of line decisions for the whole record, rather than assuming it is safe to
-- replace a previously approved total. Existing reviewed split provisions can
-- coexist with a distinct line only if they do not share its unit ID.
create view public.concert_line_financing_projection as
 select p.source_record_id,p.unit_id,p.id as finance_id,p.amount,p.target_population,p.service_code,'existing'::text as provenance
 from public.service_provisions p join public.source_records r on r.id=p.source_record_id
 where r.financing_type='concert' and p.superseded_at is null
  and not exists(select 1 from public.concert_line_award_decisions x where x.provision_id=p.id)
  and r.processing_status='completat'
  and (select d.decision from public.review_decisions d where d.source_record_id=r.id order by d.created_at desc,d.id desc limit 1) in ('approved','corrected')
  and exists(select 1 from public.concert_line_legacy_projection_base v where v.id=p.id)
 union all
 select x.source_record_id,x.unit_id,p.id,x.amount,
 case when pop.decision='confirmed' and pop.document_id=d.id and pop.revision=d.storage_sha256||':'||coalesce(d.active_extraction_id::text,'')
  and pop.unit_fingerprint=public.concert_population_unit_hash(u) and pop.document_fingerprint=public.concert_population_document_hash(d)
  and public.concert_population_on_page(d.extracted_text,pop.page,pop.quote)
  and not exists(select 1 from public.record_units other where other.source_record_id=x.source_record_id and other.id<>u.id and other.document_id=u.document_id and other.page=u.page and other.evidence_quote is not null and length(other.evidence_quote)>0 and (position(other.evidence_quote in pop.quote)>0 or position(u.evidence_quote in other.evidence_quote)>0))
 then pop.value else null end,x.service_code,'line_experiment'
 from public.concert_line_award_decisions x
 join public.source_records r on r.id=x.source_record_id and r.financing_type='concert'
 join public.record_units u on u.id=x.unit_id and u.source_record_id=x.source_record_id and u.act_type='award' and u.status='approved'
 join public.source_documents d on d.id=u.document_id and d.source_record_id=x.source_record_id
 join public.concert_population_events e on e.id=x.population_event_id and e.unit_id=x.unit_id and e.job_id=x.job_id and e.source_record_id=x.source_record_id
 left join lateral (select latest.* from public.concert_population_events latest where latest.unit_id=x.unit_id and latest.job_id=x.job_id order by latest.sequence desc limit 1) pop on true
 join public.concert_line_awards p on p.id=x.provision_id and p.unit_id=x.unit_id and p.source_record_id=x.source_record_id and p.superseded_at is null
 where x.id=(select latest.id from public.concert_line_award_decisions latest where latest.unit_id=x.unit_id and latest.job_id=x.job_id order by latest.sequence desc limit 1)
  and x.job_id=(select j.id from public.pipeline_jobs j where j.source_record_id=x.source_record_id and not j.verification_only order by j.created_at desc,j.id desc limit 1)
  and x.unit_fingerprint=public.concert_population_unit_hash(u) and e.unit_fingerprint=x.unit_fingerprint
  and x.document_fingerprint=public.concert_population_document_hash(d) and e.document_fingerprint=x.document_fingerprint
  and x.amount=u.amount and p.amount=x.amount and p.service_code=x.service_code
  and x.service_code=coalesce(u.service_code,u.observed_service_code)
  and (u.catalog_version_id is null or p.catalog_version_id=u.catalog_version_id)
  and exists(select 1 from public.eligible_official_services service where service.service_code=x.service_code and service.version_id=p.catalog_version_id)
  and exists(select 1 from storage.objects so where so.id=x.source_object_id and so.archived_at is null and so.bucket_id='cloud-documents' and so.name=d.storage_path and so.version=x.source_version)
  and exists(select 1 from storage.objects io where io.id=x.item_object_id and io.archived_at is null and io.bucket_id='cloud-documents' and io.name=u.storage_path and io.version=x.item_version)
  and not exists(select 1 from public.service_provisions p join public.record_units legacy on legacy.id=p.unit_id
   where p.source_record_id=x.source_record_id and p.superseded_at is null and (legacy.unit_key='legacy' or legacy.id=x.unit_id));
revoke all on public.concert_line_financing_projection from public,anon,authenticated,service_role;

create table public.concert_line_export_receipts(id uuid primary key,created_at timestamptz not null default now(),content_hash text not null);
create table public.concert_line_export_items(receipt_id uuid not null references public.concert_line_export_receipts(id),decision_id uuid not null references public.concert_line_award_decisions(id),snapshot jsonb not null,primary key(receipt_id,decision_id));
revoke all on public.concert_line_export_receipts,public.concert_line_export_items from public,anon,authenticated,service_role;
create function public.concert_line_immutable_history() returns trigger language plpgsql set search_path=pg_catalog as $$
begin raise exception 'ISOLATED_HISTORY_IMMUTABLE';end $$;
create trigger immutable_isolated_line before update or delete on public.concert_line_awards for each row execute function public.concert_line_immutable_history();
create trigger immutable_isolated_decision before update or delete on public.concert_line_award_decisions for each row execute function public.concert_line_immutable_history();
create trigger immutable_isolated_receipt before update or delete on public.concert_line_export_receipts for each row execute function public.concert_line_immutable_history();
create trigger immutable_isolated_receipt_item before update or delete on public.concert_line_export_items for each row execute function public.concert_line_immutable_history();
revoke all on function public.concert_line_immutable_history() from public,anon,authenticated,service_role;
-- Receipt validates the exact snapshot consumed by the Excel generator.
-- A hash supplied by the caller identifies bytes; SQL cannot verify those bytes.
create function public.concert_line_export_commit(p_receipt uuid,p_content_hash text,p_expected jsonb) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare ids uuid[];actual jsonb;existing jsonb;old_hash text;
begin
 if p_receipt is null or p_content_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_expected)<>'array' or jsonb_array_length(p_expected)=0 or jsonb_array_length(p_expected)>5000 then raise exception 'ISOLATED_EXPORT_INVALID';end if;
 select array_agg((e->>'decision_id')::uuid order by (e->>'decision_id')::uuid) into ids from jsonb_array_elements(p_expected) e;
 if array_position(ids,null) is not null or cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'ISOLATED_EXPORT_INVALID';end if;
 select content_hash into old_hash from public.concert_line_export_receipts where id=p_receipt;
 if found then
  select coalesce(jsonb_agg(jsonb_build_object('decision_id',decision_id,'snapshot',snapshot) order by decision_id),'[]') into existing from public.concert_line_export_items where receipt_id=p_receipt;
  if old_hash is distinct from p_content_hash or existing is distinct from p_expected then raise exception 'ISOLATED_EXPORT_REPLAY_CONFLICT';end if;
  return p_receipt;
 end if;
 perform 1 from public.source_records r where r.id in(select x.source_record_id from public.concert_line_award_decisions x where x.id=any(ids)) order by r.id for update nowait;
 perform 1 from public.pipeline_jobs j where j.id in(select x.job_id from public.concert_line_award_decisions x where x.id=any(ids)) order by j.id for share nowait;
 perform 1 from public.record_units u where u.id in(select x.unit_id from public.concert_line_award_decisions x where x.id=any(ids)) order by u.id for share nowait;
 perform 1 from public.source_documents d where d.id in(select u.document_id from public.record_units u join public.concert_line_award_decisions x on x.unit_id=u.id where x.id=any(ids)) order by d.id for share nowait;
 perform 1 from storage.objects o where o.id in(select x.source_object_id from public.concert_line_award_decisions x where x.id=any(ids) union select x.item_object_id from public.concert_line_award_decisions x where x.id=any(ids)) order by o.id for share nowait;
 select coalesce(jsonb_agg(jsonb_build_object('decision_id',x.id,'snapshot',to_jsonb(p)||jsonb_build_object('target_population',v.target_population)) order by x.id),'[]') into actual
 from public.concert_line_award_decisions x join public.concert_line_awards p on p.id=x.provision_id
 join public.concert_line_financing_projection v on v.finance_id=p.id and v.provenance='line_experiment'
 where x.id=any(ids);
 if jsonb_array_length(actual)<>cardinality(ids) or actual is distinct from p_expected then raise exception 'ISOLATED_EXPORT_STALE' using errcode='40001';end if;
 insert into public.concert_line_export_receipts(id,content_hash) values(p_receipt,p_content_hash);
 insert into public.concert_line_export_items(receipt_id,decision_id,snapshot)
 select p_receipt,(e->>'decision_id')::uuid,e->'snapshot' from jsonb_array_elements(actual) e;
 return p_receipt;
end $$;
revoke all on function public.concert_line_export_commit(uuid,text,jsonb) from public,anon,authenticated,service_role;
-- Versioned snapshot transport; no application role grants yet.
create function public.concert_line_export_snapshot(p_ids uuid[]) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(jsonb_agg(jsonb_build_object('decision_id',x.id,'snapshot',to_jsonb(p)||jsonb_build_object('target_population',v.target_population)) order by x.id),'[]')
 from public.concert_line_award_decisions x join public.concert_line_awards p on p.id=x.provision_id
 join public.concert_line_financing_projection v on v.finance_id=p.id and v.provenance='line_experiment'
 where x.id=any(p_ids)
$$;
revoke all on function public.concert_line_export_snapshot(uuid[]) from public,anon,authenticated,service_role;

alter table public.concert_line_awards enable row level security;
alter table public.concert_line_award_decisions enable row level security;
alter table public.concert_line_export_receipts enable row level security;
alter table public.concert_line_export_items enable row level security;
revoke all on public.concert_line_legacy_projection_base from public,anon,authenticated;
-- Candidate read for server-side physical verification before a line decision.
create function public.concert_line_award_archive_snapshot(p_record uuid,p_job uuid,p_unit uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 select jsonb_build_object('document_id',d.id,'document_path',d.storage_path,'document_sha256',d.storage_sha256,
  'unit_path',u.storage_path,'unit_sha256',u.storage_sha256,
  'source_object',src.id,'source_version',src.version,'item_object',item.id,'item_version',item.version,
  'population_event',(select e.id from public.concert_population_events e where e.unit_id=u.id and e.job_id=j.id order by e.sequence desc limit 1),
  'previous_decision',(select x.id from public.concert_line_award_decisions x where x.unit_id=u.id and x.job_id=j.id order by x.sequence desc limit 1),
  'previous_decision_parent',(select x.previous_id from public.concert_line_award_decisions x where x.unit_id=u.id and x.job_id=j.id order by x.sequence desc limit 1))
 from public.source_records r join public.pipeline_jobs j on j.source_record_id=r.id and j.id=p_job and not j.verification_only
 join public.record_units u on u.source_record_id=r.id and u.id=p_unit and u.document_id is not null
 join public.source_documents d on d.id=u.document_id and d.source_record_id=r.id
 join storage.objects src on src.bucket_id='cloud-documents' and src.name=d.storage_path and src.archived_at is null
 join storage.objects item on item.bucket_id='cloud-documents' and item.name=u.storage_path and item.archived_at is null
 where r.id=p_record and r.financing_type='concert' and j.id=(select pj.id from public.pipeline_jobs pj where pj.source_record_id=r.id and not pj.verification_only order by pj.created_at desc,pj.id desc limit 1)
$$;
revoke all on function public.concert_line_award_archive_snapshot(uuid,uuid,uuid) from public,anon,authenticated,service_role;
-- Allow a later population observation only for an
-- independently reviewed Concert line. Existing legacy behavior is preserved.
do $$
declare original text;patched text;
 anchor constant text := 'if u.status<>''draft'' or u.reviewed_at is not null or (u.pipeline_job_id is not null and u.pipeline_job_id<>p_job) then raise exception ''POP_REVIEWED'';end if;';
 replacement constant text := 'if not ((u.status=''draft'' and u.reviewed_at is null) or (u.status=''approved'' and exists(select 1 from public.concert_line_award_decisions x where x.unit_id=u.id and x.job_id=p_job and x.source_record_id=p_record))) or (u.pipeline_job_id is not null and u.pipeline_job_id<>p_job) then raise exception ''POP_REVIEWED'';end if;';
begin
 original:=pg_get_functiondef('public.concert_population_decide(uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,integer,text,text,text,text,text)'::regprocedure);
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'POP_REOPEN_PATCH_ANCHOR';end if;
 patched:=replace(original,anchor,replacement);execute patched;
end $$;

-- Common, gated projection preserving PostgREST relationships.
-- No grants until integrated review; legacy tables remain untouched.
create function public.concert_line_combined_provisions() returns setof public.service_provisions
language sql stable security definer set search_path=pg_catalog,public as $$
 select p.* from public.conveni_reviewed_provisions p
 union all
 select (jsonb_populate_record(null::public.service_provisions,to_jsonb(a)||jsonb_build_object('target_population',v.target_population))).*
 from public.concert_line_awards a
 join public.concert_line_financing_projection v on v.finance_id=a.id and v.provenance='line_experiment'
$$;
revoke all on function public.concert_line_combined_provisions() from public,anon,authenticated,service_role;

-- Unified snapshot for legacy and separate line awards.
create table public.concert_line_mixed_receipts(id uuid primary key,hash text not null);
create table public.concert_line_mixed_items(receipt_id uuid not null references public.concert_line_mixed_receipts(id),provision_id uuid not null,snapshot jsonb not null,primary key(receipt_id,provision_id));
revoke all on public.concert_line_mixed_receipts,public.concert_line_mixed_items from public,anon,authenticated,service_role;
create function public.concert_line_mixed_snapshot(p_ids uuid[],p_legacy_visible boolean default false) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'snapshot',to_jsonb(p)||jsonb_build_object('service_name',coalesce(o.service_name,p.service_code),'official_services',case when o.service_code is null then null else jsonb_build_object('service_name',o.service_name) end,'source_records',jsonb_build_object('financing_type',r.financing_type))) order by p.id),'[]')
 from public.concert_line_combined_provisions() p join public.source_records r on r.id=p.source_record_id
 left join public.official_services o on o.version_id=p.catalog_version_id and o.service_code=p.service_code
 where p.id=any(p_ids) and p.superseded_at is null and (exists(select 1 from public.concert_line_awards a where a.id=p.id)
  or (p_legacy_visible and exists(select 1 from public.conveni_reviewed_provisions legacy where legacy.id=p.id)) or p.mechanism='Conveni' or (r.processing_status='completat' and (select d.decision from public.review_decisions d where d.source_record_id=r.id order by d.created_at desc,d.id desc limit 1) in ('approved','corrected')))
$$;
revoke all on function public.concert_line_mixed_snapshot(uuid[],boolean) from public,anon,authenticated,service_role;
-- Lock sources and dependencies of the existing reviewed-provision view.
create function public.concert_line_mixed_commit(p_receipt uuid,p_hash text,p_expected jsonb,p_legacy_visible boolean default false) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare ids uuid[];sources uuid[];actual jsonb;old_hash text;old_items jsonb;
begin
 if p_receipt is null or p_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_expected)<>'array' or jsonb_array_length(p_expected)=0 then raise exception 'MIXED_INVALID';end if;
 select array_agg((e->>'id')::uuid order by (e->>'id')::uuid),array_agg(distinct (e->'snapshot'->>'source_record_id')::uuid order by (e->'snapshot'->>'source_record_id')::uuid) into ids,sources from jsonb_array_elements(p_expected) e;
 if array_position(ids,null) is not null or array_position(sources,null) is not null or cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'MIXED_INVALID';end if;
 select hash into old_hash from public.concert_line_mixed_receipts where id=p_receipt;
 if found then
  select coalesce(jsonb_agg(jsonb_build_object('id',provision_id,'snapshot',snapshot) order by provision_id),'[]') into old_items from public.concert_line_mixed_items where receipt_id=p_receipt;
  if old_hash is distinct from p_hash or old_items is distinct from p_expected then raise exception 'MIXED_REPLAY_CONFLICT';end if;
  return p_receipt;
 end if;
 perform 1 from public.source_records r where r.id=any(sources) order by r.id for update nowait;
 perform 1 from public.pipeline_jobs j where j.source_record_id=any(sources) order by j.id for update nowait;
 perform 1 from public.record_units u where u.source_record_id=any(sources) order by u.id for update nowait;
 perform 1 from public.source_documents d where d.source_record_id=any(sources) order by d.id for share nowait;
 perform 1 from public.review_decisions d where d.source_record_id=any(sources) order by d.id for share nowait;
 perform 1 from public.conveni_analyses a where a.source_record_id=any(sources) order by a.job_id for update nowait;
 perform 1 from public.conveni_unit_proposals cp join public.conveni_analyses a on a.job_id=cp.job_id where a.source_record_id=any(sources) order by cp.job_id,cp.unit_id for update of cp nowait;
 perform 1 from public.conveni_review_events e where e.source_record_id=any(sources) order by e.id for update nowait;
 perform 1 from public.service_provisions p where p.id=any(ids) order by p.id for share nowait;
 perform 1 from public.official_services o where (o.version_id,o.service_code) in(select e->'snapshot'->>'catalog_version_id',e->'snapshot'->>'service_code' from jsonb_array_elements(p_expected) e) order by o.version_id,o.service_code for share nowait;
 perform 1 from storage.objects o where o.id in(select x.source_object_id from public.concert_line_award_decisions x where x.provision_id=any(ids) union select x.item_object_id from public.concert_line_award_decisions x where x.provision_id=any(ids)) order by o.id for share nowait;
 actual:=public.concert_line_mixed_snapshot(ids,p_legacy_visible);
 if jsonb_array_length(actual)<>cardinality(ids) or actual is distinct from p_expected then raise exception 'MIXED_STALE' using errcode='40001';end if;
 insert into public.concert_line_mixed_receipts values(p_receipt,p_hash);
 insert into public.concert_line_mixed_items select p_receipt,(e->>'id')::uuid,e->'snapshot' from jsonb_array_elements(actual) e;
 return p_receipt;
end $$;
revoke all on function public.concert_line_mixed_commit(uuid,text,jsonb,boolean) from public,anon,authenticated,service_role;
create trigger mixed_receipt_immutable before update or delete on public.concert_line_mixed_receipts for each row execute function public.concert_line_immutable_history();
create trigger mixed_item_immutable before update or delete on public.concert_line_mixed_items for each row execute function public.concert_line_immutable_history();

alter table public.concert_line_mixed_receipts enable row level security;
alter table public.concert_line_mixed_items enable row level security;

-- The old review flows lock the source first. Fence their semantic transition
-- there, without triggers or lock-order changes on shared tables.
create function public.concert_line_has_award(p_record uuid,p_unit uuid default null) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.concert_line_award_decisions x where x.source_record_id=p_record and (p_unit is null or x.unit_id=p_unit))
$$;
revoke all on function public.concert_line_has_award(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.concert_line_has_award(uuid,uuid) to service_role;
do $$
declare original text;patched text;
 anchor constant text:=' select * into strict r from source_records where id=pid for update;';
 addition constant text:=E'\n if public.concert_line_has_award(r.id,p_unit) then raise exception ''Aquesta línia té una revisió econòmica individual; utilitza el seu circuit de revisió.'';end if;';
begin
 original:=pg_get_functiondef('public.review_record_unit(uuid,uuid,boolean,text)'::regprocedure);
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'LINE_UNIT_GUARD_ANCHOR';end if;
 patched:=replace(original,anchor,anchor||addition);execute patched;
end $$;
do $$
declare original text;patched text;
 anchor constant text:=' select * into strict r from source_records where id=p_record for update;';
 addition constant text:=E'\n if public.concert_line_has_award(r.id,null) then raise exception ''Aquest expedient té revisions econòmiques individuals; cal conciliar-les abans de la revisió global.'';end if;';
begin
 original:=pg_get_functiondef('public.review_analysis(uuid,text,uuid,text[],uuid,text,text)'::regprocedure);
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'LINE_GLOBAL_GUARD_ANCHOR';end if;
 patched:=replace(original,anchor,anchor||addition);execute patched;
end $$;
-- Read-only list contract: preserve the historical list criteria and add only
-- currently documented line awards. Execution is disabled pending integration.
create function public.concert_line_combined_approved() returns setof public.service_provisions
language sql stable security definer set search_path=pg_catalog,public as $$
 select p.* from public.concert_line_combined_provisions() p join public.source_records r on r.id=p.source_record_id
 where r.processing_status='completat' or r.financing_type='conveni'
  or exists(select 1 from public.concert_line_financing_projection v where v.finance_id=p.id and v.provenance='line_experiment')
$$;
create function public.concert_line_approved(p public.service_provisions) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.concert_line_financing_projection v where v.provenance='line_experiment' and v.finance_id=p.id)
$$;
revoke all on function public.concert_line_combined_approved(),public.concert_line_approved(public.service_provisions) from public,anon,authenticated,service_role;
-- Batch receipt shares an ID with the immutable mixed receipt; legacy IDs keep
-- their existing FK references and new line IDs remain in mixed snapshots.
create function public.concert_line_mixed_batch_commit(p_receipt uuid,p_run uuid,p_filename text,p_hash text,p_expected jsonb) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare result uuid;n integer;existing public.excel_exports;
begin
 if p_run is null or length(trim(coalesce(p_filename,'')))=0 then raise exception 'MIXED_BATCH_INVALID';end if;
 if exists(select 1 from jsonb_array_elements(p_expected) e where not exists(select 1 from public.pipeline_jobs j where j.run_id=p_run and j.source_record_id=(e->'snapshot'->>'source_record_id')::uuid)) then raise exception 'MIXED_BATCH_SCOPE' using errcode='40001';end if;
 result:=public.concert_line_mixed_commit(p_receipt,p_hash,p_expected,true);n:=jsonb_array_length(p_expected);
 select * into existing from public.excel_exports where id=p_receipt;
 if found then
  if existing.pipeline_run_id is distinct from p_run or existing.filename is distinct from p_filename or existing.content_hash is distinct from p_hash or existing.provision_count is distinct from n then raise exception 'MIXED_BATCH_REPLAY_CONFLICT';end if;
  return result;
 end if;
 insert into public.excel_exports(id,pipeline_run_id,filename,content_hash,provision_count) values(p_receipt,p_run,p_filename,p_hash,n);
 insert into public.excel_export_items(export_id,provision_id)
 select p_receipt,p.id from public.service_provisions p where p.id in(select (e->>'id')::uuid from jsonb_array_elements(p_expected) e);
 return result;
end $$;
revoke all on function public.concert_line_mixed_batch_commit(uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
-- A single read fixes the batch membership, current provisions and pending
-- units. The commit rechecks the same object under locks before recording.
create function public.concert_line_batch_snapshot(p_run uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare sources uuid[];ids uuid[];rows_ jsonb;pending jsonb;jobs jsonb;
begin
 if not exists(select 1 from public.pipeline_runs where id=p_run) then raise exception 'BATCH_NOT_FOUND';end if;
 select coalesce(array_agg(distinct j.source_record_id order by j.source_record_id),'{}'::uuid[]) into sources from public.pipeline_jobs j where j.run_id=p_run;
 select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'source_record_id',j.source_record_id) order by j.id),'[]') into jobs from public.pipeline_jobs j where j.run_id=p_run;
 select coalesce(array_agg(p.id order by p.id),'{}'::uuid[]) into ids from public.concert_line_combined_provisions() p where p.source_record_id=any(sources) and p.superseded_at is null;
 if cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'BATCH_DUPLICATE';end if;
 rows_:=public.concert_line_mixed_snapshot(ids,true);
 if jsonb_array_length(rows_)<>cardinality(ids) then raise exception 'BATCH_REVIEW_REQUIRED' using errcode='40001';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'source_record_id',u.source_record_id) order by u.source_record_id,u.id),'[]') into pending
 from public.record_units u where u.source_record_id=any(sources) and u.unit_key<>'legacy' and u.status='draft';
 return jsonb_build_object('run_id',p_run,'sources',to_jsonb(sources),'jobs',jobs,'provisions',rows_,'pending',pending);
end $$;
create function public.concert_line_batch_snapshot_commit(p_receipt uuid,p_run uuid,p_filename text,p_hash text,p_expected jsonb) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare sources uuid[];actual jsonb;
begin
 if jsonb_typeof(p_expected)<>'object' or p_expected->>'run_id' is distinct from p_run::text or jsonb_typeof(p_expected->'sources')<>'array' then raise exception 'BATCH_INVALID';end if;
 select coalesce(array_agg(value::uuid order by value::uuid),'{}'::uuid[]) into sources from jsonb_array_elements_text(p_expected->'sources');
 perform 1 from public.pipeline_runs where id=p_run for update nowait;
 if not found then raise exception 'BATCH_NOT_FOUND';end if;
 perform 1 from public.source_records r where r.id=any(sources) order by r.id for update nowait;
 perform 1 from public.pipeline_jobs j where j.run_id=p_run or j.source_record_id=any(sources) order by j.id for update nowait;
 perform 1 from public.record_units u where u.source_record_id=any(sources) order by u.id for update nowait;
 actual:=public.concert_line_batch_snapshot(p_run);
 if actual is distinct from p_expected then raise exception 'BATCH_STALE' using errcode='40001';end if;
 return public.concert_line_mixed_batch_commit(p_receipt,p_run,p_filename,p_hash,p_expected->'provisions');
end $$;
revoke all on function public.concert_line_batch_snapshot(uuid),public.concert_line_batch_snapshot_commit(uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
-- Candidate Master snapshot. Short NOWAIT table locks in the commit fence
-- phantoms; operational impact must be measured before this is enabled.
create function public.concert_line_master_snapshot() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare ids uuid[];rows_ jsonb;
begin
 select coalesce(array_agg(p.id order by p.id),'{}'::uuid[]) into ids from public.concert_line_combined_provisions() p where p.superseded_at is null;
 if cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'MASTER_DUPLICATE';end if;
 rows_:=public.concert_line_mixed_snapshot(ids,true);
 if jsonb_array_length(rows_)<>cardinality(ids) then raise exception 'MASTER_REVIEW_REQUIRED' using errcode='40001';end if;
 return jsonb_build_object('provisions',rows_);
end $$;
create function public.concert_line_master_snapshot_commit(p_receipt uuid,p_filename text,p_hash text,p_expected jsonb) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare actual jsonb;existing public.excel_exports;n integer;result uuid;
begin
 if p_receipt is null or length(trim(coalesce(p_filename,'')))=0 or jsonb_typeof(p_expected)<>'object' or jsonb_typeof(p_expected->'provisions')<>'array' then raise exception 'MASTER_INVALID';end if;
 lock table public.source_records,public.pipeline_jobs,public.record_units,public.source_documents,public.documented_corrections,public.review_decisions,public.service_provisions,public.conveni_analyses,public.conveni_unit_proposals,public.conveni_review_events,public.catalog_versions,public.official_services,public.concert_line_awards,public.concert_line_award_decisions,public.concert_population_events,storage.objects in share mode nowait;
 actual:=public.concert_line_master_snapshot();
 if actual is distinct from p_expected then raise exception 'MASTER_STALE' using errcode='40001';end if;
 result:=public.concert_line_mixed_commit(p_receipt,p_hash,p_expected->'provisions',true);n:=jsonb_array_length(p_expected->'provisions');
 select * into existing from public.excel_exports where id=p_receipt;
 if found then
  if existing.pipeline_run_id is not null or existing.filename is distinct from p_filename or existing.content_hash is distinct from p_hash or existing.provision_count is distinct from n then raise exception 'MASTER_REPLAY_CONFLICT';end if;
  return result;
 end if;
 insert into public.excel_exports(id,filename,content_hash,provision_count) values(p_receipt,p_filename,p_hash,n);
 insert into public.excel_export_items(export_id,provision_id) select p_receipt,p.id from public.service_provisions p where p.id in(select (e->>'id')::uuid from jsonb_array_elements(p_expected->'provisions') e);
 return result;
end $$;
revoke all on function public.concert_line_master_snapshot(),public.concert_line_master_snapshot_commit(uuid,text,text,jsonb) from public,anon,authenticated,service_role;
-- Evolution receives only a bounded status per unit, not the underlying ledger.
create function public.concert_line_evolution_states(p_units uuid[]) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(jsonb_agg(jsonb_build_object('unit_id',latest.unit_id,'state',case when exists(select 1 from public.concert_line_financing_projection v where v.finance_id=latest.provision_id and v.provenance='line_experiment') then 'current' else 'stale' end) order by latest.unit_id),'[]')
 from (select distinct on(x.unit_id) x.unit_id,x.provision_id from public.concert_line_award_decisions x join public.pipeline_jobs j on j.id=x.job_id where x.unit_id=any(p_units) order by x.unit_id,j.created_at desc,j.id desc,x.sequence desc) latest
$$;
revoke all on function public.concert_line_evolution_states(uuid[]) from public,anon,authenticated,service_role;
-- A read-only circuit breaker prevents legacy readers hiding an existing ledger
-- when the feature is disabled or during a rollback.
create function public.concert_line_ledger_exists() returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.concert_line_award_decisions)
$$;
revoke all on function public.concert_line_ledger_exists() from public,anon,authenticated,service_role;
grant execute on function public.concert_line_ledger_exists() to service_role;
