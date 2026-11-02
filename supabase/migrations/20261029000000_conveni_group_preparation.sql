-- A preparation records a documented candidate total. It does not allocate,
-- reconcile, finalize a unit, approve a service or create a provision.
create table public.conveni_group_preparation_events (
 id uuid primary key, source_record_id uuid not null references public.source_records(id),
 job_id uuid not null, unit_id uuid not null, sequence integer not null check(sequence>0),
 previous_event_id uuid references public.conveni_group_preparation_events(id),
 parent_review_id uuid references public.conveni_review_events(id),
 group_hash text not null check(group_hash ~ '^[a-f0-9]{64}$'),
 source_hash text not null, analysis_hash text not null check(analysis_hash ~ '^[a-f0-9]{64}$'), document_revisions jsonb not null,
 concept_heads jsonb not null, catalog_version_id text not null references public.catalog_versions(id),
 service_code text not null, amount_cents bigint not null check(amount_cents>=0 and amount_cents<=9007199254740991),
 proposed_amount_state text not null check(proposed_amount_state in ('planned','conditional','confirmed')),
 amount_literal text not null, total_citation jsonb not null, identity_citation jsonb not null,
 confirmations jsonb not null, reason text not null check(length(trim(reason))>=10),
 group_snapshot jsonb not null, actor text not null default 'local_user', created_at timestamptz not null default clock_timestamp(),
 foreign key(job_id,unit_id) references public.conveni_unit_proposals(job_id,unit_id), unique(job_id,unit_id,sequence)
);
create index conveni_group_preparation_latest on public.conveni_group_preparation_events(job_id,unit_id,sequence desc);
alter table public.conveni_group_preparation_events enable row level security;
revoke all on public.conveni_group_preparation_events from public,anon,authenticated,service_role;
grant select on public.conveni_group_preparation_events to service_role;

-- Deliberately reject ambiguous formats such as 1.234 and non-integer cents.
create function public.conveni_group_literal_cents(p_literal text) returns numeric
language plpgsql immutable security invoker set search_path=pg_catalog as $$
declare value_ text:=trim(coalesce(p_literal,'')); amount numeric;
begin
 if length(value_)>32 then return null;end if;
 value_:=trim(regexp_replace(value_,'[[:space:]]*€$',''));
 if value_ ~ '^[0-9]+$' then amount:=value_::numeric*100;
 elsif value_ ~ '^([0-9]+|[0-9]{1,3}(\.[0-9]{3})+),[0-9]{2}$' then amount:=replace(replace(value_,'.',''),',','.')::numeric*100;
 elsif value_ ~ '^[0-9]+\.[0-9]{2}$' then amount:=value_::numeric*100;
 else return null;end if;
 if amount>9007199254740991 then return null;end if;
 return amount;
end $$;

-- The entire number must occur in the quote, not as part of a longer number.
create function public.conveni_quote_has_amount_literal(p_quote text,p_literal text) returns boolean
language plpgsql immutable security invoker set search_path=pg_catalog as $$
declare quote_ text:=coalesce(p_quote,''); literal_ text:=trim(coalesce(p_literal,'')); offset_ integer:=1; found_ integer; pos_ integer; before_ text; after_ text;
begin
 if length(literal_)=0 or public.conveni_group_literal_cents(literal_) is null then return false;end if;
 loop
  found_:=strpos(substr(quote_,offset_),literal_);if found_=0 then return false;end if;
  pos_:=offset_+found_-1;before_:=case when pos_=1 then '' else substr(quote_,pos_-1,1) end;
  after_:=substr(quote_,pos_+length(literal_),1);
  if before_ !~ '[[:alnum:].,+−-]' and after_ !~ '[[:alnum:].,%]'
   and substr(quote_,1,pos_-1) !~ '([0-9]|[-+−])[[:space:]]+$'
   and substr(quote_,pos_+length(literal_)) !~ '^[[:space:]]+[0-9]'
   and not (substr(quote_,1,pos_-1) ~ '\([[:space:]]*$' and substr(quote_,pos_+length(literal_)) ~ '^[[:space:]]*\)')
   and substr(quote_,1,pos_-1) !~ '[0-9][[:space:]]*[-+−–—*/×÷xX=][[:space:]]*$'
   and substr(quote_,pos_+length(literal_)) !~ '^[[:space:]]*[-+−–—*/×÷xX=][[:space:]]*[0-9]'
  then return true;end if;
  offset_:=pos_+1;
 end loop;
end $$;
revoke all on function public.conveni_group_literal_cents(text) from public,anon,authenticated;
revoke all on function public.conveni_quote_has_amount_literal(text,text) from public,anon,authenticated;
grant execute on function public.conveni_group_literal_cents(text) to service_role;
grant execute on function public.conveni_quote_has_amount_literal(text,text) to service_role;

create function public.prepare_conveni_group(
 p_record uuid,p_job uuid,p_unit uuid,p_event uuid,p_previous uuid,p_parent_review uuid,
 p_group_hash text,p_analysis_hash text,p_source_hash text,p_revisions jsonb,p_heads jsonb,p_code text,
 p_amount_cents bigint,p_amount_literal text,p_total_citation jsonb,p_identity_citation jsonb,
 p_confirmations jsonb,p_note text
) returns void language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
declare r public.source_records;a public.conveni_analyses;u public.record_units;d jsonb;concept_ jsonb;heads_count integer;
 last_ public.conveni_group_preparation_events;existing public.conveni_group_preparation_events;parent_ uuid;doc public.source_documents;citation jsonb;i integer;
begin
 select * into strict r from public.source_records where id=p_record for update;
 select * into strict a from public.conveni_analyses where job_id=p_job and source_record_id=r.id for share;
 select * into strict u from public.record_units where id=p_unit and source_record_id=r.id for update;
 select data into strict d from public.conveni_unit_proposals where job_id=p_job and unit_id=u.id for share;
 if p_job is distinct from (select id from public.pipeline_jobs where source_record_id=r.id and not verification_only order by created_at desc,id desc limit 1)
  or a.source_hash is distinct from p_source_hash or a.source_hash is distinct from public.conveni_source_hash(r.id)
  or jsonb_typeof(a.document_revisions) is distinct from 'object' or a.document_revisions is distinct from p_revisions
 then raise exception 'Anàlisi o manifest obsolets' using errcode='PT409';end if;
 select id into parent_ from public.conveni_review_events where unit_id=u.id order by created_at desc,id desc limit 1;
 if parent_ is distinct from p_parent_review then raise exception 'Revisió de la unitat obsoleta' using errcode='PT409';end if;
 if coalesce(p_group_hash,'') !~ '^[a-f0-9]{64}$' or p_group_hash is distinct from encode(extensions.digest(d::text,'sha256'),'hex')
  or coalesce(p_analysis_hash,'') !~ '^[a-f0-9]{64}$' or p_analysis_hash is distinct from encode(extensions.digest(a.payload::text,'sha256'),'hex')
 then raise exception 'Grup o anàlisi obsolets' using errcode='PT409';end if;
 if a.payload->'coverage_complete' is distinct from 'true'::jsonb or coalesce((d->'blockers') ? 'incomplete',false)
  or jsonb_typeof(d->'concepts') is distinct from 'array' or jsonb_array_length(case when jsonb_typeof(d->'concepts')='array' then d->'concepts' else '[]'::jsonb end)<2 or jsonb_array_length(case when jsonb_typeof(d->'concepts')='array' then d->'concepts' else '[]'::jsonb end)>500
  or d->>'recipient_nature' is distinct from 'private' or d->'joint' is distinct from 'false'::jsonb
  or public.conveni_identity_words(d->>'recipient')='' or public.conveni_identity_words(d->>'period')=''
  or coalesce(d->>'recipient_nif','') !~ '^[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J]$'
  or coalesce(d->>'amount_state','') not in ('planned','conditional','confirmed')
 then raise exception 'Grup o cobertura pendents de documentar';end if;
 if jsonb_typeof(d->'blockers') is distinct from 'array' or exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(d->'blockers')='array' then d->'blockers' else '[]'::jsonb end) b where b not in ('mixed','missing_amount','reconciliation')) then raise exception 'El grup té bloquejos pendents';end if;
 if jsonb_typeof(p_heads) is distinct from 'object' then raise exception 'Revisions individuals incompletes';end if;
 select count(*) into heads_count from jsonb_object_keys(p_heads);
 if heads_count<>jsonb_array_length(d->'concepts') then raise exception 'Revisions individuals incompletes';end if;
 if not exists(select 1 from public.eligible_official_services where version_id=a.catalog_version_id and service_code=p_code) then raise exception 'Servei no elegible';end if;
 for i in 0..jsonb_array_length(d->'concepts')-1 loop
  concept_:=d->'concepts'->i;
  if concept_->'joint' is distinct from 'false'::jsonb or concept_->'mixed' is distinct from 'false'::jsonb
   or concept_->>'recipient_nature' is distinct from 'private'
   or public.conveni_identity_words(concept_->>'recipient') is distinct from public.conveni_identity_words(d->>'recipient')
   or concept_->>'recipient_nif' is distinct from d->>'recipient_nif'
   or public.conveni_identity_words(concept_->>'period') is distinct from public.conveni_identity_words(d->>'period')
   or concept_->'year' is distinct from d->'year' or concept_->>'amount_state' is distinct from d->>'amount_state'
   or jsonb_typeof(concept_->'blockers') is distinct from 'array'
   or exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(concept_->'blockers')='array' then concept_->'blockers' else '[]'::jsonb end) b where b not in ('missing_amount','reconciliation'))
   or not exists(select 1 from public.conveni_concept_proposals c where c.job_id=p_job and c.unit_id=u.id and c.concept_index=i
     and c.review_is_current and c.outcome='select' and c.social_confirmed and c.reviewed_code=p_code
     and c.review_id::text=p_heads->>i::text)
  then raise exception 'Concepte, atribució o revisió individual pendents';end if;
 end loop;
 if jsonb_typeof(p_confirmations) is distinct from 'object' or exists(select 1 from unnest(array['public_total','recipient_period','covers_concepts','same_social_service','recipient_role','conditions_preserved','not_a_sum_or_shared']) key where p_confirmations->key is distinct from 'true'::jsonb)
  or length(trim(coalesce(p_note,'')))<10 then raise exception 'Cal confirmar i justificar totes les comprovacions';end if;
 if p_amount_cents is null or p_amount_cents<0 or p_amount_cents>9007199254740991
  or public.conveni_group_literal_cents(p_amount_literal) is distinct from p_amount_cents::numeric
  or not public.conveni_quote_has_amount_literal(p_total_citation->>'quote',p_amount_literal)
 then raise exception 'Import literal invàlid o no acreditat a la cita';end if;
 -- Matching actor is a model proposal, not proof of economic role; the human
 -- confirmation above remains mandatory.
 if not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(a.payload->'actors')='array' then a.payload->'actors' else '[]'::jsonb end) actor
   where actor.value->>'nature'='private' and jsonb_typeof(actor.value->'roles')='array' and actor.value->'roles' ? 'recipient'
    and public.conveni_identity_words(actor.value->>'name')=public.conveni_identity_words(d->>'recipient')
    and regexp_replace(upper(coalesce(actor.value->>'nif','')),'[[:space:]-]','','g')=d->>'recipient_nif')
  or not public.conveni_identity_quote_matches(d->>'recipient',d->>'recipient_nif',p_identity_citation->>'quote')
 then raise exception 'Identitat del receptor pendent de documentar';end if;
 perform 1 from public.source_documents sd where sd.source_record_id=r.id order by sd.id for share;
 perform 1 from storage.objects o join public.source_documents sd on sd.storage_path=o.name and o.bucket_id='cloud-documents' where sd.source_record_id=r.id order by o.name for share of o;
 if exists(select 1 from public.source_documents sd where sd.source_record_id=r.id and sd.document_type in ('agreement','annex')
    and (sd.status<>'fetched' or sd.extraction_partial is not false or sd.storage_sha256 is null or sd.storage_path is null
      or coalesce(sd.quality_flags,'{}') && array['corrupt_text','incomplete_extraction']
      or sd.storage_sha256 !~ '^[0-9a-f]{64}$'
      or sd.storage_path !~ ('^cases/'||r.id::text||'/documents/'||sd.id::text||'/'||sd.storage_sha256||'\.[a-z0-9]+$')
      or not exists(select 1 from storage.objects o where o.bucket_id='cloud-documents' and o.name=sd.storage_path)
      or a.document_revisions->>sd.id::text is distinct from sd.storage_sha256||':'||coalesce(sd.active_extraction_id::text,'')))
  or exists(select 1 from jsonb_each_text(a.document_revisions) rev left join public.source_documents sd on sd.id::text=rev.key
    where sd.id is null or sd.source_record_id<>r.id or coalesce(sd.document_type,'') not in ('agreement','annex')
      or sd.status<>'fetched' or sd.extraction_partial is not false or sd.storage_sha256 is null or sd.storage_path is null
      or coalesce(sd.quality_flags,'{}') && array['corrupt_text','incomplete_extraction']
      or rev.value is distinct from sd.storage_sha256||':'||coalesce(sd.active_extraction_id::text,''))
 then raise exception 'Cobertura documental canviada' using errcode='PT409';end if;
 -- Re-evaluate every head after locking documents: a concurrent extraction
 -- update must not turn an earlier freshness check into stale evidence.
 for i in 0..jsonb_array_length(d->'concepts')-1 loop
  if not exists(select 1 from public.conveni_concept_proposals c where c.job_id=p_job and c.unit_id=u.id and c.concept_index=i
    and c.review_is_current and c.outcome='select' and c.social_confirmed and c.reviewed_code=p_code and c.review_id::text=p_heads->>i::text)
  then raise exception 'Revisió individual o evidència obsoleta' using errcode='PT409';end if;
 end loop;
 foreach citation in array array[p_total_citation,p_identity_citation] loop
  if jsonb_typeof(citation) is distinct from 'object' or coalesce(citation->>'page','') !~ '^[1-9][0-9]{0,5}$' then raise exception 'Cita invàlida';end if;
  select * into doc from public.source_documents where id::text=citation->>'document_id' and source_record_id=r.id and document_type in ('agreement','annex');
  if not found or not public.conveni_citation_on_page(doc.extracted_text,(citation->>'page')::integer,citation->>'quote') then raise exception 'Cita no verificable a la pàgina indicada';end if;
 end loop;
 select * into last_ from public.conveni_group_preparation_events where job_id=p_job and unit_id=u.id order by sequence desc limit 1;
 select * into existing from public.conveni_group_preparation_events where id=p_event;
 if found then
  if last_.id=existing.id and existing.source_record_id=p_record and existing.job_id=p_job and existing.unit_id=p_unit
   and existing.previous_event_id is not distinct from p_previous and existing.parent_review_id is not distinct from p_parent_review
   and existing.group_hash=p_group_hash and existing.analysis_hash=p_analysis_hash and existing.source_hash=p_source_hash and existing.document_revisions=p_revisions
   and existing.concept_heads=p_heads and existing.service_code=p_code and existing.amount_cents=p_amount_cents
   and existing.amount_literal=p_amount_literal and existing.total_citation=p_total_citation and existing.identity_citation=p_identity_citation
   and existing.confirmations=p_confirmations and existing.reason=p_note then return;end if;
  raise exception 'Identificador de preparació reutilitzat o obsolet' using errcode='PT409';
 end if;
 if last_.id is distinct from p_previous then raise exception 'Preparació obsoleta' using errcode='PT409';end if;
 insert into public.conveni_group_preparation_events(id,source_record_id,job_id,unit_id,sequence,previous_event_id,parent_review_id,group_hash,source_hash,analysis_hash,document_revisions,concept_heads,catalog_version_id,service_code,amount_cents,proposed_amount_state,amount_literal,total_citation,identity_citation,confirmations,reason,group_snapshot)
 values(p_event,r.id,p_job,u.id,coalesce(last_.sequence,0)+1,p_previous,p_parent_review,p_group_hash,a.source_hash,p_analysis_hash,a.document_revisions,p_heads,a.catalog_version_id,p_code,p_amount_cents,d->>'amount_state',p_amount_literal,p_total_citation,p_identity_citation,p_confirmations,p_note,d);
end $$;
revoke all on function public.prepare_conveni_group(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,bigint,text,jsonb,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.prepare_conveni_group(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,bigint,text,jsonb,jsonb,jsonb,text) to service_role;

-- A preparation remains visible for audit even when invalidated; the boolean
-- is recalculated from the current proposal, event heads and source evidence.
create view public.conveni_group_preparations with (security_invoker=true) as
 select c.source_record_id,c.job_id,c.unit_id,c.source_hash,c.document_revisions,c.review_id as parent_review_id,
  encode(extensions.digest(c.data::text,'sha256'),'hex') as group_hash,
  encode(extensions.digest(a.payload::text,'sha256'),'hex') as analysis_hash,
  head.id as preparation_id,head.sequence,head.service_code,head.amount_cents,head.proposed_amount_state,
  head.amount_literal,head.total_citation,head.identity_citation,head.confirmations,head.reason,
  coalesce(head.id is not null and head.group_hash=encode(extensions.digest(c.data::text,'sha256'),'hex')
   and head.parent_review_id is not distinct from c.review_id
   and head.source_hash=c.source_hash and head.analysis_hash=encode(extensions.digest(a.payload::text,'sha256'),'hex') and c.source_hash=public.conveni_source_hash(c.source_record_id)
   and head.document_revisions=c.document_revisions and c.payload->'coverage_complete'='true'::jsonb
   and not exists(select 1 from public.source_documents sd where sd.source_record_id=c.source_record_id and sd.document_type in ('agreement','annex')
    and (sd.storage_sha256 is null or sd.storage_sha256 !~ '^[0-9a-f]{64}$' or sd.storage_path is null
     or sd.storage_path !~ ('^cases/'||c.source_record_id::text||'/documents/'||sd.id::text||'/'||sd.storage_sha256||'\.[a-z0-9]+$')
     or not exists(select 1 from storage.objects o where o.bucket_id='cloud-documents' and o.name=sd.storage_path)))
   and a.catalog_version_id=head.catalog_version_id
   and exists(select 1 from public.eligible_official_services os where os.version_id=head.catalog_version_id and os.service_code=head.service_code)
   and jsonb_typeof(head.concept_heads)='object' and jsonb_typeof(c.data->'concepts')='array'
   and (select count(*) from jsonb_object_keys(case when jsonb_typeof(head.concept_heads)='object' then head.concept_heads else '{}'::jsonb end))=jsonb_array_length(case when jsonb_typeof(c.data->'concepts')='array' then c.data->'concepts' else '[]'::jsonb end)
   and not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(c.data->'concepts')='array' then c.data->'concepts' else '[]'::jsonb end) with ordinality x(value,ordinality)
    where not exists(select 1 from public.conveni_concept_proposals cp where cp.job_id=c.job_id and cp.unit_id=c.unit_id and cp.concept_index=(x.ordinality-1)::integer
     and cp.review_is_current and cp.outcome='select' and cp.social_confirmed and cp.reviewed_code=head.service_code
     and cp.review_id::text=head.concept_heads->>(x.ordinality-1)::text))
   and public.conveni_group_literal_cents(head.amount_literal)=head.amount_cents
   and public.conveni_quote_has_amount_literal(head.total_citation->>'quote',head.amount_literal)
   and public.conveni_identity_quote_matches(c.data->>'recipient',c.data->>'recipient_nif',head.identity_citation->>'quote')
   and exists(select 1 from public.source_documents sd where sd.id::text=head.total_citation->>'document_id' and sd.source_record_id=c.source_record_id and sd.document_type in ('agreement','annex')
    and public.conveni_citation_on_page(sd.extracted_text,case when coalesce(head.total_citation->>'page','') ~ '^[1-9][0-9]{0,5}$' then (head.total_citation->>'page')::integer else null end,head.total_citation->>'quote'))
   and exists(select 1 from public.source_documents sd where sd.id::text=head.identity_citation->>'document_id' and sd.source_record_id=c.source_record_id and sd.document_type in ('agreement','annex')
    and public.conveni_citation_on_page(sd.extracted_text,case when coalesce(head.identity_citation->>'page','') ~ '^[1-9][0-9]{0,5}$' then (head.identity_citation->>'page')::integer else null end,head.identity_citation->>'quote')),
   false) as preparation_is_current
 from public.conveni_current_units c join public.conveni_analyses a on a.job_id=c.job_id
 left join lateral (select e.* from public.conveni_group_preparation_events e where e.job_id=c.job_id and e.unit_id=c.unit_id order by e.sequence desc limit 1) head on true
 where jsonb_typeof(c.data->'concepts')='array' and jsonb_array_length(case when jsonb_typeof(c.data->'concepts')='array' then c.data->'concepts' else '[]'::jsonb end)>=2;
revoke all on public.conveni_group_preparations from public,anon,authenticated;
grant select on public.conveni_group_preparations to service_role;
