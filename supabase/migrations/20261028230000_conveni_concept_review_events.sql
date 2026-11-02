-- Concept reviews are audit events only: they neither allocate amounts nor
-- approve/reject a grouped economic unit or create a service provision.
create table public.conveni_concept_review_events (
 id uuid primary key,
 source_record_id uuid not null references public.source_records(id),
 job_id uuid not null,
 unit_id uuid not null,
 concept_index integer not null check(concept_index>=0),
 concept_hash text not null check(concept_hash ~ '^[0-9a-f]{64}$'),
 sequence integer not null check(sequence>0),
 previous_event_id uuid references public.conveni_concept_review_events(id),
 parent_review_id uuid references public.conveni_review_events(id),
 outcome text not null check(outcome in ('select','outside','reject','insufficient')),
 service_code text,
 reason text not null check(length(trim(reason))>=10),
 selected_citation jsonb not null,
 social_confirmed boolean not null,
 source_hash text not null,
 document_revisions jsonb not null,
 catalog_version_id text not null references public.catalog_versions(id),
 concept_snapshot jsonb not null,
 actor text not null default 'local_user',
 created_at timestamptz not null default clock_timestamp(),
 foreign key(job_id,unit_id) references public.conveni_unit_proposals(job_id,unit_id),
 unique(job_id,unit_id,concept_index,sequence)
);
create index conveni_concept_review_latest on public.conveni_concept_review_events(job_id,unit_id,concept_index,sequence desc);
alter table public.conveni_concept_review_events enable row level security;
revoke all on public.conveni_concept_review_events from public,anon,authenticated,service_role;
grant select on public.conveni_concept_review_events to service_role;

-- The canonical JSONB serialization is hashed on the database, not recreated
-- independently in JavaScript. Ordinality is exposed as a zero-based index.
create view public.conveni_concept_proposals with (security_invoker=true) as
 select c.source_record_id,c.job_id,c.unit_id,c.source_hash,c.document_revisions,c.review_id as parent_review_id,
  (concept.ordinality-1)::integer as concept_index,concept.value as concept,
  encode(extensions.digest(concept.value::text,'sha256'),'hex') as concept_hash,
  head.id as review_id,head.sequence as review_sequence,head.outcome,head.service_code as reviewed_code,
  head.reason as review_note,head.selected_citation,head.social_confirmed
 from public.conveni_current_units c
 cross join lateral jsonb_array_elements(case when jsonb_typeof(c.data->'concepts')='array' then c.data->'concepts' else '[]'::jsonb end)
  with ordinality as concept(value,ordinality)
 left join lateral (select e.* from public.conveni_concept_review_events e
  where e.job_id=c.job_id and e.unit_id=c.unit_id and e.concept_index=(concept.ordinality-1)::integer
   and e.concept_hash=encode(extensions.digest(concept.value::text,'sha256'),'hex')
  order by e.sequence desc limit 1) head on true;
revoke all on public.conveni_concept_proposals from public,anon,authenticated;
grant select on public.conveni_concept_proposals to service_role;

create function public.review_conveni_concept(
 p_record uuid,p_job uuid,p_unit uuid,p_index integer,p_event uuid,
 p_previous uuid,p_parent_review uuid,p_expected_hash text,p_source_hash text,p_revisions jsonb,
 p_outcome text,p_code text,p_note text,p_citation jsonb,p_social_confirmed boolean
) returns void language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
declare r public.source_records;a public.conveni_analyses;u public.record_units;data_ jsonb;concept_ jsonb;
 last_event public.conveni_concept_review_events;existing public.conveni_concept_review_events;parent_ uuid;doc public.source_documents;next_sequence integer;
begin
 select * into strict r from public.source_records where id=p_record for update;
 select * into strict a from public.conveni_analyses where job_id=p_job and source_record_id=r.id;
 select * into strict u from public.record_units where id=p_unit and source_record_id=r.id for update;
 select * into existing from public.conveni_concept_review_events where id=p_event;
 if found then
  if existing.source_record_id=p_record and existing.job_id=p_job and existing.unit_id=p_unit and existing.concept_index=p_index
   and existing.previous_event_id is not distinct from p_previous and existing.parent_review_id is not distinct from p_parent_review
   and existing.concept_hash=p_expected_hash and existing.source_hash=p_source_hash and existing.document_revisions=p_revisions
   and existing.outcome=p_outcome and existing.service_code is not distinct from p_code and existing.reason=p_note
   and existing.selected_citation=p_citation and existing.social_confirmed is not distinct from p_social_confirmed
  then return;end if;
  raise exception 'Identificador de revisió reutilitzat amb altres dades' using errcode='PT409';
 end if;
 if p_job is distinct from (select id from public.pipeline_jobs where source_record_id=r.id and not verification_only order by created_at desc,id desc limit 1)
  or a.source_hash is distinct from p_source_hash or a.source_hash is distinct from public.conveni_source_hash(r.id)
  or jsonb_typeof(a.document_revisions) is distinct from 'object' or a.document_revisions is distinct from p_revisions
 then raise exception 'Anàlisi o manifest obsolets' using errcode='PT409';end if;
 select id into parent_ from public.conveni_review_events where unit_id=u.id order by created_at desc,id desc limit 1;
 if parent_ is distinct from p_parent_review then raise exception 'Revisió de la unitat obsoleta' using errcode='PT409';end if;
 select data into strict data_ from public.conveni_unit_proposals where job_id=p_job and unit_id=u.id;
 if jsonb_typeof(data_->'concepts') is distinct from 'array' or coalesce(p_index,-1)<0 or p_index>=jsonb_array_length(data_->'concepts') then raise exception 'Concepte inexistent';end if;
 concept_:=data_->'concepts'->p_index;
 if coalesce(p_expected_hash,'') !~ '^[0-9a-f]{64}$' or p_expected_hash is distinct from encode(extensions.digest(concept_::text,'sha256'),'hex') then raise exception 'Concepte obsolet' using errcode='PT409';end if;
 select * into last_event from public.conveni_concept_review_events where job_id=p_job and unit_id=u.id and concept_index=p_index order by sequence desc limit 1;
 if last_event.id is distinct from p_previous or (last_event.id is not null and last_event.concept_hash is distinct from p_expected_hash) then raise exception 'Revisió de concepte obsoleta' using errcode='PT409';end if;
 next_sequence:=coalesce(last_event.sequence,0)+1;
 if p_outcome not in ('select','outside','reject','insufficient') or length(trim(coalesce(p_note,'')))<10 then raise exception 'Cal justificar la decisió';end if;
 if p_outcome in ('select','outside') and p_social_confirmed is not true then raise exception 'Cal confirmar la naturalesa social i la població revisades';end if;
 if p_outcome not in ('select','outside') and p_social_confirmed is distinct from false then raise exception 'Confirmació social incompatible';end if;
 if (p_outcome='select' and not exists(select 1 from public.eligible_official_services where version_id=a.catalog_version_id and service_code=p_code))
  or (p_outcome<>'select' and p_code is not null) then raise exception 'Servei incompatible amb la decisió';end if;
 -- The lock also covers rows that could change type into an annex.
 perform 1 from public.source_documents sd where sd.source_record_id=r.id order by sd.id for share;
 if exists(select 1 from public.source_documents sd where sd.source_record_id=r.id and sd.document_type in ('agreement','annex')
    and (sd.status<>'fetched' or sd.extraction_partial is not false or sd.storage_sha256 is null or sd.storage_path is null
      or coalesce(sd.quality_flags,'{}') && array['corrupt_text','incomplete_extraction']
      or a.document_revisions->>sd.id::text is distinct from sd.storage_sha256||':'||coalesce(sd.active_extraction_id::text,'')))
  or exists(select 1 from jsonb_each_text(a.document_revisions) rev left join public.source_documents sd on sd.id::text=rev.key
    where sd.id is null or sd.source_record_id<>r.id or coalesce(sd.document_type,'') not in ('agreement','annex')
      or sd.status<>'fetched' or sd.extraction_partial is not false or sd.storage_sha256 is null or sd.storage_path is null
      or coalesce(sd.quality_flags,'{}') && array['corrupt_text','incomplete_extraction']
      or rev.value is distinct from sd.storage_sha256||':'||coalesce(sd.active_extraction_id::text,''))
 then raise exception 'Cobertura documental canviada' using errcode='PT409';end if;
 if jsonb_typeof(p_citation) is distinct from 'object' or coalesce(p_citation->>'page','') !~ '^[1-9][0-9]{0,5}$'
  or not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(concept_->'evidence')='array' then concept_->'evidence' else '[]'::jsonb end) ev where ev=p_citation)
 then raise exception 'La cita ha de pertànyer al concepte';end if;
 select * into doc from public.source_documents where id::text=p_citation->>'document_id' and source_record_id=r.id and document_type in ('agreement','annex');
 if not found or not public.conveni_citation_on_page(doc.extracted_text,(p_citation->>'page')::integer,p_citation->>'quote') then raise exception 'Cita no verificable a la pàgina indicada';end if;
 insert into public.conveni_concept_review_events(id,source_record_id,job_id,unit_id,concept_index,concept_hash,sequence,previous_event_id,parent_review_id,outcome,service_code,reason,selected_citation,social_confirmed,source_hash,document_revisions,catalog_version_id,concept_snapshot)
 values(p_event,r.id,p_job,u.id,p_index,p_expected_hash,next_sequence,p_previous,p_parent_review,p_outcome,p_code,p_note,p_citation,p_social_confirmed,a.source_hash,a.document_revisions,a.catalog_version_id,concept_);
end $$;
revoke all on function public.review_conveni_concept(uuid,uuid,uuid,integer,uuid,uuid,uuid,text,text,jsonb,text,text,text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.review_conveni_concept(uuid,uuid,uuid,integer,uuid,uuid,uuid,text,text,jsonb,text,text,text,jsonb,boolean) to service_role;
